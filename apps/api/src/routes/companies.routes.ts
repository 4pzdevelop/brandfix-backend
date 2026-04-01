import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/async-handler";
import { authorize } from "../middleware/authorize";
import { validateBody } from "../middleware/validate";
import { ok } from "../utils/http";

const roleAssignmentSchema = z.object({
  userId: z.string(),
  role: z.nativeEnum(UserRole),
});

const rateCardSchema = z.object({
  itemCode: z.string().min(2),
  itemName: z.string().min(2),
  unitRate: z.number().nonnegative(),
  unit: z.string().min(1),
  isActive: z.boolean().optional(),
});

const setupWizardSchema = z.object({
  name: z.string().min(2).optional(),
  minMarginPercent: z.number().min(0).max(100).optional(),
  emergencyCapPercent: z.number().min(0).max(100).optional(),
  emergencyPerExpenseLimit: z.number().nonnegative().optional(),
  approvalThresholdAmount: z.number().nonnegative().optional(),
  country: z.string().min(2).optional(),
  state: z.string().min(2).optional(),
  city: z.string().min(2).optional(),
  postalCode: z.string().min(3).optional(),
  billingTemplate: z
    .object({
      name: z.string().min(2),
      percentages: z.array(z.number().positive()).min(1),
      setAsDefault: z.boolean().default(true),
    })
    .optional(),
  roleAssignments: z.array(roleAssignmentSchema).optional(),
  rateCards: z.array(rateCardSchema).optional(),
});

export const companiesRouter = Router();

companiesRouter.get(
  "/wizard-defaults",
  authorize("ADMIN", "FINANCE", "OPERATIONS"),
  asyncHandler(async (_req, res) => {
    return ok(res, {
      minMarginPercent: 20,
      emergencyCapPercent: 10,
      emergencyPerExpenseLimit: 50000,
      approvalThresholdAmount: 150000,
      billingTemplates: [
        { name: "40-40-20", percentages: [40, 40, 20] },
        { name: "50-50", percentages: [50, 50] },
      ],
      coreBudgetBuckets: ["MATERIAL", "LABOUR", "LOGISTICS", "MISC"],
    });
  }),
);

companiesRouter.get(
  "/current",
  authorize("ADMIN", "FINANCE", "OPERATIONS", "FIELD_EXECUTIVE", "CLIENT"),
  asyncHandler(async (req, res) => {
    const company = await prisma.company.findUnique({
      where: { id: req.auth!.companyId },
      include: {
        billingTemplates: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    return ok(res, company);
  }),
);

companiesRouter.patch(
  "/setup-wizard",
  authorize("ADMIN"),
  validateBody(setupWizardSchema),
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;

    const payload = setupWizardSchema.parse(req.body);

    const updatedCompany = await prisma.company.update({
      where: { id: companyId },
      data: {
        ...(payload.name ? { name: payload.name } : {}),
        ...(payload.minMarginPercent !== undefined
          ? { minMarginPercent: payload.minMarginPercent }
          : {}),
        ...(payload.emergencyCapPercent !== undefined
          ? { emergencyCapPercent: payload.emergencyCapPercent }
          : {}),
        ...(payload.emergencyPerExpenseLimit !== undefined
          ? { emergencyPerExpenseLimit: payload.emergencyPerExpenseLimit }
          : {}),
        ...(payload.approvalThresholdAmount !== undefined
          ? { approvalThresholdAmount: payload.approvalThresholdAmount }
          : {}),
        ...(payload.country ? { country: payload.country } : {}),
        ...(payload.state ? { state: payload.state } : {}),
        ...(payload.city ? { city: payload.city } : {}),
        ...(payload.postalCode ? { postalCode: payload.postalCode } : {}),
      },
    });

    if (payload.billingTemplate) {
      const billingTemplate = payload.billingTemplate;
      await prisma.$transaction(async (tx) => {
        if (billingTemplate.setAsDefault !== false) {
          await tx.billingTemplate.updateMany({
            where: { companyId },
            data: { isDefault: false },
          });
        }

        await tx.billingTemplate.create({
          data: {
            companyId,
            name: billingTemplate.name,
            percentages: billingTemplate.percentages,
            isDefault: billingTemplate.setAsDefault !== false,
          },
        });

        if (billingTemplate.setAsDefault !== false) {
          await tx.company.update({
            where: { id: companyId },
            data: {
              defaultBillingTemplate: billingTemplate.percentages,
            },
          });
        }
      });
    }

    if (payload.roleAssignments?.length) {
      await Promise.all(
        payload.roleAssignments.map((assignment) =>
          prisma.user.updateMany({
            where: {
              id: assignment.userId,
              companyId,
            },
            data: {
              role: assignment.role,
            },
          }),
        ),
      );
    }

    if (payload.rateCards?.length) {
      await Promise.all(
        payload.rateCards.map((item) =>
          prisma.rateCard.upsert({
            where: {
              companyId_itemCode: {
                companyId,
                itemCode: item.itemCode,
              },
            },
            update: {
              itemName: item.itemName,
              unitRate: item.unitRate,
              unit: item.unit,
              isActive: item.isActive ?? true,
            },
            create: {
              companyId,
              itemCode: item.itemCode,
              itemName: item.itemName,
              unitRate: item.unitRate,
              unit: item.unit,
              isActive: item.isActive ?? true,
            },
          }),
        ),
      );
    }

    const result = await prisma.company.findUnique({
      where: { id: updatedCompany.id },
      include: {
        billingTemplates: {
          orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        },
      },
    });

    return ok(res, result);
  }),
);
