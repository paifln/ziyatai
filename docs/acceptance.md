# Приёмка ZiyatAI

## Обновление 16 октября: исправления по обратной связи

Переработан интерфейс: белый/светло-серый фон, Inter с казахскими буквами, без синего/фиолетового и градиентов; убран «Шолу/Обзор». Боковая панель сворачивается, помощь/Lite/профиль перенесены вправо вверх. Добавлены юридические страницы; реквизиты оператора и условия production ещё требуют заполнения.

Подтверждение почты работает шестизначным OTP, а не ссылкой: 600 секунд, хешированное хранение, лимит попыток и повторной отправки. Сквозной UI тест проверяет неверный код, правильный код и запрет повторного использования. **Доставка проверена только через локальный Mailpit. Внешний SMTP не подключён.** В регистрацию и профиль добавлен предмет; AI snapshot больше не фиксируется на информатике.

Файл владельца проверен через работающий HTTP API и UI: [426 строк, 11 листов](reports/owner-workbook.json), выделение и подтверждение 17 уроков первого класса. Восемь исходных строк без целей остаются на ручную проверку. Содержимое приватного Excel в Git не включено. Есть отмена передачи и возврат после нераспознанного КТП; [queued cancel](reports/import-cancel.json) переводит и операцию, и план в cancelled.

На web application commit `6dee156` прошли **20 Chromium E2E**, 52 unit и 28 parser tests; TypeScript/ESLint проходят. Контейнеры собраны из Git-архива, прямые S3 загрузки проверены с явным build origin. [Свежий restore](reports/restore.json) включает 8 миграций, проверяет данные 14 таблиц. Отчёты производительности и сканирования обновлены; открытые MEDIUM находки renderer не скрыты. Детали подключения ключа и внешней почты — [здесь](connect-services.md).

Дополнительно прошли 8 WebKit сценариев, включая регистрацию с кодом и сенсорные phone/tablet, и повтор настоящего Firefox ESR 115 win32. Сводный [отчёт этой переработки](reports/revision-2026-10-16.json) связывает проверки с application commit и image IDs. WebKit на Windows — не физический iPhone/iPad; текущий Windows с Firefox 115 — не физическая Windows 7.

Ниже сохранены исходные критерии и границы приёмки. Полный production Definition of Done по-прежнему не достигнут: публичного URL, внешней почты, live AI и педагогической экспертизы нет.

