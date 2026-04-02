import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { validateBody } from "../middleware/validate";
import { ok } from "../utils/http";

const workflowStateSchema = z.record(z.any());

export const workflowStateRouter = Router();

workflowStateRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const record = await prisma.workflowState.findUnique({
      where: { companyId: req.auth!.companyId },
      select: { state: true },
    });

    return ok(res, record?.state ?? {});
  }),
);

workflowStateRouter.put(
  "/",
  validateBody(workflowStateSchema),
  asyncHandler(async (req, res) => {
    const record = await prisma.workflowState.upsert({
      where: { companyId: req.auth!.companyId },
      update: {
        state: req.body,
        updatedById: req.auth!.userId,
      },
      create: {
        companyId: req.auth!.companyId,
        state: req.body,
        updatedById: req.auth!.userId,
      },
      select: {
        companyId: true,
        updatedAt: true,
      },
    });

    return ok(res, {
      saved: true,
      companyId: record.companyId,
      updatedAt: record.updatedAt,
    });
  }),
);

