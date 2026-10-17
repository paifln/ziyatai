"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { GitMerge, RefreshCw } from "lucide-react";
import {
  draftsEqual,
  mergeDrafts,
  type DraftChoice,
} from "../../../packages/domain/merge-drafts";
import type { UiLocale } from "../lib/i18n";
import { useConfirm } from "./ui/ConfirmProvider";

export type RevisionSnapshot<T> = {
  revision: number;
  draft: T;
  status: string;
  reviewedAt?: string | null;
  validation?: unknown;
};
const names: Record<string, [string, string]> = {
  rows: ["Уроки", "Сабақтар"],
  tasks: ["Задания", "Тапсырмалар"],
  topic: ["Тема", "Тақырып"],
  goals: ["Цели обучения", "Оқу мақсаттары"],
  grade: ["Класс", "Сынып"],
  schoolYear: ["Учебный год", "Оқу жылы"],
  section: ["Раздел", "Бөлім"],
  quarter: ["Четверть", "Тоқсан"],
  lessonNumberRaw: ["Номер урока", "Сабақ нөмірі"],
  hours: ["Часы", "Сағат"],
  dateRaw: ["Дата", "Күні"],
  dateStart: ["Начало", "Басталуы"],
  dateEnd: ["Окончание", "Аяқталуы"],
  notes: ["Примечания", "Ескертпелер"],
  lessonGoals: ["Цели урока", "Сабақ мақсаттары"],
  dateSkipped: ["Дата пропущена", "Күні өткізіп жіберілді"],
  goalsSkipped: ["Цели пропущены", "Мақсаттар өткізіп жіберілді"],
  contentBlocks: ["Условие задания", "Тапсырма шарты"],
  answerBlocks: ["Ответ", "Жауап"],
  title: ["Название", "Атауы"],
  text: ["Текст", "Мәтін"],
  items: ["Пункты", "Тармақтар"],
  columns: ["Столбцы", "Бағандар"],
  language: ["Язык", "Тіл"],
  explanationHow: ["Решение", "Шешуі"],
  explanationWhy: ["Объяснение", "Түсіндіру"],
  rubric: ["Критерии оценивания", "Бағалау критерийлері"],
  criterion: ["Критерий", "Критерий"],
  points: ["Баллы", "Балл"],
  level: ["Уровень", "Деңгей"],
  estimatedMinutes: ["Минуты", "Минут"],
  verificationCases: ["Проверочные примеры", "Тексеру мысалдары"],
  input: ["Дано", "Берілгені"],
  expected: ["Результат", "Нәтиже"],
  translation: ["Перевод", "Аударма"],
  objectiveRefs: ["Цели", "Мақсаттар"],
  source: ["Источник", "Дереккөз"],
  sheet: ["Лист", "Парақ"],
  fragment: ["Фрагмент", "Үзінді"],
  warnings: ["Замечания", "Ескертпелер"],
  objectiveCodes: ["Коды целей", "Мақсат кодтары"],
};
function name(key: string, ru: boolean) {
  return (
    names[key]?.[ru ? 0 : 1] ??
    (ru ? "Дополнительные сведения" : "Қосымша мәліметтер")
  );
}
function readable(value: unknown, ru: boolean): string {
  if (value === undefined) return ru ? "Удалено" : "Жойылды";
  if (value === null || value === "")
    return ru ? "Не указано" : "Көрсетілмеген";
  if (typeof value === "boolean")
    return value ? (ru ? "Да" : "Иә") : ru ? "Нет" : "Жоқ";
  if (Array.isArray(value))
    return value.length
      ? value.map((item, i) => `${i + 1}. ${readable(item, ru)}`).join("\n\n")
      : ru
        ? "Пусто"
        : "Бос";
  if (typeof value === "object") {
    const block = value as Record<string, unknown>;
    if (block.type === "paragraph" || block.type === "code")
      return String(block.text || (ru ? "Пусто" : "Бос"));
    if (block.type === "list" && Array.isArray(block.items))
      return block.items.map((item) => `• ${String(item)}`).join("\n");
    if (
      block.type === "table" &&
      Array.isArray(block.columns) &&
      Array.isArray(block.rows)
    )
      return [
        block.columns.join(" | "),
        ...block.rows.map((row) =>
          Array.isArray(row) ? row.join(" | ") : String(row),
        ),
      ].join("\n");
  }
  if (typeof value === "object")
    return Object.entries(value)
      .filter(
        ([key]) => !["id", "schemaVersion", "sourceSnapshotId"].includes(key),
      )
      .map(([key, item]) => `${name(key, ru)}: ${readable(item, ru)}`)
      .join("\n");
  return String(value);
}