Обновлено 15 октября 2026 года, Asia/Qyzylorda. Доступный сайт: http://localhost:3000, облегчённый интерфейс: http://localhost:3000/lite/. Окружение — локальный Windows компьютер с Linux Docker контейнерами. Публичный staging/production URL отсутствует. Точный передаваемый commit — `git rev-parse HEAD`.

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
| AC08 | Проверено локально | Library/history, repeat download, logout/login, two-user 404 ACL. Поиск выполняется сервером по всей коллекции; UI показывает страницы по 20 записей. Источники КТП показываются по 25 строк, Lite — по 10. |
| AC09 | Частично проверено локально | Lease recovery/idempotency/cancellation/quota и mock provider errors. Fault injection реального OpenAI и renderer outage на production не выполнены. |
| AC10 | Проверено локально, production проверка нужна | Signature/ZIP/XML checks, ClamAV, ACL/Origin, deletion/cleanup, secret scan, npm audit. Independent pentest и production bucket policy не проверены. |
| AC11 | Локальный запуск; внешняя зависимость | Web, DB, S3, worker, renderer, antivirus, Mailpit. Local restore подтверждён. Public deploy/monitoring/backup schedule отсутствуют. |
| AC12 | Проверено локально и на GitHub | Lockfile, 7 migrations, README, synthetic seed, Docker builds и CI. [GitHub Actions для 51bcea3](https://github.com/paifln/ziyatai/actions/runs/38781454807): test и integration — success. Исправлено глобальное правило lib/, которое скрывало серверные исходники от первого коммита; добавлена защита check:source и сборка из Git-архива. |

Definition of Done из задания **не достигнута**: production URL и реальная AI генерация отсутствуют. Не следует выдавать local или mock результаты за production proof.

## Результаты проверок

- TypeScript, ESLint и production Docker build проходят. Unit/provider/browser-contract/gateway tests: 52 passed, 9 файлов.
- Parser pytest: 27 passed. [Цифровой отчёт](reports/parser.json): DOCX 15/15 строк и 75/75 полей; XLSX 12/12 и 60/60; XLS 6/6 и 30/30; PDF 6/6 и 30/30. Только synthetic samples, нормализация NFKC/whitespace.
- API/browser E2E на собранных локальных контейнерах: 17 passed. Включены основные форматы, reset (в том числе из действующей сессии в обоих интерфейсах), security/deletion, OCR/mixed PDF, кнопки upload/confirm/editor/export, signed S3 upload и невозможность перезаписать чистый источник, большие таблицы, ограничения chunked JSON, запрет teacherReviewed при неверных баллах, Lite editing/export, responsive/a11y и отсутствие idle polling.
- [Очередь](reports/queue.json): expired lease reclaimed с attempt 2, unique job, cancelled не claim, третья reservation откатывается.
- [Password reset fault test](reports/auth-reset.json): Better Auth 1.7.10, сбой удаления сессии не меняет пароль и не расходует ссылку; успешный повтор отзывает старую сессию. [Signed gateway](reports/netlify-gateway.json): локальная HTTP проверка подписи, входа, ACL и двух provider IP; настоящий Netlify ingress остаётся отдельной проверкой.
- [Antivirus](reports/antivirus.json): ClamAV 1.4.6, clean DOCX accepted, harmless standard EICAR rejected.
- [Restore](reports/restore.json): отдельная БД, согласованный pg_dump snapshot и SHA256 содержимого 14 таблиц, включая задания, exports и миграции. [Новый PostgreSQL image](reports/postgres-image-restore.json) отдельно проходит логическое восстановление и kk/ru ILIKE. Исходная БД не менялась. Это не production SLA.
- [Нагрузка](reports/load.json): 10 учителей, 100 API GET, 0 ошибок, development p95 846мс. Внешние AI операции не входили в этот замер.
- npm audit: 0 vulnerabilities на момент проверки. Secret scanner не нашёл узнаваемых OpenAI keys/PEM private keys в tracked/unignored source. Это не абсолютная гарантия отсутствия любых секретов.
- DOCX/PDF structural checks: TNR 14, answer page 3 из 4, glyphs ӘҒҚҢӨҰҮҺІ, отсутствие answers в student. UI проверялся на 360/768/1440 px.
- [Firefox ESR 115](reports/legacy-browser.json): настоящий win32 browser на текущем Windows, вход/импорт/правка/подтверждение/export. Физическая Windows 7 не использовалась.
- [WebKit 27.2](reports/webkit-browser.json): 7 дополнительных UI сценариев, включая responsive/a11y, большие таблицы, сенсорную навигацию phone/tablet и DOCX. Эмуляция на Windows, не физический iPhone/iPad.
- [Скорость](reports/browser-performance.json): отдельный замер compiled bundle под ограничениями CPU/сети; без внешних шрифтов. [Очистка](reports/upload-cleanup.json) проверяет повтор после сбоя S3 и сохранность используемого источника.
- [Container scan](container-security.md): отчёт точных образов включает unfixed HIGH/CRITICAL; blanket ignore не используется. [Proxy check](reports/proxy.json) проверяет локальную маршрутизацию и обе конфигурации; публичный TLS ещё не проверен.
- [Дополнительный renderer review](reports/renderer-advisories.json): 50 MEDIUM записей для 35 CVE, включая различия рейтингов Ubuntu/upstream Tesseract. Они не объявлены исправленными или автоматически принятыми. Подробности и ограничения эксплуатации — в security record.

## Блокеры и продолжение

| Не выполнено | Почему | Минимальное действие владельца | Как подтвердить завершение |
| --- | --- | --- | --- |
| Public HTTPS web/worker/DB | Нет подключённого Netlify и backend сервера/домена | Подключить frontend Netlify и backend в согласованном регионе, определить APP_URL | Деплой по netlify.md/deploy.md, readiness, полный E2E на URL, deployment record с SHA/digests/date |
| Private production storage | Нет endpoint/bucket/account | Создать private bucket и server-side secret manager entries | Anonymous GET запрещён; upload/download/deletion двух пользователей |
| Real AI generation/regen/eval | OPENAI_API_KEY/OPENAI_MODEL отсутствуют | Внести ключ/model id непосредственно в secret manager, установить бюджет | live-ai-smoke, минимум 30 live сценариев, ручная rubric 1–5 и expert review |
| Real external email | Используется локальная Mailpit | Подключить SMTP sender и DNS для отправки | Письмо дошло во внешний ящик, verify/reset на HTTPS |
| Exact deployment font preset | Шрифты законно доступны только локально | Предоставить лицензированный deployment font directory | fc-match точного семейства, визуальный export на production |
| Real KTP/правовая актуальность | Нет разрешённых образцов; полный приказ не получен | Разрешённые обезличенные файлы и проверка применимых актов/согласия/регионов | Повторный parser corpus report, privacy/legal decision record |
| Monitoring/backups | Нет production инфраструктуры | Подключить backup storage/schedule и alerts | Production restore drill + тест доставки алертов |
| Production security acceptance | Образы проверены локально; публичное окружение отсутствует | Проверить реальные ingress, bucket policy, секреты и обновления на выбранном сервере | Повторный scan exact digests и staging ACL/TLS/upload tests по container-security.md |

Секреты не передают в чат или git. После подключения нужны команды deploy.md и повторная приёмка, а не переписывание интерфейса.

## Расходы

Внешние услуги не закупались. Для коммерческого frontend выбран [Netlify Free](netlify.md) с лимитом кредитов; backend и AI он не оплачивает. Реальные monthly infrastructure и AI/OCR затраты не измерены. [ADR hosting](adr/002_hosting.md) сохраняет исследование серверов. Backup, storage, SMTP и model usage нужно зафиксировать после выбора конфигурации. Tesseract не имеет отдельной оплаты за страницу, но расходует CPU/RAM. Live OpenAI billing требует usage выбранной модели, включая repair/uncertain outcomes.
