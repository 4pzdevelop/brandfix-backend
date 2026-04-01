import { Router } from "express";
import { z } from "zod";
import { ExportType, MilestoneStatus, ReceivableStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { ok } from "../utils/http";

function queryValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function csvEscape(value: unknown): string {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\n") || raw.includes('"')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(row.map(csvEscape).join(","));
  });
  return lines.join("\n");
}

const exportQuerySchema = z.object({
  projectCode: z.string().optional(),
  includeExported: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export const accountingRouter = Router();

accountingRouter.get(
  "/receivables/summary",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const projectCode = queryValue(req.query.projectCode)?.toUpperCase();

    const rows = await prisma.receivable.findMany({
      where: {
        companyId,
        ...(projectCode ? { projectCode } : {}),
      },
      orderBy: { dueDate: "asc" },
    });

    const totals = rows.reduce(
      (acc, item) => {
        acc.totalRevenue += item.totalAmount;
        acc.billed += item.totalAmount;
        acc.collected += item.receivedAmount;
        acc.outstanding += Math.max(item.totalAmount - item.receivedAmount, 0);
        if (item.status === "OVERDUE") {
          acc.overdue += Math.max(item.totalAmount - item.receivedAmount, 0);
        }
        return acc;
      },
      { totalRevenue: 0, billed: 0, collected: 0, outstanding: 0, overdue: 0 },
    );

    const milestoneSnapshot = await prisma.billingMilestone.findMany({
      where: {
        companyId,
        ...(projectCode ? { projectCode } : {}),
      },
      select: {
        projectCode: true,
        milestoneAmount: true,
        gstAmount: true,
        invoiceTotal: true,
        status: true,
      },
    });

    const issuedValue = milestoneSnapshot
      .filter((item) => ["ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE"].includes(item.status))
      .reduce((sum, item) => sum + item.invoiceTotal, 0);

    return ok(res, {
      ...totals,
      issuedValue,
      receivableCount: rows.length,
      statusBreakdown: {
        open: rows.filter((item) => item.status === ReceivableStatus.OPEN).length,
        partial: rows.filter((item) => item.status === ReceivableStatus.PARTIALLY_PAID).length,
        paid: rows.filter((item) => item.status === ReceivableStatus.PAID).length,
        overdue: rows.filter((item) => item.status === ReceivableStatus.OVERDUE).length,
      },
    });
  }),
);

accountingRouter.post(
  "/receivables/mark-overdue",
  authorize("ADMIN", "FINANCE"),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const result = await prisma.receivable.updateMany({
      where: {
        companyId: req.auth!.companyId,
        status: { in: ["OPEN", "PARTIALLY_PAID"] },
        dueDate: { lt: now },
      },
      data: {
        status: "OVERDUE",
      },
    });

    await prisma.billingMilestone.updateMany({
      where: {
        companyId: req.auth!.companyId,
        status: { in: [MilestoneStatus.ISSUED, MilestoneStatus.PARTIALLY_PAID] },
        dueDate: { lt: now },
      },
      data: {
        status: "OVERDUE",
      },
    });

    return ok(res, { updated: result.count });
  }),
);

accountingRouter.get(
  "/exports/sales-invoices",
  authorize("ADMIN", "FINANCE"),
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const query = exportQuerySchema.parse(req.query);
    const projectCode = query.projectCode?.toUpperCase();

    const receivables = await prisma.receivable.findMany({
      where: {
        companyId,
        ...(projectCode ? { projectCode } : {}),
      },
      orderBy: [{ invoiceDate: "asc" }, { createdAt: "asc" }],
    });

    const exportKeys = receivables.map((item) => item.id);
    const logged = exportKeys.length
      ? await prisma.exportLog.findMany({
          where: {
            companyId,
            exportType: ExportType.SALES_INVOICE,
            exportKey: { in: exportKeys },
          },
          select: { exportKey: true },
        })
      : [];
    const loggedSet = new Set(logged.map((item) => item.exportKey));

    const filtered = query.includeExported
      ? receivables
      : receivables.filter((item) => !loggedSet.has(item.id));

    const projects = await prisma.project.findMany({
      where: {
        companyId,
        projectCode: { in: [...new Set(filtered.map((item) => item.projectCode))] },
      },
      include: {
        client: {
          select: { name: true },
        },
      },
    });
    const projectMap = new Map(projects.map((item) => [item.projectCode, item]));

    const rows = filtered.map((item) => {
      const project = projectMap.get(item.projectCode);
      return [
        project?.client?.name ?? "",
        "",
        item.taxableValue,
        item.gstAmount,
        item.invoiceNumber,
        item.projectCode,
        item.invoiceDate.toISOString().slice(0, 10),
      ];
    });

    if (!query.includeExported && filtered.length) {
      await Promise.all(
        filtered.map((item) =>
          prisma.exportLog.upsert({
            where: {
              companyId_exportType_exportKey: {
                companyId,
                exportType: ExportType.SALES_INVOICE,
                exportKey: item.id,
              },
            },
            update: {
              exportedById: req.auth!.userId,
            },
            create: {
              companyId,
              exportType: ExportType.SALES_INVOICE,
              exportKey: item.id,
              exportedById: req.auth!.userId,
            },
          }),
        ),
      );
    }

    return ok(res, {
      fileName: `sales-invoices-${projectCode ?? "all"}.csv`,
      csv: toCsv(
        [
          "Client Name",
          "GST",
          "Taxable Value",
          "GST Amount",
          "Invoice Number",
          "Project Code",
          "Date",
        ],
        rows,
      ),
      exportedCount: filtered.length,
      skippedCount: receivables.length - filtered.length,
    });
  }),
);

