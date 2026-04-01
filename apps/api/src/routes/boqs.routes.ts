import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { decideApprovalRecord, createApprovalRecord } from "../services/approval.service";
import { writeAuditLog } from "../services/audit-log.service";
import { calculateBoqTotals, calculateLineTotal } from "../services/boq.service";
import { ok } from "../utils/http";

const boqItemSchema = z.object({
  itemCode: z.string(),
  itemName: z.string(),
  quantity: z.number().positive(),
  unitRate: z.number().nonnegative(),
  marginPercent: z.number().min(0).max(100).optional(),
});

const boqSchema = z.object({
  recceId: z.string(),
  items: z.array(boqItemSchema).min(1),
});

const financeReviewSchema = z.object({
  approve: z.boolean(),
  comment: z.string().max(800).optional(),
});

const clientReviewSchema = z.object({
  approve: z.boolean(),
  onBehalf: z.boolean().optional(),
  comment: z.string().max(800).optional(),
});

const poLockSchema = z.object({
  poNumber: z.string().min(3).max(80),
  allocations: z
    .object({
      material: z.number().min(0).max(100).optional(),
      labour: z.number().min(0).max(100).optional(),
      logistics: z.number().min(0).max(100).optional(),
      misc: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

const legacyApprovalSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

function deriveProjectCode(storeCode: string, recceId: string): string {
  const normalizedStore = storeCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const shortRecce = recceId.slice(-6).toUpperCase();
  return `PRJ-${normalizedStore}-${shortRecce}`;
}

async function createBudgetBuckets(params: {
  companyId: string;
  projectCode: string;
  totalAmount: number;
  allocations?: {
    material?: number;
    labour?: number;
    logistics?: number;
    misc?: number;
  };
}) {
  const defaults = {
    material: 40,
    labour: 35,
    logistics: 15,
    misc: 10,
  };
  const provided = params.allocations;
  const split = {
    material: provided?.material ?? defaults.material,
    labour: provided?.labour ?? defaults.labour,
    logistics: provided?.logistics ?? defaults.logistics,
    misc: provided?.misc ?? defaults.misc,
  };
  const total = split.material + split.labour + split.logistics + split.misc;
  if (total <= 0) {
    throw new Error("Invalid budget allocation split");
  }

  const toValue = (percent: number) => Number(((params.totalAmount * percent) / total).toFixed(2));

  const buckets = [
    { type: "MATERIAL" as const, value: toValue(split.material) },
    { type: "LABOUR" as const, value: toValue(split.labour) },
    { type: "LOGISTICS" as const, value: toValue(split.logistics) },
    { type: "MISC" as const, value: toValue(split.misc) },
  ];

  await Promise.all(
    buckets.map((bucket) =>
      prisma.budgetBucket.upsert({
        where: {
          companyId_projectCode_bucketType: {
            companyId: params.companyId,
            projectCode: params.projectCode,
            bucketType: bucket.type,
          },
        },
        update: {
          approvedBudget: bucket.value,
        },
        create: {
          companyId: params.companyId,
          projectCode: params.projectCode,
          bucketType: bucket.type,
          approvedBudget: bucket.value,
        },
      }),
    ),
  );
}

export const boqsRouter = Router();

boqsRouter.get(
  "/rate-card",
  authorize("ADMIN", "FINANCE", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const rates = await prisma.rateCard.findMany({
      where: { companyId: req.auth!.companyId, isActive: true },
      orderBy: { itemName: "asc" },
    });
    return ok(res, rates);
  }),
);

boqsRouter.get(
  "/",
  authorize("ADMIN", "FINANCE", "OPERATIONS", "CLIENT"),
  asyncHandler(async (req, res) => {
    const where =
      req.auth?.role === "CLIENT"
        ? {
            companyId: req.auth.companyId,
            recce: {
              store: {
                client: {
                  users: {
                    some: { id: req.auth.userId },
                  },
                },
              },
            },
          }
        : { companyId: req.auth!.companyId };

    const boqs = await prisma.boq.findMany({
      where,
      include: { items: true },
      orderBy: [{ createdAt: "desc" }, { version: "desc" }],
    });
    return ok(res, boqs);
  }),
);

boqsRouter.post(
  "/",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(boqSchema),
  asyncHandler(async (req, res) => {
    const recce = await prisma.recce.findUnique({
      where: { id: req.body.recceId },
      include: { store: true },
    });
    if (!recce || recce.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Recce not found" });
    }

    const latest = await prisma.boq.findFirst({
      where: {
        companyId: req.auth!.companyId,
        recceId: req.body.recceId,
      },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    });

    const projectCode = latest?.projectCode ?? deriveProjectCode(recce.store.code, recce.id);
    const version = (latest?.version ?? 0) + 1;

    const lineTotals = req.body.items.map((item: z.infer<typeof boqItemSchema>) => {
      const marginPercent = req.auth?.role === "ADMIN" ? item.marginPercent : undefined;
      return {
        ...item,
        marginPercent,
        total: calculateLineTotal({ ...item, marginPercent }),
      };
    });
    const totals = calculateBoqTotals(lineTotals);

    const boq = await prisma.boq.create({
      data: {
        companyId: req.auth!.companyId,
        recceId: req.body.recceId,
        projectCode,
        version,
        status: "DRAFT",
        approvalStage: "DRAFT",
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        items: {
          create: lineTotals,
        },
      },
      include: { items: true },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE",
      entityType: "BOQ",
      entityId: boq.id,
      next: boq,
    });

    return ok(res, boq, 201);
  }),
);

boqsRouter.patch(
  "/:id/submit-internal",
  authorize("ADMIN", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const boqId = req.params.id.toString();
    const previous = await prisma.boq.findUnique({ where: { id: boqId } });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "BOQ not found" });
    }
    if (previous.approvalStage !== "DRAFT") {
      return res.status(409).json({ error: "Only draft BOQ can be submitted" });
    }

    const projectCode = previous.projectCode;
    if (!projectCode) {
      return res.status(409).json({ error: "Project code not generated for this BOQ" });
    }

    const approval = await createApprovalRecord({
      companyId: previous.companyId,
      projectCode,
      actionType: "BOQ_APPROVAL",
      requestedById: req.auth!.userId,
      metadata: {
        boqId: previous.id,
        boqVersion: previous.version,
        stage: "INTERNAL_REVIEW",
      },
    });

    const boq = await prisma.boq.update({
      where: { id: boqId },
      data: {
        status: "SUBMITTED",
        approvalStage: "INTERNAL_REVIEW",
        internalApprovalId: approval.approvalId,
      },
      include: { items: true },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "SUBMIT_INTERNAL_APPROVAL",
      entityType: "BOQ",
      entityId: boq.id,
      previous,
      next: boq,
    });

    return ok(res, { ...boq, approvalId: approval.approvalId });
  }),
);

