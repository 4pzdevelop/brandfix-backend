import bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";

const DEFAULT_ADMIN_ENABLED =
  process.env.DEFAULT_TEST_ADMIN_ENABLED?.trim().toLowerCase() !== "false";
const DEFAULT_ADMIN_EMAIL =
  process.env.DEFAULT_TEST_ADMIN_EMAIL?.trim().toLowerCase() || "admin@test.com";
const DEFAULT_ADMIN_PASSWORD =
  process.env.DEFAULT_TEST_ADMIN_PASSWORD || "12345678";
const DEFAULT_ADMIN_NAME =
  process.env.DEFAULT_TEST_ADMIN_NAME?.trim() || "Test Admin";
const DEFAULT_ADMIN_LOCATION =
  process.env.DEFAULT_TEST_ADMIN_LOCATION?.trim() || "Head Office";
const DEFAULT_COMPANY_CODE =
  process.env.DEFAULT_TEST_ADMIN_COMPANY_CODE?.trim().toUpperCase() || "BRANDFIX-IN";
const DEFAULT_COMPANY_NAME =
  process.env.DEFAULT_TEST_ADMIN_COMPANY_NAME?.trim() || "BrandFix India";

export async function ensureDefaultAdminUser(): Promise<void> {
  if (!DEFAULT_ADMIN_ENABLED) {
    return;
  }

  const company = await prisma.company.upsert({
    where: { code: DEFAULT_COMPANY_CODE },
    update: {
      name: DEFAULT_COMPANY_NAME,
    },
    create: {
      name: DEFAULT_COMPANY_NAME,
      code: DEFAULT_COMPANY_CODE,
    },
  });

  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

  await prisma.user.upsert({
    where: { email: DEFAULT_ADMIN_EMAIL },
    update: {
      companyId: company.id,
      name: DEFAULT_ADMIN_NAME,
      passwordHash,
      role: UserRole.ADMIN,
      location: DEFAULT_ADMIN_LOCATION,
      isActive: true,
    },
    create: {
      companyId: company.id,
      name: DEFAULT_ADMIN_NAME,
      email: DEFAULT_ADMIN_EMAIL,
      passwordHash,
      role: UserRole.ADMIN,
      location: DEFAULT_ADMIN_LOCATION,
      isActive: true,
    },
  });
}
