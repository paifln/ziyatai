import type { PlanStatusValue } from "../domain/plan-status";

export interface PlanSummary {
  id: string;
  title: string;
  grade: number | null;
  school_year: string;
  status: PlanStatusValue;
  created_at?: string;
}
export interface PlanCollectionPage {
  items: PlanSummary[];
  total: number;
  matched: number;
  counts: Partial<Record<PlanStatusValue, number>>;
  limit: number;
  offset: number;
}
