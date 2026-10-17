export const planStatuses = [
  "extracting",
  "review",
  "confirmed",
  "failed",
  "cancelled",
] as const;
export type PlanStatusValue = (typeof planStatuses)[number];
export function isEditablePlanStatus(status: string) {
  return status === "review" || status === "confirmed";
}
