import { expect, it } from "vitest";
import cases from "./fixtures/date-cases.json";
import { normalizeDate } from "../packages/domain/dates";

it.each(cases)(
  "preserves both date endpoints and warnings: $raw",
  ({ raw, start, end, warnings }) => {
    expect(normalizeDate(raw)).toEqual({
      dateStart: start,
      dateEnd: end,
      warnings,
    });
  },
);
