import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);
  const company = await prisma.company.upsert({
    where: { code: "BRANDFIX-IN" },
    update: {},
    create: {
      name: "BrandFix India",
      code: "BRANDFIX-IN",
      minMarginPercent: 20,
      emergencyCapPercent: 10,
      emergencyPerExpenseLimit: 50000,
      approvalThresholdAmount: 150000,
      defaultBillingTemplate: [40, 40, 20],
      country: "India",
      state: "Delhi",
      city: "New Delhi",
      postalCode: "110001",
    },
  });

  await prisma.billingTemplate.upsert({
    where: { id: `${company.id}-default-template` },
    update: {
      percentages: [40, 40, 20],
      isDefault: true,
    },
    create: {
      id: `${company.id}-default-template`,
      companyId: company.id,
      name: "40-40-20",
      percentages: [40, 40, 20],
      isDefault: true,
    },
  });

  const client = await prisma.client.upsert({
    where: { code: "NXT-RETAIL" },
    update: { companyId: company.id },
    create: {
      companyId: company.id,
      name: "Next Retail Pvt Ltd",
      code: "NXT-RETAIL",
      industry: "Retail",
      primaryContact: "ops@nxtretail.com",
    },
  });

  const [admin, finance, operations, fieldExec, clientUser, adminTest] = await Promise.all([
    prisma.user.upsert({
      where: { email: "admin@brandfix.io" },
      update: { location: "Head Office", companyId: company.id },
      create: {
        companyId: company.id,
        name: "Platform Admin",
        email: "admin@brandfix.io",
        passwordHash,
        role: UserRole.ADMIN,
        location: "Head Office",
      },
    }),
    prisma.user.upsert({
      where: { email: "finance@brandfix.io" },
      update: { location: "Head Office", companyId: company.id },
      create: {
        companyId: company.id,
        name: "Finance Controller",
        email: "finance@brandfix.io",
        passwordHash,
        role: UserRole.FINANCE,
        location: "Head Office",
      },
    }),
    prisma.user.upsert({
      where: { email: "ops@brandfix.io" },
      update: { location: "Delhi NCR", companyId: company.id },
      create: {
        companyId: company.id,
        name: "Operations Lead",
        email: "ops@brandfix.io",
        passwordHash,
        role: UserRole.OPERATIONS,
        location: "Delhi NCR",
      },
    }),
    prisma.user.upsert({
      where: { email: "field@brandfix.io" },
      update: { location: "Bengaluru", companyId: company.id },
      create: {
        companyId: company.id,
        name: "Field Executive",
        email: "field@brandfix.io",
        passwordHash,
        role: UserRole.FIELD_EXECUTIVE,
        location: "Bengaluru",
      },
    }),
    prisma.user.upsert({
      where: { email: "client@brandfix.io" },
      update: { location: "Bengaluru", companyId: company.id },
      create: {
        companyId: company.id,
        name: "Client Viewer",
        email: "client@brandfix.io",
        passwordHash,
        role: UserRole.CLIENT,
        location: "Bengaluru",
        clientId: client.id,
      },
    }),
    prisma.user.upsert({
      where: { email: "admin@test.com" },
      update: { location: "Head Office", companyId: company.id },
      create: {
        companyId: company.id,
        name: "Demo Admin",
        email: "admin@test.com",
        passwordHash: await bcrypt.hash("12345678", 10),
        role: UserRole.ADMIN,
        location: "Head Office",
      },
    }),
  ]);

  await prisma.request.upsert({
    where: { id: "demo-brandfix-request" },
    update: {
      companyId: company.id,
      createdById: admin.id,
      companyName: "BrandFix India",
      issueTitle: "Storefront signage maintenance",
      description: "Flagship store signage needs recce and repair planning.",
      category: "SIGNAGE",
      status: "pending",
    },
    create: {
      id: "demo-brandfix-request",
      companyId: company.id,
      createdById: admin.id,
      companyName: "BrandFix India",
      issueTitle: "Storefront signage maintenance",
      description: "Flagship store signage needs recce and repair planning.",
      category: "SIGNAGE",
      status: "pending",
    },
  });

  const store = await prisma.store.upsert({
    where: { code: "BLR-IND-001" },
    update: { companyId: company.id, clientId: client.id },
    create: {
      companyId: company.id,
      clientId: client.id,
      name: "Indiranagar Flagship",
      code: "BLR-IND-001",
      storeType: "Flagship",
      addressLine1: "100 Feet Road, Indiranagar",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560038",
      amcStatus: "ACTIVE",
    },
  });

  const recce = await prisma.recce.create({
    data: {
      companyId: company.id,
      storeId: store.id,
      visitDate: new Date(),
      status: "SUBMITTED",
      notes: "Initial recce completed with lighting and signage observations",
      conditionSummary: {
        signage: "Good",
        vm: "Needs Repair",
        lighting: "Critical",
        branding: "Good",
      },
      measurements: [
        {
          section: "Front",
          length: 12,
          width: 2,
          height: 8,
          unit: "ft",
        },
      ],
      createdById: fieldExec.id,
    },
  });

  await prisma.recceImage.createMany({
    data: [
      {
        recceId: recce.id,
        fileUrl: "https://example.com/images/recce-1.jpg",
        category: "SIGNAGE",
      },
      {
        recceId: recce.id,
        fileUrl: "https://example.com/images/recce-2.jpg",
        category: "LIGHTING",
      },
    ],
  });

  await Promise.all([
    prisma.rateCard.upsert({
      where: {
        companyId_itemCode: {
          companyId: company.id,
          itemCode: "SIG001",
        },
      },
      update: {},
      create: {
        companyId: company.id,
        itemCode: "SIG001",
        itemName: "Signage Replacement",
        unitRate: 18500,
        unit: "nos",
      },
    }),
    prisma.rateCard.upsert({
      where: {
        companyId_itemCode: {
          companyId: company.id,
          itemCode: "LGT010",
        },
      },
      update: {},
      create: {
        companyId: company.id,
        itemCode: "LGT010",
        itemName: "LED Module Retrofit",
        unitRate: 7200,
        unit: "nos",
      },
    }),
    prisma.rateCard.upsert({
      where: {
        companyId_itemCode: {
          companyId: company.id,
          itemCode: "BND055",
        },
      },
      update: {},
      create: {
        companyId: company.id,
        itemCode: "BND055",
        itemName: "Brand Panel Refinishing",
        unitRate: 9800,
        unit: "sqm",
      },
    }),
  ]);

  const projectCode = `PRJ-BLRIND001-${recce.id.slice(-6).toUpperCase()}`;

  const boq = await prisma.boq.create({
    data: {
      companyId: company.id,
      recceId: recce.id,
      projectCode,
      version: 1,
      status: "APPROVED",
      approvalStage: "CLIENT_APPROVED",
      financeReviewedById: finance.id,
      financeReviewedAt: new Date(),
      clientApprovedAt: new Date(),
      poNumber: "PO-2026-001",
      budgetFrozenAt: new Date(),
      revenueLockedAmount: 30326,
      subtotal: 25700,
      taxAmount: 4626,
      totalAmount: 30326,
      items: {
        create: [
          {
            itemCode: "SIG001",
            itemName: "Signage Replacement",
            quantity: 1,
            unitRate: 18500,
            marginPercent: 14,
            total: 18500,
          },
          {
            itemCode: "LGT010",
            itemName: "LED Module Retrofit",
            quantity: 1,
            unitRate: 7200,
            marginPercent: 12,
            total: 7200,
          },
        ],
      },
    },
  });

  await Promise.all([
    prisma.budgetBucket.upsert({
      where: {
        companyId_projectCode_bucketType: {
          companyId: company.id,
          projectCode,
          bucketType: "MATERIAL",
        },
      },
      update: { approvedBudget: 12130.4 },
      create: { companyId: company.id, projectCode, bucketType: "MATERIAL", approvedBudget: 12130.4 },
    }),
    prisma.budgetBucket.upsert({
      where: {
        companyId_projectCode_bucketType: {
          companyId: company.id,
          projectCode,
          bucketType: "LABOUR",
        },
      },
      update: { approvedBudget: 10614.1 },
      create: { companyId: company.id, projectCode, bucketType: "LABOUR", approvedBudget: 10614.1 },
    }),
    prisma.budgetBucket.upsert({
      where: {
        companyId_projectCode_bucketType: {
          companyId: company.id,
          projectCode,
          bucketType: "LOGISTICS",
        },
      },
      update: { approvedBudget: 4548.9 },
      create: { companyId: company.id, projectCode, bucketType: "LOGISTICS", approvedBudget: 4548.9 },
    }),
    prisma.budgetBucket.upsert({
      where: {
        companyId_projectCode_bucketType: {
          companyId: company.id,
          projectCode,
          bucketType: "MISC",
        },
      },
      update: { approvedBudget: 3032.6 },
      create: { companyId: company.id, projectCode, bucketType: "MISC", approvedBudget: 3032.6 },
    }),
  ]);

  await prisma.project.upsert({
    where: { projectCode },
    update: {
      status: "BUDGET_FROZEN",
      poNumber: "PO-2026-001",
      poValue: 30326,
      baselineCost: 25700,
      budgetFrozenAt: new Date(),
      companyId: company.id,
    },
    create: {
      companyId: company.id,
      projectCode,
      title: "Indiranagar Flagship Repair",
      clientId: client.id,
      executionType: "HYBRID",
      status: "BUDGET_FROZEN",
      poNumber: "PO-2026-001",
      poValue: 30326,
      baselineCost: 25700,
      budgetFrozenAt: new Date(),
      createdById: operations.id,
    },
  });

  await Promise.all([
    prisma.labourRateMaster.upsert({
      where: { companyId_roleLabel: { companyId: company.id, roleLabel: "Site Engineer" } },
      update: { hourlyRate: 350, isActive: true },
      create: { companyId: company.id, roleLabel: "Site Engineer", hourlyRate: 350, isActive: true },
    }),
    prisma.labourRateMaster.upsert({
      where: { companyId_roleLabel: { companyId: company.id, roleLabel: "Carpenter" } },
      update: { hourlyRate: 320, isActive: true },
      create: { companyId: company.id, roleLabel: "Carpenter", hourlyRate: 320, isActive: true },
    }),
    prisma.labourRateMaster.upsert({
      where: { companyId_roleLabel: { companyId: company.id, roleLabel: "Painter" } },
      update: { hourlyRate: 300, isActive: true },
      create: { companyId: company.id, roleLabel: "Painter", hourlyRate: 300, isActive: true },
    }),
    prisma.labourRateMaster.upsert({
      where: { companyId_roleLabel: { companyId: company.id, roleLabel: "Helper" } },
      update: { hourlyRate: 220, isActive: true },
      create: { companyId: company.id, roleLabel: "Helper", hourlyRate: 220, isActive: true },
    }),
  ]);

  const amc = await prisma.amc.create({
    data: {
      companyId: company.id,
      clientId: client.id,
      storeId: store.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      visitFrequency: "MONTHLY",
      coverageTypes: ["Signage", "Lighting", "VM Fixtures"],
      status: "ACTIVE",
    },
  });

  const task = await prisma.task.create({
    data: {
      companyId: company.id,
      storeId: store.id,
      amcId: amc.id,
      title: "Lighting Compliance Fix",
      description: "Replace failed modules in front fascia",
      dueDate: new Date("2026-02-15"),
      assignedToId: fieldExec.id,
      status: "IN_PROGRESS",
    },
  });

  await prisma.taskImage.createMany({
    data: [
      {
        taskId: task.id,
        stage: "BEFORE",
        fileUrl: "https://example.com/images/task-before.jpg",
      },
    ],
  });

  const audit = await prisma.audit.create({
    data: {
      companyId: company.id,
      storeId: store.id,
      auditDate: new Date("2026-01-28"),
      status: "SUBMITTED",
      totalScore: 34,
      maxScore: 40,
      summary: "Improved branding visibility, pending fixture repairs",
      items: {
        create: [
          {
            key: "signage",
            label: "Signage compliance",
            score: 8,
            maxScore: 10,
            remarks: "Need slight alignment",
          },
          {
            key: "lighting",
            label: "Lighting quality",
            score: 8,
            maxScore: 10,
            remarks: "One dead module",
          },
          {
            key: "branding",
            label: "Branding visibility",
            score: 9,
            maxScore: 10,
            remarks: "Good",
          },
          {
            key: "fixtures",
            label: "Fixture condition",
            score: 9,
            maxScore: 10,
            remarks: "Minor scratches",
          },
        ],
      },
    },
  });

  await prisma.report.createMany({
    data: [
      {
        companyId: company.id,
        reportType: "RECCE",
        referenceId: recce.id,
        fileUrl: "https://example.com/reports/recce.pdf",
        generatedById: operations.id,
      },
      {
        companyId: company.id,
        reportType: "BOQ",
        referenceId: boq.id,
        fileUrl: "https://example.com/reports/boq.xlsx",
        generatedById: admin.id,
      },
      {
        companyId: company.id,
        reportType: "AUDIT",
        referenceId: audit.id,
        fileUrl: "https://example.com/reports/audit.pdf",
        generatedById: operations.id,
      },
    ],
  });

  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      userId: admin.id,
      action: "SEED_BOOTSTRAP",
      entityType: "SYSTEM",
      entityId: "initial",
      next: {
        users: [admin.id, finance.id, operations.id, fieldExec.id, clientUser.id],
        projectCode,
      },
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
