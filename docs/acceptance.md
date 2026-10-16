# Приёмка ZiyatAI

## Вечерняя переработка 16–17 октября

Реализованы гостевая главная, светлая/тёмная тема, массовый пропуск дат с отменой и серверное одобрение конкретной версии заданий перед DOCX/PDF. После правки одобрение сбрасывается. В карточках проверки раскрываются ответы и критерии; подготовку файлов можно отменить и повторить. [ADR](adr/004_review_and_public_entry.md), [сводный отчёт](reports/evening-2026-10-16.json).

Финальные проверки: **74 unit, 38 parser, 37 Chromium без пропусков, 10 WebKit** и настоящий Firefox ESR 115.40.0 win32. Chromium включает файл владельца и PDF-рендеринг; WebKit повторён на окончательных контейнерах. В source [CI `1e4e3be`](https://github.com/paifln/ziyatai/actions/runs/38954170086) обе jobs успешны: проверки кода/парсера, offline Netlify packaging и Linux integration. Полный Chromium прогон использует `8f668b4`; после него менялись только Docker ignore rules, код приложения совпадает. Физические Windows 7/iPhone/iPad не проверены.

Новая локальная подсказка на экранах кода/reset открывает Mailpit и объясняет отсутствие внешней доставки. Основной интерфейс и Lite проверены на 360px в тёмной теме с реальным и отключённым флагом Mailpit: формы работают, нет горизонтального переполнения или найденных axe нарушений. [Проверка](reports/local-mail-preview.json). Пять контейнеров Railway-схемы повторно проверены Trivy: [0 известных HIGH/CRITICAL](reports/evening-container-security.json), без исключения unfixed; прежние MEDIUM renderer не объявляются закрытыми.

На настоящем OpenAI проверены три задания по математике, запрет PDF до одобрения, сохранение одобрения, загрузка PDF и повторный запрет после редактирования. Первый холодный экспорт превысил ожидание UI-теста, результат восстановлен без повторного AI-запроса. После исправлений отдельная проверка холодного renderer получила PDF с первой попытки за 9,2 секунды; отмена и повтор DOCX через интерфейс прошли. Автоматическое подтверждение в тесте проверяет механизм и не считается педагогической экспертизой. [Живой сценарий](reports/evening-live-approval.json), [очередь](reports/evening-export-controls.json).

Восстановление согласованного snapshot после миграции 009 сверяет хэши всех 19 public tables, включая данные одобрения; 781 версия КТП совпала. [Restore](reports/restore.json). Это локальная проверка БД, не доказательство backup файлов S3 или production-расписания.

Целевая схема размещения — **Netlify + Railway**. [Инструкция](railway.md) содержит роли контейнеров, migration/health commands, private networking, storage, SMTP, шрифты и стоимость. `check:deploy` проверяет настройки без сети и вывода секретов. Отдельный S3 с lifecycle пока обязателен для публичного варианта: поддержка виртуального bucket URL сама по себе не делает Railway bucket полностью совместимым. Настоящие аккаунты, домены, SMTP и staging ещё не подключены.

## Утренняя переработка 16 октября

Полный итоговый прогон: **64 unit, 38 parser, 30 Chromium E2E, 14 WebKit E2E** и настоящий Firefox ESR 115. После логического переноса БД все **30 Chromium сценариев повторно прошли**; существующая сессия и её планы сохранились. [Утренний отчёт](reports/morning-2026-10-16.json) фиксирует исходники, image IDs и CI. Физические Windows 7/iPhone/iPad не проверялись.

Интерфейс перестроен на лесные/бумажные тона и локальный Onest. Общая валидация форм заменяет браузерные всплывающие сообщения; выбор файла, пароль, подтверждения, фильтры КТП, интерактивный образец, отмена передачи и отзыв других сессий доступны в новом кабинете. Формы выделены в отдельные модули. Lite сохраняет ES5 и системный шрифт. [Решения по архитектуре](adr/003_interface_and_demo.md).

Новый ключ OpenAI проверен и подключён к локальным web/worker. [Живой сценарий](reports/live-workflow.json) включает математический план, три уровня, замену одного задания с сохранением остальных и DOCX/PDF; [настоящая кнопка создания](reports/live-ui.json) также проверена в браузере. [Три предметные проверки](reports/live-subjects.json): математика RU, биология KK, математика KK+RU. [Оценка модели](reports/live-evaluation.json): 36 подготовленных synthetic сценариев информатики для 5–10 классов и два дополнительных примера для 1 и 11 классов — **38/38 прошли автоматические структурные проверки**. Это не педагогическая экспертиза. Схема ограничивает число заданий и привязывает ответ к snapshot; валидатор проверяет время отдельно по уровню.

Новые границы безопасности: случайный CSP nonce для каждого HTML ответа, отсутствие script unsafe-inline/eval в production, фактические лимиты streamed JSON/auth/multipart, два буферизуемых multipart на web процесс, регистронезависимая проверка XML и ограничение HTTP тела renderer. [Отрицательные HTTP проверки renderer](reports/renderer-boundary.json) прошли. Внешняя почта, публичный HTTPS адрес и production эксплуатация остаются незавершёнными.

[Активные PDF](reports/passive-pdf.json) отклоняются через multipart и подписанную S3 загрузку; непроверенный объект не публикуется. [Перенос PostgreSQL](reports/postgres-upgrade.json) выполнен логически в новый том: хеши всех 19 публичных таблиц и kk/ru ILIKE совпали, старый том и dump сохранены. Сопоставление запущенных образов со сканами — в [container-security](reports/container-security.json). У renderer остаются [50 MEDIUM замечаний зависимостей](reports/renderer-advisories.json), они не скрыты исключениями.

## Предыдущий прогон 16 октября до утренней переработки

Переработан интерфейс: белый/светло-серый фон, Inter с казахскими буквами, без синего/фиолетового и градиентов; убран «Шолу/Обзор». Боковая панель сворачивается, помощь/Lite/профиль перенесены вправо вверх. Добавлены юридические страницы; реквизиты оператора и условия production ещё требуют заполнения.

Подтверждение почты работает шестизначным OTP, а не ссылкой: 600 секунд, хешированное хранение, лимит попыток и повторной отправки. Сквозной UI тест проверяет неверный код, правильный код и запрет повторного использования. **Доставка проверена только через локальный Mailpit. Внешний SMTP не подключён.** В регистрацию и профиль добавлен предмет; AI snapshot больше не фиксируется на информатике.

Файл владельца проверен через работающий HTTP API и UI: [426 строк, 11 листов](reports/owner-workbook.json), выделение и подтверждение 17 уроков первого класса. Восемь исходных строк без целей остаются на ручную проверку. Содержимое приватного Excel в Git не включено. Есть отмена передачи и возврат после нераспознанного КТП; [queued cancel](reports/import-cancel.json) переводит и операцию, и план в cancelled.

На web application commit `6dee156` прошли **20 Chromium E2E**, 52 unit и 28 parser tests; TypeScript/ESLint проходят. Контейнеры собраны из Git-архива, прямые S3 загрузки проверены с явным build origin. [Свежий restore](reports/restore.json) включает 8 миграций, проверяет данные 14 таблиц. Отчёты производительности и сканирования обновлены; открытые MEDIUM находки renderer не скрыты. Детали подключения ключа и внешней почты — [здесь](connect-services.md).

Дополнительно прошли 8 WebKit сценариев, включая регистрацию с кодом и сенсорные phone/tablet, и повтор настоящего Firefox ESR 115 win32. Сводный [отчёт этой переработки](reports/revision-2026-10-16.json) связывает проверки с application commit и image IDs. WebKit на Windows — не физический iPhone/iPad; текущий Windows с Firefox 115 — не физическая Windows 7.

Ниже сохранены исходные критерии и границы приёмки. Полный production Definition of Done по-прежнему не достигнут: публичного URL, внешней почты и педагогической экспертизы нет.

Обновлено 15 октября 2026 года, Asia/Qyzylorda. Доступный сайт: http://localhost:3000, облегчённый интерфейс: http://localhost:3000/lite/. Окружение — локальный Windows компьютер с Linux Docker контейнерами. Публичный staging/production URL отсутствует. Точный передаваемый commit — `git rev-parse HEAD`.

Работают локально регистрация и подтверждение email в Mailpit, password reset, приватный импорт PDF/DOCX/XLS/XLSX и OCR сканов, исправление/подтверждение КТП, редактор заданий, версии, DOCX/PDF и student export, библиотека, сохранение после logout/login, запрет чужого доступа и удаление. Настоящий OpenAI проверен на ограниченных синтетических сценариях. Это частично проверенная реализация.

## Критерии

| AC | Статус | Доказательство / что осталось |
| --- | --- | --- |
| AC01 | Проверено локально; внешняя зависимость | Better Auth registration, verification и reset через Mailpit. Нужны HTTPS и реальная внешняя SMTP delivery. |
| AC02 | Проверено локально на synthetic corpus | Все 4 формата, скан и mixed PDF через отдельный renderer. Нужны разрешённые реальные файлы и расширенная OCR оценка. |
| AC03 | Проверено локально | Исправление, confirm, optimistic conflict, SQL DATE и persistence. Источник содержит fragment/page/sheet + исходный download; для PDF реализован приватный просмотр оригинальной страницы, для DOCX/Excel — исходный фрагмент таблицы. |
| AC04 | Проверено локально с живым OpenAI | Responses/strict schema и kk/ru/kk+ru: 36 подготовленных synthetic примеров и 2 возрастных дополнения прошли автоматические проверки. Дополнительно проверены другие предметы; педагогическая оценка ещё нужна. |
| AC05 | Частично проверено локально | Rubric/points/references/duplicates/перевод чисел/простая арифметика; always needs_review. Семантическая и языковая педагогическая экспертиза не проведена. |
| AC06 | Редактор/версии проверены локально | Редактирование/restore/stale validation; живая замена одного задания сохраняет соседние задания, IDs и уровень. |
| AC07 | Проверено локально | OOXML, TNR 14, PDF, казахские символы, page break, student answers absent. Все 4 страницы representative export визуально просмотрены. Production fonts/exports ещё не проверены. |
| AC08 | Проверено локально | Library/history, repeat download, logout/login, two-user 404 ACL. Поиск выполняется сервером по всей коллекции; UI показывает страницы по 20 записей. Источники КТП показываются по 25 строк, Lite — по 10. |
| AC09 | Частично проверено локально | Lease recovery/idempotency/cancellation/quota и mock provider errors. Fault injection реального OpenAI и renderer outage на production не выполнены. |
| AC10 | Проверено локально, production проверка нужна | Signature/ZIP/XML checks, ClamAV, ACL/Origin, deletion/cleanup, secret scan, npm audit. Independent pentest и production bucket policy не проверены. |
| AC11 | Локальный запуск; внешняя зависимость | Web, DB, S3, worker, renderer, antivirus, Mailpit. Local restore подтверждён. Public deploy/monitoring/backup schedule отсутствуют. |
| AC12 | Проверено локально и на GitHub | Lockfile, 8 migrations, README, synthetic seed, Docker builds из Git-архива, check:source и CI. Точные commits, run URL и результаты двух jobs — в [утреннем отчёте](reports/morning-2026-10-16.json). |

Definition of Done из задания **не достигнута**: production URL и внешняя почта отсутствуют; педагогическая экспертиза не проведена. Не следует выдавать local или mock результаты за production proof.

## Архив результатов до утренней переработки

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
| Public HTTPS web/worker/DB | Нет подключённых Netlify/Railway и production доменов | Подключить frontend Netlify и backend Railway в согласованном регионе, определить APP_URL | Деплой по railway.md/netlify.md, readiness, полный E2E на URL, deployment record с SHA/digests/date |
| Private production storage | Нет endpoint/bucket/account | Создать private bucket и server-side secret manager entries | Anonymous GET запрещён; upload/download/deletion двух пользователей |
| Педагогическая и production AI приёмка | Локальный ключ/model работают, живые структурные сценарии пройдены; экспертной оценки и облачного окружения нет | Перенести настройки через secret manager Railway, задать бюджет и привлечь предметных экспертов | Staging generation/regen/approval/export, ручная rubric 1–5 и expert review |
| Real external email | Используется локальная Mailpit | Подключить SMTP sender и DNS для отправки | Письмо дошло во внешний ящик, verify/reset на HTTPS |
| Exact deployment font preset | Шрифты законно доступны только локально | Предоставить лицензированный deployment font directory | fc-match точного семейства, визуальный export на production |
| Расширенный корпус КТП/правовая актуальность | Файл владельца проверен: 426 строк/11 листов; разнообразие школ и правовая проверка ограничены | Дополнительные разрешённые обезличенные файлы и проверка применимых актов/согласия/регионов | Расширенный parser corpus report, privacy/legal decision record |
| Monitoring/backups | Нет production инфраструктуры | Подключить backup storage/schedule и alerts | Production restore drill + тест доставки алертов |
| Production security acceptance | Образы проверены локально; публичное окружение отсутствует | Проверить реальные ingress, bucket policy, секреты и обновления на выбранном сервере | Повторный scan exact digests и staging ACL/TLS/upload tests по container-security.md |

Секреты не передают в чат или git. После подключения нужны команды deploy.md и повторная приёмка, а не переписывание интерфейса.

## Расходы

Внешние услуги не закупались. Для коммерческого frontend выбран [Netlify Free](netlify.md) с лимитом кредитов; backend и AI он не оплачивает. Реальные monthly infrastructure и AI/OCR затраты не измерены. [ADR hosting](adr/002_hosting.md) сохраняет исследование серверов. Backup, storage, SMTP и model usage нужно зафиксировать после выбора конфигурации. Tesseract не имеет отдельной оплаты за страницу, но расходует CPU/RAM. Live OpenAI billing требует usage выбранной модели, включая repair/uncertain outcomes.