export function RevisionConflict<T>({
  base,
  local,
  locale,
  loadLatest,
  onResolve,
  onClose,
}: {
  base: T;
  local: T;
  locale: UiLocale;
  loadLatest: (signal: AbortSignal) => Promise<RevisionSnapshot<T>>;
  onResolve: (latest: RevisionSnapshot<T>, merged: T, dirty: boolean) => void;
  onClose: () => void;
}) {
  const ru = locale === "ru",
    id = useId(),
    confirm = useConfirm();
  const [latest, setLatest] = useState<RevisionSnapshot<T> | null>(null);
  const [choices, setChoices] = useState<Record<string, DraftChoice>>({});
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useCallback(async () => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setError("");
    setLatest(null);
    setChoices({});
    try {
      const result = await loadLatest(request.signal);
      if (!request.signal.aborted) setLatest(result);
    } catch (e) {
      if (!request.signal.aborted) setError((e as Error).message);
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [loadLatest]);
  useEffect(() => {
    heading.current?.focus();
    void read();
    return () => controller.current?.abort();
  }, [read]);
  const result = useMemo(
    () => (latest ? mergeDrafts(base, local, latest.draft, choices) : null),
    [base, local, latest, choices],
  );
  const unresolved =
    result?.conflicts.filter((c) => !choices[c.key]).length ?? 0;
  const needsSave =
    !!latest && !!result && !draftsEqual(result.merged, latest.draft);
  return (
    <section
      className="revision-conflict card"
      aria-labelledby={`${id}-title`}
      aria-busy={loading}
    >
      <h2 id={`${id}-title`} tabIndex={-1} ref={heading}>
        <GitMerge size={20} />
        {ru
          ? "Есть более новая версия материала"
          : "Материалдың жаңа нұсқасы бар"}
      </h2>
      <p>
        {ru
          ? "Ваши правки остались здесь. Сравните версии перед сохранением. Изменения в разных полях объединим; для совпавших полей выберите нужный вариант."
          : "Өзгерістеріңіз осы жерде сақталды. Сақтау алдында нұсқаларды салыстырыңыз. Әртүрлі өрістердегі өзгерістер біріктіріледі; бір өріс өзгерсе, қажетті нұсқаны таңдаңыз."}
      </p>
      {loading && (
        <p role="status">
          {ru ? "Загружаем сохранённую версию…" : "Сақталған нұсқа жүктелуде…"}
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button className="button secondary" onClick={() => void read()}>
            <RefreshCw size={16} />
            {ru ? "Повторить сравнение" : "Салыстыруды қайталау"}
          </button>
        </div>
      )}
      {latest && result && (
        <>
          <p className="status-bar" role="status">
            {result.conflicts.length
              ? ru
                ? `Полей для выбора: ${unresolved} из ${result.conflicts.length}.`
                : `Таңдалатын өрістер: ${result.conflicts.length} ішінен ${unresolved}.`
              : ru
                ? "Различающиеся правки можно объединить без выбора."
                : "Әртүрлі өзгерістерді таңдаусыз біріктіруге болады."}
          </p>
          {result.conflicts.map((conflict, index) => (
            <fieldset className="revision-conflict-field" key={conflict.key}>
              <legend>
                {conflict.path
                  .map((key) =>
                    /^\d+$/.test(key) ? String(Number(key) + 1) : name(key, ru),
                  )
                  .join(" · ") || (ru ? "Материал" : "Материал")}
              </legend>
              <div className="revision-conflict-options">
                {(["local", "remote"] as const).map((choice) => (
                  <label
                    key={choice}
                    className={
                      choices[conflict.key] === choice ? "selected" : ""
                    }
                  >
                    <span>
                      <input
                        type="radio"
                        aria-label={
                          choice === "local"
                            ? ru
                              ? "Мои правки"
                              : "Менің өзгерістерім"
                            : ru
                              ? "Сохранённая версия"
                              : "Сақталған нұсқа"
                        }
                        name={`${id}-${index}`}
                        value={choice}
                        checked={choices[conflict.key] === choice}
                        onChange={() =>
                          setChoices((current) => ({
                            ...current,
                            [conflict.key]: choice,
                          }))
                        }
                      />
                      {choice === "local"
                        ? ru
                          ? "Мои правки"
                          : "Менің өзгерістерім"
                        : ru
                          ? "Сохранённая версия"
                          : "Сақталған нұсқа"}
                    </span>
                    <pre
                      tabIndex={0}
                      aria-label={
                        choice === "local"
                          ? ru
                            ? "Мои правки"
                            : "Менің өзгерістерім"
                          : ru
                            ? "Сохранённая версия"
                            : "Сақталған нұсқа"
                      }
                    >
                      {readable(conflict[choice], ru)}
                    </pre>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p>
            {needsSave
              ? ru
                ? "После применения проверьте результат в редакторе и нажмите «Сохранить». Сравнение не изменяет сохранённую версию."
                : "Қолданғаннан кейін нәтижені редакторда тексеріп, «Сақтау» түймесін басыңыз. Салыстыру сақталған нұсқаны өзгертпейді."
              : ru
                ? "Результат совпадает с сохранённой версией. Можно синхронизировать редактор без повторного сохранения."
                : "Нәтиже сақталған нұсқамен бірдей. Редакторды қайта сақтамай синхрондауға болады."}
          </p>
          <div className="actions">
            <button
              className="button primary"
              disabled={unresolved > 0}
              onClick={() =>
                onResolve(
                  latest,
                  result.merged,
                  !draftsEqual(result.merged, latest.draft),
                )
              }
            >
              {needsSave
                ? ru
                  ? "Применить объединение"
                  : "Біріктіруді қолдану"
                : ru
                  ? "Синхронизировать редактор"
                  : "Редакторды синхрондау"}
            </button>
            <button
              className="button secondary"
              onClick={async () => {
                if (
                  await confirm(
                    ru
                      ? "Отказаться от всех местных правок и открыть сохранённую версию?"
                      : "Осы жердегі барлық өзгерістерден бас тартып, сақталған нұсқаны ашу керек пе?",
                  )
                )
                  onResolve(latest, latest.draft, false);
              }}
            >
              {ru
                ? "Использовать сохранённую версию"
                : "Сақталған нұсқаны пайдалану"}
            </button>
          </div>
        </>
      )}
      <button className="text-button" onClick={onClose}>
        {ru ? "Продолжить редактирование" : "Өңдеуді жалғастыру"}
      </button>
    </section>
  );
}
