import type { VisitFrequency } from "@prisma/client";

function frequencyToMonths(frequency: VisitFrequency): number {
  switch (frequency) {
    case "MONTHLY":
      return 1;
    case "QUARTERLY":
      return 3;
    case "HALF_YEARLY":
      return 6;
    default:
      return 1;
  }
}

export function generateVisitSchedule(startDate: Date, endDate: Date, frequency: VisitFrequency): Date[] {
  const visits: Date[] = [];
  const jump = frequencyToMonths(frequency);
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    visits.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + jump);
  }

  return visits;
}
