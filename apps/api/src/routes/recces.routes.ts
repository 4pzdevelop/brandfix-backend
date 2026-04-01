import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { ok } from "../utils/http";
import { writeAuditLog } from "../services/audit-log.service";

const imageSchema = z.object({
  id: z.string().optional(),
  url: z.string().min(1),
  category: z.enum(["SIGNAGE", "VM", "LIGHTING", "BRANDING", "OTHER"]),
  capturedAt: z.string().datetime().optional(),
});

const recceSchema = z.object({
  storeId: z.string(),
  visitDate: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED"]).default("DRAFT"),
  notes: z.string().optional(),
  conditionSummary: z.record(z.string()),
  measurements: z.array(
    z.object({
      section: z.string(),
      length: z.number(),
      width: z.number(),
      height: z.number(),
      unit: z.enum(["ft", "m"]),
    }),
  ),
  images: z.array(imageSchema).optional(),
});

export const reccesRouter = Router();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

reccesRouter.get(
  "/",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const where =
      req.auth?.role === "CLIENT"
        ? {
            companyId: req.auth.companyId,
            status: "APPROVED" as const,
            store: {
              client: {
                users: {
                  some: {
                    id: req.auth.userId,
                  },
                },
              },
            },
          }
        : { companyId: req.auth!.companyId };

    const recces = await prisma.recce.findMany({
      where,
      include: {
        images: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
            location: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return ok(
      res,
      recces.map((recce) => ({
        ...recce,
        createdByName: recce.createdBy.name,
        createdByRole: recce.createdBy.role,
        createdByLocation: recce.createdBy.location,
        images: recce.images.map((image) => ({
          id: image.id,
          url: image.fileUrl,
          category: image.category,
          capturedAt: image.timestamp.toISOString(),
        })),
      })),
    );
  }),
);

reccesRouter.post(
  "/",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE"),
  validateBody(recceSchema),
  asyncHandler(async (req, res) => {
    const store = await prisma.store.findUnique({
      where: { id: req.body.storeId },
      select: { id: true, companyId: true },
    });
    if (!store || store.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Store not found" });
    }

    const recce = await prisma.recce.create({
      data: {
        companyId: req.auth!.companyId,
        storeId: req.body.storeId,
        visitDate: new Date(req.body.visitDate),
        status: req.body.status,
        notes: req.body.notes,
        conditionSummary: req.body.conditionSummary,
        measurements: req.body.measurements,
        createdById: req.auth!.userId,
        images: req.body.images
          ? {
              create: req.body.images.map(
                (image: z.infer<typeof imageSchema>) => ({
                  fileUrl: image.url,
                  category: image.category,
                  timestamp: image.capturedAt
                    ? new Date(image.capturedAt)
                    : new Date(),
                }),
              ),
            }
          : undefined,
      },
      include: {
        images: true,
        createdBy: {
          select: {
            id: true,
            name: true,
            role: true,
            location: true,
          },
        },
      },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE",
      entityType: "RECCE",
      entityId: recce.id,
      next: recce,
    });

    return ok(
      res,
      {
        ...recce,
        createdByName: recce.createdBy.name,
        createdByRole: recce.createdBy.role,
        createdByLocation: recce.createdBy.location,
        images: recce.images.map((image) => ({
          id: image.id,
          url: image.fileUrl,
          category: image.category,
          capturedAt: image.timestamp.toISOString(),
        })),
      },
      201,
    );
  }),
);

reccesRouter.patch(
  "/:id/status",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(
    z.object({ status: z.enum(["DRAFT", "SUBMITTED", "APPROVED"]) }),
  ),
  asyncHandler(async (req, res) => {
    const recceId = routeParam(req.params.id);
    const previous = await prisma.recce.findUnique({
      where: { id: recceId },
    });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Recce not found" });
    }

    const updated = await prisma.recce.update({
      where: { id: recceId },
      data: { status: req.body.status },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "STATUS_UPDATE",
      entityType: "RECCE",
      entityId: updated.id,
      previous,
      next: updated,
    });

    return ok(res, updated);
  }),
);

reccesRouter.get(
  "/:id/pdf",
  authorize("ADMIN", "OPERATIONS", "CLIENT"),
  asyncHandler(async (req, res) => {
    const recceId = routeParam(req.params.id);
    const recce = await prisma.recce.findUnique({
      where: { id: recceId },
      include: { store: true },
    });
    if (!recce || recce.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Recce not found" });
    }
    if (req.auth?.role === "CLIENT") {
      const me = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { clientId: true },
      });
      if (!me?.clientId || recce.store.clientId !== me.clientId) {
        return res.status(403).json({ error: "Forbidden for this recce" });
      }
    }

    return ok(res, {
      recceId: recce.id,
      reportUrl: `https://example.com/reports/recce-${recce.id}.pdf`,
    });
  }),
);
