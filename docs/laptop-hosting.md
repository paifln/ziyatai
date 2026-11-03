# Netlify + Supabase + backend на ноутбуке

Сайт: https://ziyatai.netlify.app. Supabase хранит аккаунты, прикладную базу и приватные файлы. На ноутбуке работают API, worker, renderer и антивирус. Один Cloudflare Quick Tunnel публикует API через подписанный прокси Netlify; база, антивирус и renderer не публикуются.

## Управление

Включите Docker Desktop, затем `Start online.cmd` или `node scripts/deploy/laptop-backend.mjs start`. Для остановки: `Stop online.cmd`. Проверка: `node scripts/deploy/laptop-backend.mjs status`.

Конфигурация backend — игнорируемый `.local/hosting/laptop-backend.env`, frontend — `.local/hosting/laptop-netlify.env`. Серверные Supabase/S3/AI ключи не передаются на Netlify. Локальные PostgreSQL, Garage и Mailpit не нужны. Данные находятся в Supabase и сохраняются после остановки ноутбука.

`start` проверяет Docker, включает `infra/compose.laptop.yml`, получает HTTPS адрес API и проверяет готовность. При смене адреса туннеля требуется новая сборка Netlify. `publish` публикует именно текущий чистый Git-коммит в отдельной Linux-папке, поэтому старые удалённые файлы не попадают в сборку. Перед сменой серверного кода пересоберите образы `ziyatai-web:laptop`, `ziyatai-worker:laptop`, `ziyatai-renderer:laptop` по соответствующим Dockerfile.

Команды из корня проекта:

```powershell
npm run online:build
npm run online:start
npm run online:status
# После изменения frontend и коммита:
npm run online:publish
```

`online:build` собирает три образа; `online:start` пересоздаёт изменившиеся контейнеры. `online:stop` проверяет очередь и останавливает сервисы без удаления данных.

## Первичная настройка другого ноутбука

Установите зависимости и Docker Desktop с Compose 2.30 или новее, заполните `.env.local` по корневому README. Подготовьте конфигурацию без облачных изменений:

```powershell
npm run prepare:hosting -- --site-id NETLIFY_SITE_UUID --site-origin https://your-site.netlify.app --operator "Владелец проекта" --contact owner@example.com
```

По умолчанию создаются `laptop-backend.env`, `laptop-netlify.env`, `manifest.json` в `.local/hosting/` и общий токен `.local/renderer.env`. Не публикуйте эти файлы. Скрипт выводит только имена незаполненных параметров; заполните их перед запуском. Существующие настроенные секреты сохраняются. Railway не требуется; `--target railway` готовит отдельные файлы для будущего переноса.

`laptop-container.env` создаётся автоматически для Compose в формате raw: символы `$`, `#` и кавычки в секретах не интерполируются. TLS-сертификат передаётся в поддерживаемом приложением виде с `\n`. Редактируйте `laptop-backend.env`, а затем запускайте `online:start`, чтобы обновить контейнерный файл.

Войдите в Netlify CLI (`npx netlify-cli@27.12.1 login`), сохраните исходники чистым Git-коммитом, затем выполните команды сборки и запуска выше. При первой публикации создаётся отдельный Linux-контейнер сборки. Публикация может расходовать квоту Netlify.

Регистрация выполняется email + пароль без подтверждения и без почтового сервиса. Смена пароля доступна в профиле; восстановление письмом отключено до настройки SMTP в Supabase.

## Ограничения

Ноутбук, Docker и интернет должны оставаться включёнными: после остановки backend задачи импорта, генерации и экспорта недоступны. Quick Tunnel предназначен для временного размещения; адрес меняется после перезапуска. Публикации расходуют квоту Netlify. Настоящая генерация расходует средства OpenAI.

На renderer доступны свободные Liberation/Carlito. Для лицензированных офисных шрифтов можно задать `FONT_DIRECTORY`; отсутствие этой переменной не мешает запуску со свободными шрифтами. Перед переносом на постоянный сервер сделайте резервные копии и проверьте генерацию/экспорт. Подготовка Railway находится в отдельной папке `.railway/`, она не запускается автоматически и не создаёт платные ресурсы.
