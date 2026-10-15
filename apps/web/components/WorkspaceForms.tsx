"use client";
import { useState, useEffect, useRef } from "react";
import { Upload, ArrowRight, Sparkles, Check } from "lucide-react";
import { api, authClient, uploadFile } from "../lib/client";
import type { Texts, UiLocale } from "../lib/i18n";
import { displayLevel } from "../../../packages/domain/validation";
export function UploadPanel({
  directUploads,
  t,
  locale,
  onDone,
  onError,
}: {
  directUploads: boolean;
  t: Texts;
  locale: UiLocale;
  onDone: (id: string) => void;
  onError: (e: string) => void;
}) {
  const [file, setFile] = useState<File>(),
    [sourceLocale, setSourceLocale] = useState(locale),
    [hidden, setHidden] = useState(false),
    [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      if (!file.size || file.size > 25 * 1024 * 1024)
        throw new Error(
          locale === "ru"
            ? "Выберите файл размером до 25 МБ."
            : "25 МБ дейінгі файлды таңдаңыз.",
        );
      setProgress(0);
      const uploaded = await uploadFile(file, directUploads, setProgress);
      const imported = await api("ktp/imports", "POST", {
        uploadId: uploaded.id,
        locale: sourceLocale,
        includeHidden: hidden,
      });
      onDone(imported.id);
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
          <h1>{t.newPlan}</h1>
          <p>{t.uploadSub}</p>
        </div>
      </div>
      <section className="card upload-card">
        <form onSubmit={submit}>
          {busy && directUploads && (
            <div role="status" className="notice">
              {locale === "ru" ? "Загрузка файла" : "Файл жүктелуде"}:{" "}
              {progress}%
            </div>
          )}
          <div className="dropzone">
            <Upload size={32} />
            <h3>{t.drag}</h3>
            <p>{t.formats}</p>
            <label>
              <span className="sr-only">{t.upload}</span>
              <input
                type="file"
                accept=".pdf,.docx,.xls,.xlsx"
                required
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            <p>{t.docNotice}</p>
          </div>
          <label>
            {t.sourceLanguage}
            <select
              value={sourceLocale}
              onChange={(e) => setSourceLocale(e.target.value as UiLocale)}
            >
              <option value="kk">Қазақша</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <label className="checkbox mt-20">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            {t.includeHidden}
          </label>
          <div className="notice">{t.privacy}</div>
          <p style={{ fontSize: 12 }}>{t.policy}</p>
          <button className="button primary wide" disabled={!file || busy}>
            {busy ? (
              <>
                <span className="spinner" />
                {t.importing}
              </>
            ) : (
              <>
                {t.import}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      </section>
    </>
  );
}
export function GeneratePanel({
  t,
  locale,
  plans,
  selected,
  aiAvailable,
  quota,
  onError,
  onDone,
  onReview,
}: {
  t: Texts;
  locale: UiLocale;
  plans: any[];
  selected: string;
  aiAvailable: boolean;
  quota: number;
  onError: (s: string) => void;
  onDone: (id: string) => void;
  onReview: (id: string) => void;
}) {
  const confirmed = plans.filter((p) => p.status === "confirmed");
  const [planId, setPlanId] = useState(selected || confirmed[0]?.id || ""),
    [plan, setPlan] = useState<any>(),
    [rowId, setRowId] = useState(""),
    [outLocale, setOutLocale] = useState<string>(locale),
    [count, setCount] = useState(3),
    [minutes, setMinutes] = useState(30),
    [constraints, setConstraints] = useState(""),
    [format, setFormat] = useState("mixed"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (planId)
      api(`ktp/${planId}`)
        .then((p) => {
          setPlan(p);
          setRowId(p.rows?.[0]?.id ?? "");
        })
        .catch((e) => onError(e.message));
  }, [planId, onError]);
  const row = plan?.rows?.find((r: any) => r.id === rowId);
  const requestKeys = useRef(new Map<string, string>());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
      {!confirmed.length ? (
        <section className="card">
          <p>{t.noConfirmed}</p>
          {plans[0] && (
            <button className="button" onClick={() => onReview(plans[0].id)}>
              {t.plans}
              <ArrowRight size={16} />
            </button>
          )}
        </section>
      ) : (
        <div className="generation-layout">
          <section className="card">
            <form onSubmit={submit}>
              <label>
                {t.choosePlan}
                <select
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  {confirmed.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-20">
                {t.chooseTopic}
                <select
                  value={rowId}
                  onChange={(e) => setRowId(e.target.value)}
                >
                  {plan?.rows?.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.sourceOrder}. {r.topic}
                    </option>
                  ))}
                </select>
              </label>
              {row && (
                <div className="topic-summary">
                  <span className="badge green">
                    {plan.grade} {t.grade.toLowerCase()} · {t.confirmed}
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
                        {(t as any)[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.count}
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  />
                </label>
                <label>
                  {t.minutes}
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
                <label className="span-2">
                  {t.constraints}
                  <textarea
                    value={constraints}
                    maxLength={2000}
                    onChange={(e) => setConstraints(e.target.value)}
                    placeholder={
                      locale === "ru"
                        ? "Например: без доступа к интернету, Python 3.13"
                        : "Мысалы: интернетсіз, Python 3.13"
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
                    !row || busy || !aiAvailable || plan?.status !== "confirmed"
                  }
                >
                  {busy ? t.loading : t.generate}
                  <Sparkles size={16} />
                </button>
              </div>
            </form>
          </section>
          <section className="card" style={{ alignSelf: "start" }}>
            <h2>
              {t.total}: {count * 3}
            </h2>
            {["easy", "medium", "advanced"].map((level, i) => (
              <div key={level} className="level-preview">
                <span className={`level-dot dot-${i}`} />
                <strong>{displayLevel(level, locale)}</strong>
                <small>
                  {count} {locale === "ru" ? "задания" : "тапсырма"}
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
      )}
    </>
  );
}
export function ProfilePanel({
  t,
  profile,
  onError,
  onSaved,
  setLocale,
}: {
  t: Texts;
  profile: any;
  onError: (s: string) => void;
  onSaved: () => void;
  setLocale: (l: UiLocale) => void;
}) {
  const [form, setForm] = useState({
      ...profile,
      styles: {
        font: "Times New Roman",
        size: 14,
        marginLeft: 3,
        marginRight: 1.5,
        marginTop: 2,
        marginBottom: 2,
        lineSpacing: 1.15,
        answerSpace: true,
        includeLogo: true,
        ...profile.styles,
      },
    }),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t.profile}</h1>
        </div>
      </div>
      <section className="card profile-card">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("profile", "PATCH", form);
              setLocale(form.locale);
              onSaved();
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              {t.name}
              <input
                required
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              {t.email}
              <input value={form.email} disabled />
            </label>
            <label>
              {t.school}
              <input
                maxLength={200}
                value={form.school}
                onChange={(e) => setForm({ ...form, school: e.target.value })}
              />
            </label>
            <label>
              {t.language}
              <select
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value })}
              >
                <option value="kk">Қазақша</option>
                <option value="ru">Русский</option>
              </select>
            </label>
            <label className="span-2">
              {t.preferredGrades}
              <span className="chip-grid">
                {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`grade-chip ${form.grades.includes(n) ? "active" : ""}`}
                    aria-pressed={form.grades.includes(n)}
                    onClick={() =>
                      setForm({
                        ...form,
                        grades: form.grades.includes(n)
                          ? form.grades.filter((g: number) => g !== n)
                          : [...form.grades, n],
                      })
                    }
                  >
                    {n}
                  </button>
                ))}
              </span>
            </label>
            <label>
              {t.font}
              <select
                value={form.styles.font}
                onChange={(e) =>
                  setForm({
                    ...form,
                    styles: { ...form.styles, font: e.target.value },
                  })
                }
              >
                {["Times New Roman", "Arial", "Calibri"].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              {t.fontSize}
              <input
                type="number"
                min={10}
                max={18}
                value={form.styles.size}
                onChange={(e) =>
                  setForm({
                    ...form,
                    styles: { ...form.styles, size: Number(e.target.value) },
                  })
                }
              />
            </label>
          </div>
          <button className="button primary mt-20" disabled={busy}>
            <Check size={16} />
            {busy ? t.loading : t.save}
          </button>
        </form>
        <div className="notice mt-20">{t.privacy}</div>
        <details className="mt-20">
          <summary className="danger">
            {profile.locale === "ru" ? "Удаление аккаунта" : "Аккаунтты жою"}
          </summary>
          <p className="mt-20">
            {profile.locale === "ru"
              ? "Все КТП, задания и документы станут недоступны сразу. Файлы будут удалены фоновой операцией. Копии в резервных архивах истекают через 30 дней."
              : "Барлық КТЖ, тапсырмалар және құжаттар бірден қолжетімсіз болады. Файлдар фондық операция арқылы жойылады. Резервтік көшірмелер 30 күннен кейін жойылады."}
          </p>
          <button
            className="button danger"
            onClick={async () => {
              if (!window.confirm(t.deleteConfirm)) return;
              try {
                await api("account", "DELETE");
                await authClient.signOut();
                window.location.reload();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            {t.remove}
          </button>
        </details>
      </section>
    </>
  );
}
