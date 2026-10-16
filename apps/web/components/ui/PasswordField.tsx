"use client";
import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff, ArrowUp } from "lucide-react";
import type { UiLocale } from "../../lib/i18n";

export function PasswordField({
  label,
  hint,
  locale,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  locale: UiLocale;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const length = String(props.value || "").length;
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          {...props}
          id={id}
          type={visible ? "text" : "password"}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onKeyUp={(event) => setCaps(event.getModifierState("CapsLock"))}
          onBlur={() => setCaps(false)}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={
            locale === "ru"
              ? visible
                ? "Скрыть пароль"
                : "Показать пароль"
              : visible
                ? "Құпиясөзді жасыру"
                : "Құпиясөзді көрсету"
          }
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
      {hint && (
        <>
          <div className="password-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (length / 12) * 100)}%` }} />
          </div>
          <small id={`${id}-hint`}>{hint}</small>
        </>
      )}
      {caps && (
        <small className="caps-hint" role="status">
          <ArrowUp size={13} /> Caps Lock
        </small>
      )}
    </div>
  );
}
