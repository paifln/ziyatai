export function normalizeDate(raw: string) {
  const warnings: string[] = [];
  if (!raw.trim())
    return { dateStart: null, dateEnd: null, warnings: ["missing_date"] };
  const matches = [
    ...raw.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/g),
  ];
  const iso = [...raw.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map((m) => [
    m[0],
    m[3],
    m[2],
    m[1],
  ]);
  const parsed = matches.length ? matches : iso;
  if (!parsed.length)
    return {
      dateStart: null,
      dateEnd: null,
      warnings: ["date_requires_year_or_review"],
    };
  const dates: string[] = [];
  for (const m of parsed) {
    const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    )
      return { dateStart: null, dateEnd: null, warnings: ["invalid_date"] };
    dates.push(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  if (dates.length > 2 || (dates.length === 2 && dates[0] > dates[1]))
    return {
      dateStart: null,
      dateEnd: null,
      warnings: ["multiple_dates_require_review"],
    };
  return {
    dateStart: dates[0],
    dateEnd: dates.length === 2 ? dates[1] : null,
    warnings,
  };
}
