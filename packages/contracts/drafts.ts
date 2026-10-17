import { z } from "zod";
import { GenerationDoc, Row } from "./index";

export const PlanDraftSchema = z
  .object({
    rows: z.array(Row).max(2000),
    grade: z.number().int().min(1).max(11).nullable(),
    schoolYear: z.string().max(20),
  })
  .strict();
export type PlanDraft = z.infer<typeof PlanDraftSchema>;
export const DraftKind = z.enum(["ktp", "generation"]);
export type DraftKind = z.infer<typeof DraftKind>;
export const DraftResource = z
  .object({ kind: DraftKind, resourceId: z.string().uuid() })
  .strict();
const fields = {
  id: z.string().uuid(),
  resourceId: z.string().uuid(),
  baseRevision: z.number().int().positive().max(2147483647),
  sequence: z.number().int().positive().max(1000000000),
};
export const DraftWrite = z.discriminatedUnion("kind", [
  z
    .object({ ...fields, kind: z.literal("ktp"), draft: PlanDraftSchema })
    .strict(),
  z
    .object({ ...fields, kind: z.literal("generation"), draft: GenerationDoc })
    .strict(),
]);
export type StoredDraft<T> = {
  id: string;
  kind: DraftKind;
  resourceId: string;
  baseRevision: number;
  sequence: number;
  savedAt: string;
  expiresAt: string;
  draft: T;
  base: T;
};
export type DraftSummary = Pick<
  StoredDraft<unknown>,
  "id" | "baseRevision" | "sequence" | "savedAt" | "expiresAt"
>;
