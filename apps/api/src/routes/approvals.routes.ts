import { Router } from "express";
import { z } from "zod";
import {
  ApprovalActionType,
  ApprovalRecordStatus,
  ExpenseStatus,
  MilestoneStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import {
  createApprovalRecord,
  decideApprovalRecord,
  latestPendingApprovalRecord,
} from "../services/approval.service";
import { writeAuditLog } from "../services/audit-log.service";
import { ok } from "../utils/http";

const FINANCE_APPROVAL_THRESHOLD = 150000;
const MIN_MARGIN_PERCENT = 20;

const expenseCreateSchema = z.object({
  projectCode: z.string().min(3),
  category: z.string().min(2),
  bucketType: z.enum(["MATERIAL", "LABOUR", "LOGISTICS", "MISC"]),
  linkedElement: z.string().optional(),
  vendor: z.string().min(2),
  amount: z.number().positive(),
  quotationAttachment: z.string().url().optional(),
  justification: z.string().min(8),
  isEmergency: z.boolean().optional(),
});

const financeReviewSchema = z.object({
  approve: z.boolean(),
  comment: z.string().max(1000).optional(),
  escalate: z.boolean().optional(),
});

const adminReviewSchema = z.object({
  approve: z.boolean(),
  comment: z.string().max(1000).optional(),
  markPolicyBreach: z.boolean().optional(),
});

const vendorPoCreateSchema = z.object({
  projectCode: z.string().min(3),
  expenseRequestId: z.string(),
  vendor: z.string().min(2),
  amount: z.number().positive(),
});

const vendorInvoiceSchema = z.object({
  vendorPoId: z.string(),
  invoiceNumber: z.string().min(3),
  amount: z.number().positive(),
});

const attendanceSchema = z.object({
  projectCode: z.string().min(3),
  roleLabel: z.string().min(2),
  hours: z.number().positive().max(24),
  workDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  locationText: z.string().max(250).optional(),
});

const labourRateSchema = z.object({
  roleLabel: z.string().min(2),
  hourlyRate: z.number().nonnegative(),
  isActive: z.boolean().optional(),
});

const payrollGenerateSchema = z.object({
  projectCode: z.string().min(3),
  cycleMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

const milestoneSetupSchema = z.object({
  projectCode: z.string().min(3),
  milestones: z
    .array(
      z.object({
        label: z.string().min(2),
        percent: z.number().positive(),
        dueDate: z.string().datetime().optional(),
        gstPercent: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1),
});

const milestonePaymentSchema = z.object({
  amount: z.number().positive(),
});

const overrideSchema = z.object({
  projectCode: z.string().min(3),
  actionType: z.string().min(3),
  reason: z.string().min(6),
  beforeValue: z.any().optional(),
  afterValue: z.any().optional(),
});

const closureRequestSchema = z.object({
  comment: z.string().max(800).optional(),
});

const projectSummaryQuerySchema = z.object({
  projectCode: z.string().min(3),
});

function queryValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function authCompanyId(req: { auth?: { companyId: string } }): string {
  return req.auth!.companyId;
}

function categoryToBucketType(category: string): "MATERIAL" | "LABOUR" | "LOGISTICS" | "MISC" {
  const normalized = category.toUpperCase();
  if (normalized.includes("LABOUR")) return "LABOUR";
  if (normalized.includes("LOGISTIC") || normalized.includes("TRANSPORT")) return "LOGISTICS";
  if (normalized.includes("MATERIAL")) return "MATERIAL";
  return "MISC";
}

async function ensureProjectRecord(params: {
  companyId: string;
  projectCode: string;
  createdById: string;
}) {
  await prisma.project.upsert({
    where: { projectCode: params.projectCode },
    update: {},
    create: {
      companyId: params.companyId,
      projectCode: params.projectCode,
      title: `Project ${params.projectCode}`,
      createdById: params.createdById,
    },
  });
}

async function ensureEmergencyEscalation() {
  const now = new Date();
  const due = await prisma.expenseRequest.findMany({
    where: {
      isEmergency: true,
      status: "EMERGENCY_PENDING_FINANCE",
      emergencyDeadlineAt: { lte: now },
    },
  });
  if (!due.length) {
    return;
  }

  for (const item of due) {
    await prisma.expenseRequest.update({
      where: { id: item.id },
      data: { status: "EMERGENCY_ESCALATED_ADMIN" },
    });

    await createApprovalRecord({
      companyId: item.companyId,
      projectCode: item.projectCode,
      actionType: "EMERGENCY_EXPENSE_APPROVAL",
      requestedById: item.requestedById,
      status: "AUTO_ESCALATED",
      comments: "Emergency expense auto-escalated after 24h finance window",
      metadata: {
        expenseRequestId: item.id,
      },
    });
  }
}

async function projectSnapshot(companyId: string, projectCode: string) {
  const frozenBoq = await prisma.boq.findFirst({
    where: {
      companyId,
      projectCode,
      budgetFrozenAt: { not: null },
      approvalStage: "CLIENT_APPROVED",
    },
    orderBy: { budgetFrozenAt: "desc" },
  });

  const revenue = frozenBoq?.revenueLockedAmount ?? 0;

  const bucketTotals = await prisma.budgetBucket.findMany({
    where: { companyId, projectCode },
  });
  const approvedBudget = bucketTotals.reduce((sum, item) => sum + item.approvedBudget, 0);
  const approvedExpense = bucketTotals.reduce((sum, item) => sum + item.approvedExpense, 0);
  const actualPaid = bucketTotals.reduce((sum, item) => sum + item.actualPaid, 0);

  const payrollCost = await prisma.payrollCycle.aggregate({
    where: {
      companyId,
      projectCode,
      status: { in: ["FINANCE_APPROVED", "ADMIN_APPROVED"] },
    },
    _sum: { totalAmount: true },
  });

  const pendingExpenses = await prisma.expenseRequest.aggregate({
    where: {
      companyId,
      projectCode,
      status: {
        in: [
          "PENDING_FINANCE",
          "BUDGET_BREACH",
          "ESCALATED_ADMIN",
          "EMERGENCY_PENDING_FINANCE",
          "EMERGENCY_ESCALATED_ADMIN",
        ],
      },
    },
    _sum: { amount: true },
  });

  const estimatedCost = approvedBudget;
  const actualCost = actualPaid + (payrollCost._sum.totalAmount ?? 0);
  const forecastFinalCost = actualCost + (pendingExpenses._sum.amount ?? 0);
  const marginValue = revenue - forecastFinalCost;
  const marginPercent = revenue > 0 ? Number(((marginValue / revenue) * 100).toFixed(2)) : 0;

  const statusColor = marginPercent >= MIN_MARGIN_PERCENT ? "GREEN" : marginPercent >= 10 ? "YELLOW" : "RED";

  return {
    projectCode,
    revenue,
    estimatedCost,
    approvedExpense,
    actualCost,
    forecastFinalCost,
    marginValue: Number(marginValue.toFixed(2)),
    marginPercent,
    statusColor,
  };
}

function firstOfMonth(month: string) {
  return new Date(`${month}-01T00:00:00.000Z`);
}

function nextMonth(month: string) {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const numericMonth = Number(monthRaw);
  const next = numericMonth === 12 ? { y: year + 1, m: 1 } : { y: year, m: numericMonth + 1 };
  return new Date(`${next.y}-${String(next.m).padStart(2, "0")}-01T00:00:00.000Z`);
}

export const approvalsRouter = Router();

approvalsRouter.get(
  "/",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    await ensureEmergencyEscalation();

    const projectCode = queryValue(req.query.projectCode)?.toUpperCase();
    const actionTypeRaw = queryValue(req.query.actionType);
    const statusRaw = queryValue(req.query.status);
    const actionType =
      actionTypeRaw && actionTypeRaw in ApprovalActionType
        ? (actionTypeRaw as ApprovalActionType)
        : undefined;
    const status =
      statusRaw && statusRaw in ApprovalRecordStatus
        ? (statusRaw as ApprovalRecordStatus)
        : undefined;

    const where: Prisma.ApprovalRecordWhereInput = {
      companyId: authCompanyId(req),
      ...(projectCode ? { projectCode } : {}),
      ...(actionType ? { actionType } : {}),
      ...(status ? { status } : {}),
    };

    const approvals = await prisma.approvalRecord.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(
      res,
      approvals.map((item) => ({
        approvalId: item.approvalId,
        projectCode: item.projectCode,
        actionType: item.actionType,
        requestedBy: item.requestedBy.name,
        approvedBy: item.approvedBy?.name,
        timestamp: item.createdAt,
        status: item.status,
        comments: item.comments,
      })),
    );
  }),
);

approvalsRouter.get(
  "/projects/:projectCode/summary",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const parsed = projectSummaryQuerySchema.safeParse({
      projectCode: routeParam(req.params.projectCode),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid project code" });
    }
    return ok(res, await projectSnapshot(authCompanyId(req), parsed.data.projectCode));
  }),
);

approvalsRouter.get(
  "/projects/:projectCode/buckets",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const projectCode = routeParam(req.params.projectCode).toUpperCase();
    const buckets = await prisma.budgetBucket.findMany({
      where: { companyId: authCompanyId(req), projectCode },
      orderBy: { bucketType: "asc" },
    });
    return ok(res, buckets);
  }),
);