boqsRouter.patch(
  "/:id/finance-review",
  authorize("ADMIN", "FINANCE"),
  validateBody(financeReviewSchema),
  asyncHandler(async (req, res) => {
    const boqId = req.params.id.toString();
    const previous = await prisma.boq.findUnique({ where: { id: boqId } });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "BOQ not found" });
    }
    if (previous.approvalStage !== "INTERNAL_REVIEW") {
      return res.status(409).json({ error: "BOQ is not pending finance review" });
    }
    if (!previous.internalApprovalId) {
      return res.status(409).json({ error: "Missing linked approval record" });
    }

    const approved = req.body.approve === true;
    const boq = await prisma.boq.update({
      where: { id: boqId },
      data: {
        approvalStage: approved ? "FINANCE_APPROVED" : "REJECTED",
        status: approved ? "SUBMITTED" : "REJECTED",
        financeReviewedById: req.auth!.userId,
        financeReviewedAt: new Date(),
        financeReviewComment: req.body.comment,
      },
      include: { items: true },
    });

    await decideApprovalRecord({
      approvalId: previous.internalApprovalId,
      status: approved ? "APPROVED" : "REJECTED",
      approvedById: req.auth!.userId,
      comments: req.body.comment,
      metadata: {
        boqId: boq.id,
        boqVersion: boq.version,
        stage: "FINANCE_REVIEW",
      },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: approved ? "FINANCE_APPROVE" : "FINANCE_REJECT",
      entityType: "BOQ",
      entityId: boq.id,
      previous,
      next: boq,
    });

    return ok(res, boq);
  }),
);

