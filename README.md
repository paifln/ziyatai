# ZiyatAI

ZiyatAI помогает учителю информатики загрузить КТП, проверить строки, подтвердить тему и цели, создать задания трёх уровней, отредактировать версии и выпустить DOCX/PDF. Интерфейс — қазақша/русский; язык исходника и заданий выбирается отдельно. Данные сохраняются в PostgreSQL, файлы — в приватном S3, длительные операции — в отдельном worker.

**Текущий статус: проверено локально, публичный production запуск не выполнен.** Настоящий OpenAI provider реализован, но без ключа не проверен. Синтетическое демо явно помечено и не выдаётся за AI. Полный перечень результатов и блокеров — в [приёмке](docs/acceptance.md).

## Локальный запуск с нуля

Требуются Git, Node.js 24.21.0 LTS, Python 3.13/3.14 и работающий Docker Desktop/Engine с Linux контейнерами. На машине нужно примерно 8GiB свободной RAM и место для образов. Windows шрифты используются только локально с установленной лицензией; на Linux задайте FONT_DIRECTORY с законно установленными TNR/Arial/Calibri. Шрифты в репозиторий и образы не включаются.

```powershell
npm ci
python -m pip install -r apps/worker/requirements.txt -r tests/requirements.txt
npm run local:setup
npm run infra:up
npx tsx scripts/enable-local-renderer.ts
npx tsx scripts/prepare-local-containers.ts
docker compose -f infra/compose.tools-local.yml --env-file .env.local up -d --build
npm run migrate
npm run fixtures
```

`local:setup` генерирует случайные локальные credentials в игнорируемом `.env.local` и конфигурацию локального Garage. Повторный запуск сохраняет их. `.env.local` не пересоздавайте при существующем PostgreSQL volume: иначе пароль БД и storage ключи разойдутся. В Windows используйте редактор UTF-8 без BOM; PowerShell `Set-Content -Encoding utf8` старых версий добавляет BOM и может испортить имя первой переменной.

Для разработки откройте два терминала:

```powershell
npm run dev
npm run worker
```

Для устойчивого локального запуска соберите и запустите web/worker контейнеры:

```powershell
docker build --target web -f infra/Dockerfile -t ziyatai-web:local .
docker build --target worker -f infra/Dockerfile -t ziyatai-worker:local .
docker compose -f infra/compose.app-local.yml up -d
```

Перед этим остановите `npm run dev` и `npm run worker`, чтобы не занимать порт 3000 и не запускать лишний worker. Данные находятся в именованных volumes; `docker compose down` их сохраняет. Не используйте `down -v`, если данные нужны.

Сайт: [localhost:3000](http://localhost:3000). Локальная почта: [localhost:8025](http://localhost:8025). Зарегистрируйте собственный email и откройте письмо в Mailpit для подтверждения. Это локальная доставка в тестовый ящик, а не письмо во внешний интернет. Общего admin/demo пароля нет. После входа кнопка синтетического демо идемпотентно создаёт личный пример на выбранном языке.

## Настройка OpenAI и production

Добавьте OPENAI_API_KEY и проверенный OPENAI_MODEL в `.env.local` редактором либо в secret manager хостинга. Никогда не отправляйте секреты в чат, git или frontend. После изменения перезапустите web и worker; для контейнеров повторите `prepare-local-containers.ts` и `docker compose ... up -d --force-recreate`.

```powershell
npx tsx --env-file=.env.local scripts/live-ai-smoke.ts
```

Без ключа smoke завершается статусом BLOCKED и не делает запрос. Успешный smoke проверяет контракт одного ответа, но не заменяет педагогическую оценку, 36 подготовленных сценариев и production E2E.

Production план и минимальные внешние действия владельца — в [deploy.md](docs/deploy.md). [env.example](.env.example) содержит только placeholders и используемые настройки. APP_ENV=production включает fail-closed требования антивируса и isolated renderer, отключает synthetic demo provider и требует real AI на startup. Локально собранный production bundle с APP_ENV=local остаётся локальной проверкой, не production приёмкой.

## Проверки

```powershell
npm run lint
npm run typecheck
npm test
npm run test:parser
npm run test:e2e
npm audit --audit-level=moderate
python scripts/scan-secrets.py
npx tsx --env-file=.env.local scripts/queue-check.ts
npx tsx --env-file=.env.local scripts/restore-check.ts
npx tsx --env-file=.env.local scripts/antivirus-check.ts
npx tsx --env-file=.env.local scripts/load-check.ts
python scripts/parser-report.py
python scripts/document-check.py
```

E2E требует запущенных web, worker, PostgreSQL, S3, renderer, ClamAV, Mailpit и локально установленного Chrome. Проверки используют только синтетические данные и случайные пароли. `.local/qa`, traces и резервные тестовые архивы игнорируются git; не публикуйте их как общую библиотеку. На CI выполняются lint/typecheck/unit/parser/build/audit/secret scan. Интеграционная приёмка с контейнерами и staging должна проходить перед production release отдельно.

## Документация

- [Исследование КТП и границы корпуса](docs/ktp-research.md)
- [Архитектура и лицензии](docs/adr/001_architecture.md), [инфраструктура и расходы](docs/adr/002_hosting.md)
- [Контракты API](docs/api.md), [модель угроз](docs/threat-model.md)
- [Деплой](docs/deploy.md), [эксплуатация и восстановление](docs/runbook.md)
- [Прогресс](docs/progress.md), [приёмка и внешние блокеры](docs/acceptance.md)

## Troubleshooting

Если БД недоступна, проверьте Docker и `docker compose -f infra/compose.local.yml --env-file .env.local ps`. Миграции защищены advisory lock и checksum; уже применённые файлы не редактируют. Для изменения схемы добавляют новую миграцию.

Если OCR не работает, проверьте renderer `/health`, языки kaz/rus в образе и ограничения памяти. Неразмеченный или повёрнутый скан может потребовать ручного восстановления; пустой результат не подставляет выдуманные уроки.

Если PDF сообщает FONT_UNAVAILABLE, установите лицензированный выбранный шрифт на mounted directory. Замена шрифта не выполняется скрытно. Если файл не создаётся, смотрите безопасный код job и логи renderer без исходного текста.

Для email проверьте SMTP port/STARTTLS и callback APP_URL; production требует TLS. Для 429 worker использует ограниченный backoff. AI_UNCERTAIN означает неизвестный исход внешнего запроса и возможную оплату; автоматический повтор такого случая отключён.

Для зависшей операции проверьте worker readiness/heartbeat. Истёкший lease подхватывается janitor, а старый lease token не может опубликовать результат. Кнопка retry доступна для импорта/экспорта; новый AI запрос создают с осознанием расхода лимита.
