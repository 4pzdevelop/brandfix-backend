import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { ok } from "../utils/http";
import { writeAuditLog } from "../services/audit-log.service";

const storeSchema = z.object({
  clientId: z.string(),
  name: z.string().min(2),
  code: z.string().min(2),
  storeType: z.string().min(2),
  addressLine1: z.string().min(3),
  city: z.string().min(2),
  state: z.string().min(2),
  postalCode: z.string().min(4),
  amcStatus: z.enum(["NONE", "ACTIVE", "EXPIRED"]).default("NONE")
});

export const storesRouter = Router();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function queryValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

storesRouter.get(
  "/",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const clientId = queryValue(req.query.clientId);

    if (req.auth?.role === "CLIENT") {
      const me = await prisma.user.findUnique({ where: { id: req.auth.userId } });
      if (!me?.clientId) {
        return ok(res, []);
      }
      const stores = await prisma.store.findMany({
        where: { companyId: req.auth.companyId, clientId: me.clientId },
        orderBy: { createdAt: "desc" },
      });
      return ok(res, stores);
    }

    const stores = await prisma.store.findMany({
      where: {
        companyId: req.auth!.companyId,
        ...(clientId ? { clientId } : {}),
      },
      orderBy: { createdAt: "desc" }
    });

    return ok(res, stores);
  })
);

storesRouter.get(
  "/:id/timeline",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const storeId = routeParam(req.params.id);
    if (req.auth?.role === "CLIENT") {
      const user = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { clientId: true } });
      const store = await prisma.store.findUnique({ where: { id: storeId }, select: { clientId: true } });
      if (!user?.clientId || !store || store.clientId !== user.clientId) {
        return res.status(403).json({ error: "Forbidden for this store" });
      }
    }

    const [recceCount, boqCount, taskCount, auditCount] = await Promise.all([
      prisma.recce.count({ where: { companyId: req.auth!.companyId, storeId } }),
      prisma.boq.count({ where: { companyId: req.auth!.companyId, recce: { storeId } } }),
      prisma.task.count({ where: { companyId: req.auth!.companyId, storeId } }),
      prisma.audit.count({ where: { companyId: req.auth!.companyId, storeId } })
    ]);

    return ok(res, {
      recce: recceCount > 0 ? "DONE" : "PENDING",
      boq: boqCount > 0 ? "DONE" : "PENDING",
      tasks: taskCount > 0 ? "DONE" : "PENDING",
      audit: auditCount > 0 ? "DONE" : "PENDING"
    });
  })
);

storesRouter.post(
  "/",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(storeSchema),
  asyncHandler(async (req, res) => {
    const store = await prisma.store.create({
      data: {
        ...req.body,
        companyId: req.auth!.companyId,
      },
    });
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE",
      entityType: "STORE",
      entityId: store.id,
      next: store
    });

    return ok(res, store, 201);
  })
);

storesRouter.patch(
  "/:id",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(storeSchema.partial()),
  asyncHandler(async (req, res) => {
    const storeId = routeParam(req.params.id);
    const previous = await prisma.store.findUnique({ where: { id: storeId } });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Store not found" });
    }

    const store = await prisma.store.update({
      where: { id: storeId },
      data: req.body
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "UPDATE",
      entityType: "STORE",
      entityId: store.id,
      previous,
      next: store
    });

    return ok(res, store);
  })
);
