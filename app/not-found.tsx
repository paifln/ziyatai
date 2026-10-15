export default function NotFound() {
  return (
    <main className="service-page">
      <a className="brand" href="/">
        <img src="/brand-owl.png" width="46" height="50" alt="" />
        ZiyatAI
      </a>
      <span className="small-label">404</span>
      <h1>Бет табылмады</h1>
      <p lang="ru">
        Страница не найдена. Вернитесь в кабинет или откройте помощь.
      </p>
      <div className="actions">
        <a className="button primary" href="/">
          Кабинет
        </a>
        <a className="button secondary" href="/help/">
          Көмек / Помощь
        </a>
      </div>
    </main>
  );
}
