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
    description: request.description,
    category: request.category,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
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
  const request = await prisma.request.create({
    data: {
      companyId: req.auth!.companyId,
      createdById: req.auth!.userId,
      companyName: req.body.companyName,
      issueTitle: req.body.issueTitle,
      description: req.body.description,
      category: req.body.category ?? null,
      status: "pending",
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

  const request = await prisma.request.update({
    where: { id: requestId },
    data: {
      ...(req.body.companyName !== undefined ? { companyName: req.body.companyName } : {}),
      ...(req.body.issueTitle !== undefined ? { issueTitle: req.body.issueTitle } : {}),
      ...(req.body.description !== undefined ? { description: req.body.description } : {}),
      ...(req.body.category !== undefined ? { category: req.body.category } : {}),
      ...(req.body.status !== undefined ? { status: req.body.status } : {}),
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
