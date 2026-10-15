"use client";
export default function ErrorBoundary({ retry }: { retry: () => void }) {
  return (
    <main className="service-page">
      <a className="brand" href="/">
        <img src="/brand-owl.png" width="46" height="50" alt="" />
        ZiyatAI
      </a>
      <h1>Бет ашылмады</h1>
      <p lang="ru">Не удалось открыть страницу. Попробуйте ещё раз.</p>
      <div className="actions">
        <button className="button primary" onClick={() => retry()}>
          Қайталау / Повторить
        </button>
        <a className="button secondary" href="/lite/">
          Жеңіл нұсқа / Лёгкая версия
        </a>
      </div>
    </main>
  );
}