boqsRouter.patch(
  "/:id/client-review",
  authorize("ADMIN", "OPERATIONS", "CLIENT"),
  validateBody(clientReviewSchema),
  asyncHandler(async (req, res) => {
    const boqId = req.params.id.toString();
    const previous = await prisma.boq.findUnique({
      where: { id: boqId },
      include: {
        recce: {
          include: { store: true },
        },
      },
    });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "BOQ not found" });
    }
    if (previous.approvalStage !== "FINANCE_APPROVED") {
      return res.status(409).json({ error: "BOQ is not ready for client approval" });
    }

    const approved = req.body.approve === true;
    const onBehalf = req.body.onBehalf === true;
    if (onBehalf && req.auth?.role !== "ADMIN") {
      return res.status(403).json({ error: "Only admin can approve on behalf of client" });
    }
    if (req.auth?.role === "CLIENT") {
      const me = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { clientId: true },
      });
      if (!me?.clientId || me.clientId !== previous.recce.store.clientId) {
        return res.status(403).json({ error: "Forbidden for this BOQ" });
      }
    }

    const boq = await prisma.boq.update({
      where: { id: boqId },
      data: {
        approvalStage: approved ? "CLIENT_APPROVED" : "REJECTED",
        status: approved ? "APPROVED" : "REJECTED",
        clientApprovedAt: approved ? new Date() : null,
        clientReviewComment: req.body.comment,
        approvedOnBehalfById: onBehalf ? req.auth!.userId : null,
      },
      include: { items: true },
    });

    if (boq.projectCode) {
      await createApprovalRecord({
        companyId: boq.companyId,
        projectCode: boq.projectCode,
        actionType: "BOQ_APPROVAL",
        requestedById: boq.financeReviewedById ?? req.auth!.userId,
        approvedById: req.auth!.userId,
        status: approved ? "APPROVED" : "REJECTED",
        comments: req.body.comment,
        metadata: {
          boqId: boq.id,
          boqVersion: boq.version,
          stage: "CLIENT_APPROVAL",
          approvedOnBehalf: onBehalf,
        },
      });
    }

    await writeAuditLog({
      userId: req.auth!.userId,
      action: approved ? "CLIENT_APPROVE" : "CLIENT_REJECT",
      entityType: "BOQ",
      entityId: boq.id,
      previous,
      next: boq,
    });

    return ok(res, boq);
  }),
);

