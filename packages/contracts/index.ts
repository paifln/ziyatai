import { z } from "zod";
export const Locale = z.enum(["kk", "ru", "kk+ru"]);
export const Block = z
  .object({
    type: z.enum(["paragraph", "list", "table", "code"]),
    text: z.string(),
    items: z.array(z.string()),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    language: z.string(),
  })
  .strict();
export const Task = z
  .object({
    id: z.string(),
    level: z.enum(["easy", "medium", "advanced"]),
    objectiveRefs: z.array(z.string()),
    estimatedMinutes: z.number().int(),
    points: z.number().int(),
    contentBlocks: z.array(Block),
    answerBlocks: z.array(Block),
    explanationHow: z.string(),
    explanationWhy: z.string(),
    rubric: z.array(
      z.object({ criterion: z.string(), points: z.number().int() }).strict(),
    ),
    verificationCases: z.array(
      z.object({ input: z.string(), expected: z.string() }).strict(),
    ),
    translation: z
      .object({
        contentBlocks: z.array(Block),
        answerBlocks: z.array(Block),
        explanationHow: z.string(),
        explanationWhy: z.string(),
        rubric: z.array(
          z
            .object({ criterion: z.string(), points: z.number().int() })
            .strict(),
        ),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const GenerationDoc = z
  .object({
    schemaVersion: z.literal("1.0"),
    localeMode: Locale,
    sourceSnapshotId: z.string(),
    title: z.string(),
    grade: z.number().int(),
    tasks: z.array(Task),
    warnings: z.array(z.string()),
  })
  .strict();
export type GenerationDocument = z.infer<typeof GenerationDoc>;
export type TaskDocument = z.infer<typeof Task>;
export const Row = z.object({
  id: z.string().uuid(),
  sourceOrder: z.number().int(),
  lessonNumberRaw: z.string(),
  section: z.string(),
  quarter: z.string(),
  topic: z.string().max(2000),
  goals: z.string().max(8000),
  objectiveCodes: z.array(z.string()),
  lessonGoals: z.string(),
  hours: z.string(),
  dateRaw: z.string(),
  dateStart: z.string().nullable(),
  dateEnd: z.string().nullable(),
  notes: z.string(),
  warnings: z.array(z.string()),
  source: z.object({
    page: z.number().nullable(),
    sheet: z.string().nullable(),
    range: z.string(),
    fragment: z.string(),
    method: z.enum(["digital", "ocr", "manual"]),
    confidence: z.number(),
  }),
});
export type KtpRow = z.infer<typeof Row>;
export const ImportResult = z.object({
  schemaVersion: z.literal("1.0"),
  rows: z.array(Row).max(2000),
  warnings: z.array(z.string()),
  unrecognized: z.array(z.string()),
  parserVersion: z.string(),
});
export const Styles = z.object({
  font: z
    .enum(["Times New Roman", "Arial", "Calibri"])
    .default("Times New Roman"),
  size: z.number().min(10).max(18).default(14),
  marginLeft: z.number().min(1).max(4).default(3),
  marginRight: z.number().min(1).max(4).default(1.5),
  marginTop: z.number().min(1).max(4).default(2),
  marginBottom: z.number().min(1).max(4).default(2),
  lineSpacing: z
    .union([z.literal(1), z.literal(1.15), z.literal(1.5)])
    .default(1.15),
  answerSpace: z.boolean().default(true),
  includeLogo: z.boolean().default(true),
});
export const GenerateInput = z.object({
  planId: z.string().uuid(),
  rowId: z.string().uuid(),
  revision: z.number().int().positive(),
  locale: Locale,
  count: z.number().int().min(1).max(5),
  minutes: z.number().int().min(5).max(120),
  constraints: z.string().max(2000).default(""),
  format: z.enum(["mixed", "theory", "programming", "logic"]).default("mixed"),
});
