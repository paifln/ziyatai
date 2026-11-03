# Будущий backend Railway

Этот пакет не используется текущим запуском. Конфигурация описывает API, worker, renderer и антивирус; аккаунты, PostgreSQL и файлы остаются в Supabase. Собственный PostgreSQL на Railway не создаётся.

`npm run check:railway` из корня устанавливает зависимости только этого пакета и проверяет граф локально. Проверка не выполняет plan/apply, не создаёт облачных ресурсов и не требует подписки.

После приобретения подписки сначала слейте проверенный релиз в `main` (источник задан в `railway.ts`), заполните перечисленные проверкой Shared Variables в secret manager и проверьте план ресурсов. Публикация выполняется отдельно; переключение Netlify proxy делается после проверки готовности всех сервисов. Нужны постоянные worker и антивирус, renderer и доступ к Supabase Session pooler. Node-образы используют `infra/Dockerfile`, renderer — `infra/Dockerfile.renderer`.

Секреты Supabase, базы, S3, AI и renderer должны оставаться в Shared Variables. На Netlify передаются только публичные origins, site ID и секрет подписи прокси в Runtime scope.