approvalsRouter.post(
  "/expenses",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(expenseCreateSchema),
  asyncHandler(async (req, res) => {
    await ensureEmergencyEscalation();

    const companyId = authCompanyId(req);
    const projectCode = req.body.projectCode.trim().toUpperCase();
    const bucketType = req.body.bucketType ?? categoryToBucketType(req.body.category);

    const frozenBoq = await prisma.boq.findFirst({
      where: {
        companyId,
        projectCode,
        budgetFrozenAt: { not: null },
      },
      orderBy: { budgetFrozenAt: "desc" },
    });
    if (!frozenBoq) {
      return res.status(409).json({ error: "Budget freeze is required before expense booking" });
    }

    const bucket = await prisma.budgetBucket.findUnique({
      where: {
        companyId_projectCode_bucketType: {
          companyId,
          projectCode,
          bucketType,
        },
      },
    });
    if (!bucket) {
      return res.status(404).json({ error: `Budget bucket ${bucketType} not found` });
    }

    const remainingBudget = Number((bucket.approvedBudget - bucket.approvedExpense).toFixed(2));
    const isEmergency = req.body.isEmergency === true;
    const breach = req.body.amount > remainingBudget;

    const status = isEmergency
      ? "EMERGENCY_PENDING_FINANCE"
      : breach
        ? "BUDGET_BREACH"
        : "PENDING_FINANCE";

    const approval = await createApprovalRecord({
      companyId,
      projectCode,
      actionType: isEmergency ? "EMERGENCY_EXPENSE_APPROVAL" : "EXPENSE_APPROVAL",
      requestedById: req.auth!.userId,
      status: "PENDING",
      comments: req.body.justification,
      metadata: {
        category: req.body.category,
        bucketType,
        amount: req.body.amount,
      },
    });

    const expense = await prisma.expenseRequest.create({
      data: {
        companyId,
        projectCode,
        category: req.body.category,
        linkedElement: req.body.linkedElement,
        vendor: req.body.vendor,
        amount: req.body.amount,
        quotationAttachment: req.body.quotationAttachment,
        justification: req.body.justification,
        requestedById: req.auth!.userId,
        status,
        approvalId: approval.approvalId,
        isEmergency,
        emergencyDeadlineAt: isEmergency ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null,
      },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE_EXPENSE_REQUEST",
      entityType: "EXPENSE_REQUEST",
      entityId: expense.id,
      next: expense,
    });

    return ok(
      res,
      {
        ...expense,
        remainingBudget,
        budgetBreach: breach,
      },
      201,
    );
  }),
);

