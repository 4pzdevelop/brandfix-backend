import {
  type ApprovalActionType,
  type ApprovalRecord,
  type ApprovalRecordStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma";

interface CreateApprovalRecordInput {
  companyId?: string;
  projectCode: string;
  actionType: ApprovalActionType;
  requestedById: string;
  status?: ApprovalRecordStatus;
  approvedById?: string;
  comments?: string;
  metadata?: Prisma.InputJsonValue;
  approvalId?: string;
}

interface DecideApprovalRecordInput {
  approvalId: string;
  status: ApprovalRecordStatus;
  approvedById: string;
  comments?: string;
  metadata?: Prisma.InputJsonValue;
}

async function nextApprovalId(): Promise<string> {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.floor(Math.random() * 9000 + 1000);
  return `APR-${stamp}-${suffix}`;
}

export async function createApprovalRecord(
  input: CreateApprovalRecordInput,
): Promise<ApprovalRecord> {
  const companyId =
    input.companyId ??
    (
      await prisma.user.findUnique({
        where: { id: input.requestedById },
        select: { companyId: true },
      })
    )?.companyId;
  if (!companyId) {
    throw new Error("Company scope not found for approval record");
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const approvalId = input.approvalId ?? (await nextApprovalId());
    try {
      return await prisma.approvalRecord.create({
        data: {
          companyId,
          approvalId,
          projectCode: input.projectCode,
          actionType: input.actionType,
          requestedById: input.requestedById,
          approvedById: input.approvedById,
          status: input.status ?? "PENDING",
          comments: input.comments,
          metadata: input.metadata,
          decidedAt:
            input.status && input.status !== "PENDING" ? new Date() : null,
        },
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not generate unique approval id");
}

export async function decideApprovalRecord(
  input: DecideApprovalRecordInput,
): Promise<ApprovalRecord> {
  return prisma.approvalRecord.update({
    where: { approvalId: input.approvalId },
    data: {
      status: input.status,
      approvedById: input.approvedById,
      comments: input.comments,
      metadata: input.metadata,
      decidedAt: new Date(),
    },
  });
}

export async function latestPendingApprovalRecord(params: {
  companyId?: string;
  projectCode: string;
  actionType: ApprovalActionType;
}): Promise<ApprovalRecord | null> {
  return prisma.approvalRecord.findFirst({
    where: {
      ...(params.companyId ? { companyId: params.companyId } : {}),
      projectCode: params.projectCode,
      actionType: params.actionType,
      status: "PENDING",
    },
    orderBy: { createdAt: "desc" },
  });
}
