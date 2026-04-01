import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { ok } from "../utils/http";

export const reportsRouter = Router();

reportsRouter.get(
  "/",
  authorize("ADMIN", "OPERATIONS", "CLIENT"),
  asyncHandler(async (req, res) => {
    const type = req.query.type?.toString();
    const where: any = type
      ? { companyId: req.auth!.companyId, reportType: z.enum(["RECCE", "BOQ", "AMC", "AUDIT"]).parse(type) }
      : { companyId: req.auth!.companyId };

    if (req.auth?.role === "CLIENT") {
      const me = await prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { clientId: true }
      });
      if (!me?.clientId) {
        return ok(res, []);
      }

      const [recces, boqs, amcs, audits] = await Promise.all([
        prisma.recce.findMany({
          where: { companyId: req.auth!.companyId, store: { clientId: me.clientId } },
          select: { id: true }
        }),
        prisma.boq.findMany({
          where: { companyId: req.auth!.companyId, recce: { store: { clientId: me.clientId } } },
          select: { id: true }
        }),
        prisma.amc.findMany({
          where: { companyId: req.auth!.companyId, clientId: me.clientId },
          select: { id: true }
        }),
        prisma.audit.findMany({
          where: { companyId: req.auth!.companyId, store: { clientId: me.clientId } },
          select: { id: true }
        })
      ]);

      where.OR = [
        { reportType: "RECCE", referenceId: { in: recces.map((row) => row.id) } },
        { reportType: "BOQ", referenceId: { in: boqs.map((row) => row.id) } },
        { reportType: "AMC", referenceId: { in: amcs.map((row) => row.id) } },
        { reportType: "AUDIT", referenceId: { in: audits.map((row) => row.id) } }
      ];
    }

    const reports = await prisma.report.findMany({
      where,
      orderBy: { generatedAt: "desc" }
    });

    return ok(
      res,
      reports.map((report) => ({
        id: report.id,
        reportType: report.reportType,
        referenceId: report.referenceId,
        generatedAt: report.generatedAt,
        generatedBy: report.generatedById,
        fileUrl: report.fileUrl
      }))
    );
  })
);

reportsRouter.get(
  "/dashboard",
  authorize("ADMIN", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    if (req.auth?.role === "CLIENT") {
      const clientId = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { clientId: true } });
      if (!clientId?.clientId) {
        return ok(res, {
          activeClients: 0,
          activeAmcs: 0,
          pendingTasks: 0,
          monthlyVisits: 0
        });
      }

      const [activeAmcs, pendingTasks] = await Promise.all([
        prisma.amc.count({ where: { companyId: req.auth!.companyId, clientId: clientId.clientId, status: "ACTIVE" } }),
        prisma.task.count({
          where: {
            companyId: req.auth!.companyId,
            store: { clientId: clientId.clientId },
            status: { in: ["PENDING", "IN_PROGRESS"] }
          }
        })
      ]);

      return ok(res, {
        activeClients: 1,
        activeAmcs,
        pendingTasks,
        monthlyVisits: activeAmcs
      });
    }

    const start = new Date();
    start.setDate(1);

    const [activeClients, activeAmcs, pendingTasks, monthlyVisits] = await Promise.all([
      prisma.client.count({ where: { companyId: req.auth!.companyId, status: "ACTIVE" } }),
      prisma.amc.count({ where: { companyId: req.auth!.companyId, status: "ACTIVE" } }),
      prisma.task.count({ where: { companyId: req.auth!.companyId, status: { in: ["PENDING", "IN_PROGRESS"] } } }),
      prisma.task.count({ where: { companyId: req.auth!.companyId, dueDate: { gte: start } } })
    ]);

    return ok(res, {
      activeClients,
      activeAmcs,
      pendingTasks,
      monthlyVisits
    });
  })
);