approvalsRouter.get(
  "/expenses",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    await ensureEmergencyEscalation();
    const projectCode = queryValue(req.query.projectCode)?.toUpperCase();
    const statusRaw = queryValue(req.query.status);
    const status =
      statusRaw && statusRaw in ExpenseStatus
        ? (statusRaw as ExpenseStatus)
        : undefined;
    const expenses = await prisma.expenseRequest.findMany({
      where: {
        companyId: authCompanyId(req),
        ...(projectCode ? { projectCode } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        requestedBy: { select: { id: true, name: true, role: true } },
        financeReviewedBy: { select: { id: true, name: true, role: true } },
        adminReviewedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, expenses);
  }),
);

approvalsRouter.patch(
  "/expenses/:id/finance-review",
  authorize("ADMIN", "FINANCE"),
  validateBody(financeReviewSchema),
  asyncHandler(async (req, res) => {
    await ensureEmergencyEscalation();
    const expenseId = routeParam(req.params.id);

    const previous = await prisma.expenseRequest.findUnique({
      where: { id: expenseId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Expense request not found" });
    }

    if (
      ![
        "PENDING_FINANCE",
        "BUDGET_BREACH",
        "EMERGENCY_PENDING_FINANCE",
        "EMERGENCY_ESCALATED_ADMIN",
      ].includes(previous.status)
    ) {
      return res.status(409).json({ error: `Cannot finance-review expense in ${previous.status}` });
    }

    const forceAdminEscalation =
      previous.status === "BUDGET_BREACH" || previous.amount > FINANCE_APPROVAL_THRESHOLD;
    const escalate = req.body.escalate === true || forceAdminEscalation;

    if (!req.body.approve) {
      const rejectedStatus =
        previous.status === "EMERGENCY_PENDING_FINANCE"
          ? "EMERGENCY_REJECTED"
          : "FINANCE_REJECTED";

      const updated = await prisma.expenseRequest.update({
        where: { id: previous.id },
        data: {
          status: rejectedStatus,
          financeReviewedById: req.auth!.userId,
          reviewComment: req.body.comment,
        },
      });

      if (previous.approvalId) {
        await decideApprovalRecord({
          approvalId: previous.approvalId,
          status: "REJECTED",
          approvedById: req.auth!.userId,
          comments: req.body.comment,
          metadata: {
            expenseRequestId: previous.id,
          },
        });
      }

      return ok(res, updated);
    }

    if (escalate) {
      const escalatedStatus =
        previous.status === "EMERGENCY_PENDING_FINANCE"
          ? "EMERGENCY_ESCALATED_ADMIN"
          : "ESCALATED_ADMIN";

      const updated = await prisma.expenseRequest.update({
        where: { id: previous.id },
        data: {
          status: escalatedStatus,
          financeReviewedById: req.auth!.userId,
          reviewComment: req.body.comment,
        },
      });

      if (previous.approvalId) {
        await decideApprovalRecord({
          approvalId: previous.approvalId,
          status: "ESCALATED",
          approvedById: req.auth!.userId,
          comments: req.body.comment ?? "Escalated to admin for threshold/budget breach",
          metadata: {
            expenseRequestId: previous.id,
            escalated: true,
          },
        });
      }

      return ok(res, updated);
    }

    const approvedStatus =
      previous.status === "EMERGENCY_PENDING_FINANCE"
        ? "EMERGENCY_APPROVED"
        : "FINANCE_APPROVED";

    const bucketType = categoryToBucketType(previous.category);
    await ensureProjectRecord({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      createdById: previous.requestedById,
    });
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.expenseRequest.update({
        where: { id: previous.id },
        data: {
          status: approvedStatus,
          financeReviewedById: req.auth!.userId,
          reviewComment: req.body.comment,
        },
      });

      await tx.budgetBucket.update({
        where: {
          companyId_projectCode_bucketType: {
            companyId: previous.companyId,
            projectCode: previous.projectCode,
            bucketType,
          },
        },
        data: {
          approvedExpense: {
            increment: previous.amount,
          },
        },
      });

      await tx.projectLedger.create({
        data: {
          companyId: previous.companyId,
          projectCode: previous.projectCode,
          entryType: "MISC_EXPENSE",
          amount: previous.amount,
          notes: `Expense approved (${previous.category})`,
          approvalId: previous.approvalId,
          referenceType: "EXPENSE_REQUEST",
          referenceId: previous.id,
          createdById: req.auth!.userId,
        },
      });

      return next;
    });

    if (previous.approvalId) {
      await decideApprovalRecord({
        approvalId: previous.approvalId,
        status: "APPROVED",
        approvedById: req.auth!.userId,
        comments: req.body.comment,
        metadata: {
          expenseRequestId: previous.id,
        },
      });
    }

    return ok(res, updated);
  }),
);

approvalsRouter.patch(
  "/expenses/:id/admin-review",
  authorize("ADMIN"),
  validateBody(adminReviewSchema),
  asyncHandler(async (req, res) => {
    const expenseId = routeParam(req.params.id);
    const previous = await prisma.expenseRequest.findUnique({
      where: { id: expenseId },
    });
    if (!previous) {
      return res.status(404).json({ error: "Expense request not found" });
    }

    if (
      !["ESCALATED_ADMIN", "EMERGENCY_ESCALATED_ADMIN", "BUDGET_BREACH"].includes(
        previous.status,
      )
    ) {
      return res.status(409).json({ error: `Cannot admin-review expense in ${previous.status}` });
    }

    if (req.body.markPolicyBreach) {
      const breachRecord = await createApprovalRecord({
        companyId: previous.companyId,
        projectCode: previous.projectCode,
        actionType: previous.isEmergency
          ? "EMERGENCY_EXPENSE_APPROVAL"
          : "EXPENSE_APPROVAL",
        requestedById: previous.requestedById,
        approvedById: req.auth!.userId,
        status: "POLICY_BREACH",
        comments: req.body.comment ?? "Policy breach marked by admin",
        metadata: {
          expenseRequestId: previous.id,
        },
      });

      const updated = await prisma.expenseRequest.update({
        where: { id: previous.id },
        data: {
          status: previous.isEmergency ? "EMERGENCY_REJECTED" : "ADMIN_REJECTED",
          adminReviewedById: req.auth!.userId,
          reviewComment: req.body.comment,
          approvalId: breachRecord.approvalId,
        },
      });

      return ok(res, updated);
    }

    const approved = req.body.approve;
    const finalStatus = approved
      ? previous.isEmergency
        ? "EMERGENCY_APPROVED"
        : "ADMIN_APPROVED"
      : previous.isEmergency
        ? "EMERGENCY_REJECTED"
        : "ADMIN_REJECTED";

    const approval = await createApprovalRecord({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      actionType: previous.isEmergency
        ? "EMERGENCY_EXPENSE_APPROVAL"
        : "EXPENSE_APPROVAL",
      requestedById: previous.requestedById,
      approvedById: req.auth!.userId,
      status: approved ? "APPROVED" : "REJECTED",
      comments: req.body.comment,
      metadata: {
        expenseRequestId: previous.id,
      },
    });

    if (approved) {
      await ensureProjectRecord({
        companyId: previous.companyId,
        projectCode: previous.projectCode,
        createdById: previous.requestedById,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.expenseRequest.update({
        where: { id: previous.id },
        data: {
          status: finalStatus,
          adminReviewedById: req.auth!.userId,
          reviewComment: req.body.comment,
          approvalId: approval.approvalId,
        },
      });

      if (approved) {
        await tx.budgetBucket.update({
          where: {
            companyId_projectCode_bucketType: {
              companyId: previous.companyId,
              projectCode: previous.projectCode,
              bucketType: categoryToBucketType(previous.category),
            },
          },
          data: {
            approvedExpense: {
              increment: previous.amount,
            },
          },
        });

        await tx.projectLedger.create({
          data: {
            companyId: previous.companyId,
            projectCode: previous.projectCode,
            entryType: "MISC_EXPENSE",
            amount: previous.amount,
            notes: `Expense approved by admin (${previous.category})`,
            approvalId: approval.approvalId,
            referenceType: "EXPENSE_REQUEST",
            referenceId: previous.id,
            createdById: req.auth!.userId,
          },
        });
      }

      return next;
    });

    return ok(res, updated);
  }),
);

approvalsRouter.post(
  "/vendor-pos",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(vendorPoCreateSchema),
  asyncHandler(async (req, res) => {
    const expense = await prisma.expenseRequest.findUnique({
      where: { id: req.body.expenseRequestId },
    });
    if (!expense || expense.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Expense request not found" });
    }
    if (!expense.approvalId) {
      return res.status(409).json({ error: "Expense has no Approval_ID" });
    }
    if (
      ![
        "FINANCE_APPROVED",
        "ADMIN_APPROVED",
        "EMERGENCY_APPROVED",
      ].includes(expense.status)
    ) {
      return res.status(409).json({ error: "Expense is not approved for PO generation" });
    }
    if (expense.projectCode !== req.body.projectCode.toUpperCase()) {
      return res.status(400).json({ error: "Expense project code mismatch" });
    }

    const approval = await createApprovalRecord({
      companyId: expense.companyId,
      projectCode: expense.projectCode,
      actionType: "VENDOR_PO_APPROVAL",
      requestedById: req.auth!.userId,
      status: "PENDING",
      metadata: {
        expenseRequestId: expense.id,
        amount: req.body.amount,
      },
    });

    const record = await prisma.vendorPo.create({
      data: {
        companyId: expense.companyId,
        projectCode: expense.projectCode,
        expenseRequestId: expense.id,
        vendor: req.body.vendor,
        amount: req.body.amount,
        status: "PENDING_FINANCE",
        approvalId: approval.approvalId,
        createdById: req.auth!.userId,
      },
    });

    return ok(res, record, 201);
  }),
);

approvalsRouter.get(
  "/vendor-pos",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const projectCode = queryValue(req.query.projectCode)?.toUpperCase();
    const list = await prisma.vendorPo.findMany({
      where: {
        companyId: authCompanyId(req),
        ...(projectCode ? { projectCode } : {}),
      },
      include: {
        expenseRequest: true,
        createdBy: { select: { id: true, name: true, role: true } },
        financeApprovedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, list);
  }),
);

approvalsRouter.patch(
  "/vendor-pos/:id/finance-review",
  authorize("ADMIN", "FINANCE"),
  validateBody(financeReviewSchema),
  asyncHandler(async (req, res) => {
    const vendorPoId = routeParam(req.params.id);
    const previous = await prisma.vendorPo.findUnique({
      where: { id: vendorPoId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Vendor PO not found" });
    }
    if (previous.status !== "PENDING_FINANCE") {
      return res.status(409).json({ error: `Cannot review PO in ${previous.status}` });
    }
    if (!previous.approvalId) {
      return res.status(409).json({ error: "Vendor PO has no Approval_ID" });
    }

    const approved = req.body.approve === true;
    const updated = await prisma.vendorPo.update({
      where: { id: previous.id },
      data: {
        status: approved ? "ISSUED" : "REJECTED",
        financeApprovedById: req.auth!.userId,
        issuedAt: approved ? new Date() : null,
      },
    });

    await decideApprovalRecord({
      approvalId: previous.approvalId,
      status: approved ? "APPROVED" : "REJECTED",
      approvedById: req.auth!.userId,
      comments: req.body.comment,
      metadata: {
        vendorPoId: previous.id,
      },
    });

    return ok(res, updated);
  }),
);

approvalsRouter.post(
  "/vendor-invoices",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(vendorInvoiceSchema),
  asyncHandler(async (req, res) => {
    const po = await prisma.vendorPo.findUnique({
      where: { id: req.body.vendorPoId },
    });
    if (!po || po.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Vendor PO not found" });
    }
    if (po.status !== "ISSUED" || !po.approvalId) {
      return res.status(409).json({ error: "Vendor PO must be finance approved and issued" });
    }

    const overPo = req.body.amount > po.amount;
    const initialStatus = overPo ? "PENDING_ADMIN" : "PENDING_FINANCE";

    const approval = await createApprovalRecord({
      companyId: po.companyId,
      projectCode: po.projectCode,
      actionType: "VENDOR_INVOICE_APPROVAL",
      requestedById: req.auth!.userId,
      status: "PENDING",
      metadata: {
        vendorPoId: po.id,
        amount: req.body.amount,
        overPo,
      },
    });

    if (overPo) {
      await createApprovalRecord({
        companyId: po.companyId,
        projectCode: po.projectCode,
        actionType: "OVERRIDE_APPROVAL",
        requestedById: req.auth!.userId,
        status: "PENDING",
        comments: "Vendor invoice exceeds approved PO value",
        metadata: {
          vendorPoId: po.id,
          invoiceNumber: req.body.invoiceNumber,
          poAmount: po.amount,
          invoiceAmount: req.body.amount,
        },
      });
    }

    const invoice = await prisma.vendorInvoice.create({
      data: {
        companyId: po.companyId,
        projectCode: po.projectCode,
        vendorPoId: po.id,
        invoiceNumber: req.body.invoiceNumber,
        amount: req.body.amount,
        status: initialStatus,
        approvalId: approval.approvalId,
        createdById: req.auth!.userId,
      },
    });

    return ok(res, invoice, 201);
  }),
);

approvalsRouter.get(
  "/vendor-invoices",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const projectCode = queryValue(req.query.projectCode)?.toUpperCase();
    const invoices = await prisma.vendorInvoice.findMany({
      where: {
        companyId: authCompanyId(req),
        ...(projectCode ? { projectCode } : {}),
      },
      include: {
        vendorPo: true,
        createdBy: { select: { id: true, name: true, role: true } },
        financeReviewedBy: { select: { id: true, name: true, role: true } },
        adminReviewedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, invoices);
  }),
);

approvalsRouter.patch(
  "/vendor-invoices/:id/finance-review",
  authorize("ADMIN", "FINANCE"),
  validateBody(financeReviewSchema),
  asyncHandler(async (req, res) => {
    const vendorInvoiceId = routeParam(req.params.id);
    const previous = await prisma.vendorInvoice.findUnique({
      where: { id: vendorInvoiceId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Vendor invoice not found" });
    }
    if (previous.status !== "PENDING_FINANCE") {
      return res.status(409).json({ error: `Cannot finance-review invoice in ${previous.status}` });
    }
    if (!previous.approvalId) {
      return res.status(409).json({ error: "Vendor invoice has no Approval_ID" });
    }

    const approved = req.body.approve === true;
    const updated = await prisma.vendorInvoice.update({
      where: { id: previous.id },
      data: {
        status: approved ? "FINANCE_APPROVED" : "FINANCE_REJECTED",
        financeReviewedById: req.auth!.userId,
        reviewComment: req.body.comment,
      },
    });

    await decideApprovalRecord({
      approvalId: previous.approvalId,
      status: approved ? "APPROVED" : "REJECTED",
      approvedById: req.auth!.userId,
      comments: req.body.comment,
      metadata: {
        vendorInvoiceId: previous.id,
      },
    });

    return ok(res, updated);
  }),
);

approvalsRouter.patch(
  "/vendor-invoices/:id/admin-review",
  authorize("ADMIN"),
  validateBody(adminReviewSchema),
  asyncHandler(async (req, res) => {
    const vendorInvoiceId = routeParam(req.params.id);
    const previous = await prisma.vendorInvoice.findUnique({
      where: { id: vendorInvoiceId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Vendor invoice not found" });
    }
    if (previous.status !== "PENDING_ADMIN") {
      return res.status(409).json({ error: `Cannot admin-review invoice in ${previous.status}` });
    }

    const approved = req.body.approve === true;
    const finalApproval = await createApprovalRecord({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      actionType: "VENDOR_INVOICE_APPROVAL",
      requestedById: previous.createdById,
      approvedById: req.auth!.userId,
      status: approved ? "APPROVED" : "REJECTED",
      comments: req.body.comment,
      metadata: {
        vendorInvoiceId: previous.id,
      },
    });

    const updated = await prisma.vendorInvoice.update({
      where: { id: previous.id },
      data: {
        status: approved ? "ADMIN_APPROVED" : "ADMIN_REJECTED",
        adminReviewedById: req.auth!.userId,
        reviewComment: req.body.comment,
        approvalId: finalApproval.approvalId,
      },
    });

    return ok(res, updated);
  }),
);

approvalsRouter.patch(
  "/vendor-invoices/:id/authorize-payment",
  authorize("ADMIN", "FINANCE"),
  asyncHandler(async (req, res) => {
    const vendorInvoiceId = routeParam(req.params.id);
    const previous = await prisma.vendorInvoice.findUnique({
      where: { id: vendorInvoiceId },
      include: {
        vendorPo: {
          include: { expenseRequest: true },
        },
      },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Vendor invoice not found" });
    }
    if (!["FINANCE_APPROVED", "ADMIN_APPROVED"].includes(previous.status)) {
      return res.status(409).json({ error: "Invoice must be approved before payment authorization" });
    }
    if (!previous.approvalId) {
      return res.status(409).json({ error: "No linked Approval_ID found for invoice" });
    }

    const paymentApproval = await createApprovalRecord({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      actionType: "PAYMENT_AUTHORIZATION",
      requestedById: req.auth!.userId,
      approvedById: req.auth!.userId,
      status: "APPROVED",
      comments: `Payment authorized for invoice ${previous.invoiceNumber}`,
      metadata: {
        vendorInvoiceId: previous.id,
      },
    });

    await ensureProjectRecord({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      createdById: previous.createdById,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const invoice = await tx.vendorInvoice.update({
        where: { id: previous.id },
        data: {
          status: "PAYMENT_AUTHORIZED",
          paymentAuthorizationId: paymentApproval.approvalId,
          paymentAuthorizedAt: new Date(),
        },
      });

      const expense = previous.vendorPo.expenseRequest;
      if (expense) {
        await tx.budgetBucket.update({
          where: {
            companyId_projectCode_bucketType: {
              companyId: previous.companyId,
              projectCode: previous.projectCode,
              bucketType: categoryToBucketType(expense.category),
            },
          },
          data: {
            actualPaid: {
              increment: previous.amount,
            },
          },
        });
      }

      await tx.projectLedger.create({
        data: {
          companyId: previous.companyId,
          projectCode: previous.projectCode,
          entryType: "VENDOR_INVOICE",
          amount: previous.amount,
          notes: `Vendor invoice authorized: ${previous.invoiceNumber}`,
          approvalId: paymentApproval.approvalId,
          referenceType: "VENDOR_INVOICE",
          referenceId: previous.id,
          createdById: req.auth!.userId,
        },
      });

      return invoice;
    });

    return ok(res, updated);
  }),
);

approvalsRouter.post(
  "/attendance/mark",
  authorize("FINANCE", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  validateBody(attendanceSchema),
  asyncHandler(async (req, res) => {
    const role = req.auth!.role;
    if (role === "CLIENT") {
      return res.status(403).json({ error: "Client users cannot mark attendance" });
    }

    const companyId = authCompanyId(req);
    const projectCode = req.body.projectCode.toUpperCase();
    const rate = await prisma.labourRateMaster.findUnique({
      where: {
        companyId_roleLabel: {
          companyId,
          roleLabel: req.body.roleLabel,
        },
      },
    });
    if (!rate || !rate.isActive) {
      return res.status(409).json({ error: "Active labour rate is required for attendance role" });
    }

    await ensureProjectRecord({
      companyId,
      projectCode,
      createdById: req.auth!.userId,
    });

    const entry = await prisma.$transaction(async (tx) => {
      const attendance = await tx.attendanceLog.create({
        data: {
          companyId,
          projectCode,
          userId: req.auth!.userId,
          roleLabel: req.body.roleLabel,
          hours: req.body.hours,
          workDate: new Date(`${req.body.workDate}T00:00:00.000Z`),
          latitude: req.body.latitude,
          longitude: req.body.longitude,
          locationText: req.body.locationText,
        },
      });

      await tx.projectLedger.create({
        data: {
          companyId,
          projectCode,
          entryType: "LABOUR_ATTENDANCE",
          amount: Number((req.body.hours * rate.hourlyRate).toFixed(2)),
          notes: `Attendance cost (${req.body.roleLabel})`,
          referenceType: "ATTENDANCE",
          referenceId: attendance.id,
          createdById: req.auth!.userId,
        },
      });

      return attendance;
    });

    return ok(res, entry, 201);
  }),
);

approvalsRouter.get(
  "/attendance",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const dateFrom = queryValue(req.query.dateFrom);
    const dateTo = queryValue(req.query.dateTo);
    const projectCode = queryValue(req.query.projectCode)?.toUpperCase();
    const userId = queryValue(req.query.userId);

    const logs = await prisma.attendanceLog.findMany({
      where: {
        companyId: authCompanyId(req),
        ...(projectCode ? { projectCode } : {}),
        ...(userId ? { userId } : {}),
        ...(dateFrom || dateTo
          ? {
              workDate: {
                ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
                ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy: [{ workDate: "desc" }, { markedAt: "desc" }],
    });

    return ok(res, logs);
  }),
);

approvalsRouter.get(
  "/labour-rates",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const rates = await prisma.labourRateMaster.findMany({
      where: { companyId: authCompanyId(req) },
      orderBy: { roleLabel: "asc" },
    });
    return ok(res, rates);
  }),
);

approvalsRouter.post(
  "/labour-rates",
  authorize("ADMIN"),
  validateBody(labourRateSchema),
  asyncHandler(async (req, res) => {
    const rate = await prisma.labourRateMaster.upsert({
      where: {
        companyId_roleLabel: {
          companyId: authCompanyId(req),
          roleLabel: req.body.roleLabel,
        },
      },
      update: {
        hourlyRate: req.body.hourlyRate,
        isActive: req.body.isActive ?? true,
      },
      create: {
        companyId: authCompanyId(req),
        roleLabel: req.body.roleLabel,
        hourlyRate: req.body.hourlyRate,
        isActive: req.body.isActive ?? true,
      },
    });
    return ok(res, rate, 201);
  }),
);

approvalsRouter.post(
  "/payroll/generate",
  authorize("FINANCE", "ADMIN"),
  validateBody(payrollGenerateSchema),
  asyncHandler(async (req, res) => {
    const companyId = authCompanyId(req);
    const start = firstOfMonth(req.body.cycleMonth);
    const end = nextMonth(req.body.cycleMonth);

    const logs = await prisma.attendanceLog.findMany({
      where: {
        companyId,
        projectCode: req.body.projectCode.toUpperCase(),
        workDate: { gte: start, lt: end },
      },
    });
    if (!logs.length) {
      return res.status(404).json({ error: "No attendance logs found for selected cycle" });
    }

    const roles = [...new Set(logs.map((entry) => entry.roleLabel))];
    const rates = await prisma.labourRateMaster.findMany({
      where: {
        companyId,
        roleLabel: { in: roles },
        isActive: true,
      },
    });
    const rateMap = new Map(rates.map((entry) => [entry.roleLabel, entry.hourlyRate]));
    const missingRates = roles.filter((role) => !rateMap.has(role));
    if (missingRates.length) {
      return res.status(409).json({
        error: "Labour rates missing for roles",
        missingRates,
      });
    }

    let totalHours = 0;
    let totalAmount = 0;
    const breakdown = logs.map((entry) => {
      const rate = rateMap.get(entry.roleLabel) ?? 0;
      const amount = Number((entry.hours * rate).toFixed(2));
      totalHours += entry.hours;
      totalAmount += amount;
      return {
        attendanceId: entry.id,
        userId: entry.userId,
        roleLabel: entry.roleLabel,
        hours: entry.hours,
        rate,
        amount,
      };
    });

    const approval = await createApprovalRecord({
      companyId,
      projectCode: req.body.projectCode.toUpperCase(),
      actionType: "PAYROLL_APPROVAL",
      requestedById: req.auth!.userId,
      status: "PENDING",
      metadata: {
        cycleMonth: req.body.cycleMonth,
        breakdown,
      },
    });

    const cycle = await prisma.payrollCycle.upsert({
      where: {
        companyId_projectCode_cycleMonth: {
          companyId,
          projectCode: req.body.projectCode.toUpperCase(),
          cycleMonth: req.body.cycleMonth,
        },
      },
      update: {
        status: "PENDING_FINANCE",
        totalHours: Number(totalHours.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
        approvalId: approval.approvalId,
        generatedById: req.auth!.userId,
      },
      create: {
        companyId,
        projectCode: req.body.projectCode.toUpperCase(),
        cycleMonth: req.body.cycleMonth,
        status: "PENDING_FINANCE",
        totalHours: Number(totalHours.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
        approvalId: approval.approvalId,
        generatedById: req.auth!.userId,
      },
    });

    return ok(res, { cycle, breakdown }, 201);
  }),
);

approvalsRouter.get(
  "/payroll",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const projectCode = queryValue(req.query.projectCode)?.toUpperCase();
    const cycleMonth = queryValue(req.query.cycleMonth);
    const list = await prisma.payrollCycle.findMany({
      where: {
        companyId: authCompanyId(req),
        ...(projectCode ? { projectCode } : {}),
        ...(cycleMonth ? { cycleMonth } : {}),
      },
      include: {
        generatedBy: { select: { id: true, name: true, role: true } },
        financeReviewedBy: { select: { id: true, name: true, role: true } },
        adminReviewedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: [{ cycleMonth: "desc" }, { createdAt: "desc" }],
    });
    return ok(res, list);
  }),
);

approvalsRouter.patch(
  "/payroll/:id/finance-review",
  authorize("FINANCE"),
  validateBody(financeReviewSchema),
  asyncHandler(async (req, res) => {
    const payrollId = routeParam(req.params.id);
    const previous = await prisma.payrollCycle.findUnique({
      where: { id: payrollId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Payroll cycle not found" });
    }
    if (previous.status !== "PENDING_FINANCE") {
      return res.status(409).json({ error: `Cannot finance-review payroll in ${previous.status}` });
    }
    if (!previous.approvalId) {
      return res.status(409).json({ error: "Payroll has no Approval_ID" });
    }

    const approved = req.body.approve === true;
    const updated = await prisma.payrollCycle.update({
      where: { id: previous.id },
      data: {
        status: approved ? "FINANCE_APPROVED" : "FINANCE_REJECTED",
        financeReviewedById: req.auth!.userId,
        financeComment: req.body.comment,
      },
    });

    await decideApprovalRecord({
      approvalId: previous.approvalId,
      status: approved ? "APPROVED" : "REJECTED",
      approvedById: req.auth!.userId,
      comments: req.body.comment,
      metadata: {
        payrollCycleId: previous.id,
      },
    });

    return ok(res, updated);
  }),
);

approvalsRouter.patch(
  "/payroll/:id/admin-review",
  authorize("ADMIN"),
  validateBody(adminReviewSchema),
  asyncHandler(async (req, res) => {
    const payrollId = routeParam(req.params.id);
    const previous = await prisma.payrollCycle.findUnique({
      where: { id: payrollId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Payroll cycle not found" });
    }
    if (previous.status !== "FINANCE_APPROVED") {
      return res.status(409).json({ error: "Finance-approved payroll is required" });
    }

    const approved = req.body.approve === true;
    const approval = await createApprovalRecord({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      actionType: "PAYROLL_APPROVAL",
      requestedById: previous.generatedById,
      approvedById: req.auth!.userId,
      status: approved ? "APPROVED" : "REJECTED",
      comments: req.body.comment,
      metadata: {
        payrollCycleId: previous.id,
        finalAdminApproval: true,
      },
    });

    const updated = await prisma.payrollCycle.update({
      where: { id: previous.id },
      data: {
        status: approved ? "ADMIN_APPROVED" : "ADMIN_REJECTED",
        adminReviewedById: req.auth!.userId,
        adminComment: req.body.comment,
        approvalId: approval.approvalId,
      },
    });

    if (approved) {
      await ensureProjectRecord({
        companyId: previous.companyId,
        projectCode: previous.projectCode,
        createdById: previous.generatedById,
      });
      await prisma.projectLedger.create({
        data: {
          companyId: previous.companyId,
          projectCode: previous.projectCode,
          entryType: "PAYROLL",
          amount: previous.totalAmount,
          notes: `Payroll approved for ${previous.cycleMonth}`,
          approvalId: approval.approvalId,
          referenceType: "PAYROLL",
          referenceId: previous.id,
          createdById: req.auth!.userId,
        },
      });
    }

    return ok(res, updated);
  }),
);

approvalsRouter.get(
  "/payroll/:id/export",
  authorize("ADMIN", "FINANCE"),
  asyncHandler(async (req, res) => {
    const payrollId = routeParam(req.params.id);
    const cycle = await prisma.payrollCycle.findUnique({
      where: { id: payrollId },
    });
    if (!cycle || cycle.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Payroll cycle not found" });
    }
    if (cycle.status !== "ADMIN_APPROVED" || !cycle.approvalId) {
      return res.status(409).json({ error: "Only admin-approved payroll can be exported" });
    }

    const csvLines = [
      "ProjectCode,CycleMonth,TotalHours,TotalAmount,ApprovalID",
      `${cycle.projectCode},${cycle.cycleMonth},${cycle.totalHours},${cycle.totalAmount},${cycle.approvalId}`,
    ];
    return ok(res, {
      fileName: `payroll-${cycle.projectCode}-${cycle.cycleMonth}.csv`,
      csv: csvLines.join("\n"),
    });
  }),
);

approvalsRouter.post(
  "/billing/milestones",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  validateBody(milestoneSetupSchema),
  asyncHandler(async (req, res) => {
    const companyId = authCompanyId(req);
    const payload = req.body as z.infer<typeof milestoneSetupSchema>;
    const projectCode = payload.projectCode.toUpperCase();
    const frozenBoq = await prisma.boq.findFirst({
      where: {
        companyId,
        projectCode,
        budgetFrozenAt: { not: null },
      },
      orderBy: { budgetFrozenAt: "desc" },
    });
    if (!frozenBoq || !frozenBoq.revenueLockedAmount) {
      return res.status(409).json({ error: "PO lock + budget freeze required before milestone setup" });
    }

    const milestones = payload.milestones;
    const percentTotal = milestones.reduce(
      (sum: number, item: (typeof milestones)[number]) => sum + item.percent,
      0,
    );
    if (percentTotal > 100.01) {
      return res.status(400).json({ error: "Milestone total percent cannot exceed 100" });
    }

    const created = await prisma.$transaction(
      milestones.map((item: (typeof milestones)[number]) => {
        const milestoneAmount = Number(((frozenBoq.revenueLockedAmount! * item.percent) / 100).toFixed(2));
        const gstPercent = item.gstPercent ?? 18;
        const gstAmount = Number(((milestoneAmount * gstPercent) / 100).toFixed(2));
        const invoiceTotal = Number((milestoneAmount + gstAmount).toFixed(2));
        return prisma.billingMilestone.create({
          data: {
            companyId,
            projectCode,
            label: item.label,
            milestonePercent: item.percent,
            milestoneAmount,
            gstPercent,
            gstAmount,
            invoiceTotal,
            dueDate: item.dueDate ? new Date(item.dueDate) : null,
            status: "PLANNED",
          },
        });
      }),
    );

    return ok(res, created, 201);
  }),
);

approvalsRouter.get(
  "/billing/milestones",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const projectCode = queryValue(req.query.projectCode)?.toUpperCase();
    const list = await prisma.billingMilestone.findMany({
      where: {
        companyId: authCompanyId(req),
        ...(projectCode ? { projectCode } : {}),
      },
      include: {
        triggeredBy: { select: { id: true, name: true, role: true } },
        financeReviewedBy: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, list);
  }),
);

approvalsRouter.patch(
  "/billing/milestones/:id/trigger",
  authorize("ADMIN", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const milestoneId = routeParam(req.params.id);
    const previous = await prisma.billingMilestone.findUnique({
      where: { id: milestoneId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Milestone not found" });
    }
    if (!["PLANNED", "REJECTED"].includes(previous.status)) {
      return res.status(409).json({ error: `Cannot trigger invoice in ${previous.status}` });
    }

    const approval = await createApprovalRecord({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      actionType: "BILLING_INVOICE_APPROVAL",
      requestedById: req.auth!.userId,
      status: "PENDING",
      metadata: {
        milestoneId: previous.id,
      },
    });

    const updated = await prisma.billingMilestone.update({
      where: { id: previous.id },
      data: {
        status: "PENDING_FINANCE_APPROVAL",
        invoiceNumber: `INV-${previous.projectCode}-${Date.now()}`,
        triggeredById: req.auth!.userId,
        approvalId: approval.approvalId,
      },
    });

    return ok(res, updated);
  }),
);

approvalsRouter.patch(
  "/billing/milestones/:id/finance-review",
  authorize("ADMIN", "FINANCE"),
  validateBody(financeReviewSchema),
  asyncHandler(async (req, res) => {
    const milestoneId = routeParam(req.params.id);
    const previous = await prisma.billingMilestone.findUnique({
      where: { id: milestoneId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Milestone not found" });
    }
    if (previous.status !== "PENDING_FINANCE_APPROVAL") {
      return res.status(409).json({ error: "Milestone invoice is not pending finance approval" });
    }
    if (!previous.approvalId) {
      return res.status(409).json({ error: "Milestone has no Approval_ID" });
    }

    const approved = req.body.approve === true;
    const updated = await prisma.billingMilestone.update({
      where: { id: previous.id },
      data: {
        status: approved ? "ISSUED" : "REJECTED",
        financeReviewedById: req.auth!.userId,
        reviewComment: req.body.comment,
        issuedAt: approved ? new Date() : null,
      },
    });

    await decideApprovalRecord({
      approvalId: previous.approvalId,
      status: approved ? "APPROVED" : "REJECTED",
      approvedById: req.auth!.userId,
      comments: req.body.comment,
      metadata: {
        billingMilestoneId: previous.id,
      },
    });

    if (approved) {
      await ensureProjectRecord({
        companyId: previous.companyId,
        projectCode: previous.projectCode,
        createdById: previous.triggeredById ?? req.auth!.userId,
      });

      const invoiceNumber =
        updated.invoiceNumber ?? `INV-${updated.projectCode}-${updated.id.slice(-6).toUpperCase()}`;
      const dueDate = updated.dueDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await prisma.receivable.upsert({
        where: {
          companyId_invoiceNumber: {
            companyId: updated.companyId,
            invoiceNumber,
          },
        },
        update: {
          projectCode: updated.projectCode,
          billingMilestoneId: updated.id,
          invoiceDate: updated.issuedAt ?? new Date(),
          dueDate,
          taxableValue: updated.milestoneAmount,
          gstAmount: updated.gstAmount,
          totalAmount: updated.invoiceTotal,
          status: "OPEN",
        },
        create: {
          companyId: updated.companyId,
          projectCode: updated.projectCode,
          billingMilestoneId: updated.id,
          invoiceNumber,
          invoiceDate: updated.issuedAt ?? new Date(),
          dueDate,
          taxableValue: updated.milestoneAmount,
          gstAmount: updated.gstAmount,
          totalAmount: updated.invoiceTotal,
          status: "OPEN",
        },
      });

      await prisma.projectLedger.create({
        data: {
          companyId: updated.companyId,
          projectCode: updated.projectCode,
          entryType: "BILLING",
          amount: updated.invoiceTotal,
          notes: `Milestone invoice issued: ${invoiceNumber}`,
          approvalId: updated.approvalId,
          referenceType: "BILLING_MILESTONE",
          referenceId: updated.id,
          createdById: req.auth!.userId,
        },
      });
    }

    return ok(res, updated);
  }),
);

approvalsRouter.patch(
  "/billing/milestones/:id/payment",
  authorize("ADMIN", "FINANCE"),
  validateBody(milestonePaymentSchema),
  asyncHandler(async (req, res) => {
    const milestoneId = routeParam(req.params.id);
    const previous = await prisma.billingMilestone.findUnique({
      where: { id: milestoneId },
    });
    if (!previous || previous.companyId !== authCompanyId(req)) {
      return res.status(404).json({ error: "Milestone not found" });
    }
    if (!["ISSUED", "PARTIALLY_PAID", "OVERDUE"].includes(previous.status)) {
      return res.status(409).json({ error: `Cannot register payment in ${previous.status}` });
    }

    const newPaidAmount = Number((previous.paidAmount + req.body.amount).toFixed(2));
    const fullyPaid = newPaidAmount >= previous.invoiceTotal;

    const updated = await prisma.billingMilestone.update({
      where: { id: previous.id },
      data: {
        paidAmount: newPaidAmount,
        status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
        paidAt: fullyPaid ? new Date() : null,
      },
    });

    const receivable = await prisma.receivable.findFirst({
      where: {
        companyId: previous.companyId,
        billingMilestoneId: previous.id,
      },
      orderBy: { createdAt: "desc" },
    });
    if (receivable) {
      const nextReceived = Number((receivable.receivedAmount + req.body.amount).toFixed(2));
      await prisma.receivable.update({
        where: { id: receivable.id },
        data: {
          receivedAmount: nextReceived,
          status: nextReceived >= receivable.totalAmount ? "PAID" : "PARTIALLY_PAID",
        },
      });
    }

    return ok(res, updated);
  }),
);

approvalsRouter.post(
  "/overrides",
  authorize("ADMIN"),
  validateBody(overrideSchema),
  asyncHandler(async (req, res) => {
    const override = await createApprovalRecord({
      companyId: authCompanyId(req),
      projectCode: req.body.projectCode.toUpperCase(),
      actionType: "OVERRIDE_APPROVAL",
      requestedById: req.auth!.userId,
      approvedById: req.auth!.userId,
      status: "APPROVED",
      comments: req.body.reason,
      metadata: {
        actionType: req.body.actionType,
        beforeValue: req.body.beforeValue,
        afterValue: req.body.afterValue,
      },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "OVERRIDE_APPROVAL",
      entityType: "APPROVAL_OVERRIDE",
      entityId: override.id,
      next: override,
    });

    return ok(res, override, 201);
  }),
);

approvalsRouter.post(
  "/projects/:projectCode/closure/request",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(closureRequestSchema),
  asyncHandler(async (req, res) => {
    const projectCode = routeParam(req.params.projectCode).toUpperCase();
    const companyId = authCompanyId(req);
    const closure = await prisma.projectClosure.upsert({
      where: {
        companyId_projectCode: {
          companyId,
          projectCode,
        },
      },
      update: {
        status: "REQUESTED",
        requestedById: req.auth!.userId,
        requestComment: req.body.comment,
        requestedAt: new Date(),
      },
      create: {
        companyId,
        projectCode,
        status: "REQUESTED",
        requestedById: req.auth!.userId,
        requestComment: req.body.comment,
        requestedAt: new Date(),
      },
    });

    await createApprovalRecord({
      companyId,
      projectCode,
      actionType: "PROJECT_CLOSURE",
      requestedById: req.auth!.userId,
      status: "PENDING",
      comments: req.body.comment,
      metadata: {
        stage: "REQUESTED",
      },
    });

    return ok(res, closure);
  }),
);

approvalsRouter.patch(
  "/projects/:projectCode/closure/finance-verify",
  authorize("ADMIN", "FINANCE"),
  validateBody(closureRequestSchema),
  asyncHandler(async (req, res) => {
    const projectCode = routeParam(req.params.projectCode).toUpperCase();
    const companyId = authCompanyId(req);

    const closure = await prisma.projectClosure.findUnique({
      where: {
        companyId_projectCode: {
          companyId,
          projectCode,
        },
      },
    });
    if (!closure || closure.status !== "REQUESTED") {
      return res.status(409).json({ error: "Project closure is not pending finance verification" });
    }

    const [pendingExpense, pendingInvoice, pendingPayroll, pendingMilestone] = await Promise.all([
      prisma.expenseRequest.findFirst({
        where: {
          companyId,
          projectCode,
          status: {
            in: [
              "PENDING_FINANCE",
              "BUDGET_BREACH",
              "ESCALATED_ADMIN",
              "EMERGENCY_PENDING_FINANCE",
              "EMERGENCY_ESCALATED_ADMIN",
            ],
          },
        },
      }),
      prisma.vendorInvoice.findFirst({
        where: {
          companyId,
          projectCode,
          status: {
            in: ["SUBMITTED", "PENDING_FINANCE", "PENDING_ADMIN"],
          },
        },
      }),
      prisma.payrollCycle.findFirst({
        where: {
          companyId,
          projectCode,
          status: { not: "ADMIN_APPROVED" },
        },
      }),
      prisma.billingMilestone.findFirst({
        where: {
          companyId,
          projectCode,
          status: {
            in: ["PLANNED", "PENDING_FINANCE_APPROVAL"],
          },
        },
      }),
    ]);

    const issues = [
      ...(pendingExpense ? ["Pending expense approvals exist"] : []),
      ...(pendingInvoice ? ["Pending vendor invoice approvals exist"] : []),
      ...(pendingPayroll ? ["Payroll is not admin approved"] : []),
      ...(pendingMilestone ? ["Some billing milestones are not issued"] : []),
    ];
    if (issues.length) {
      return res.status(409).json({
        error: "Project closure readiness checks failed",
        issues,
      });
    }

    const snapshot = await projectSnapshot(authCompanyId(req), projectCode);
    if (snapshot.marginPercent < 0) {
      issues.push("Final margin is negative");
      return res.status(409).json({
        error: "Project closure readiness checks failed",
        issues,
      });
    }

    const updated = await prisma.projectClosure.update({
      where: {
        companyId_projectCode: {
          companyId,
          projectCode,
        },
      },
      data: {
        status: "FINANCE_VERIFIED",
        financeVerifiedById: req.auth!.userId,
        financeComment: req.body.comment,
        financeVerifiedAt: new Date(),
      },
    });

    const pendingApproval = await latestPendingApprovalRecord({
      companyId,
      projectCode,
      actionType: "PROJECT_CLOSURE",
    });
    if (pendingApproval) {
      await decideApprovalRecord({
        approvalId: pendingApproval.approvalId,
        status: "APPROVED",
        approvedById: req.auth!.userId,
        comments: req.body.comment ?? "Finance verified project closure",
      });
    }

    return ok(res, {
      closure: updated,
      snapshot,
    });
  }),
);

approvalsRouter.patch(
  "/projects/:projectCode/closure/admin-confirm",
  authorize("ADMIN"),
  validateBody(closureRequestSchema),
  asyncHandler(async (req, res) => {
    const projectCode = routeParam(req.params.projectCode).toUpperCase();
    const companyId = authCompanyId(req);
    const closure = await prisma.projectClosure.findUnique({
      where: {
        companyId_projectCode: {
          companyId,
          projectCode,
        },
      },
    });
    if (!closure || closure.status !== "FINANCE_VERIFIED") {
      return res.status(409).json({ error: "Finance verification is required before admin confirmation" });
    }

    const finalApproval = await createApprovalRecord({
      companyId,
      projectCode,
      actionType: "PROJECT_CLOSURE",
      requestedById: closure.requestedById ?? req.auth!.userId,
      approvedById: req.auth!.userId,
      status: "APPROVED",
      comments: req.body.comment ?? "Admin confirmed project closure",
      metadata: {
        stage: "ADMIN_CONFIRMED",
      },
    });

    const updated = await prisma.projectClosure.update({
      where: {
        companyId_projectCode: {
          companyId,
          projectCode,
        },
      },
      data: {
        status: "CLOSED",
        adminApprovedById: req.auth!.userId,
        adminComment: req.body.comment,
        adminApprovedAt: new Date(),
        closedAt: new Date(),
      },
    });

    return ok(res, {
      closure: updated,
      approvalId: finalApproval.approvalId,
    });
  }),
);
