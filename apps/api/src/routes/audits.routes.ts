import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { writeAuditLog } from "../services/audit-log.service";
import { ok } from "../utils/http";

const itemSchema = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number().int().nonnegative(),
  maxScore: z.number().int().positive(),
  remarks: z.string().optional()
});

const auditSchema = z.object({
  storeId: z.string(),
  auditDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED"]).default("DRAFT"),
  summary: z.string().optional(),
  items: z.array(itemSchema).min(1)
});

export const auditsRouter = Router();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

auditsRouter.get(
  "/",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const where = req.auth?.role === "CLIENT"
      ? {
          companyId: req.auth.companyId,
          store: {
            client: {
              users: {
                some: {
                  id: req.auth.userId
                }
              }
            }
          }
        }
      : { companyId: req.auth!.companyId };

    const audits = await prisma.audit.findMany({
      where,
      include: { items: true },
      orderBy: { auditDate: "desc" }
    });

    return ok(
      res,
      audits.map((audit) => ({
        ...audit,
        checklist: audit.items
      }))
    );
  })
);

auditsRouter.post(
  "/",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE"),
  validateBody(auditSchema),
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({
      where: { id: req.body.storeId },
      select: { id: true, companyId: true },
    });
    if (!store || store.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Store not found" });
    }

    const totalScore = req.body.items.reduce((sum: number, item: z.infer<typeof itemSchema>) => sum + item.score, 0);
    const maxScore = req.body.items.reduce((sum: number, item: z.infer<typeof itemSchema>) => sum + item.maxScore, 0);

    const audit = await prisma.audit.create({
      data: {
        companyId: req.auth!.companyId,
        storeId: req.body.storeId,
        auditDate: new Date(req.body.auditDate),
        status: req.body.status,
        summary: req.body.summary,
        totalScore,
        maxScore,
        items: {
          create: req.body.items
        }
      },
      include: { items: true }
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE",
      entityType: "AUDIT",
      entityId: audit.id,
      next: audit
    });

    return ok(res, audit, 201);
  })
);

auditsRouter.patch(
  "/:id/status",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(z.object({ status: z.enum(["DRAFT", "SUBMITTED", "APPROVED"]) })),
  asyncHandler(async (req, res) => {
    const auditId = routeParam(req.params.id);
    const previous = await prisma.audit.findUnique({ where: { id: auditId } });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Audit not found" });
    }

    const audit = await prisma.audit.update({
      where: { id: auditId },
      data: { status: req.body.status }
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "STATUS_UPDATE",
      entityType: "AUDIT",
      entityId: audit.id,
      previous,
      next: audit
    });

    return ok(res, audit);
  })
);

auditsRouter.get(
  "/:id/report",
  authorize("ADMIN", "OPERATIONS", "CLIENT"),
  asyncHandler(async (req, res) => {
    const auditId = routeParam(req.params.id);
    const audit = await prisma.audit.findUnique({
      where: { id: auditId },
      include: { store: true }
    });
    if (!audit || audit.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Audit not found" });
    }
    if (req.auth?.role === "CLIENT") {
      const me = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { clientId: true } });
      if (!me?.clientId || audit.store.clientId !== me.clientId) {
        return res.status(403).json({ error: "Forbidden for this audit" });
      }
    }

    return ok(res, {
      auditId: audit.id,
      reportUrl: `https://example.com/reports/audit-${audit.id}.pdf`
    });
  })
);
