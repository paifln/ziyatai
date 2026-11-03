import { z } from "zod";
import { Styles, type GenerationDocument, type KtpRow } from "./index";
export type ExportStyles = z.infer<typeof Styles>;
export interface JobSummary {
  id: string;
  kind: string;
  status: string;
  stage: string;
  resource_id?: string;
  attempt?: number;
  error?: { code?: string; message?: string } | null;
  format?: "docx" | "pdf";
  result?: { exportId?: string } | null;
  error_code?: string | null;
  errorCode?: string | null;
  cancel_requested?: boolean;
  cancelRequested?: boolean;
}
export interface PlanDetail {
  id: string;
  title: string;
  file_id: string;
  revision: number;
  status: string;
  rows: KtpRow[];
  grade: number | null;
  school_year: string;
  unrecognized?: string[];
}
export interface SourceSnapshot {
  id: string;
  topic: string;
  goals: string;
  grade: number;
  locale: string;
  count: number;
  objectiveCodes: string[];
  minutes?: number;
  goalsSkipped?: boolean;
  subject?: string;
  demo?: boolean;
}
export const ValidationReportSchema = z.object({
  issues: z.array(z.string()).default([]),
  details: z
    .array(
      z.object({
        code: z.string(),
        taskId: z.string().nullable(),
        taskIndex: z.number().nullable(),
      }),
    )
    .optional(),
  stale: z.boolean().optional(),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;
export interface GenerationDetail {
  id: string;
  title: string;
  revision: number;
  status: string;
  demo?: boolean;
  source_snapshot: SourceSnapshot;
  document?: GenerationDocument;
  reviewed_at?: string | null;
  validation?: ValidationReport;
}
export interface AccountProfile {
  name: string;
  email: string;
  school: string;
  teachingSubject: string;
  locale: "kk" | "ru";
  grades: number[];
  styles: ExportStyles;
  stats: { planCount: number; reviewCount: number; documentCount: number };
  limits: { daily: number };
  capabilities: {
    authMode: string;
    ai: boolean;
    demo: boolean;
    directUploads: boolean;
  };
}
