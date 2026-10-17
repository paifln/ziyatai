# Google и Apple

Один и тот же вход создаёт аккаунт нового учителя или открывает существующий аккаунт провайдера. Предмет после первого социального входа задаётся в настройках профиля. Пароль для социального входа не требуется. Неподтверждённый локальный аккаунт не объединяется по одному совпадению почты: используйте прежний способ входа. При Apple Hide My Email адрес может отличаться от обычного адреса учителя.

Секреты хранятся только на backend Railway: не в Netlify frontend, GitHub или NEXT_PUBLIC-переменных. Для локального запуска используются приватный `.env.local` либо `.local/docker.env` при Docker; после изменения нужен перезапуск web. Никаких ключей в чат отправлять не нужно. Без настройки кнопки сообщают о недоступности; парольный вход работает как раньше.

## Google

В Google Cloud Console создайте OAuth client типа Web application, настройте consent screen и разрешённую аудиторию. Для тестового приложения добавьте тестовых пользователей. Укажите redirect URI `http://localhost:3000/api/auth/callback/google` для локальной разработки и `${APP_URL}/api/auth/callback/google` для размещения. Запишите `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` на backend.

## Apple

Нужен активный Apple Developer account. Создайте App ID с Sign in with Apple, Service ID для сайта и ключ. В Service ID задайте публичный HTTPS-домен сайта и return URL `${APP_URL}/api/auth/callback/apple`. `APPLE_CLIENT_ID` — Service ID. `APPLE_CLIENT_SECRET` — подписанный ES256 JWT с issuer Team ID, subject Service ID, audience `https://appleid.apple.com` и Key ID в заголовке. Срок не больше шести месяцев; заменяйте JWT до истечения. Приватный `.p8` храните вне репозитория. localhost и HTTP Apple не поддерживает: на локальном HTTP кнопка остаётся недоступна.

В гибридном размещении APP_URL и callback указывают публичный Netlify-домен, а не внутренний Railway URL. Не отключайте OAuth state/PKCE, origin-проверки или защиту cookies ради настройки провайдера.

## Проверка после настройки

Проверьте вход новым и возвращающимся пользователем, отмену на странице провайдера, выход, возврат в основную и Lite-версию, выбор предмета в настройках. Убедитесь, что неподтверждённый парольный аккаунт не сливается с социальным. Реальный вход нельзя считать проверенным только по наличию кнопок или переходу на страницу провайдера.

Официальные инструкции: [Google](https://better-auth.com/docs/authentication/google), [Apple](https://better-auth.com/docs/authentication/apple).
