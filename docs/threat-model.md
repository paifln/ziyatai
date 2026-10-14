# Модель угроз и защита

Недоверенные входы — загруженные документы, текст ячеек, source snapshot, ответы модели, редактирование AST и UUID в URL. Авторизованный субъект определяется только сессией Better Auth. owner_id нельзя передать через пользовательскую форму.

| Угроза | Реализация | Проверка и остаточный риск |
| --- | --- | --- |
| Чужие ресурсы и storage keys | Проверка owner и tombstone на API, jobs, исходниках, export и parent generation | E2E с двумя аккаунтами: чужие КТП, генерация и download дают 404. Приватность bucket требует отдельной проверки конфигурации production. |
| CSRF и credential theft | HttpOnly SameSite cookies Better Auth, Secure на HTTPS, точная проверка Origin для мутаций, общая БД rate limit, SMTP verification | Проверен отказ постороннему Origin. Caddy выдаёт HTTPS; production callback/delivery не проверены без аккаунта. |
| Загрузка вредоносного файла | Allowlist + magic + объём + ClamAV INSTREAM + структурная проверка ZIP/XML/PDF/Excel | Повреждения, ZIP bomb, внешняя relationship и encrypted PDF отклонены. ClamAV недоступен — fail closed. Нельзя обещать обнаружение всех вредоносных файлов. |
| Exploit parser/LibreOffice | Отдельный renderer без DB/S3/OpenAI secrets, bearer token, serial execution, read-only root, tmpfs, CPU/RAM/PID, private internal network без egress | Локальные импорт и PDF проходят через сервис. Production топология подготовлена; требует развёртывания и сетевого negative test. |
| Prompt injection | Системный prompt отделён от source data, нет tools, передаётся минимальный snapshot, строгий AST без HTML | Mock regression подтверждает разделение; реальный adversarial AI eval не выполнен без ключа. |
| Ошибки AI | Schema + ссылки + уровни + баллы + дубликаты + числа перевода + ограниченная арифметика; max 2 repair; всегда needs_review | Код не выполняется. Арифметический grammar не доказывает соответствие всех условий ответам. Учитель обязательно проверяет содержание. |
| Повтор jobs и worker crash | DB transaction enqueue, unique idempotency, SKIP LOCKED, lease token fencing, heartbeat, ограниченный retry | Проверены recovery истёкшего lease, одна запись export, отменённая задача и откат третьей reservation. Внешний OpenAI не имеет гарантии exactly once. |
| Delete race | Tombstones, cancel_requested, повторная проверка и блокировка объекта перед публикацией, cleanup неопубликованного storage object | Немедленный запрет download проверен. Worker физически удаляет объекты и связанные snapshot. Бэкапы имеют отдельный срок 30 дней. |
| Стоимость и отказ в обслуживании | 25 MiB, 150 страниц, 20 листов, ZIP expansion 100 MiB, 100k непустых ячеек, 2k строк; user/global request и token budgets | Caddy ограничивает body 26MB. Renderer serial и ограничен контейнером. Нагрузка без внешних AI операций измеряется отдельно. |
| Утечка в логах/bundle | Нет NEXT_PUBLIC secrets; process subprocess env allowlist; auth logger выключен; безопасные codes/requestId; не логируются source/prompts | Secret scan и npm audit проходят. Next dev пишет query token в диагностический access log; он предназначен только для localhost. Production не включает access logging с query strings. |

Ротация ключей и восстановление описаны в runbook. Полноценный независимый pentest, юридическая оценка, подтверждение регионов и production мониторинг остаются условиями запуска, а не подразумеваются успешной локальной сборкой.
