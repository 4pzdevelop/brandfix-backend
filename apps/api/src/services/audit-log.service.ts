import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

interface AuditLogInput {
  companyId?: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  previous?: unknown;
  next?: unknown;
}

export async function writeAuditLog(payload: AuditLogInput): Promise<void> {
  const companyId =
    payload.companyId ??
    (
      await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { companyId: true },
      })
    )?.companyId;
  if (!companyId) {
    return;
  }

  await prisma.auditLog.create({
    data: {
      companyId,
      userId: payload.userId,
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      previous: payload.previous as Prisma.InputJsonValue | undefined,
      next: payload.next as Prisma.InputJsonValue | undefined,
    },
  });
}