accountingRouter.get(
  "/exports/purchase-bills",
  authorize("ADMIN", "FINANCE"),
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const query = exportQuerySchema.parse(req.query);
    const projectCode = query.projectCode?.toUpperCase();

    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        companyId,
        ...(projectCode ? { projectCode } : {}),
        status: { in: ["PAYMENT_AUTHORIZED", "ADMIN_APPROVED", "FINANCE_APPROVED"] },
      },
      include: {
        vendorPo: {
          select: { vendor: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const exportKeys = invoices.map((item) => item.id);
    const logged = exportKeys.length
      ? await prisma.exportLog.findMany({
          where: {
            companyId,
            exportType: ExportType.PURCHASE_BILL,
            exportKey: { in: exportKeys },
          },
          select: { exportKey: true },
        })
      : [];
    const loggedSet = new Set(logged.map((item) => item.exportKey));

    const filtered = query.includeExported
      ? invoices
      : invoices.filter((item) => !loggedSet.has(item.id));

    const rows = filtered.map((item) => [
      item.vendorPo.vendor,
      "",
      item.amount,
      item.projectCode,
      item.invoiceNumber,
      item.createdAt.toISOString().slice(0, 10),
    ]);

    if (!query.includeExported && filtered.length) {
      await Promise.all(
        filtered.map((item) =>
          prisma.exportLog.upsert({
            where: {
              companyId_exportType_exportKey: {
                companyId,
                exportType: ExportType.PURCHASE_BILL,
                exportKey: item.id,
              },
            },
            update: {
              exportedById: req.auth!.userId,
            },
            create: {
              companyId,
              exportType: ExportType.PURCHASE_BILL,
              exportKey: item.id,
              exportedById: req.auth!.userId,
            },
          }),
        ),
      );
    }

    return ok(res, {
      fileName: `purchase-bills-${projectCode ?? "all"}.csv`,
      csv: toCsv(["Vendor", "GST", "Amount", "Project Code", "Invoice Number", "Date"], rows),
      exportedCount: filtered.length,
      skippedCount: invoices.length - filtered.length,
    });
  }),
);

accountingRouter.get(
  "/exports/payroll-journal",
  authorize("ADMIN", "FINANCE"),
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const query = exportQuerySchema.parse(req.query);
    const projectCode = query.projectCode?.toUpperCase();

    const payrolls = await prisma.payrollCycle.findMany({
      where: {
        companyId,
        ...(projectCode ? { projectCode } : {}),
        status: "ADMIN_APPROVED",
      },
      orderBy: [{ cycleMonth: "asc" }, { createdAt: "asc" }],
    });

    const exportKeys = payrolls.map((item) => item.id);
    const logged = exportKeys.length
      ? await prisma.exportLog.findMany({
          where: {
            companyId,
            exportType: ExportType.PAYROLL_JOURNAL,
            exportKey: { in: exportKeys },
          },
          select: { exportKey: true },
        })
      : [];
    const loggedSet = new Set(logged.map((item) => item.exportKey));

    const filtered = query.includeExported
      ? payrolls
      : payrolls.filter((item) => !loggedSet.has(item.id));

    const rows = filtered.map((item) => [
      item.totalAmount,
      0,
      item.totalAmount,
      item.projectCode,
      item.cycleMonth,
      item.approvalId ?? "",
    ]);

    if (!query.includeExported && filtered.length) {
      await Promise.all(
        filtered.map((item) =>
          prisma.exportLog.upsert({
            where: {
              companyId_exportType_exportKey: {
                companyId,
                exportType: ExportType.PAYROLL_JOURNAL,
                exportKey: item.id,
              },
            },
            update: {
              exportedById: req.auth!.userId,
            },
            create: {
              companyId,
              exportType: ExportType.PAYROLL_JOURNAL,
              exportKey: item.id,
              exportedById: req.auth!.userId,
            },
          }),
        ),
      );
    }

    return ok(res, {
      fileName: `payroll-journal-${projectCode ?? "all"}.csv`,
      csv: toCsv(
        ["Labour Expense", "Deductions", "Net Payable", "Project Allocation", "Cycle Month", "Approval ID"],
        rows,
      ),
      exportedCount: filtered.length,
      skippedCount: payrolls.length - filtered.length,
    });
  }),
);
