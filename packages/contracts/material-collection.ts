export const materialStatuses = [
  "queued",
  "running",
  "needs_review",
  "approved",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type MaterialStatus = (typeof materialStatuses)[number];
export interface MaterialSummary {
  id: string;
  title: string;
  status: MaterialStatus;
  created_at: string;
  revision: number;
  locale?: string;
  generation_id?: string;
  demo?: boolean;
  format?: "docx" | "pdf" | null;
  audience?: "student" | "full" | null;
  teacher_reviewed?: boolean;
}
export interface MaterialCollectionPage {
  items: MaterialSummary[];
  total: number;
  matched: number;
  counts: Partial<Record<MaterialStatus, number>>;
  limit: number;
  offset: number;
}
