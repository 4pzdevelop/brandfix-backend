import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ok } from "../utils/http";

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function serializeRequest(request: {
  id: string;
  companyId: string;
  createdById: string;
  companyName: string;
  issueTitle: string;
  description: string;
  category: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: request.id,
    companyId: request.companyId,
    createdById: request.createdById,
    companyName: request.companyName,
    issueTitle: request.issueTitle,
    title: request.issueTitle,
    description: request.description,
    category: request.category,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

type RequestInputBody = {
  companyId?: string;
  companyName?: string;
  issueTitle?: string;
  title?: string;
  description?: string;
  category?: string;
  status?: string;
};

function normalizeRequestPayload(
  body: RequestInputBody,
  authCompanyId: string,
) {
  const issueTitle = String(body.issueTitle ?? body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  const companyName = String(
    body.companyName ?? body.companyId ?? authCompanyId ?? "BrandFix",
  ).trim();

  return {
    issueTitle,
    description,
    companyName: companyName.length > 0 ? companyName : "BrandFix",
    category: body.category ?? null,
    status: body.status?.trim(),
  };
}

export async function listRequests(req: Request, res: Response) {
  const requests = await prisma.request.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { createdAt: "desc" },
  });
  return ok(res, requests.map(serializeRequest));
}

export async function getRequestById(req: Request, res: Response) {
  const requestId = routeParam(req.params.id);
  const request = await prisma.request.findUnique({ where: { id: requestId } });

  if (!request || request.companyId !== req.auth!.companyId) {
    return res.status(404).json({ error: "Request not found" });
  }

  return ok(res, serializeRequest(request));
}

export async function createRequest(req: Request, res: Response) {
  const normalized = normalizeRequestPayload(
    req.body as RequestInputBody,
    req.auth!.companyId,
  );
  if (normalized.issueTitle.length < 3) {
    return res.status(400).json({ error: "issueTitle/title is required" });
  }
  if (normalized.description.length < 5) {
    return res.status(400).json({ error: "description is required" });
  }

  const request = await prisma.request.create({
    data: {
      companyId: req.auth!.companyId,
      createdById: req.auth!.userId,
      companyName: normalized.companyName,
      issueTitle: normalized.issueTitle,
      description: normalized.description,
      category: normalized.category,
      status: normalized.status ?? "pending",
    },
  });

  return ok(res, serializeRequest(request), 201);
}

export async function updateRequest(req: Request, res: Response) {
  const requestId = routeParam(req.params.id);
  const existing = await prisma.request.findUnique({ where: { id: requestId } });
  if (!existing || existing.companyId !== req.auth!.companyId) {
    return res.status(404).json({ error: "Request not found" });
  }

  const normalized = normalizeRequestPayload(
    req.body as RequestInputBody,
    req.auth!.companyId,
  );

  const request = await prisma.request.update({
    where: { id: requestId },
    data: {
      ...(req.body.companyName !== undefined || req.body.companyId !== undefined
        ? { companyName: normalized.companyName }
        : {}),
      ...(req.body.issueTitle !== undefined || req.body.title !== undefined
        ? { issueTitle: normalized.issueTitle }
        : {}),
      ...(req.body.description !== undefined
        ? { description: normalized.description }
        : {}),
      ...(req.body.category !== undefined ? { category: normalized.category } : {}),
      ...(req.body.status !== undefined ? { status: normalized.status } : {}),
    },
  });

  return ok(res, serializeRequest(request));
}

export async function deleteRequest(req: Request, res: Response) {
  const requestId = routeParam(req.params.id);
  const existing = await prisma.request.findUnique({ where: { id: requestId } });
  if (!existing || existing.companyId !== req.auth!.companyId) {
    return res.status(404).json({ error: "Request not found" });
  }

  await prisma.request.delete({ where: { id: requestId } });
  return ok(res, { success: true });
}
