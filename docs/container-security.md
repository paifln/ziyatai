# Проверка контейнеров

15 октября 2026 года Trivy 0.76.0 проверил окончательные **web, worker, renderer, PostgreSQL, Caddy proxy и ClamAV** образы. В [отчёте](reports/container-security.json) сохраняются точные digests, время, области сканирования и все HIGH/CRITICAL находки, включая unfixed. Blanket ignore и `--ignore-unfixed` не используются. Нулевой результат означает отсутствие известных находок в распознанных пакетах на момент сканирования, а не отсутствие любых уязвимостей или замену pentest.

## Изменения

Web/worker в текущем отчёте пересобраны из Git-архива application commit `51bcea3`; остальные четыре образа не менялись. Изменения только тестового harness и отчётов после этой точки не входят в runtime. При следующем изменении приложения нужна новая сборка и scan.

- Web/worker: минимальный Ubuntu 24.04 runtime и официальный Node LTS 24.22.0. npm отсутствует в runtime. Worker собирается в отдельный bundle; его зависимости дополнительно проверяются `npm audit` по lockfile, поскольку image scanner не восстанавливает каждую библиотеку из JavaScript bundle.
- Renderer: Ubuntu 24.04, закреплённые Python зависимости, PDFium вместо PyMuPDF, обновлённые системные пакеты. Исходная Debian Trixie libxml2 была уязвима для CVE-2026-6653; [Canonical указывает исправление для Ubuntu 24.04](https://ubuntu.com/security/CVE-2026-6653). Уязвимость исправлена сменой/обновлением пакета, а не исключена из отчёта.
- Caddy: стандартные модули версии 2.11.7 пересобраны Go 1.27.2 и `golang.org/x/net` 0.60.0. Исходный официальный образ содержал Go 1.26.8 и четыре HIGH находки. [Go advisory](https://pkg.go.dev/vuln/GO-2026-6609), [официальная сборка Caddy](https://caddyserver.com/docs/build). Go module versions/checksums закреплены в `infra/caddy/`; notices сохраняются в образе.
- PostgreSQL: для **новой production установки** используется официальный PostgreSQL 18.6 Alpine с тем же entrypoint и пересобранным gosu 1.19 на Go 1.27.2. Старый Debian image имел 87 HIGH/CRITICAL записей; исходный Alpine image — 25 записей для старого Go runtime в gosu. Сам PostgreSQL не патчился. Замена privilege-drop binary проверена настоящим init и restore.
- ClamAV: проверен закреплённый официальный образ; обновление баз сигнатур при эксплуатации остаётся обязательным.

Существующая локальная БД на Debian **не переводилась на Alpine подменой volume**. Она сохранена для продолжения работы. Production Compose использует отдельный `postgres-alpine` volume. [Логическое восстановление](reports/postgres-image-restore.json) в изолированный новый PostgreSQL проверило SHA256 содержимого 14 таблиц и регистронезависимый kk/ru поиск. Это не разрешение подключать старый data directory к другой libc/locale платформе.

## Проверка перед выпуском

Соберите образы из передаваемого commit, затем проверьте каждый точный digest, включая внешние сервисы. Пример:

```powershell
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ziyatai-trivy-cache:/root/.cache aquasec/trivy:0.76.0 image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 ziyatai-web:release
npm audit --audit-level=moderate
```

Не запускайте несколько Trivy процессов с одним файловым cache одновременно: он блокируется. Для JSON отчётов используйте `--format json --output /report/security-COMPONENT-final.json` с mounted `.local:/report`, затем `python scripts/image-security-report.py`. Генератор откажется принимать старый отчёт, если локальный image digest уже изменился, или если один из шести отчётов отсутствует.

До публичной приёмки всё ещё нужны проверка HTTPS/DNS, bucket ACL/CORS/lifecycle, секретов, изоляции сетей и актуальных образов на выбранном сервере. [Локальная проверка proxy](reports/proxy.json) подтверждает маршруты/config, но не внешний TLS или настоящий Netlify proxy. У renderer нет DB/S3/AI credentials, публичного ingress или egress; ограничения CPU/RAM/PID/time остаются частью конфигурации.