boqsRouter.patch(
  "/:id/lock-po",
  authorize("ADMIN", "FINANCE"),
  validateBody(poLockSchema),
  asyncHandler(async (req, res) => {
    const boqId = req.params.id.toString();
    const previous = await prisma.boq.findUnique({ where: { id: boqId } });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "BOQ not found" });
    }
    if (previous.approvalStage !== "CLIENT_APPROVED") {
      return res.status(409).json({ error: "Client-approved BOQ is required to lock PO" });
    }
    if (!previous.projectCode) {
      return res.status(409).json({ error: "Project code missing for BOQ" });
    }
    if (previous.budgetFrozenAt) {
      return res.status(409).json({ error: "Budget is already frozen for this BOQ version" });
    }

    const boq = await prisma.boq.update({
      where: { id: boqId },
      data: {
        poNumber: req.body.poNumber,
        budgetFrozenAt: new Date(),
        revenueLockedAmount: previous.totalAmount,
      },
      include: { items: true },
    });

    await createBudgetBuckets({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      totalAmount: previous.totalAmount,
      allocations: req.body.allocations,
    });

    const approval = await createApprovalRecord({
      companyId: previous.companyId,
      projectCode: previous.projectCode,
      actionType: "BUDGET_FREEZE",
      requestedById: req.auth!.userId,
      approvedById: req.auth!.userId,
      status: "APPROVED",
      comments: `PO ${req.body.poNumber} locked and budget freeze activated`,
      metadata: {
        boqId: boq.id,
        boqVersion: boq.version,
        poNumber: req.body.poNumber,
      },
    });

    await prisma.project.upsert({
      where: { projectCode: previous.projectCode },
      update: {
        poNumber: req.body.poNumber,
        poValue: previous.totalAmount,
        baselineCost: previous.subtotal,
        budgetFrozenAt: boq.budgetFrozenAt,
        status: "BUDGET_FROZEN",
      },
      create: {
        companyId: previous.companyId,
        projectCode: previous.projectCode,
        title: `Project ${previous.projectCode}`,
        executionType: "HYBRID",
        poNumber: req.body.poNumber,
        poValue: previous.totalAmount,
        baselineCost: previous.subtotal,
        budgetFrozenAt: boq.budgetFrozenAt,
        status: "BUDGET_FROZEN",
        createdById: req.auth!.userId,
      },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "BUDGET_FREEZE",
      entityType: "BOQ",
      entityId: boq.id,
      previous,
      next: boq,
    });

    return ok(res, { ...boq, approvalId: approval.approvalId });
  }),
);

boqsRouter.patch(
  "/:id/approve",
  authorize("ADMIN"),
  validateBody(legacyApprovalSchema),
  asyncHandler(async (req, res) => {
    const approved = req.body.status === "APPROVED";
    const boqId = req.params.id.toString();
    const previous = await prisma.boq.findUnique({ where: { id: boqId } });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "BOQ not found" });
    }
    if (previous.approvalStage !== "INTERNAL_REVIEW") {
      return res.status(409).json({
        error: "Legacy approval route works only for finance review stage",
      });
    }

    const boq = await prisma.boq.update({
      where: { id: boqId },
      data: {
        approvalStage: approved ? "FINANCE_APPROVED" : "REJECTED",
        status: approved ? "SUBMITTED" : "REJECTED",
        financeReviewedById: req.auth!.userId,
        financeReviewedAt: new Date(),
      },
      include: { items: true },
    });

    if (previous.internalApprovalId) {
      await decideApprovalRecord({
        approvalId: previous.internalApprovalId,
        status: approved ? "APPROVED" : "REJECTED",
        approvedById: req.auth!.userId,
        metadata: {
          boqId: boq.id,
          boqVersion: boq.version,
          stage: "LEGACY_FINANCE_REVIEW",
        },
      });
    }

    await writeAuditLog({
      userId: req.auth!.userId,
      action: approved ? "LEGACY_APPROVE" : "LEGACY_REJECT",
      entityType: "BOQ",
      entityId: boq.id,
      previous,
      next: boq,
    });

    return ok(res, boq);
  }),
);

boqsRouter.get(
  "/:id/export",
  authorize("ADMIN", "FINANCE", "OPERATIONS", "CLIENT"),
  asyncHandler(async (req, res) => {
    const format = req.query.format === "excel" ? "xlsx" : "pdf";
    const boqId = req.params.id.toString();
    const boq = await prisma.boq.findUnique({
      where: { id: boqId },
      include: {
        recce: {
          include: { store: true },
        },
      },
    });
    if (!boq || boq.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "BOQ not found" });
    }
    if (req.auth?.role === "CLIENT") {
      const me = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { clientId: true },
      });
      if (!me?.clientId || boq.recce.store.clientId !== me.clientId) {
        return res.status(403).json({ error: "Forbidden for this BOQ" });
      }
    }

    return ok(res, {
      boqId: boq.id,
      format,
      fileUrl: `https://example.com/reports/boq-${boq.id}.${format}`,
      approvalStage: boq.approvalStage,
      projectCode: boq.projectCode,
    });
  }),
);
