import { Router } from "express";
import { z } from "zod";
import type { UserRole } from "@brandfix/types";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { ok } from "../utils/http";

const sendMessageSchema = z.object({
  receiverId: z.string(),
  message: z.string().min(1).max(1200),
});

const hierarchy: Record<UserRole, UserRole[]> = {
  ADMIN: ["FINANCE", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"],
  FINANCE: ["ADMIN", "OPERATIONS"],
  OPERATIONS: ["ADMIN", "FINANCE", "FIELD_EXECUTIVE", "CLIENT"],
  FIELD_EXECUTIVE: ["OPERATIONS", "ADMIN"],
  CLIENT: ["OPERATIONS", "ADMIN"],
};

function canMessage(role: UserRole, otherRole: UserRole) {
  return hierarchy[role].includes(otherRole);
}

export const chatRouter = Router();

chatRouter.get(
  "/contacts",
  authorize("ADMIN", "FINANCE", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const me = req.auth!;
    const allowedRoles = hierarchy[me.role];

    const contacts = await prisma.user.findMany({
      where: {
        companyId: me.companyId,
        id: { not: me.userId },
        isActive: true,
        role: { in: allowedRoles },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        location: true,
      },
      orderBy: {
        name: "asc",
      },
    });

    return ok(res, contacts);
  }),
);

chatRouter.get(
  "/messages",
  authorize("ADMIN", "FINANCE", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const withUserId = req.query.withUserId?.toString();
    if (!withUserId) {
      return res
        .status(400)
        .json({ error: "withUserId query param is required" });
    }

    const me = req.auth!;
    const other = await prisma.user.findFirst({
      where: {
        id: withUserId,
        companyId: me.companyId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!other || !other.isActive) {
      return res.status(404).json({ error: "Chat contact not found" });
    }

    if (!canMessage(me.role, other.role)) {
      return res.status(403).json({ error: "You cannot chat with this role" });
    }

    const messages = await prisma.chatMessage.findMany({
      where: {
        companyId: me.companyId,
        OR: [
          { senderId: me.userId, receiverId: other.id },
          { senderId: other.id, receiverId: me.userId },
        ],
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return ok(
      res,
      messages.map((message) => ({
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        message: message.message,
        createdAt: message.createdAt,
        senderName: message.sender.name,
        senderRole: message.sender.role,
      })),
    );
  }),
);

chatRouter.post(
  "/messages",
  authorize("ADMIN", "FINANCE", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  validateBody(sendMessageSchema),
  asyncHandler(async (req, res) => {
    const me = req.auth!;
    const receiver = await prisma.user.findFirst({
      where: {
        id: req.body.receiverId,
        companyId: me.companyId,
      },
      select: {
        id: true,
        role: true,
        isActive: true,
      },
    });

    if (!receiver || !receiver.isActive) {
      return res.status(404).json({ error: "Receiver not found" });
    }

    if (!canMessage(me.role, receiver.role)) {
      return res.status(403).json({ error: "You cannot chat with this role" });
    }

    const message = await prisma.chatMessage.create({
      data: {
        companyId: me.companyId,
        senderId: me.userId,
        receiverId: receiver.id,
        message: req.body.message.trim(),
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    });

    return ok(
      res,
      {
        id: message.id,
        senderId: message.senderId,
        receiverId: message.receiverId,
        message: message.message,
        createdAt: message.createdAt,
        senderName: message.sender.name,
        senderRole: message.sender.role,
      },
      201,
    );
  }),
);
