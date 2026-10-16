# Netlify + Railway

Целевая схема: Netlify обслуживает главную, кабинет и Lite; Railway запускает API, worker, PostgreSQL, renderer и ClamAV. Файлы — в отдельном приватном S3 bucket, письмо — через внешний SMTP. OpenAI и все рабочие секреты остаются на backend. Локальный Docker остаётся удобным способом демонстрации.

Это инструкция к подготовленному коду. Реальный Railway project, Netlify site, SMTP и staging ещё нужно подключить и проверить на доменах. Пароли и ключи в чат или Git не отправлять.

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

Railway также предлагает приватные S3 buckets. Для новых virtual-hosted buckets задайте `STORAGE_FORCE_PATH_STYLE=false`, базовый endpoint из Credentials и настоящий `BUCKET`, не display name. `UPLOAD_ORIGIN` в этом случае — **bucket subdomain**, фактически используемый подписанной ссылкой. Для старых path-style buckets следуйте Credentials. [Railway buckets](https://docs.railway.com/storage-buckets).

На момент проверки документация Railway не обещает bucket lifecycle. Поэтому нельзя считать новый Railway bucket полностью взаимозаменяемым с настроенным production S3: скрипт настройки должен успешно применить lifecycle, иначе используйте провайдера с этой возможностью. Worker удаляет заброшенные uploads, но это не заменяет lifecycle для повторно записанного quarantine object по ещё действующей ссылке. Unsigned GET существующего объекта должен возвращать отказ, а не файл.

## Шрифты и изоляция

Локальная демонстрация использует лицензированные шрифты с Windows. Railway не имеет доступа к диску `C:`. Для PDF нужно доставить **законно лицензированные** Times New Roman/Arial/Calibri в renderer volume `/usr/local/share/fonts/licensed`, выполнить `fc-cache -f` и проверить `fc-match`. В публичный image эти файлы не добавлять. Пока шрифты не настроены, сервис должен возвращать `FONT_UNAVAILABLE`, а не незаметно менять печатную вёрстку.

Compose read-only/tmpfs/network ограничения автоматически в Railway не переносятся. Renderer не должен получать public domain, рабочие credentials или доступ к общей файловой системе приложений. Отсутствие public domain само по себе не запрещает исходящий интернет. Проверку сетевых ограничений выбранного Railway окружения и загрузку вредоносных тестовых файлов включите в staging; не считать локальный Compose доказательством такой же изоляции в облаке.

## Netlify

Подключите тот же репозиторий и `main`. `netlify.toml` содержит build command. Настройте `ZIYATAI_API_ORIGIN` на HTTPS domain API, `UPLOAD_ORIGIN` на origin S3 загрузок и `NETLIFY_PROXY_SECRET` в Runtime. DB/S3/SMTP/OpenAI ключи Netlify не нужны. Cookies, Origin и callbacks относятся к Netlify origin. Подробности и проверка подписанного proxy: [netlify.md](netlify.md).

## Стоимость и приёмка

Netlify Free подходит для старта в рамках текущих квот. Railway Free/Trial — ограниченный ресурсный режим; Hobby имеет минимум $5/месяц с включёнными $5 usage. Непрерывная работа нескольких служб может стоить больше. До запуска задайте budget alerts/usage limits, измерьте память антивируса, БД и renderer. OpenAI, SMTP и storage учитываются отдельно. [Railway pricing](https://docs.railway.com/pricing/plans), [Netlify pricing](https://www.netlify.com/pricing/).

На настоящих доменах пройдите регистрацию с реальным письмом и reset; загрузите каждый поддерживаемый формат через CORS; проверьте quarantine/scan, удаление, принадлежность данных двум учителям, реальные задания, запрет PDF до одобрения, сброс одобрения после правки, DOCX/PDF после одобрения и восстановление backup. Отдельно проверьте signed proxy headers/IP, обновление антивируса и выбранные владельцем условия размещения данных. Только после этого публичный запуск можно считать проверенным.
