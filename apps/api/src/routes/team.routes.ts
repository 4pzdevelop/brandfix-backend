import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { writeAuditLog } from "../services/audit-log.service";
import { ok } from "../utils/http";

const createSiteEngineerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  location: z.string().min(2),
});

export const teamRouter = Router();

teamRouter.get(
  "/site-engineers",
  authorize("ADMIN", "OPERATIONS"),
  asyncHandler(async (req, res) => {
    const engineers = await prisma.user.findMany({
      where: {
        companyId: req.auth!.companyId,
        role: "FIELD_EXECUTIVE",
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        location: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return ok(res, engineers);
  }),
);

teamRouter.post(
  "/site-engineers",
  authorize("ADMIN", "OPERATIONS"),
  validateBody(createSiteEngineerSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.user.findUnique({
      where: { email: req.body.email },
    });
    if (existing) {
      return res
        .status(409)
        .json({ error: "A user with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const engineer = await prisma.user.create({
      data: {
        companyId: req.auth!.companyId,
        name: req.body.name,
        email: req.body.email,
        passwordHash,
        role: "FIELD_EXECUTIVE",
        location: req.body.location,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        location: true,
        createdAt: true,
      },
    });

    await writeAuditLog({
      userId: req.auth!.userId,
      action: "CREATE",
      entityType: "SITE_ENGINEER",
      entityId: engineer.id,
      next: engineer,
    });

    return ok(res, engineer, 201);
  }),
);
