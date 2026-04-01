import type { UserRole } from "@brandfix/types";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";

interface GenerateTasksInput {
  companyId: string;
  storeId: string;
  amcId: string;
  visitDates: Date[];
  createdByRole: UserRole;
}

export async function generateAmcTasks(input: GenerateTasksInput) {
  const assignee = await prisma.user.findFirst({
    where: {
      companyId: input.companyId,
      role: {
        in: ["FIELD_EXECUTIVE", input.createdByRole]
      }
    }
  });

  if (!assignee) {
    return [];
  }

  const rows: Prisma.TaskCreateManyInput[] = input.visitDates.map((visitDate, index) => ({
    companyId: input.companyId,
    storeId: input.storeId,
    amcId: input.amcId,
    title: `Scheduled AMC Visit ${index + 1}`,
    description: "Auto-generated visit task from AMC schedule",
    dueDate: visitDate,
    status: "PENDING" satisfies TaskStatus,
    assignedToId: assignee.id
  }));

  await prisma.task.createMany({ data: rows });
  return rows;
}
