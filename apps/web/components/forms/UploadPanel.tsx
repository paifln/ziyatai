"use client";
import { useState, useEffect, useRef } from "react";
import {
  Upload,
  ArrowRight,
  FileText,
  X,
  ShieldCheck,
  FolderOpen,
} from "lucide-react";
import { useAccountClient } from "../../lib/account-client";
import type { Texts, UiLocale } from "../../lib/i18n";
import { uploadSelectionError } from "../../../../packages/domain/uploads";
import { Form } from "../ui/Form";
import { Workflow } from "../ui/Workflow";

export function UploadPanel({
  directUploads,
  t,
  locale,
  onDone,
  onError,
  onCancel,
}: {
  directUploads: boolean;
  t: Texts;
  locale: UiLocale;
  onDone: (id: string) => void;
  onError: (e: string) => void;
  onCancel: () => void;
}) {
  const { api, uploadFile } = useAccountClient();
  const [file, setFile] = useState<File>();
  const [sourceLocale, setSourceLocale] = useState(locale);
  const [hidden, setHidden] = useState(false);
  const [grade, setGrade] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const ru = locale === "ru";
  useEffect(() => () => controller.current?.abort(), []);
  function selectFile(selected?: File) {
    if (!selected) return;
    const error = uploadSelectionError(selected);
    if (error) {
      setFileError(
        error === "FILE_TYPE"
          ? ru
            ? "Этот формат не подходит. Выберите PDF, DOCX, XLS или XLSX. Файл DOC нужно пересохранить в DOCX."
            : "Бұл пішім жарамайды. PDF, DOCX, XLS немесе XLSX таңдаңыз. DOC файлын DOCX пішімінде қайта сақтаңыз."
          : ru
            ? "Файл должен быть непустым и не больше 25 МБ."
            : "Файл бос болмауы және 25 МБ-тан аспауы керек.",
      );
      if (fileInput.current) fileInput.current.value = "";
      setFile(undefined);
      return;
    }
    setFile(selected);
    setFileError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setProgress(0);
    controller.current = new AbortController();
    try {
      const uploaded = await uploadFile(
        file,
        directUploads,
        setProgress,
        controller.current.signal,
      );
      const imported = await api(
        "ktp/imports",
        "POST",
        {
          uploadId: uploaded.id,
          locale: sourceLocale,
          includeHidden: hidden,
          grade: grade ? Number(grade) : null,
        },
        undefined,
        controller.current.signal,
      );
      onDone(imported.id);
    } catch (error) {
      if (!controller.current?.signal.aborted)
        onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {ru ? "Ваш учебный план" : "Сіздің оқу жоспарыңыз"}
          </span>
          <h1>{t.newPlan}</h1>
          <p>{t.uploadSub}</p>
        </div>
      </div>
      <Workflow step={1} locale={locale} />
      <div className="upload-layout">
        <section className="card upload-card">
          <Form locale={locale} onSubmit={submit}>
            <div
              className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                  setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy) selectFile(event.dataTransfer.files[0]);
              }}
            >
              <span className="upload-symbol">
                <Upload size={26} strokeWidth={1.5} />
              </span>
              <h2>{t.drag}</h2>
              <p>
                {ru
                  ? "или выберите файл на компьютере"
                  : "немесе компьютерден файл таңдаңыз"}
              </p>
              <input
                className="sr-only"
                ref={fileInput}
                type="file"
                accept=".pdf,.docx,.xls,.xlsx"
                aria-label={t.upload}
                tabIndex={-1}
                disabled={busy}
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
              <button
                ref={chooseButton}
                className="button file-picker"
                type="button"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <FolderOpen size={18} />
                {file
                  ? ru
                    ? "Выбрать другой файл"
                    : "Басқа файлды таңдау"
                  : ru
                    ? "Выбрать файл"
                    : "Файлды таңдау"}
              </button>
              <div className="file-formats" aria-label={t.formats}>
                <span>PDF</span>
                <span>DOCX</span>
                <span>XLS / XLSX</span>
                <small>{ru ? "до 25 МБ" : "25 МБ дейін"}</small>
              </div>
            </div>
            {fileError && (
              <div className="notice error" role="alert">
                {fileError}
              </div>
            )}
            {file && (
              <div className="selected-file" role="status">
                <span className="file-icon">
                  <FileText size={22} />
                </span>
                <div>
                  <strong>{file.name}</strong>
                  <small>
                    {(file.size / 1024 / 1024).toFixed(2)} МБ ·{" "}
                    {ru ? "Готов к загрузке" : "Жүктеуге дайын"}
                  </small>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  disabled={busy}
                  aria-label={ru ? "Убрать файл" : "Файлды алып тастау"}
                  onClick={() => {
                    setFile(undefined);
                    if (fileInput.current) fileInput.current.value = "";
                    chooseButton.current?.focus();
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            )}
            <fieldset className="upload-options editor-fields" disabled={busy}>
              <legend className="sr-only">{t.sourceLanguage}</legend>
              <label>
                {t.sourceLanguage}
                <select
                  value={sourceLocale}
                  onChange={(event) =>
                    setSourceLocale(event.target.value as UiLocale)
                  }
                >
                  <option value="kk">Қазақша</option>
                  <option value="ru">Русский</option>
                </select>
                <small>
                  {ru
                    ? "Выберите язык самого документа, а не интерфейса."
                    : "Интерфейс тілін емес, құжаттың тілін таңдаңыз."}
                </small>
              </label>
              <label>
                {ru ? "Класс для работы" : "Жұмыс сыныбы"}
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                >
                  <option value="">
                    {ru ? "Определить из документа" : "Құжаттан анықтау"}
                  </option>
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                <small>
                  {ru
                    ? "Если классов несколько, после загрузки покажем уроки выбранного класса. Остальные сохранятся."
                    : "Бірнеше сынып болса, таңдалған сыныптың сабақтары көрсетіледі. Қалғаны сақталады."}
                </small>
              </label>
              <details className="advanced-options">
                <summary>
                  {ru ? "Дополнительные настройки" : "Қосымша баптаулар"}
                </summary>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={hidden}
                    onChange={(event) => setHidden(event.target.checked)}
                  />
                  {t.includeHidden}
                </label>
                <p>{t.docNotice}</p>
              </details>
            </fieldset>
            {busy && (
              <div className="upload-progress" role="status">
                <div>
                  <span>
                    {progress < 100 && directUploads
                      ? ru
                        ? "Передаём файл"
                        : "Файл жіберілуде"
                      : ru
                        ? "Проверяем файл перед обработкой"
                        : "Файл өңдеуге дейін тексерілуде"}
                  </span>
                  {directUploads && <strong>{progress}%</strong>}
                </div>
                <progress
                  max={100}
                  value={directUploads ? progress : undefined}
                />
              </div>
            )}
            <div className="upload-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  controller.current?.abort();
                  onCancel();
                }}
              >
                {t.cancel}
              </button>
              <button
                className="button primary"
                disabled={!file || busy}
                aria-busy={busy}
              >
                {busy ? (
                  <>
                    <span className="spinner" />
                    {t.importing}
                  </>
                ) : (
                  <>
                    {t.import}
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
            </div>
          </Form>
        </section>
        <aside className="upload-guide">
          <span className="small-label">
            {ru ? "От плана к уроку" : "Жоспардан сабаққа"}
          </span>
          <h2>{ru ? "Дальше всё по шагам" : "Әрі қарай — қадам бойынша"}</h2>
          <div>
            <span>01</span>
            <p>
              <strong>{ru ? "Извлечём темы" : "Тақырыптарды шығарамыз"}</strong>
              {ru
                ? "Прочитаем таблицы, листы Excel и сканированные страницы."
                : "Кестелерді, Excel парақтарын және сканерленген беттерді оқимыз."}
            </p>
          </div>
          <div>
            <span>02</span>
            <p>
              <strong>
                {ru ? "Вы проверите результат" : "Нәтижені тексересіз"}
              </strong>
              {ru
                ? "Покажем пропуски. Вы сможете исправить цели и выбрать нужный класс."
                : "Жетпейтін мәліметтерді көрсетеміз. Мақсаттарды түзетіп, сыныпты таңдай аласыз."}
            </p>
          </div>
          <div>
            <span>03</span>
            <p>
              <strong>
                {ru ? "Подготовим задания" : "Тапсырмаларды дайындаймыз"}
              </strong>
              {ru
                ? "Три уровня сложности, ответы и редактируемый документ."
                : "Үш қиындық деңгейі, жауаптар және өңдеуге болатын құжат."}
            </p>
          </div>
          <div className="upload-private">
            <ShieldCheck size={20} />
            <p>{t.privacy}</p>
          </div>
          <small>{t.policy}</small>
        </aside>
      </div>
    </>
  );
}
