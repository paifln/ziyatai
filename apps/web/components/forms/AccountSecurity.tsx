"use client";
import { useState, useRef, useEffect } from "react";
import { ShieldCheck, LaptopMinimal, Check } from "lucide-react";
import { useAccountClient } from "../../lib/account-client";
import { messages, kazakhMessages } from "../../../../packages/domain/errors";
import type { UiLocale } from "../../lib/i18n";
import { useConfirm } from "../ui/ConfirmProvider";
import { PasswordChangeForm } from "./PasswordChangeForm";

export function AccountSecurity({
  locale,
  onDirtyChange,
}: {
  locale: UiLocale;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { auth: accountAuth } = useAccountClient();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"sessions" | "password" | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState(false);
  const ru = locale === "ru";
  async function revoke() {
    if (busy) return;
    if (
      !(await confirm(
        ru
          ? "Завершить все остальные сеансы? На этом устройстве вы останетесь в аккаунте."
          : "Барлық басқа сеанстарды аяқтау керек пе? Осы құрылғыдағы аккаунт ашық қалады.",
      ))
    )
      return;
    if (!active.current) return;
    setBusy("sessions");
    setResult("");
    setError(false);
    try {
      const response = await accountAuth.revokeOtherSessions();
      if (!active.current) return;
      if (response.error)
        throw Object.assign(new Error(), { code: response.error.code });
      setResult(
        ru
          ? "Другие сеансы завершены. Текущий сеанс сохранён."
          : "Басқа сеанстар аяқталды. Ағымдағы сеанс сақталды.",
      );
    } catch (failure) {
      if (!active.current) return;
      setError(true);
      setResult(
        (failure as { code?: string })?.code === "SESSION_CHANGED"
          ? (ru ? messages : kazakhMessages).SESSION_CHANGED
          : ru
            ? "Не удалось завершить сеансы. Попробуйте ещё раз."
            : "Сеанстар аяқталмады. Қайта көріңіз.",
      );
    } finally {
      if (active.current) setBusy(null);
    }
  }
  return (
    <section className="card profile-card account-security">
      <div className="section-heading">
        <ShieldCheck size={21} />
        <div>
          <h2>{ru ? "Безопасность аккаунта" : "Аккаунт қауіпсіздігі"}</h2>
          <p>
            {ru
              ? "Закончили работать на школьном компьютере? Завершите остальные сеансы одним действием."
              : "Мектеп компьютеріндегі жұмысыңыз аяқталды ма? Басқа сеанстарды бір әрекетпен аяқтаңыз."}
          </p>
        </div>
      </div>
      <button
        className="button secondary"
        disabled={!!busy}
        aria-busy={busy === "sessions"}
        onClick={revoke}
      >
        <LaptopMinimal size={17} />
        {busy === "sessions"
          ? ru
            ? "Завершаем сеансы…"
            : "Сеанстар аяқталуда…"
          : ru
            ? "Выйти на других устройствах"
            : "Басқа құрылғылардан шығу"}
      </button>
      {result && (
        <div
          className={`notice ${error ? "error" : "success"}`}
          role={error ? "alert" : "status"}
        >
          {!error && <Check size={14} />} {result}
        </div>
      )}
      <PasswordChangeForm
        locale={locale}
        onDirtyChange={onDirtyChange}
        busy={busy === "password"}
        disabled={!!busy}
        onBusyChange={(value) => setBusy(value ? "password" : null)}
      />
    </section>
  );
}
