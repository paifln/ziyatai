import type { KtpRow } from "../contracts";
import { normalizeDate } from "./dates";

/** A date-only school calendar; never compare local-midnight Date timestamps. */
export function schoolDate(now = new Date(), timeZone = "Asia/Almaty") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function lessonSchedule(
  rows: readonly KtpRow[],
  today: string,
  limit = 5,
) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(today) ||
    normalizeDate(today).dateStart !== today
  )
    throw new RangeError("Expected a valid ISO calendar date");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Schedule limit must be between 1 and 100");
  let undated = 0,
    past = 0,
    active = 0;
  const upcoming: {
    row: KtpRow;
    index: number;
    start: string;
    end: string;
    ongoing: boolean;
  }[] = [];
  rows.forEach((row, index) => {
    const date = normalizeDate(row.dateSkipped ? "" : row.dateRaw);
    if (!date.dateStart || date.warnings.length) {
      undated++;
      return;
    }
    const start = date.dateStart,
      end = date.dateEnd ?? start;
    if (end < today) {
      past++;
      return;
    }
    const ongoing = start <= today;
    if (ongoing) active++;
    upcoming.push({ row, index, start, end, ongoing });
  });
  upcoming.sort(
    (a, b) =>
      Number(b.ongoing) - Number(a.ongoing) ||
      a.start.localeCompare(b.start) ||
      a.index - b.index,
  );
  return {
    upcoming: upcoming.slice(0, limit),
    upcomingCount: upcoming.length,
    undated,
    past,
    active,
  };
}
