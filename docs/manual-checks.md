# Реестр ручных проверок

Отсутствие вызова из npm/CI не означает, что CLI-файл мёртвый. Ниже перечислены
кандидаты первоначального аудита; они сохранены как ручные инструменты.
Ответственный за запуск и внешние producer-скрипты пока не установлены.

Для TypeScript-команд, использующих конфигурацию сервера, шаблон запуска из корня:
`npx tsx --env-file=.env.local scripts/checks/ИМЯ.ts`.
Python: `python scripts/checks/ИМЯ.py`. MJS: `node scripts/checks/ИМЯ.mjs`.
Перед запуском выбирайте изолированное тестовое окружение и читайте входы ниже.
Эта таблица документирует инструменты и не добавляет их автоматически в CI.

| Файл | Вход и назначение | Побочные эффекты / ограничение |
| --- | --- | --- |
| [ai-eval.ts](../scripts/checks/ai-eval.ts) | `tests/ai/scenarios.json`, настроенный OpenAI; `EVAL_LIVE=1`, лимит `EVAL_REQUEST_LIMIT` 1…36 | Платные генерации, отчёты `.local/ai-eval`; отдельно от обычных тестов |
| [check-openai.ts](../scripts/checks/check-openai.ts) | Проверка ключа/модели коротким Responses-запросом | Платный внешний запрос; не является read-only проверкой конфига |
| [live-ai-smoke.ts](../scripts/checks/live-ai-smoke.ts) | Синтетический казахский snapshot и настроенная модель | Платная генерация; отчёт `.local/ai-eval/smoke.json` |
| [live-subject-check.ts](../scripts/checks/live-subject-check.ts) | `LIVE_AI_CHECK=1`, несколько синтетических предметов | До трёх генераций с возможными внутренними исправлениями; платно |
| [antivirus-check.ts](../scripts/checks/antivirus-check.ts) | Локальный ClamAV `127.0.0.1:13310`, созданный fixture DOCX | Чистый файл и стандартная безвредная EICAR-сигнатура; отчёт `.local/reports`; включён в document CI |
| [check-renderer-boundary.ts](../scripts/checks/check-renderer-boundary.ts) | Настроенный локальный renderer/token | Ошибочные HTTP-запросы для проверки границ; отчёт `.local/reports` |
| [delete-snapshot-check.ts](../scripts/checks/delete-snapshot-check.ts) | Только локальная БД, синтетические ресурсы | Транзакционные DML с rollback; нельзя запускать вместо backup-проверки |
| [lease-recovery-check.ts](../scripts/checks/lease-recovery-check.ts) | Отдельная тестовая БД | Создание синтетических lease-сценариев, recovery, rollback; отчёт |
| [queue-check.ts](../scripts/checks/queue-check.ts) | Тестовые БД/Storage, работающий worker | Записи в очередь, экспорт, удаление созданных объектов и строк; требует выделенного окружения |
| [upload-cleanup-check.ts](../scripts/checks/upload-cleanup-check.ts) | Тестовые БД/Storage | Создаёт и удаляет объекты; вызывает настоящий cleanup просроченных загрузок. Не запускать на действующих данных |
| [quarantine-sweep-check.ts](../scripts/checks/quarantine-sweep-check.ts) | Тестовый Storage | Listing quarantine, synthetic orphan, проверка sweep/удаления; нужен выделенный bucket |
| [export-lease-isolation-check.ts](../scripts/checks/export-lease-isolation-check.ts) | Только локальный Storage | PUT/GET/DELETE синтетических объектов, проверка изоляции lease |
| [draft-performance-check.mjs](../scripts/checks/draft-performance-check.mjs) | Chromium, актуальные Lite helpers | Офлайн-измерения сериализации; создаёт JSON-отчёт, не обращается к AI/БД |
| [browser-check.ts](../scripts/checks/browser-check.ts) | Работающий web; `QA_BASE_URL`/`QA_ORIGIN` | Проверки и скриншоты `/` и `/lite/`; выбранный адрес может быть внешним |
| [parser-report.py](../scripts/checks/parser-report.py) | `npm run fixtures`, Python parser dependencies | Извлекает синтетические документы, пишет `.local/reports/parser.json`; OCR оценивается отдельно |
| [document-check.py](../scripts/checks/document-check.py) | Ручные `.local/qa/{full,student}.docx` и `full.pdf`, необязательный `reviewed.docx` | Проверяет специальные казахские символы, Times New Roman 14, разрыв перед ответами; создаёт PNG/JSON. Producer этих специальных документов не установлен; это не generic-проверка `supabase-student.*` |
| [image-security-report.py](../scripts/checks/image-security-report.py) | Docker и четыре актуальных Trivy JSON `.local/security-{web,renderer,worker,antivirus}-final.json` | Проверяет совпадение digest с локальными образами, собирает отчёт; scanner/producers запускаются отдельно |
| [create-eval-corpus.ts](../scripts/dev/create-eval-corpus.ts) | Синтетические темы, без AI/БД | Перезаписывает tracked `tests/ai/scenarios.json` с новыми UUID. Перезапуск требует review diff |
| [build-bootstrap.ts](../scripts/supabase/build-bootstrap.ts) | Неизменённые SQL-миграции | Генерирует SQL для первоначальной установки; сам не выполняет его. Применение отдельно, только к пустому проекту |
| [workflow-smoke.ts](../scripts/supabase/workflow-smoke.ts) | Явный env-файл, web/worker/renderer/ClamAV/Storage | Создаёт аккаунт, загружает и импортирует fixture. `--fixture-export` добавляет synthetic версии и экспорт; `--live-ai` вызывает платную модель. Пытается удалить тестовый аккаунт в finally; локальный fixture-вариант включён в CI |

Нельзя заменять эти специальные проверки одним «запустить всё»: часть пишет в БД,
часть удаляет файлы, часть оплачивается у провайдера. Обязательная безопасная группа
команд находится в README и CI. `npm run check:repository` продолжает показывать
CLI без потребителей кода даже после добавления документации.

Для удаления инструмента нужны подтверждение отсутствия внешнего запуска,
актуальный заменяющий тест и проверка документации/CI/конфигов. Для удаления
резервных копий, legacy таблиц и миграций нужен отдельный план работы с данными.
