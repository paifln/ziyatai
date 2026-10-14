# Приёмка ZiyatAI

Дата реализации — 14 октября 2026 года, Asia/Qyzylorda. Доступный сайт: http://localhost:3000. Окружение — локальный Windows компьютер с Linux Docker контейнерами. Публичный staging/production URL отсутствует. Точный передаваемый commit — `git rev-parse HEAD`; SHA также указан в итоговом сообщении владельцу.

Работают локально регистрация и подтверждение email в Mailpit, password reset, приватный импорт PDF/DOCX/XLS/XLSX и OCR сканов, исправление/подтверждение КТП, редактор synthetic заданий, версии, DOCX/PDF и student export, библиотека, сохранение после logout/login, запрет чужого доступа и удаление. Настоящий OpenAI backend реализован, но живой вызов не выполнен. Это частично проверенная реализация.

## Критерии

| AC | Статус | Доказательство / что осталось |
| --- | --- | --- |
| AC01 | Проверено локально; внешняя зависимость | Better Auth registration, verification и reset через Mailpit. Нужны HTTPS и реальная внешняя SMTP delivery. |
| AC02 | Проверено локально на synthetic corpus | Все 4 формата, скан и mixed PDF через отдельный renderer. Нужны разрешённые реальные файлы и расширенная OCR оценка. |
| AC03 | Проверено локально | Исправление, confirm, optimistic conflict, SQL DATE и persistence. Источник содержит fragment/page/sheet + исходный download; для PDF реализован приватный просмотр оригинальной страницы, для DOCX/Excel — исходный фрагмент таблицы. |
| AC04 | Реализовано, заблокировано внешней зависимостью | Responses SDK/strict schema и kk/ru/kk+ru. Live OpenAI и eval не выполнены. |
| AC05 | Частично проверено локально | Rubric/points/references/duplicates/перевод чисел/простая арифметика; always needs_review. Семантическая и языковая педагогическая экспертиза не проведена. |
| AC06 | Редактор/версии проверены локально | Редактирование/restore/stale validation; регенерация одного задания реализована, live roundtrip заблокирован. |
| AC07 | Проверено локально | OOXML, TNR 14, PDF, казахские символы, page break, student answers absent. Все 4 страницы representative export визуально просмотрены. Production fonts/exports ещё не проверены. |
| AC08 | Проверено локально | Library/history, repeat download, logout/login, two-user 404 ACL. Более сложные фильтры и пагинация UI ограничены начальным списком 100 записей. |
| AC09 | Частично проверено локально | Lease recovery/idempotency/cancellation/quota и mock provider errors. Fault injection реального OpenAI и renderer outage на production не выполнены. |
| AC10 | Проверено локально, production проверка нужна | Signature/ZIP/XML checks, ClamAV, ACL/Origin, deletion/cleanup, secret scan, npm audit. Independent pentest и production bucket policy не проверены. |
| AC11 | Локальный запуск; внешняя зависимость | Web, DB, S3, worker, renderer, antivirus, Mailpit. Local restore подтверждён. Public deploy/monitoring/backup schedule отсутствуют. |
| AC12 | Реализовано и проверено локально | Lockfile, migrations, README, synthetic seed, Docker builds и CI configuration. GitHub Actions не запускался: remote не подключён. |

Definition of Done из задания **не достигнута**: production URL и реальная AI генерация отсутствуют. Не следует выдавать local или mock результаты за production proof.

## Результаты проверок

- TypeScript, ESLint и production Docker build проходят. Unit/provider contract tests проходят; актуальное число видно в `npm test`.
- Parser pytest: 22 passed. [Цифровой отчёт](reports/parser.json): DOCX 15/15 строк и 75/75 полей; XLSX 12/12 и 60/60; XLS 6/6 и 30/30; PDF 6/6 и 30/30. Только synthetic samples, нормализация NFKC/whitespace.
- API/browser E2E на собранных локальных контейнерах: основной сценарий, password reset, security/deletion и OCR/mixed PDF проходят. Дополнительный UI сценарий отдельно проверяет реальные кнопки upload/confirm/editor/export.
- [Очередь](reports/queue.json): expired lease reclaimed с attempt 2, unique job, cancelled не claim, третья reservation откатывается.
- [Antivirus](reports/antivirus.json): ClamAV 1.4.6, clean DOCX accepted, harmless standard EICAR rejected.
- [Restore](reports/restore.json): отдельная БД, совпадение всех 32 snapshot версий, 683мс для тестового архива 62,409 bytes. Не SLA production.
- [Нагрузка](reports/load.json): 10 учителей, 100 API GET, 0 ошибок, development p95 846мс. Внешние AI операции не входили в этот замер.
- npm audit: 0 vulnerabilities на момент проверки. Secret scanner не нашёл узнаваемых OpenAI keys/PEM private keys в tracked/unignored source. Это не абсолютная гарантия отсутствия любых секретов.
- DOCX/PDF structural checks: TNR 14, answer page 3 из 4, glyphs ӘҒҚҢӨҰҮҺІ, отсутствие answers в student. UI проверялся на 360/768/1440 px.

## Блокеры и продолжение

| Не выполнено | Почему | Минимальное действие владельца | Как подтвердить завершение |
| --- | --- | --- | --- |
| Public HTTPS web/worker/DB | Нет аккаунта/SSH/домена провайдера и remote | Выбрать Казахстанский VPS/тариф, предоставить настроенный доступ, определить APP_URL | Деплой по deploy.md, readiness, полный E2E на URL, deployment record с SHA/digests/date |
| Private production storage | Нет endpoint/bucket/account | Создать private bucket и server-side secret manager entries | Anonymous GET запрещён; upload/download/deletion двух пользователей |
| Real AI generation/regen/eval | OPENAI_API_KEY/OPENAI_MODEL отсутствуют | Внести ключ/model id непосредственно в secret manager, установить бюджет | live-ai-smoke, минимум 30 live сценариев, ручная rubric 1–5 и expert review |
| Real external email | Используется локальная Mailpit | Подключить SMTP sender и DNS для отправки | Письмо дошло во внешний ящик, verify/reset на HTTPS |
| Exact deployment font preset | Шрифты законно доступны только локально | Предоставить лицензированный deployment font directory | fc-match точного семейства, визуальный export на production |
| Real KTP/правовая актуальность | Нет разрешённых образцов; полный приказ не получен | Разрешённые обезличенные файлы и проверка применимых актов/согласия/регионов | Повторный parser corpus report, privacy/legal decision record |
| Monitoring/backups | Нет production инфраструктуры | Подключить backup storage/schedule и alerts | Production restore drill + тест доставки алертов |
| Production security gate | Raw container scan содержит системные unfixed findings, включая libxml2 | Подтвердить patched renderer image либо независимый анализ достижимости и mitigation | Повторный Trivy scan точных digests и security decision record по container-security.md |

Секреты не передают в чат или git. После подключения нужны команды deploy.md и повторная приёмка, а не переписывание интерфейса.

## Расходы

Внешние услуги не закупались. Реальные monthly infrastructure и AI/OCR затраты не измерены. [ADR hosting](adr/002_hosting.md) содержит проверенные ссылки и доступные условия Railway на 14.10.2026; минимум платформы не является бюджетом всего ZiyatAI. Тариф Казахстанского VPS, backup, storage, SMTP и model usage нужно зафиксировать после выбора конфигурации. Tesseract не имеет отдельной оплаты за страницу, но расходует CPU/RAM. Live OpenAI billing требует usage выбранной модели, включая repair/uncertain outcomes.
