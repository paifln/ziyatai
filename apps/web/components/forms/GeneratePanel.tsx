"use client";
import type { PlanDetail } from "../../../../packages/contracts/workspace";
import { textForKey } from "../../lib/i18n";
import { useState, useEffect, useRef } from "react";
import { Sparkles, Minus, Plus, Clock3 } from "lucide-react";
import { useAccountApi } from "../../lib/account-client";
import type { Texts, UiLocale } from "../../lib/i18n";
import { displayLevel } from "../../../../packages/domain/validation";
import { ConfirmedPlanPicker } from "./ConfirmedPlanPicker";
import { Form } from "../ui/Form";
import { Workflow } from "../ui/Workflow";
import { planGrades, rowGrade } from "../../../../packages/domain/grades";
export function GeneratePanel({
  t,
  locale,
  selected,
  aiAvailable,
  quota,
  onError,
  onDone,
}: {
  t: Texts;
  locale: UiLocale;
  selected: string;
  aiAvailable: boolean;
  quota: number;
  onError: (s: string) => void;
  onDone: (id: string) => void;
  onReview: (id: string) => void;
}) {
  const api = useAccountApi();
  const [planId, setPlanId] = useState(selected || ""),
    [plan, setPlan] = useState<PlanDetail>(),
    [rowId, setRowId] = useState(""),
    [outLocale, setOutLocale] = useState<string>(locale),
    [count, setCount] = useState(3),
    [minutes, setMinutes] = useState(30),
    [constraints, setConstraints] = useState(""),
    [format, setFormat] = useState("mixed"),
    [busy, setBusy] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [topicQuery, setTopicQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setPlan(undefined);
    setRowId("");
    setTopicQuery("");
    if (planId) {
      setPlanLoading(true);
      api(`ktp/${planId}`, "GET", undefined, undefined, controller.signal)
        .then((p) => {
          if (controller.signal.aborted) return;
          setPlan(p);
          const grades = planGrades(p.rows ?? [], p.grade);
          const selectedGrade = grades.includes(p.grade) ? p.grade : grades[0];
          setClassFilter(selectedGrade ? String(selectedGrade) : "");
          setRowId(
            p.rows?.find(
              (r: import("../../../../packages/contracts").KtpRow) =>
                !selectedGrade || rowGrade(r, p.grade) === selectedGrade,
            )?.id ?? "",
          );
        })
        .catch((e) => {
          if (!controller.signal.aborted) onError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPlanLoading(false);
        });
    } else setPlanLoading(false);
    return () => controller.abort();
  }, [planId, onError, api]);
  const row = plan?.rows?.find(
    (r: import("../../../../packages/contracts").KtpRow) => r.id === rowId,
  );
  const requestKeys = useRef(new Map<string, string>());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !plan || planLoading) return;
    setBusy(true);
    try {
      const data = {
        planId,
        rowId,
        revision: plan.revision,
        locale: outLocale,
        count,
        minutes,
        constraints,
        format,
      };
      const signature = JSON.stringify(data);
      if (!requestKeys.current.has(signature))
        requestKeys.current.set(signature, crypto.randomUUID());
      const g = await api(
        "generations",
        "POST",
        data,
        requestKeys.current.get(signature),
      );
      onDone(g.id);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t.create}</h1>
          <p>{t.createSub}</p>
        </div>
      </div>
      <Workflow step={3} locale={locale} />
      <div className="generation-layout">
        <section className="card">
          <Form locale={locale} onSubmit={submit}>
            <ConfirmedPlanPicker
              value={planId}
              selectedTitle={plan?.title}
              onChange={setPlanId}
              onError={onError}
              locale={locale}
              t={t}
            />
            {plan && (
              <label>
                {t.grade}
                <select
                  aria-label={t.grade}
                  value={classFilter}
                  onChange={(e) => {
                    const next = e.target.value;
                    setClassFilter(next);
                    setTopicQuery("");
                    setRowId(
                      plan.rows.find(
                        (r: import("../../../../packages/contracts").KtpRow) =>
                          String(rowGrade(r, plan.grade)) === next,
                      )?.id ?? "",
                    );
                  }}
                >
                  {planGrades(plan.rows ?? [], plan.grade).map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="mt-20 field-group">
              <label htmlFor="generation-topic">{t.chooseTopic}</label>
              {(plan?.rows?.length ?? 0) > 20 && (
                <input
                  type="search"
                  aria-label={
                    locale === "ru"
                      ? "Найти тему в плане"
                      : "Жоспардан тақырып іздеу"
                  }
                  placeholder={
                    locale === "ru" ? "Найти тему…" : "Тақырыпты іздеу…"
                  }
                  value={topicQuery}
                  onChange={(event) => setTopicQuery(event.target.value)}
                />
              )}
              <select
                id="generation-topic"
                disabled={planLoading || busy}
                value={rowId}
                onChange={(e) => setRowId(e.target.value)}
              >
                {plan?.rows
                  ?.filter(
                    (r: import("../../../../packages/contracts").KtpRow) =>
                      !classFilter ||
                      String(rowGrade(r, plan.grade)) === classFilter,
                  )
                  .filter(
                    (r: import("../../../../packages/contracts").KtpRow) =>
                      !topicQuery.trim() ||
                      r.topic
                        .toLocaleLowerCase()
                        .includes(topicQuery.trim().toLocaleLowerCase()) ||
                      r.id === rowId,
                  )
                  .map((r: import("../../../../packages/contracts").KtpRow) => (
                    <option key={r.id} value={r.id}>
                      {r.sourceOrder}. {r.topic}
                    </option>
                  ))}
              </select>
            </div>
            {planLoading && (
              <div className="notice" role="status">
                <span className="spinner" /> {t.loading}
              </div>
            )}
            {row && (
              <div className="topic-summary">
                <span className="badge green">
                  {rowGrade(row, plan?.grade ?? null)} {t.grade.toLowerCase()} ·{" "}
                  {t.confirmed}
                </span>
                <h3 className="mt-20">{row.topic}</h3>
                <p>{row.goals}</p>
              </div>
            )}
            <div className="form-grid">
              <label>
                {t.locale}
                <select
                  value={outLocale}
                  onChange={(e) => setOutLocale(e.target.value)}
                >
                  <option value="kk">Қазақша</option>
                  <option value="ru">Русский</option>
                  <option value="kk+ru">Қазақша + Русский</option>
                </select>
              </label>
              <label>
                {t.format}
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {["mixed", "theory", "programming", "logic"].map((f) => (
                    <option key={f} value={f}>
                      {textForKey(t, f, f)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-group">
                <label htmlFor="generation-count">{t.count}</label>
                <span className="number-stepper">
                  <button
                    type="button"
                    disabled={count <= 1 || busy}
                    aria-label={
                      locale === "ru" ? "Меньше заданий" : "Тапсырманы азайту"
                    }
                    onClick={() => setCount(Math.max(1, count - 1))}
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    id="generation-count"
                    type="number"
                    min={1}
                    max={5}
                    required
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    disabled={count >= 5 || busy}
                    aria-label={
                      locale === "ru" ? "Больше заданий" : "Тапсырманы көбейту"
                    }
                    onClick={() => setCount(Math.min(5, count + 1))}
                  >
                    <Plus size={16} />
                  </button>
                </span>
              </div>
              <label>
                {t.minutes}
                <input
                  type="number"
                  min={5}
                  max={120}
                  required
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              <div
                className="quick-times span-2"
                aria-label={
                  locale === "ru"
                    ? "Быстрый выбор времени"
                    : "Уақытты жылдам таңдау"
                }
              >
                <Clock3 size={14} />
                {[15, 30, 45].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={minutes === value}
                    onClick={() => setMinutes(value)}
                  >
                    {value} {locale === "ru" ? "мин" : "мин"}
                  </button>
                ))}
              </div>
              <label className="span-2">
                {t.constraints}
                <textarea
                  value={constraints}
                  maxLength={2000}
                  onChange={(e) => setConstraints(e.target.value)}
                  placeholder={
                    locale === "ru"
                      ? "Например: работа в парах, без интернета, с примерами из повседневной жизни"
                      : "Мысалы: жұптық жұмыс, интернетсіз, күнделікті өмірден мысалдармен"
                  }
                />
              </label>
            </div>
            {!aiAvailable && (
              <div className="notice warning">{t.aiMissing}</div>
            )}
            <div className="actions">
              <button
                className="button primary"
                disabled={
                  !row ||
                  busy ||
                  planLoading ||
                  !aiAvailable ||
                  plan?.status !== "confirmed"
                }
              >
                {busy ? t.loading : t.generate}
                <Sparkles size={16} />
              </button>
            </div>
          </Form>
        </section>
        <section
          className="card generation-summary"
          style={{ alignSelf: "start" }}
          aria-label={
            locale === "ru" ? "Ваш комплект заданий" : "Тапсырмалар жинағыңыз"
          }
        >
          <span className="eyebrow">
            {locale === "ru" ? "Ваш комплект" : "Сіздің жинағыңыз"}
          </span>
          <h2>
            {t.total}: {count * 3}
          </h2>
          {["easy", "medium", "advanced"].map((level, i) => (
            <div key={level} className="level-preview">
              <span className={`level-dot dot-${i}`} />
              <strong>{displayLevel(level, locale)}</strong>
              <small>
                {count}{" "}
                {locale === "ru"
                  ? count === 1
                    ? "задание"
                    : count < 5
                      ? "задания"
                      : "заданий"
                  : "тапсырма"}
              </small>
            </div>
          ))}
          <p className="mt-20" style={{ fontSize: 12 }}>
            {t.quota}: {quota}
          </p>
          <div className="notice">{t.privacy}</div>
          <p style={{ fontSize: 12 }}>{t.teacherWarning}</p>
        </section>
      </div>
    </>
  );
}
