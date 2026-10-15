# Netlify для ZiyatAI

Выбор на 15 октября 2026 года: **Netlify для интерфейса, отдельный контейнерный сервер для API и фоновой обработки**. Публичный deploy ещё не выполнен. Конфигурация подготовлена; аккаунт, DNS и production-провайдеры не подключены.

## Почему Netlify

Netlify прямо допускает коммерческие проекты на Free; Vercel Hobby ограничен личным некоммерческим использованием. Поэтому Free удобнее для пилота продукта, который предполагается продавать. Это не обещание бесплатного сервиса при любой нагрузке. [Netlify Free](https://www.netlify.com/blog/introducing-netlify-free-plan/), [Vercel Hobby](https://vercel.com/docs/plans/hobby).

На текущей [странице тарифов](https://www.netlify.com/pricing/) Free имеет 300 credits в месяц. Production deploy — 15 credits, bandwidth — 20/GB, requests — 2/10k, compute — 10/GB-hour. Расходы складываются. Например, 4 публикации + 2 GB + 100 000 requests = 120 credits **до compute**; это арифметический пример, не измерение ZiyatAI. Не включайте auto recharge, если нужен жёсткий бесплатный предел.

OCR, LibreOffice, постоянный worker, PostgreSQL, SMTP, private S3 и OpenAI не становятся бесплатными от выбора CDN. Сервер и внешние услуги оцениваются отдельно; покупки не производились. Размещение и обработку персональных данных, в том числе проксирование через Netlify, владелец должен подтвердить для выбранной юрисдикции.

## Архитектура

```text
Браузер → Netlify: интерфейс и Lite
                → /api/* → HTTPS API на контейнерном сервере
Браузер → короткая подписанная PUT-ссылка → private S3 quarantine
Worker  → антивирус + проверка формата → отдельная чистая копия → импорт
Worker  → OpenAI / приватный renderer → PostgreSQL / private S3
```

Выбран API proxy, чтобы cookies и авторизация оставались для браузера на одном origin. Секреты БД, S3, SMTP, renderer и OpenAI на Netlify не нужны. Renderer, ClamAV и БД остаются во внутренних Docker networks сервера.

Стандартные функции имеют ограничение buffered payload 6 MB, а внешний proxy — timeout 26 секунд. Поэтому 25 MiB загрузки идут прямо в S3, а OCR/PDF выполняются в очереди. Ожидание preview ограничено; при ошибке можно скачать оригинал. Эти ограничения необходимо повторно проверить на реальном staging. [Functions limits](https://docs.netlify.com/build/functions/configuration/), [Proxy limits](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/).

## Подготовка сервера

1. Выполните [развёртывание контейнеров](deploy.md). Используйте выделенный private bucket и лицензированные шрифты.
2. Для hybrid задайте `APP_URL=https://ваш-проект.netlify.app`, `APP_HOST=api.ваш-домен`, `CADDY_CONFIG=./Caddyfile.hybrid`, `DIRECT_UPLOADS=true`. `UPLOAD_ORIGIN` и `STORAGE_PUBLIC_ENDPOINT` — публичный HTTPS origin S3 API, а не публичный bucket. `STORAGE_ENDPOINT` может использовать внутренний маршрут к тому же bucket.
3. Администратором хранилища настройте CORS: только точный `APP_URL`, метод PUT, заголовок Content-Type. Включите lifecycle удаления `quarantine/` через сутки. Скрипт `scripts/configure-storage.ts` служит образцом настройки; bucket admin credentials не оставляют в runtime приложения.
4. Runtime S3 role получает только нужные object operations и readiness HeadBucket. Убедитесь, что unsigned GET существующего объекта запрещён. Объекты не публикуются через website endpoint.
5. Для web image `UPLOAD_ORIGIN` передаётся как **несекретный build arg**: CSP фиксируется при сборке. Compose передаёт его автоматически. Изменение origin требует новой сборки интерфейса.

## Настройка Netlify

Подключите GitHub repository `paifln/ziyatai`, ветку `main`. `netlify.toml` задаёт Node 24.22.0, command `npm run build:netlify` и publish `.next`. Поддержка Next.js обеспечивается автоматическим OpenNext adapter; фиксировать устаревший plugin не требуется. [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).

В build environment нужны два публичных значения:

```dotenv
ZIYATAI_API_ORIGIN=https://api.ваш-домен
UPLOAD_ORIGIN=https://s3.ваш-провайдер
```

Подготовка сборки отклоняет пустые значения, HTTP, credentials, path/query/hash. Она генерирует `_redirects` и `_headers` без секретов. Эти производные файлы не коммитятся. Все `/api/*` принудительно проксируются на backend до framework routing.

Deploy Preview должен использовать отдельный staging backend и staging `APP_URL`/bucket. Не перенаправляйте preview на production ради удобства: Origin и callback должны совпадать с конкретным окружением.

## Приёмка на реальном домене

Проверьте регистрацию и реальное письмо, reset, cookies Secure/HttpOnly, загрузку около 25 MiB через browser CORS, отсутствие доступа до scan, каждый формат и скан, редактор, реальные AI ответы на kk/ru, DOCX/PDF, второго пользователя и восстановление backup. Локальные E2E не проверяют CDN, DNS, внешний SMTP и region/privacy условия. Публикация одного экрана входа не означает запуск всего продукта.
