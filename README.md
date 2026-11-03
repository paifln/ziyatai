# ZiyatAI

Сайт для учителей Казахстана: импорт КТП, проверка тем и целей, дифференцированные задания, редактирование и выпуск DOCX/PDF. Интерфейс на русском и казахском; отдельная лёгкая версия `/lite/` для школьных компьютеров. Перед экспортом учитель одобряет сохранённую версию. В ученических листах предусмотрены поля имени и класса.

## Архитектура

- `app/` — Next.js, страницы и HTTP-маршруты.
- `apps/web/components/` — интерфейс; `apps/web/lib/auth/` — Supabase Auth, привязки владельцев и браузерный клиент сессии.
- `apps/web/lib/` — серверные операции с данными, приватными файлами, лимитами и очередью.
- `apps/worker/` — импорт, генерация, экспорт и очистка; `apps/renderer/` — изолированный обработчик документов.
- `packages/` — общие контракты и предметная логика; `migrations/` — последовательные SQL-миграции с контрольными суммами.
- `scripts/supabase/` — проверка подключения, перенос базы и файлов, интеграционная проверка авторизации.
- `supabase/` — локальный CLI-профиль и шаблоны писем; `infra/compose.supabase.yml` — профиль backend без локальных Postgres, Garage и SMTP.
- `tests/` — модульные, браузерные и интеграционные проверки, безопасность файлов.
- `archive/legacy-auth/` — прежние диагностические скрипты и CI-схема. Исторические материалы, не команды запуска.

Авторизация: **email + пароль через Supabase**. Better Auth, ввод кодов из письма и SMTP внутри приложения удалены. Supabase-токены хранятся в HttpOnly cookies; браузер получает прикладную сессию без JWT. Сервер проверяет пользователя у Supabase и реестр отзыва сессий. Смена аккаунта отменяет запросы предыдущего владельца.

Таблицы находятся в приватной схеме `ziyatai`, файлы — в приватном Supabase Storage. Доступ к материалам проходит через серверную проверку владельца. Публичный Data API не открывает прикладные таблицы. Worker, renderer и антивирус остаются отдельными сервисами. Netlify размещает frontend и проксирует API на backend.

## Запуск

Нужны Node.js 24, Python 3.12–3.14 и Docker для renderer и антивируса.

```powershell
npm ci
python -m pip install -r apps/worker/requirements.lock.txt -r tests/requirements.txt
npm run local:setup
```

Заполните игнорируемый `.env.local` по [.env.supabase.example](.env.supabase.example). Используйте Session pooler на порту 5432; специальные символы пароля должны быть URL-кодированы. Для TLS можно указать Supabase CA в `DATABASE_SSL_CA`; проверка сертификата остаётся включённой. S3 endpoint берите из Storage → S3 settings: он может использовать домен `PROJECT_REF.storage.supabase.co`.

```powershell
npm run migrate
npx tsx scripts/enable-local-renderer.ts
npx tsx scripts/prepare-local-containers.ts
docker compose -f infra/compose.tools-local.yml --env-file .env.local up -d --build
npm run dev
```

В другом терминале: `npm run worker`. Сайт: [localhost:3000](http://localhost:3000). Проверка backend и bucket: `npm run supabase:check -- .env.local`. Параметр `--storage-probe` создаёт, читает и удаляет временный объект проверки.

## Настройка аккаунтов

В Supabase Auth → URL Configuration задайте Site URL, совпадающий с `APP_URL`, и разрешите `APP_URL/api/auth/callback`. Для разработки добавьте `http://localhost:3000/api/auth/callback`.

Вход использует пароль. При включённом Confirm email регистрация требует перехода по ссылке. Восстановление тоже выполняется по ссылке, без ввода кодов. Шаблоны: [подтверждение](supabase/templates/confirmation.html) и [восстановление](supabase/templates/recovery.html). Скопируйте их в Email Templates панели Supabase. TokenHash позволяет открыть письмо в другом браузере; стандартный PKCE callback работает в браузере, начавшем операцию.

**Для публичной доставки писем нужен SMTP в Supabase.** Встроенная почта предназначена для тестовых адресов команды проекта. Почта Netlify её не заменяет. До проверки доставки регистрация с подтверждением и восстановление не считаются готовыми к публичному запуску.

Пароли прежней системы не переносились. Владельцу импортированных материалов следует зарегистрироваться с прежним email и подтвердить его по ссылке: сервер сохранит прежний ID и материалы. Простой вход с паролем не может присвоить непривязанный импортированный аккаунт.

## Перенос и размещение

Перенос базы и файлов требует окна обслуживания, резервной копии и остановки записывающих web/worker. `supabase:copy-db` и `supabase:copy-files` по умолчанию проверяют данные; запись требует `--apply --maintenance`. Данные назначения не перезаписываются. Подробности: [переход на Supabase](docs/supabase.md).

Для production задайте секреты на backend и worker, а на Netlify — только параметры прокси и разрешённый origin загрузок. Серверные ключи Supabase, база, S3 и AI не должны попадать во frontend. Перед запуском: `npm run check:deploy`, резервные копии и проверка генерации/экспорта на настоящих документах. TNR/Arial/Calibri требуют отдельно установленных лицензированных шрифтов; свободные Liberation/Carlito входят в renderer.

Старые инструкции Railway, локального Garage/Mailpit и Windows-скрипты описывают предыдущую инфраструктуру. Новый backend использует Supabase; существующее размещение переключается отдельным релизом.

## Проверки

```powershell
npm run lint
npm run typecheck
npm test
npm run test:browser
npm run test:parser
npm run test:security
npm run check:source
npm run check:client
python scripts/scan-secrets.py
npm run build
npx tsx scripts/supabase/auth-smoke.ts .env.local
```

Последняя команда создаёт и удаляет синтетического пользователя; проверяет настоящий Supabase, пароль, восстановление, HttpOnly cookies, кабинет и отзыв сессий. Письма она не отправляет. CI выполняет эту проверку с локальным Supabase без production-ключей. Дополнительные сценарии КТП/экспорта находятся в `tests/e2e/`; старые сценарии OTP требуют обновления перед использованием.
