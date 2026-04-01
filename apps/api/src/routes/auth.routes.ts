import bcrypt from "bcryptjs";
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/authenticate";
import { asyncHandler } from "../middleware/async-handler";
import { validateBody } from "../middleware/validate";
import { ok } from "../utils/http";
import { signAccessToken, signRefreshToken } from "../utils/jwt";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  companyCode: z.string().min(2).optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(UserRole),
  companyId: z.string().min(1),
  name: z.string().min(2).optional(),
  location: z.string().min(2).optional(),
  clientId: z.string().min(1).optional(),
});

export const authRouter = Router();

function buildAuthResponse(user: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  location: string | null;
  clientId: string | null;
  companyId: string;
  company: { code: string };
}) {
  const payload = {
    sub: user.id,
    role: user.role,
    email: user.email,
    companyId: user.companyId,
  };

  return {
    token: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      location: user.location,
      clientId: user.clientId,
      companyId: user.companyId,
      companyCode: user.company.code,
    },
  };
}

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { email: req.body.email },
      include: { client: true, company: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (
      req.body.companyCode &&
      user.company.code.toUpperCase() !== req.body.companyCode.toUpperCase()
    ) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const matches = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    return ok(res, buildAuthResponse(user));
  }),
);

authRouter.post(
  "/register",
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const email = req.body.email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      return res.status(409).json({ error: "User already exists" });
    }

    const company = await prisma.company.findUnique({
      where: { id: req.body.companyId },
      select: { id: true, code: true },
    });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    if (req.body.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: req.body.clientId },
        select: { id: true, companyId: true },
      });
      if (!client || client.companyId !== company.id) {
        return res.status(400).json({ error: "Client does not belong to company" });
      }
    }

    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const user = await prisma.user.create({
      data: {
        companyId: company.id,
        name: req.body.name?.trim() || email.split("@")[0],
        email,
        passwordHash,
        role: req.body.role,
        location: req.body.location?.trim(),
        clientId: req.body.clientId ?? null,
      },
      include: {
        company: {
          select: {
            code: true,
          },
        },
      },
    });

    return ok(res, buildAuthResponse(user), 201);
  }),
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (!auth) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        location: true,
        clientId: true,
        companyId: true,
        company: {
          select: {
            code: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    return ok(res, {
      ...user,
      companyCode: user.company.code,
    });
  }),
);
