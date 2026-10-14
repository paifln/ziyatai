# Прогресс ZiyatAI

Работа началась 14 октября 2026 года в пустом репозитории. Требования взяты из предоставленного DOCX; его обещания актуальности и production готовности не приняты без проверки. Полный запуск означает внешний HTTPS, реальные провайдеры и подтверждённую приёмку, а не сборку.

## Фаза 0

Реализованы исследование КТП, kk/ru словарь заголовков, каноническая схема с исходными ссылками, 17 синтетических размеченных файлов и 5 негативных образцов. Найдено письмо НАО на 2026–2027 год. Актуальная редакция приказа № 130 и разрешённые реальные школьные образцы остаются непроверенными. Gate выполнен частично; пределы корпуса отмечены в исследовании.

## Фаза 1

Реализованы Next.js/TypeScript, Better Auth, PostgreSQL, private S3, durable PostgreSQL очередь, отдельный worker, миграции и env validation. В локальной БД исправлены UUID defaults и rate-limit schema по фактическому контракту auth. Регистрация, verification/reset mail и owner ACL проверены. Public staging заблокирован отсутствием аккаунта/доступа к инфраструктуре.

## Фаза 2

Реализованы безопасный multipart upload с magic/антивирусом, отдельные PDF/DOCX/XLS/XLSX адаптеры, постраничный OCR kaz+rus, review, редактирование, ручное добавление/удаление/объединение и подтверждение immutable версии. Даты SQL DATE не получают выдуманный год. На 13 цифровых synthetic fixtures найдены 39/39 строк и совпали 195/195 размеченных полей; OCR оценён отдельно в E2E. Реальные сложные/повёрнутые документы требуют расширения корпуса. DOC явно не поддерживается.

## Фаза 3

Реализован серверный официальный OpenAI Responses provider с text.format, строгим AST, kk/ru/kk+ru, snapshot привязкой, levels/rubric/duplicates/references/numeric translation/ограниченной арифметикой. Код не исполняется. Есть bounded repair, обработка refusal/incomplete/429/network failure, token reservation и лимит 3 внешних вызовов на durable job. Mock tests проверяют контракт, но real API smoke заблокирован отсутствием ключа/model id. Подготовлены 36 synthetic eval scenarios; экспертные оценки не проведены.

## Фаза 4

Реализованы редактор AST, immutable history, stale validation после редактирования, точечная регенерация на backend, restore и export snapshot. DOCX и PDF создаются из одного AST, решения после заданий с новой страницы, student вариант исключает решения. TNR 14 и казахские символы проверены в OOXML/PDF. Все страницы представительского PDF просмотрены. Реальная AI регенерация пока не проверена без провайдера.

## Фаза 5

Реализованы server ACL, Origin protection, private download, tombstones/deletion worker, temp cleanup, orphan upload expiry, quota и backoff/lease fencing. Проверены два пользователя, негативные файлы, cancellation/idempotency, восстановление lease, quota rollback, ClamAV clean/EICAR, локальный backup restore и 10 teachers/100 requests. npm audit — 0 известных уязвимостей. Production pentest, region/privacy/legal review, alarms и backup scheduling не проведены.

## Фаза 6

Собраны Docker образы web/worker/renderer; локальные web/worker работают с restart unless-stopped и постоянными данными. На собранных контейнерах повторно пройдены сквозные сценарии импорта, редактора/экспорта на synthetic материалах, входа и ACL. Source, README, deploy/runbook, ADR, API/threat model и отчёты передаются в репозитории.

Production gate заблокирован внешними зависимостями: нет VPS/SSH доступа, private production S3, SMTP sender, OpenAI key/model, утверждённой конфигурации хранения/трансграничной передачи и законно предоставленных deployment fonts. [Приёмка](acceptance.md) содержит конкретные действия и проверки для каждого блокера. Работа не объявляется полностью готовой к публичному использованию.
