import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { env } from "../config/env";
import { storeFile } from "../services/storage.service";
import { writeAuditLog } from "../services/audit-log.service";
import { ok } from "../utils/http";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024
  }
});

const taskSchema = z.object({
  storeId: z.string(),
  amcId: z.string().optional(),
  title: z.string().min(2),
  description: z.string().min(3),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  assignedToId: z.string(),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).default("PENDING")
});

export const tasksRouter = Router();

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

tasksRouter.get(
  "/",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const store = queryValue(req.query.store);
    const status = queryValue(req.query.status) as "PENDING" | "IN_PROGRESS" | "COMPLETED" | undefined;
    const assignedTo = queryValue(req.query.assignedTo);
    const limit = Number(req.query.limit ?? 100);

    const where: any = {
      companyId: req.auth!.companyId,
      ...(store ? { storeId: { contains: store } } : {}),
      ...(status ? { status } : {}),
      ...(assignedTo ? { assignedTo: { name: { contains: assignedTo } } } : {}),
      ...(req.auth?.role === "FIELD_EXECUTIVE" ? { assignedToId: req.auth.userId } : {}),
      ...(req.auth?.role === "CLIENT"
        ? {
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
        : {})
    };

    const tasks = await prisma.task.findMany({
      where,
      include: {
        images: true,
        assignedTo: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { dueDate: "asc" },
      take: Number.isFinite(limit) ? limit : 100
    });

    return ok(
      res,
      tasks.map((task) => ({
        id: task.id,
        storeId: task.storeId,
        amcId: task.amcId,
        title: task.title,
        description: task.description,
        assignedTo: task.assignedTo.name,
        dueDate: task.dueDate,
        status: task.status,
        beforePhotoUrl: task.images.find((image) => image.stage === "BEFORE")?.fileUrl ?? null,
        afterPhotoUrl: task.images.find((image) => image.stage === "AFTER")?.fileUrl ?? null
      }))
    );
  })
);

tasksRouter.post(
  "/",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(taskSchema),
  asyncHandler(async (req, res) => {
    const task = await prisma.task.create({
      data: {
        companyId: req.auth!.companyId,
        ...req.body,
        dueDate: new Date(req.body.dueDate)
      }
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE",
      entityType: "TASK",
      entityId: task.id,
      next: task
    });

    return ok(res, task, 201);
  })
);

tasksRouter.patch(
  "/:id",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE"),
  validateBody(
    z.object({
      status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
      completionNote: z.string().optional(),
      assignedToId: z.string().optional(),
      dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const taskId = routeParam(req.params.id);
    const previous = await prisma.task.findUnique({ where: { id: taskId } });
    if (!previous || previous.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (req.auth?.role === "FIELD_EXECUTIVE" && previous.assignedToId !== req.auth.userId) {
      return res.status(403).json({ error: "Field user can only update assigned tasks" });
    }

    const data = {
      ...req.body,
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
      completedAt: req.body.status === "COMPLETED" ? new Date() : undefined
    };

    const task = await prisma.task.update({
      where: { id: taskId },
      data
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "UPDATE",
      entityType: "TASK",
      entityId: task.id,
      previous,
      next: task
    });

    return ok(res, task);
  })
);

tasksRouter.post(
  "/:id/images",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const taskId = routeParam(req.params.id);
    const stage = z.enum(["BEFORE", "AFTER"]).parse(req.body.stage);
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "Image file is required" });
    }

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task || task.companyId !== req.auth!.companyId) {
      return res.status(404).json({ error: "Task not found" });
    }

    if (req.auth?.role === "FIELD_EXECUTIVE" && task.assignedToId !== req.auth.userId) {
      return res.status(403).json({ error: "Cannot upload for unassigned task" });
    }

    const stored = await storeFile(file);
    const image = await prisma.taskImage.create({
      data: {
        taskId,
        stage,
        fileUrl: stored.url
      }
    });

    return ok(res, image, 201);
  })
);
