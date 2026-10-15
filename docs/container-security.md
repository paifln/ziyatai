# Проверка контейнеров

15 октября 2026 года Trivy 0.76.0 проверил окончательные **web, worker, renderer, PostgreSQL, Caddy proxy и ClamAV** образы. В [отчёте](reports/container-security.json) сохраняются точные digests, время, области сканирования и все HIGH/CRITICAL находки, включая unfixed. Blanket ignore и `--ignore-unfixed` не используются. Нулевой результат означает отсутствие известных находок в распознанных пакетах на момент сканирования, а не отсутствие любых уязвимостей или замену pentest.

## Изменения

После переработки 16 октября повторно проверены web (application commit `6dee156`), worker (`b7d2c0d`) и renderer с parser 1.1. Остальные три образа не менялись. Все шесть HIGH/CRITICAL отчётов сверяют точные локальные image IDs. Дополнительный MEDIUM review renderer также повторён; 50 записей для 35 CVE остаются открытыми. При следующем изменении runtime нужна новая сборка и scan.

- Web/worker: минимальный Ubuntu 24.04 runtime и официальный Node LTS 24.22.0. npm отсутствует в runtime. Worker собирается в отдельный bundle; его зависимости дополнительно проверяются `npm audit` по lockfile, поскольку image scanner не восстанавливает каждую библиотеку из JavaScript bundle.
- Renderer: Ubuntu 24.04, закреплённые Python зависимости, PDFium вместо PyMuPDF, обновлённые системные пакеты. Исходная Debian Trixie libxml2 была уязвима для CVE-2026-6653; [Canonical указывает исправление для Ubuntu 24.04](https://ubuntu.com/security/CVE-2026-6653). Уязвимость исправлена сменой/обновлением пакета, а не исключена из отчёта.
- Caddy: стандартные модули версии 2.11.7 пересобраны Go 1.27.2 и `golang.org/x/net` 0.60.0. Исходный официальный образ содержал Go 1.26.8 и четыре HIGH находки. [Go advisory](https://pkg.go.dev/vuln/GO-2026-6609), [официальная сборка Caddy](https://caddyserver.com/docs/build). Go module versions/checksums закреплены в `infra/caddy/`; notices сохраняются в образе.
- PostgreSQL: для **новой production установки** используется официальный PostgreSQL 18.6 Alpine с тем же entrypoint и пересобранным gosu 1.19 на Go 1.27.2. Старый Debian image имел 87 HIGH/CRITICAL записей; исходный Alpine image — 25 записей для старого Go runtime в gosu. Сам PostgreSQL не патчился. Замена privilege-drop binary проверена настоящим init и restore.
- ClamAV: проверен закреплённый официальный образ; обновление баз сигнатур при эксплуатации остаётся обязательным.

Существующая локальная БД на Debian **не переводилась на Alpine подменой volume**. Она сохранена для продолжения работы. Production Compose использует отдельный `postgres-alpine` volume. [Логическое восстановление](reports/postgres-image-restore.json) в изолированный новый PostgreSQL проверило SHA256 содержимого 14 таблиц и регистронезависимый kk/ru поиск. Это не разрешение подключать старый data directory к другой libc/locale платформе.

## Проверка перед выпуском

### Дополнительная проверка renderer

[Расширенный отчёт](reports/renderer-advisories.json) включает MEDIUM: 50 записей для 35 CVE в системных пакетах; HIGH/CRITICAL по классификации Trivy — 0. Для этих 50 записей scanner не указал FixedVersion. Это **не означает**, что upstream исправлений нет, и не является принятием риска.

Например, Ubuntu относит [CVE-2026-88053](https://ubuntu.com/security/CVE-2026-88053) к Medium, а два upstream advisory Tesseract — к High: [ReadNormProtos](https://github.com/tesseract-ocr/tesseract/security/advisories/GHSA-5j2p-r5vc-q7f3), [GenericVector model parsing](https://github.com/tesseract-ocr/tesseract/security/advisories/GHSA-88qp-4g94-3rf3). В них названа версия 5.5.4, но проверка официальных git refs не нашла такого опубликованного тега (последний стабильный — 5.5.3). Подмена версии в отчёте или автоматическая установка несуществующего релиза не выполнялась. Canonical также публикует [USN-8882-1](https://ubuntu.com/security/notices/USN-8882-1); доступность конкретного обновлённого пакета/ESM нужно проверить в выбранном production окружении.

Два названных upstream advisory требуют вредоносных model files. API принимает PDF/DOCX/XLS/XLSX, не `.traineddata`; OCR запускается с фиксированными `kaz+rus` и `--psm 6`. В отчёт записаны SHA256 установленных моделей и фактический readonly rootfs локального renderer. Production renderer изолирован от egress/БД/S3, имеет CPU/RAM/PID/time limits. Эти ограничения уменьшают воздействие, но не исправляют библиотечные CVE и не доказывают недостижимость всех уязвимых путей. До публичной приёмки нужен разбор оставшихся находок и проверенный vendor update/backport либо обоснованное решение владельца эксплуатации.

Повтор дополнительного scan: используйте ту же команду Trivy с `--severity MEDIUM,HIGH,CRITICAL`; для этого прогона не применяют exclusions или `--ignore-unfixed`. Отчёт относится только к указанному renderer digest, не ко всем шести образам.

Соберите образы из передаваемого commit, затем проверьте каждый точный digest, включая внешние сервисы. Пример:

```powershell
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v ziyatai-trivy-cache:/root/.cache aquasec/trivy:0.76.0 image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 ziyatai-web:release
npm audit --audit-level=moderate
```

Не запускайте несколько Trivy процессов с одним файловым cache одновременно: он блокируется. Для JSON отчётов используйте `--format json --output /report/security-COMPONENT-final.json` с mounted `.local:/report`, затем `python scripts/image-security-report.py`. Генератор откажется принимать старый отчёт, если локальный image digest уже изменился, или если один из шести отчётов отсутствует.

До публичной приёмки всё ещё нужны проверка HTTPS/DNS, bucket ACL/CORS/lifecycle, секретов, изоляции сетей и актуальных образов на выбранном сервере. [Локальная проверка proxy](reports/proxy.json) подтверждает маршруты/config, но не внешний TLS или настоящий Netlify proxy. У renderer нет DB/S3/AI credentials, публичного ingress или egress; ограничения CPU/RAM/PID/time остаются частью конфигурации.
