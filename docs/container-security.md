# Проверка контейнеров

15 октября 2026 года Trivy 0.76.0 проверил образы web, worker и renderer. npm audit проекта отдельно показывает 0 известных package vulnerabilities; это не заменяет OS/container scan.

Исходный Node Bookworm образ содержал 14 исправимых HIGH/CRITICAL находок, включая perl-base и зависимости поставляемого npm. Системные пакеты обновлены, npm/npx удалены из рабочих образов. Исходный renderer на Bookworm содержал дополнительные системные находки. Runtime переведён на Debian 13 Trixie; builder остаётся Node 24.21.0 Bookworm. GLib/SQLite и другие исправимые пакеты обновлены. Python зависимости закреплены в requirements.lock.txt.

[Сводный отчёт](reports/container-security.json) сохраняет raw HIGH/CRITICAL, включая unfixed записи. Уязвимости не скрываются через blanket ignore. Для production нужны повторный скан точных image digests и подтверждение анализа доступности уязвимого кода.

## Оставшаяся libxml2 находка

[Debian tracker CVE-2026-6653](https://security-tracker.debian.org/tracker/CVE-2026-6653) отмечает системную libxml2 Trixie как vulnerable/no-dsa. Речь об internal DTD subset и entity handling. Python lxml в используемом wheel имеет libxml2 2.14.6; системная libxml2 приходит с LibreOffice.

На границе source OOXML **до XML parser** запрещены DOCTYPE/ENTITY, в том числе UTF-8/UTF-16/UTF-32 и варианты без BOM. Это проверено дополнительными тремя негативными pytest cases. Внешние relationships, макросы и embedded objects отвергаются. LibreOffice получает только DOCX, построенный сервером из ограниченного AST, с экранированным текстом; произвольный исходный XML учителя не передаётся ему для экспорта. Renderer не имеет DB/S3/OpenAI credentials, egress или публичного ingress и ограничен CPU/RAM/PID/time.

Эти условия снижают доступность указанного пути, но **не означают исправление системной библиотеки или независимый pentest**. Findings остаются в отчёте. Production security gate требует подтверждённого patched/maintained образа либо независимого заключения о достижимости и принятой mitigation; публичный запуск не объявляется завершённым до этого решения.

Для CVE-2023-45853 на старом Bookworm [Debian указывает](https://security-tracker.debian.org/tracker/CVE-2023-45853), что уязвимый contrib/minizip не собирался в соответствующий бинарный zlib package. После смены runtime на Trixie эта исходная находка не является основанием скрывать другие CVE.
