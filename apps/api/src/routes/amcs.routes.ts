import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { generateVisitSchedule } from "../services/amc.service";
import { generateAmcTasks } from "../services/task.service";
import { writeAuditLog } from "../services/audit-log.service";
import { ok } from "../utils/http";

const amcSchema = z.object({
  clientId: z.string(),
  storeId: z.string(),
  startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  visitFrequency: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY"]),
  coverageTypes: z.array(z.string()).min(1),
  status: z.enum(["ACTIVE", "EXPIRED", "RENEWED"]).default("ACTIVE")
});

export const amcRouter = Router();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

amcRouter.get(
  "/",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const where = req.auth?.role === "CLIENT"
      ? {
          companyId: req.auth.companyId,
          client: {
            users: {
              some: {
                id: req.auth.userId
              }
            }
          }
        }
      : { companyId: req.auth!.companyId };

    const amcs = await prisma.amc.findMany({
      where,
      orderBy: { createdAt: "desc" }
    });

    return ok(res, amcs);
  })
);

amcRouter.post(
  "/",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(amcSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;

    const amc = await prisma.amc.create({
      data: {
        companyId,
        ...req.body,
        startDate: new Date(req.body.startDate),
        endDate: new Date(req.body.endDate)
      }
    });

    await prisma.store.update({
      where: { id: amc.storeId },
      data: { amcStatus: amc.status === "ACTIVE" ? "ACTIVE" : "EXPIRED" }
    });

    const visits = generateVisitSchedule(amc.startDate, amc.endDate, amc.visitFrequency);
    await generateAmcTasks({
      companyId,
      storeId: amc.storeId,
      amcId: amc.id,
      visitDates: visits,
      createdByRole: req.auth!.role
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE",
      entityType: "AMC",
      entityId: amc.id,
      next: { amc, visits: visits.map((date) => date.toISOString()) }
    });

    return ok(res, amc, 201);
  })
);

amcRouter.get(
  "/:id/schedule",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const amcId = routeParam(req.params.id);
    const amc = await prisma.amc.findUnique({ where: { id: amcId } });
    if (!amc || amc.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "AMC not found" });
    }
    if (req.auth?.role === "CLIENT") {
      const me = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { clientId: true } });
      if (!me?.clientId || amc.clientId !== me.clientId) {
        return res.status(403).json({ error: "Forbidden for this AMC" });
      }
    }

    const visits = generateVisitSchedule(amc.startDate, amc.endDate, amc.visitFrequency);
    return ok(res, {
      amcId: amc.id,
      visits: visits.map((date) => date.toISOString())
    });
  })
);
