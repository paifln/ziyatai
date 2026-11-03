# Backend Railway

Production: API, worker, renderer и антивирус размещаются в проекте Railway `ziyatai`. Аккаунты, PostgreSQL и приватные файлы остаются в Supabase. Интерфейс — https://ziyatai.netlify.app.

Конфигурация `.railway/railway.ts` управляет четырьмя сервисами и диском сигнатур антивируса. `npm run check:railway` проверяет её локально. Для `railway config plan/apply` требуется Railway CLI 5.42.1+ в PATH. Перед apply просмотрите план; он не должен удалять ресурсы с данными.

Исходники загружаются через Railway CLI, поэтому доступ Railway GitHub App не требуется:

```powershell
railway config plan
railway config apply --yes
railway up --service renderer --detach
railway up --service worker --detach
railway up --service api --detach
railway service list
```

Сначала заполните Shared Variables, перечисленные `npm run check:railway`, настоящими значениями. Секреты Supabase, базы, S3, OpenAI и renderer остаются в Railway. Node-сервисы используют `infra/Dockerfile`; `ZIYATAI_TARGET` выбирает web/worker. Renderer использует `infra/Dockerfile.renderer`. API перед запуском проверяет существующие миграции и применяет недостающие; база не создаётся заново.

Публикация frontend выполняется отдельно, после проверки `/api/health/live` и `/api/health/ready` нового API:

```powershell
npm run publish:railway
```

Команда требует чистого проверенного Git-коммита, авторизации Netlify CLI, Docker и файла `.local/hosting/railway-netlify.env`. В нём разрешены только `NETLIFY_SITE_ID`, `NETLIFY_PROXY_SECRET`, `ZIYATAI_API_ORIGIN`, `UPLOAD_ORIGIN`, `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`. Адрес API должен быть постоянным HTTPS-доменом Railway. Приватные ключи базы, Supabase, S3 и OpenAI на Netlify не передаются. Результат сохраняется в `.local/hosting/railway-published.json`. Конфигурация резервного запуска с ноутбука сохраняется отдельно.

После проверки импорта, генерации и PDF/Word через публичный сайт можно остановить старый backend на ноутбуке командой `npm run online:stop`. Не удаляйте данные Supabase или Docker-тома при переключении. Рабочие задания перед остановкой должны завершиться.

Лимит Compute задаётся на уровне workspace Railway. Достижение Hard Limit останавливает backend, но не отменяет Hobby. Оплата OpenAI регулируется отдельно.
