# Развёртывание ZiyatAI

Публичного URL пока нет. Frontend предполагается разместить на Netlify, API/worker и длительные операции — на отдельном сервере: [hybrid настройка](netlify.md). Ниже описан также самостоятельный Compose запуск всего сайта. Нужны доступ к серверу в подтверждённом регионе, private S3, SMTP, OpenAI и лицензированные шрифты.

## Последовательность

1. Создайте отдельные staging и production инфраструктуры: БД/volumes, buckets, secrets, email sender, redirect URLs. Подтвердите регион, резервное хранение и применимость требований к персональным данным. Откройте только HTTPS ingress; PostgreSQL, renderer и ClamAV не публикуются.
2. Создайте `.env.production` на сервере с правами 600 из `.env.example`. DATABASE_URL использует hostname postgres, STORAGE_ENDPOINT — private S3, RENDERER_URL — http://renderer:8090, CLAMAV_HOST — clam-update. AUTH_SECRET и RENDERER_TOKEN — разные случайные секреты. APP_ENV=production, SCAN_REQUIRED=true, ALLOW_DEMO=false. RELEASE — commit SHA; APP_URL и APP_HOST соответствуют публичному HTTPS адресу.
3. Создайте отдельный private bucket с запретом anonymous access, минимальными permissions на PutObject/GetObject/DeleteObject/HeadBucket для приложения, encryption и защищённым backup/versioning. HeadObject использует право GetObject. Нельзя принимать один лишь факт существования bucket за проверку приватности: unsigned GET должен быть запрещён. Для Netlify обязательны DIRECT_UPLOADS=true и HTTPS STORAGE_PUBLIC_ENDPOINT; UPLOAD_ORIGIN при сборке web должен совпадать с origin публичного storage. Настройте CORS для точного APP_URL и lifecycle quarantine через `scripts/configure-storage.ts` в одноразовой административной сессии. Скрипт сохраняет остальные lifecycle rules; административные права изменения bucket не оставляют у runtime ключа.
4. Установите Times New Roman на LICENSED_FONT_DIR с подтверждённым правом использования. В эту папку не кладут документы учителей. Renderer mount только read-only.
   Новая production БД использует PostgreSQL 18 Alpine в отдельном `postgres-alpine` volume. Не подключайте к ней старый Debian data directory: перенос выполняется pg_dump/pg_restore с проверкой содержимого и коллации. Текущая локальная БД не меняется автоматически. Образы PostgreSQL и proxy собираются из `Dockerfile.postgres`/`Dockerfile.proxy`; причины и проверки — в [security record](container-security.md).
5. Соберите образы и примените миграции единственным runner. Для Netlify APP_URL — адрес frontend, APP_HOST — hostname backend; используйте CADDY_CONFIG=./Caddyfile.hybrid. Для самостоятельного сайта они соответствуют одному адресу, Caddyfile остаётся стандартным:

```sh
docker compose -f infra/compose.production.yml --env-file .env.production build
docker compose -f infra/compose.production.yml --env-file .env.production up -d postgres clam-update renderer
docker compose -f infra/compose.production.yml --env-file .env.production run --rm worker node dist/migrate.mjs
docker compose -f infra/compose.production.yml --env-file .env.production up -d web worker proxy
```

6. Проверьте liveness/readiness, свежие антивирусные базы, SMTP delivery в реальный внешний ящик, подтверждение email и reset. Проверка renderer с посторонней сети должна быть невозможной. Без auth запросы к ресурсам дают 401, чужие UUID — 404.
7. Выполните полный сценарий на staging, затем production: каждый формат, OCR только на скане, ручная правка, real OpenAI на каждом языковом режиме, редактор/версии/точечная регенерация, DOCX/PDF, повторный вход, библиотека, второй пользователь. Скачанные документы визуально проверяют на всех страницах.
8. Настройте ежедневный encrypted backup БД и объектов, восстановите в отдельное окружение, включите monitoring/alerts на uptime, queue age, failed jobs и budget. Только после проверки этих действий заполните production строку в acceptance record.

## Выпуск и откат

Закрепляйте RELEASE и deployment record за immutable commit SHA и image digest. Для обновления: backup, additive migration одним runner, staging E2E, смена образов, readiness, smoke. В случае ошибки верните предыдущие совместимые web/worker images; не пытайтесь автоматически удалить новые данные или откатить destructive DDL. Восстановление snapshot используют только после оценки потери данных и сверки S3 объектов. План отката должен учитывать совместимость schema и AST version.

Compose — исходная конфигурация, а не доказательство deployment. На текущем локальном окружении не проверены TLS/DNS, реальные провайдеры, region, внешняя доставка email, public OpenAI roundtrip, production backup scheduling и алерты.

## Минимальные действия владельца

Предоставьте доступ к выбранному VPS через настроенный SSH/аккаунт провайдера, а секреты внесите непосредственно в secret manager/.env.production. Нужны выбранные регион/тариф, private bucket endpoint, SMTP sender и OpenAI key/model с установленным бюджетом. Не нужно передавать сами секреты в сообщении. После подключения продолжение состоит в командах выше, live smoke и приёмке на HTTPS URL.
