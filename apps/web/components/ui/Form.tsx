"use client";
import {
  useId,
  useEffect,
  useRef,
  useState,
  type FormHTMLAttributes,
} from "react";
import { CircleAlert } from "lucide-react";
import type { UiLocale } from "../../lib/i18n";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Issue = { control: Control; label: string; message: string; id: string };
function blankRequired(control: Control) {
  const password =
    control instanceof HTMLInputElement &&
    ["current-password", "new-password"].includes(control.autocomplete);
  return control.required && !password && !control.value.trim();
}

function messageFor(control: Control, locale: UiLocale) {
  const v = control.validity;
  const ru = locale === "ru";
  if (v.valueMissing || blankRequired(control))
    return control.type === "checkbox"
      ? ru
        ? "Подтвердите согласие, чтобы продолжить."
        : "Жалғастыру үшін келісіміңізді растаңыз."
      : ru
        ? "Заполните это поле."
        : "Осы өрісті толтырыңыз.";
  if (v.typeMismatch)
    return ru
      ? "Введите адрес почты, например name@school.kz."
      : "Пошта мекенжайын енгізіңіз, мысалы name@school.kz.";
  if (
    v.tooShort ||
    (control instanceof HTMLInputElement &&
      control.minLength > 0 &&
      control.value.length < control.minLength)
  )
    return ru
      ? `Введите не менее ${(control as HTMLInputElement).minLength} символов.`
      : `Кемінде ${(control as HTMLInputElement).minLength} таңба енгізіңіз.`;
  if (v.rangeUnderflow)
    return ru
      ? `Минимальное значение — ${(control as HTMLInputElement).min}.`
      : `Ең аз мән — ${(control as HTMLInputElement).min}.`;
  if (v.rangeOverflow)
    return ru
      ? `Максимальное значение — ${(control as HTMLInputElement).max}.`
      : `Ең көп мән — ${(control as HTMLInputElement).max}.`;
  if (v.patternMismatch)
    return ru
      ? "Проверьте формат введённых данных."
      : "Енгізілген деректердің пішімін тексеріңіз.";
  if (v.stepMismatch)
    return ru
      ? "Введите целое число в указанном диапазоне."
      : "Көрсетілген аралықта бүтін сан енгізіңіз.";
  return ru
    ? "Проверьте значение этого поля."
    : "Осы өрістің мәнін тексеріңіз.";
}

/** Native field semantics, with our own accessible validation instead of browser popups. */
export function Form({
  locale,
  children,
  onSubmit,
  ...props
}: FormHTMLAttributes<HTMLFormElement> & { locale: UiLocale }) {
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  useEffect(() => {
    setIssues((old) =>
      old.map((issue) => ({
        ...issue,
        label:
          issue.control.getAttribute("aria-label") ||
          issue.control.labels?.[0]?.innerText.trim().split("\n")[0] ||
          issue.label,
        message: messageFor(issue.control, locale),
      })),
    );
  }, [locale]);
  function clear(issue: Issue) {
    issue.control.removeAttribute("aria-invalid");
    const described = (issue.control.getAttribute("aria-describedby") || "")
      .split(" ")
      .filter((id) => id && id !== issue.id);
    if (described.length)
      issue.control.setAttribute("aria-describedby", described.join(" "));
    else issue.control.removeAttribute("aria-describedby");
  }
  function invalid(control: Control) {
    return (
      control.willValidate &&
      (!control.validity.valid ||
        blankRequired(control) ||
        (control instanceof HTMLInputElement &&
          control.minLength > 0 &&
          control.value.length > 0 &&
          control.value.length < control.minLength))
    );
  }
  return (
    <form
      {...props}
      ref={form}
      noValidate
      onInput={() =>
        setIssues((old) =>
          old.filter((issue) => {
            if (invalid(issue.control)) return true;
            clear(issue);
            return false;
          }),
        )
      }
      onSubmit={(event) => {
        issues.forEach(clear);
        const next = Array.from(event.currentTarget.elements)
          .filter(
            (element): element is Control =>
              element instanceof HTMLInputElement ||
              element instanceof HTMLSelectElement ||
              element instanceof HTMLTextAreaElement,
          )
          .filter(invalid)
          .map((control, index) => {
            const id = `${formId}-error-${index}`;
            const label =
              control.getAttribute("aria-label") ||
              control.labels?.[0]?.innerText.trim().split("\n")[0] ||
              (locale === "ru" ? "Поле" : "Өріс");
            control.setAttribute("aria-invalid", "true");
            control.setAttribute(
              "aria-describedby",
              [control.getAttribute("aria-describedby"), id]
                .filter(Boolean)
                .join(" "),
            );
            return { control, label, message: messageFor(control, locale), id };
          });
        setIssues(next);
        if (next.length) {
          event.preventDefault();
          next[0].control.focus();
          return;
        }
        onSubmit?.(event);
      }}
    >
      {issues.length > 0 && (
        <div className="form-errors" role="alert">
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <strong>
              {locale === "ru"
                ? "Проверим несколько деталей"
                : "Бірнеше мәліметті тексерейік"}
            </strong>
            <ul>
              {issues.map((issue) => (
                <li key={issue.id} id={issue.id}>
                  <button type="button" onClick={() => issue.control.focus()}>
                    {issue.label}: {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {children}
    </form>
  );
}
