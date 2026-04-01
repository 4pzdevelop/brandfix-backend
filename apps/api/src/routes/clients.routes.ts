import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { ok } from "../utils/http";
import { writeAuditLog } from "../services/audit-log.service";

const clientSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2),
  industry: z.string().optional(),
  primaryContact: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
});

export const clientsRouter = Router();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

clientsRouter.get(
  "/",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    if (req.auth?.role === "CLIENT" && req.auth.userId) {
      const me = await prisma.user.findUnique({ where: { id: req.auth.userId } });
      if (!me?.clientId) {
        return ok(res, []);
      }
      const client = await prisma.client.findMany({
        where: {
          id: me.clientId,
          companyId: req.auth.companyId,
        },
      });
      return ok(res, client);
    }

    const clients = await prisma.client.findMany({
      where: { companyId: req.auth!.companyId },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, clients);
  })
);

clientsRouter.post(
  "/",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(clientSchema),
  asyncHandler(async (req, res) => {
    const client = await prisma.client.create({
      data: {
        ...req.body,
        companyId: req.auth!.companyId,
      },
    });
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE",
      entityType: "CLIENT",
      entityId: client.id,
      next: client
    });
    return ok(res, client, 201);
  })
);

clientsRouter.patch(
  "/:id",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(clientSchema.partial()),
  asyncHandler(async (req, res) => {
    const clientId = routeParam(req.params.id);
    const previous = await prisma.client.findUnique({ where: { id: clientId } });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Client not found" });
    }

    const client = await prisma.client.update({
      where: { id: clientId },
      data: req.body
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "UPDATE",
      entityType: "CLIENT",
      entityId: client.id,
      previous,
      next: client
    });

    return ok(res, client);
  })
);

clientsRouter.delete(
  "/:id",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const clientId = routeParam(req.params.id);
    const existing = await prisma.client.findUnique({ where: { id: clientId } });
    if (!existing || existing.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Client not found" });
    }

    await prisma.client.delete({ where: { id: clientId } });
    await writeAuditLog({
      userId: req.auth!.userId,
      action: "DELETE",
      entityType: "CLIENT",
      entityId: clientId,
      previous: existing
    });

    return ok(res, { success: true });
  })
);
