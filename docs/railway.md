# Netlify + Railway

Целевая схема: Netlify обслуживает главную, кабинет и Lite; Railway запускает API, worker, PostgreSQL, renderer и ClamAV. Файлы — в отдельном приватном S3 bucket, письмо — через внешний SMTP. OpenAI и все рабочие секреты остаются на backend. Локальный Docker остаётся удобным способом демонстрации.

Это инструкция к подготовленному коду. Реальный Railway project, Netlify site, SMTP и staging ещё нужно подключить и проверить на доменах. Пароли и ключи в чат или Git не отправлять.

## Конфигурация проекта в коде

[`.railway/railway.ts`](../.railway/railway.ts) описывает пять служб и три постоянных тома, общий secret references, роли сборки, API migration/healthcheck и отключение сна worker. SDK закреплён как dev dependency и не добавляется в клиентский JavaScript. `npm run check:railway` **без сети** проверяет локальное описание и ссылки между службами, отсутствие literal credentials и совпадение ClamAV image с Compose; выводит имена требуемых Shared Variables, без их значений. Это не облачный plan и не выполненный deploy.

Используется новый Railway IaC. Старые `railway.json`/`railway.toml` не добавляются: для новых служб Config as Code больше не подключается. [Актуальный workflow Railway](https://docs.railway.com/infrastructure-as-code). Нужен CLI **5.42.1 или новее**. После создания/подключения аккаунта выполните `railway login`, `railway link`, настройте Shared Variables через интерфейс хостинга и просмотрите `railway config plan`. Только проверенный план применяйте через `railway config apply`; расходы, volumes, регион и удаления должны быть понятны до применения. Здесь эти команды с облаком не выполнялись.

Для первого подключения используйте отдельный новый проект `ziyatai`: ожидаемый первый plan содержит только описанные добавления. IaC управляет окружением; удаление ресурса из файла или переименование тома может повлечь удаление/замену облачных данных. Не применяйте этот файл поверх чужого существующего проекта без сверки плана и backup.

`POSTGRES_PASSWORD` задайте отдельным случайным **hex** значением от 32 байт: в DATABASE_URL используется reference без URI-экранирования. API/worker получают URL из postgres, имя антивируса и renderer — из private networking references. Настоящие секреты не записывайте в IaC; `config pull --include-variables` не используйте для файла, который попадёт в Git. Не переименовывайте volumes после появления данных без отдельного плана переноса. Начальные размеры томов — 1 GiB БД, 1 GiB сигнатуры, 512 MiB лицензированные шрифты; рост и backup нужно настроить до нагрузки.

При первом развёртывании дождитесь PostgreSQL и антивируса, загрузите лицензированные шрифты; если API pre-deploy ещё не дождался новой БД, повторите API deploy после её готовности. Он сам применит миграции. Затем проверьте readiness и worker. Генерацию публичного HTTPS domain включите **только для API**, после чего задайте этот origin в Netlify. Остальные службы оставьте приватными. Внешние S3/SMTP и Netlify не создаются этим файлом. Ручная таблица ниже описывает те же настройки и остаётся запасным способом подключения.

## Сервисы Railway

Создайте один project и одно environment. Для сервисов из GitHub используйте корень репозитория, а не `apps/web`. В Settings → Build задайте Dockerfile Path. Публичный HTTPS domain нужен только API. Для renderer, ClamAV и PostgreSQL не включайте public domain/TCP proxy.

| Сервис      | Источник                                                                           | Настройки                                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api`       | GitHub, `infra/Dockerfile`                                                         | Variable `ZIYATAI_TARGET=web`, `HOSTNAME=::`, `PORT=3000`. Pre-deploy command `node migrate.mjs`. Healthcheck `/api/health/live`.                                                                      |
| `worker`    | GitHub, `infra/Dockerfile`                                                         | Variable `ZIYATAI_TARGET=worker`. Команда берётся из image. Без HTTP healthcheck и без serverless/sleep: очередь должна обрабатываться постоянно.                                                      |
| `postgres`  | GitHub, `infra/Dockerfile.postgres`                                                | `POSTGRES_USER=ziyatai`, `POSTGRES_DB=ziyatai`, случайный `POSTGRES_PASSWORD`. Persistent volume `/var/lib/postgresql`. Не подключать старый Debian volume к Alpine image.                             |
| `renderer`  | GitHub, `infra/Dockerfile.renderer`                                                | `PORT=8090`, `RENDERER_HOST=::`, отдельный случайный `RENDERER_TOKEN` не короче 32 символов. Healthcheck `/health`. Секреты БД/S3/SMTP/OpenAI сюда не передавать.                                      |
| `antivirus` | Тот же закреплённый `clamav/clamav` image digest из `infra/compose.production.yml` | Persistent volume `/var/lib/clamav`; private port 3310. Дождаться обновления сигнатур и ответа PONG. Размер памяти подобрать по фактическому потреблению; 512 MB для этой службы недостаточно надёжны. |

Один Dockerfile собирает оба приложения: последний stage `railway` выбирает уже существующий `web` или `worker` через публичный build ARG `ZIYATAI_TARGET`. Никакие ключи в build ARG не нужны. Локальный эквивалент: `docker build -f infra/Dockerfile --build-arg ZIYATAI_TARGET=worker -t ziyatai-worker .`. [Dockerfiles и build variables](https://docs.railway.com/builds/dockerfiles).

Сначала поднимите БД, антивирус и renderer, затем API с миграциями, затем worker. Pre-deploy должен иметь доступ к приватной БД. После запуска проверьте `/api/health/ready`: в отличие от `/live`, он проверяет зависимости и heartbeat worker. Liveness намеренно не зависит от worker, иначе последовательное развёртывание может зайти в тупик.

Renderer слушает IPv6 и IPv4 через dual-stack socket, где это поддерживается. Он сохраняет последовательную обработку файлов и ограничение времени. В `api`/`worker` используйте адреса `postgres.railway.internal`, `renderer.railway.internal`, `antivirus.railway.internal`, а не `localhost`. Проверьте разрешение имён и соединения из обоих приложений; поведение зависит от network environment. [Private networking](https://docs.railway.com/networking/private-networking).

## Переменные API и worker

За основу возьмите `.env.example`, значения задавайте в Railway Variables. Не загружайте заполненный env в GitHub. Для общих секретов используйте Railway references; отдельные независимые значения в двух сервисах легко рассинхронизировать.

| Переменная                                         | Значение                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                          | `production`                                                                                        |
| `APP_URL`                                          | Точный origin Netlify, например `https://your-site.netlify.app`                                     |
| `DATABASE_URL`                                     | Приватный URL PostgreSQL с credentials из Railway reference                                         |
| `AUTH_SECRET`                                      | Случайное значение от 32 символов                                                                   |
| `API_GATEWAY`                                      | `netlify`                                                                                           |
| `NETLIFY_SITE_ID`                                  | UUID именно production сайта Netlify                                                                |
| `NETLIFY_PROXY_SECRET`                             | Отдельное случайное значение от 32 символов, совпадает с Netlify Runtime; отличается от AUTH_SECRET |
| `RENDERER_URL`                                     | `http://renderer.railway.internal:8090`                                                             |
| `RENDERER_TOKEN`                                   | Reference секрета renderer                                                                          |
| `CLAMAV_HOST`, `CLAMAV_PORT`                       | `antivirus.railway.internal`, `3310`                                                                |
| `SCAN_REQUIRED`, `ALLOW_DEMO`                      | `true`, `false`                                                                                     |
| `DIRECT_UPLOADS`                                   | `true`                                                                                              |
| `STORAGE_*`                                        | Доступ к приватному S3 bucket; подробнее ниже                                                       |
| `SMTP_*`                                           | Внешний SMTP, порт 587 с STARTTLS или 465 с TLS; настроенный домен отправителя                      |
| `OPENAI_API_KEY`, `OPENAI_MODEL`                   | Новый серверный ключ и проверенная модель; текущий выбор `gpt-5.4-mini`                             |
| `PARSER_CONTAINER_IMAGE`, `RENDER_CONTAINER_IMAGE` | Пустые: worker обращается к отдельному renderer по HTTP                                             |

`UPLOAD_ORIGIN` — публичный origin **загрузок**, передаётся при сборке web и Netlify. `LEGAL_OPERATOR_NAME` и `LEGAL_CONTACT_EMAIL` — публичные данные владельца для правовых страниц. После изменения этих значений пересоберите web/Netlify.

## Приватное хранилище

Для первого публичного запуска выбирайте S3 provider с проверенными CORS и lifecycle, например уже поддерживаемый path-style S3/R2. `STORAGE_FORCE_PATH_STYLE=true` сохраняет нынешнее поведение Garage/R2. CORS разрешает PUT только с точного `APP_URL`, а lifecycle удаляет `quarantine/` через сутки. Административный пример: `scripts/configure-storage.ts`. Runtime credentials должны быть ограничены рабочими object operations.

У R2 нет S3 bucket versioning API; общий пример скрипта содержит также `NoncurrentVersionExpiration` для версионированного S3. Для R2 настройте совместимые правила через его панель: CORS PUT с точного `APP_URL`, удаление объектов префикса `quarantine/` через день и завершение незаконченных multipart через день. Правила для `clean/` не добавляйте. Сверьте фактическую конфигурацию и загрузку до запуска; versioning не заменяет отдельный backup. [Совместимость S3 API R2](https://developers.cloudflare.com/r2/api/s3/api/), [object lifecycle R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/). Живой R2 bucket здесь не подключался; проверка URL-подписи не равна проверке политики провайдера.

Railway также предлагает приватные S3 buckets. Для новых virtual-hosted buckets задайте `STORAGE_FORCE_PATH_STYLE=false`, базовый endpoint из Credentials и настоящий `BUCKET`, не display name. `UPLOAD_ORIGIN` в этом случае — **bucket subdomain**, фактически используемый подписанной ссылкой. Для старых path-style buckets следуйте Credentials. [Railway buckets](https://docs.railway.com/storage-buckets).

На момент проверки документация Railway не обещает bucket lifecycle. Поэтому нельзя считать новый Railway bucket полностью взаимозаменяемым с настроенным production S3: скрипт настройки должен успешно применить lifecycle, иначе используйте провайдера с этой возможностью. Worker удаляет заброшенные uploads, но это не заменяет lifecycle для повторно записанного quarantine object по ещё действующей ссылке. Unsigned GET существующего объекта должен возвращать отказ, а не файл.

## Шрифты и изоляция

Локальная демонстрация использует лицензированные шрифты с Windows. Railway не имеет доступа к диску `C:`. Для PDF нужно доставить **законно лицензированные** Times New Roman/Arial/Calibri в renderer volume `/usr/local/share/fonts/licensed`, выполнить `fc-cache -f` и проверить `fc-match`. В публичный image эти файлы не добавлять. Пока шрифты не настроены, сервис должен возвращать `FONT_UNAVAILABLE`, а не незаметно менять печатную вёрстку.

Compose read-only/tmpfs/network ограничения автоматически в Railway не переносятся. Renderer не должен получать public domain, рабочие credentials или доступ к общей файловой системе приложений. Отсутствие public domain само по себе не запрещает исходящий интернет. Проверку сетевых ограничений выбранного Railway окружения и загрузку вредоносных тестовых файлов включите в staging; не считать локальный Compose доказательством такой же изоляции в облаке.

## Netlify

Подключите тот же репозиторий и `main`. `netlify.toml` содержит build command. Настройте `ZIYATAI_API_ORIGIN` на HTTPS domain API, `UPLOAD_ORIGIN` на origin S3 загрузок и `NETLIFY_PROXY_SECRET` в Runtime. DB/S3/SMTP/OpenAI ключи Netlify не нужны. Cookies, Origin и callbacks относятся к Netlify origin. Подробности и проверка подписанного proxy: [netlify.md](netlify.md).

## Стоимость и приёмка

Перед деплоем выполните `npm run check:deploy -- --profile=backend` в окружении с переменными API/worker, а `npm run check:deploy -- --profile=frontend` — отдельно с переменными Netlify. Команда работает **без сети**, не отправляет письма/AI-запросы, ничего не меняет и не печатает значения переменных. Код выхода `1` означает ошибки настройки, `0` — только успешную статическую проверку; пункты `MANUAL` остаются обязательными. `--json` даёт безопасный машиночитаемый отчёт.

Для локальной проверки файлов настроек храните их только в игнорируемой `.local/`, отдельно для каждого окружения:

```powershell
npx tsx --env-file=.local/railway-production.env scripts/deploy-check.ts --profile=backend
npx tsx --env-file=.local/netlify-production.env scripts/deploy-check.ts --profile=frontend
```

Файлы не создаются командой и не должны попадать в Git/архив. Передавайте переменные из secret manager; не вставляйте ключи в строку команды. Для Netlify не копируйте backend env целиком. Проверка отдельно ловит серверные ключи на frontend и несовпадение `UPLOAD_ORIGIN` с origin, который реально выбирает S3 signer для path-style/virtual-hosted bucket. Секреты, site ID и origins между двумя хостингами всё равно нужно сопоставить при staging-приёмке.

Netlify Free подходит для старта в рамках текущих квот. Railway Free/Trial — ограниченный ресурсный режим; Hobby имеет минимум $5/месяц с включёнными $5 usage. Непрерывная работа нескольких служб может стоить больше. До запуска задайте budget alerts/usage limits, измерьте память антивируса, БД и renderer. OpenAI, SMTP и storage учитываются отдельно. [Railway pricing](https://docs.railway.com/pricing/plans), [Netlify pricing](https://www.netlify.com/pricing/).

На настоящих доменах пройдите регистрацию с реальным письмом и reset; загрузите каждый поддерживаемый формат через CORS; проверьте quarantine/scan, удаление, принадлежность данных двум учителям, реальные задания, запрет PDF до одобрения, сброс одобрения после правки, DOCX/PDF после одобрения и восстановление backup. Отдельно проверьте signed proxy headers/IP, обновление антивируса и выбранные владельцем условия размещения данных. Только после этого публичный запуск можно считать проверенным.
