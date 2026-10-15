# API ZiyatAI

Все бизнес endpoints требуют подтверждённого email, cookie сессии и проверки владельца. Для POST/PATCH/DELETE необходим Origin, равный APP_URL. Ответы не кешируются. Ошибка: code, безопасное message, requestId, необязательные fieldErrors. Чужой ресурс даёт 404, конфликт revision — 409.

Типизированные runtime контракты находятся в packages/contracts. Один catch-all Route Handler маршрутизирует фиксированный набор ресурсов. Auth endpoints обслуживает Better Auth.

| Метод и путь | Контракт |
| --- | --- |
| POST /api/auth/sign-up/email | name, email, password минимум 12 символов; verification email |
| POST /api/auth/sign-in/email; /sign-out | Обычная email/password сессия |
| POST /api/auth/request-password-reset; /reset-password | Восстановление через одноразовый токен в письме; успешный сброс отзывает все старые сессии |
| GET /api/health; /api/health/ready | Liveness; БД/storage/worker readiness; без секретов |
| POST /api/uploads | multipart file; локальный резервный путь при DIRECT_UPLOADS=false, максимум 25MiB |
| POST /api/uploads/init | name, bytes; резервирование квоты и короткоживущий подписанный PUT в приватный quarantine; MIME определяется сервером по расширению |
| POST /api/uploads/{id}/complete | HEAD проверяет размер/тип; идемпотентное завершение загрузки; ещё не разрешает скачивание непроверенного файла |
| GET /api/uploads/{id} | Разрешённое владельцу скачивание исходника |
| POST /api/ktp/imports | uploadId, locale kk/ru, includeHidden; 202 {id,jobId} |
| GET /api/ktp | q, limit максимум 100, offset; список владельца |
| GET /api/ktp/{id} | Текущий plan и immutable snapshot строк |
| GET /api/ktp/{id}/preview?page=N | Приватный PNG оригинальной страницы PDF; проверка владельца плана и исходника |
| PATCH /api/ktp/{id}/rows | revision, rows, grade nullable, schoolYear; сохранение всей таблицы как новой версии |
| POST /api/ktp/{id}/confirm | Тот же контракт; обязательны класс, тема и текст целей каждой строки |
| GET /api/jobs; /api/jobs/{id} | Статус, этап, безопасная ошибка и result, никаких внутренних payload/secrets |
| POST /api/jobs/{id}/cancel | Отмена до публикации; длительный внешний вызов может завершиться, но результат не публикуется |
| POST /api/generations | planId, rowId, revision, locale, count 1–5, minutes 5–120, constraints, format; Idempotency-Key UUID; 202 |
| GET /api/generations/{id} | Текущий AST; ?revision=N для исторического snapshot |
| GET /api/generations/{id}/versions | Список номеров и дат версий |
| PATCH /api/generations/{id}/tasks/{taskId} | revision, task; новая версия, прежняя проверка устаревает |
| PATCH /api/generations/{id}/document | revision, document; редактор всего AST и перестановка заданий |
| POST /api/generations/{id}/tasks/{taskId}/regenerate | revision; Idempotency-Key UUID; сохраняются stable ID/level и остальные задания |
| POST /api/generations/{id}/validate | Структурная проверка текущей версии; не методическое утверждение |
| POST /api/exports | generationId, revision, format docx/pdf, audience full/student, styles, teacherReviewed (default false); Idempotency-Key UUID; 202 |
| GET /api/exports/{id}/download | Владелец и parent generation проверяются; private attachment bytes |
| GET /api/history; /api/library | q, limit, offset; версии и исторические exports |
| GET/PATCH /api/profile | name, school, locale, grades, styles; credentials в профиль не копируются |
| DELETE /api/ktp/{id}; /api/generations/{id}; /api/exports/{id} | Немедленная tombstone, durable deletion job; КТП удаляет связанные задания и exports |
| DELETE /api/account | Немедленное прекращение доступа, отзыв сессий, фоновое физическое удаление |
| POST /api/demo | Только явно включённый local/test demo; отдельная маркировка synthetic/no OpenAI; идемпотентно на пользователя и язык |

При DIRECT_UPLOADS=true браузер отправляет bytes непосредственно в S3: init → PUT → complete → import. Подпись ограничивает ключ, тип, размер и срок. Worker проверяет сигнатуру, архив/XML и антивирус, затем копирует проверенные bytes в новый неизменяемый ключ: повтор PUT по ещё действующей подписи не изменит чистый источник. Пока проверка не завершилась, download/preview запрещены. Для quarantine настраивается удаление через сутки; CORS допускает только APP_URL. Это позволяет не пропускать большие файлы через ограничения Netlify proxy, см. [инструкцию](netlify.md).

teacherReviewed=true — явное подтверждение учителя для конкретного экспорта. Сервер повторно проверяет документ и отвергает подтверждение при структурных замечаниях (REVIEW_REQUIRED); без подтверждения экспорт сохраняет надпись «Черновик». Подтверждение не меняет needs_review у AI и не является автоматической педагогической экспертизой. Поле сохраняется в exports и возвращается библиотекой. JSON body ограничен 2MiB независимо от Content-Length; AST имеет отдельные ограничения количества заданий, блоков, ячеек и текста.

Renderer — внутренний сервис: POST /inspect, /parse, /render. Требует длинный bearer token; принимает ограниченные bytes + X-Format, X-Font, X-Include-Hidden. Публичный ingress для него запрещён. В нём отсутствуют пользовательская БД, storage ключи и OpenAI key.

При API_GATEWAY=netlify все auth/business endpoints дополнительно требуют действующую Netlify HS256 подпись нужного site ID. Проверенный provider IP используется для auth rate limit; клиентский `x-ziyatai-client-ip` перезаписывается. Health не требует подписи. Standalone Compose сохраняет API_GATEWAY=direct и доверяет только заголовкам своего reverse proxy. [Настройка](netlify.md).
