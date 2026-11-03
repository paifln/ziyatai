# Аудит безопасной очистки и архитектуры

Дата: 3 ноября 2026 года. Исходная точка: `ceb88e2ea1b5f25e12a2a011d15c881d66e4ac0d`. Работа изолирована в ветке `codex/project-audit-cleanup`; основной checkout и действующее размещение не изменялись. Исходное рабочее дерево было чистым, его восстановимая копия — исходный Git-коммит и отдельный worktree.

## 1. Резюме

Здоровье проекта: **7/10** — инженерная оценка сопровождаемости, а не сертификат безопасности. Исходники компактны: 421 отслеживаемый файл, 3 009 209 байт; пустых файлов, побайтовых дубликатов и отслеживаемых игнорируемых артефактов не обнаружено. Рабочие зависимости подтверждаются импортами, сборкой и обычным Knip; оснований массово удалять пакеты нет. Основной долг сосредоточен в крупных файлах API, редакторов, worker и Lite, а также в зависимости worker от каталога web. Полный сценарий обработки документов и значительная часть E2E не входят в текущую интеграционную CI-проверку. Безопасная очистка на этом этапе — улучшение проверок, устранение доказанно недостижимого условия и исправление устаревшей документации; спорные скрипты, CSS, миграции и локальные данные сохранены.

### Что проверено и где заканчивается доказательство

- Рассмотрены Git-файлы, npm scripts, Next.js App Router/proxy, динамические импорты UI, Python adapters, Dockerfiles, Compose, Netlify plugin, Railway template, CI, тесты, HTML/CSS и локальные Markdown-ссылки.
- Ключевые динамические связи: `next/dynamic` в `Workspace.tsx`; `readdir("migrations")` в migration/bootstrap runners; `subprocess` и пути `/scripts/*.py` в renderer; ES5 global exports и `<script src>` в Lite; runtime import `.next/standalone/server.js`. Это не мёртвый код.
- У 1515 текстовых blob-объектов всех доступных на исходном этапе локальных refs не найдено совпадений с существующим детектором секретов проекта. Проверка ограничена его regex, текстовыми blob до 2 МБ и локально доступной историей; не доказывает отсутствия неизвестных форматов ключей, секретов в удалённых refs, CI secrets, контейнерах, логах или резервных копиях.
- `git ls-files -ci --exclude-standard`: пусто. Размер Git pack на исходном checkout — около 3,08 МиБ, garbage — 0. Самый большой текущий файл — `package-lock.json` (217 433 байта); самый большой бинарный fixture — 99 387 байт. Переход на Git LFS ради этих размеров не обоснован.
- Все 44 найденных ключа Zod env schema представлены в `.env.example` и имеют строковые использования за пределами `env.ts`. Это сверка имён, не проверка значений окружения или условий конкретного deployment.
- Все обнаруженные файловые цели корневых npm scripts существуют; единственный workflow использует актуальные пути. Исходные локальные ветки имели коммиты от 3 ноября, поэтому оснований объявлять их устаревшими по возрасту нет; удалённые ветки и внешние CI jobs не проверялись.
- Корневой lockfile и `.railway/package-lock.json` принадлежат разным `package.json`. Это не конфликт package managers. Python requirements и lockfile также имеют разные роли.
- `.gitattributes` задаёт LF, Prettier настроен; `.editorconfig` отсутствует. Это необязательное улучшение настроек редактора, а не основание менять весь формат исходников.
- Внешние ручные вызовы скриптов, сохранённые URL, сторонние API-клиенты и настройки панелей хостинга нельзя опровергнуть локальным `rg`. Поэтому отсутствие ссылки в Git само по себе не разрешает удаление.

## 2. Кандидаты и решения

Уверенность ниже означает уверенность в избыточности, а не вероятность того, что поиск выполнился. Ни один объект со статусом «ручная проверка» не удалён.

| № | Что | Тип | Доказательство | Уверенность | Риск | Проверка перед удалением / решение |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Повторный `if (schema === "public")` в `scripts/runtime/migrate.ts` перед REVOKE | Недостижимая ветка | `schema` — локальный `const`; такая же проверка уже выбрасывает ошибку до цикла миграций; переприсваивания нет | Высокая | Низкий | Удалена только повторная ветка. Первый запрет `public`, SQL, последовательность и checksum миграций сохранены. Миграции не запускались |
| 2 | `scripts/checks/document-check.py` | Возможный устаревший manual helper | Ожидает `.local/qa/full.docx` и `student.docx`; в Git не найден их актуальный producer; новый Supabase smoke пишет `supabase-student.*` | Средняя | Средний: проверка печати и шрифтов | Найти внешний/manual producer и владельца. Пока сохранить; заменить на параметризованный input только отдельной задачей |
| 3 | `scripts/checks/image-security-report.py` | Возможный старый процесс отчётности | Читает фиксированные `.local/security-*-final.json`; выполняет полезную проверку image digest, но вызов/producer сканов не описан в текущем CI | Средняя | Высокий: потеря security-проверки | Уточнить процедуру Trivy и владельца; документировать либо заменить, не удалять по нулю imports |
| 4 | 17 manual scripts из списка ниже | Неподключённые операционные точки входа | На baseline нет входящих ссылок по имени файла или extensionless import; `scripts/**` объявлены entry в Knip | Низкая | Средний/высокий: некоторые вызывают AI, меняют данные или тестируют аварии | Ручная проверка назначения, запусков из терминала и внешнего CI; добавить реестр с режимом local/cloud/paid |
| 5 | 16 уникальных CSS-классов без буквальной ссылки | Возможные остатки прежнего UI | Лексический поиск в TS/TSX/JS/HTML/tests не находит имён; имеется динамическая генерация других классов | Средняя | Средний: темы, responsive, состояния | Coverage React + Lite, все темы/ширины/ошибки, safelist динамических классов; пока не удалять |
| 6 | `.local/`, `.next/`, `.netlify/`, `dist/`, reports, caches, старые volumes основного checkout | Локальные артефакты, не Git-мусор | Исключены Git; `.local/` содержит также действующие env, deploy metadata, snapshots и backups | Низкая для удаления целиком | Высокий: потеря ключей/данных/воспроизводимости | Отдельная инвентаризация по назначению и retention; никаких recursive deletes и `down -v` |
| 7 | Старые `session`, `account`, `verification`, `rateLimit` из миграции 001 | Возможный legacy schema после Supabase | Auth теперь в `apps/web/lib/auth/`; старая история используется bootstrap/copy runners и ссылками данных | Низкая | Высокий | Не удалять применённые миграции. Если нужны DROP — отдельная новая миграция после анализа FK, данных, backups и rollback |
| 8 | `verifyNetlifyRequest`, `sniffFile`, `gradeFromLabel`, `createReadinessProbe` и другие test seams | Ложный production-only сигнал | Экспорты используются тестами или scripts; обычный Knip их не считает мёртвыми | Низкая | Средний: потеря проверяемости | Сохранены. Production dependency gate намеренно не удаляет exports, используемые тестами |
| 9 | Next.js `page/layout/error/route` exports, Playwright `global-setup`, Lite generated JS | Framework/generated API | Файловые соглашения Next.js, Playwright config и `build-lite.mjs`/HTML `<script>` | Отсутствует | Высокий | Не кандидаты. `--include-entry-exports` показывает ложные сигналы; не применять `--fix` |
| 10 | 10 runtime dependencies, помеченные прежним `knip --production` | Ошибка конфигурации анализа | Старый config не маркировал production patterns `!`; импорты S3/Supabase/pg/docx/openai существуют | Отсутствует | Высокий | Исправлены точки входа и введена отдельная production-проверка. Пакеты сохранены |

### Ручные скрипты без найденного входящего вызова

`scripts/checks/`: `ai-eval.ts`, `antivirus-check.ts`, `check-openai.ts`, `check-renderer-boundary.ts`, `delete-snapshot-check.ts`, `document-check.py`, `draft-performance-check.mjs`, `export-lease-isolation-check.ts`, `image-security-report.py`, `lease-recovery-check.ts`, `live-ai-smoke.ts`, `live-subject-check.ts`, `parser-report.py`, `quarantine-sweep-check.ts`, `queue-check.ts`, `upload-cleanup-check.ts`; также `scripts/dev/create-eval-corpus.ts`.

`plan-grades.ts`, `deployment-config.ts`, `migration-config.ts`, `create-only-upload.ts` **не входят**: обнаружены extensionless imports в runner/test modules. Каталог `.local/ai-eval` в corpus generator, наоборот, не является импортом `ai-eval.ts`. Эти примеры показывают, почему поиска полного имени или любого совпадения basename недостаточно.

### CSS, требующий покрытия состояний

- `app/globals.css`: `demo-link`, `dot-0`, `dot-1`, `dot-2`, `empty-icon`, `mail-preview-note`.
- `app/landing.css`: `example-answer`, `example-copy`, `example-levels`, `example-paper`, `example-paper-head`, `example-task`, `landing-example`.
- `app/theme.css`: `empty-icon`, `job-item`, `version-list`.
- `public/lite/lite.css`: `header-actions`, `mail-preview-note`.

Это 18 файловых наблюдений, 16 уникальных имён. Динамические примеры: `accent-${i}` в Landing, `review-level ${task.level}` в TaskReview, состояния sidebar/dropzone. Их и остальные состояния нельзя вырезать PurgeCSS без анализа.

### Повторяемые команды доказательства

```powershell
git ls-files -ci --exclude-standard
npm run check:repository -- --history
rg -n 'document-check|full\.docx|student\.docx|supabase-student' scripts tests docs .github
rg -n 'security-web-final|security-.*-final|image-security-report' scripts docs .github
rg -n 'create-only-upload|migration-config|deployment-config|plan-grades' scripts tests
rg -n 'next/dynamic|import\(|require\(|readdir\(|importlib|subprocess' app apps packages scripts infra
rg -n 'demo-link|dot-[012]|empty-icon|mail-preview-note|example-paper|landing-example|job-item|version-list|header-actions' app apps public tests
```

`repository-audit.py` — read-only инвентаризация tracked files. Выводит подсказки о ссылках, а не разрешения на удаление; записывает только отчёт внутри `.local/`. Работает с Python standard library. `--history` не печатает найденные значения секретов.

## 3. Структура: было → цель

Уже выполненное разделение `scripts/` полезно; повторный перенос скриптов в ещё одну иерархию не нужен. Next.js `app/`, `public/`, `proxy.ts` сохраняются на месте.

```text
Сейчас                              Эволюционная цель
app/                                app/                    # маршруты Next.js
apps/web/components/                apps/web/features/
  Workspace.tsx                       workspace/
  PlanReview.tsx                      plans/
  GenerationEditor.tsx                generations/
  forms/, plans/, generations/        account/
  ui/                               apps/web/ui/            # только UI primitives
apps/web/lib/                       apps/web/client/         # hooks, transport
  api.ts                            server/http/             # маршрутизация, HTTP
  db.ts, storage.ts, queue.ts        server/infrastructure/   # pg, S3, queue adapters
  auth/, budgets, renderer          server/auth/, application/
apps/worker/index.ts                apps/worker/
                                      runtime.ts
                                      jobs/{import,generate,export,delete}.ts
apps/renderer/                      apps/renderer/           # отдельный процесс
packages/domain/                    packages/domain/         # предметные правила
packages/contracts/index.ts         packages/contracts/      # план/генерация/экспорт
packages/document-renderer/         packages/document-renderer/
scripts/{build,checks,...}/         scripts/{build,checks,...}/
tests/{browser,e2e,parser,...}/      tests/ + точечная colocation в будущих фичах
migrations/                        migrations/              # неизменяемая история
.railway/                          .railway/                # отдельный tool project
```

Направление: HTTP/UI → application → domain/contracts; infrastructure реализует потребности application. Worker и web используют общий `server/`, а не импортируют друг друга. `packages/domain` не должен знать Next.js, Supabase, pg или React. Не требуется вводить Nx/Turborepo, отдельный package.json для каждой папки или общий barrel для всего `server/`.

## 4. Карта возможных переносов

**Эта таблица — план, переносы не выполнены.** Один тип зависимости/feature за коммит; старые import paths можно временно оставить как explicit re-export adapters, затем удалить после поиска всех потребителей.

| Откуда | Куда | Зачем | Обновить |
| --- | --- | --- | --- |
| `apps/web/lib/{db,database-connection,storage,queue,renderer,clamav,antivirus,files}.ts` | `server/infrastructure/{database,storage,queue,documents,antivirus}/` | Worker перестаёт зависеть от web | Web, worker, checks, test mocks, `check-client-boundary`, Docker/worker bundle |
| `apps/web/lib/auth/` | `server/auth/` | Явная server-only граница | auth route, API, worker admin imports, tests, secret boundary check |
| Ветки `apps/web/lib/api.ts` | `server/http/routes/{plans,generations,exports,uploads,account}.ts` | Один HTTP-handler на ресурс, общая ownership/transaction политика | catch-all route, API allowlist, API tests, budgets/CSRF/error mapping |
| SQL и сценарии из API | `server/application/{plans,generations,exports}/` и небольшие repositories | Отделить HTTP от транзакционных сценариев | Route handlers, worker, integration tests; транзакцию не дробить |
| `apps/web/components/PlanReview.tsx` и связанные UI | `apps/web/features/plans/` | Colocation просмотра, таблиц, подтверждения | dynamic imports Workspace, CSV/schedule/readiness imports, mocks, CSS |
| `GenerationEditor.tsx` и `components/generations/` | `apps/web/features/generations/` | Отделить загрузку, редактирование, approval и preview | Workspace dynamic import, drafts/revision helpers, export UI tests |
| `apps/web/lib/use-*.ts`, `account-client.tsx`, `client.ts` | `apps/web/client/` | Не смешивать браузерные hooks с секретными адаптерами | Все UI imports, тесты, browser entry graph |
| Обработчики из `apps/worker/index.ts` | `apps/worker/jobs/*.ts` | Разделить job logic и polling/heartbeat runtime | Worker entry, fencing/lease tests, renderer requests, bundler |
| Секции `app/globals.css` | `features/*/*.css` либо CSS Modules постепенно | Ограничить глобальные пересечения | App imports, React selectors, browser snapshots; Lite CSS отдельно |
| Крупный `packages/contracts/index.ts` | `contracts/{plans,generations,exports,profile}.ts` | Явные контракты и меньше связности | API, worker, UI, Zod format генерации, тесты; сначала сохранить совместимый index |

## 5. Архитектурные проблемы

| № | Проблема / доказательство | Где | Последствие | Исправление | Сложность |
| --- | --- | --- | --- | --- | --- |
| 1 | HTTP, SQL, quota, ownership и business transitions в одном файле, около 1321 строки | `apps/web/lib/api.ts` | Изменение одного ресурса затрагивает весь API; сложнее проверять транзакции | Извлекать handlers, затем application services, сохраняя атомарность | Высокая |
| 2 | Около 1386 и 1334 строк, несколько независимых редакторских сценариев | `GenerationEditor.tsx`, `PlanReview.tsx` | Большая цена изменения состояния/черновиков/конфликтов | Сначала hooks по сценариям, затем feature UI; не менять state model одновременно | Средняя/высокая |
| 3 | Около 735 строк и множество состояний/динамических imports | `Workspace.tsx` | Navigation/session orchestration смешаны с содержимым | Отделить shell, navigation и resource controllers | Средняя |
| 4 | Worker импортирует `../web/lib/db`, `storage`, `files`, `auth/admin`, budgets/adapters | `apps/worker/index.ts` | Серверная инфраструктура логически принадлежит web, хотя нужна нескольким процессам | Общий `server/infrastructure`; не переносить UI туда | Средняя |
| 5 | Polling, cleanup, lease и четыре job handlers, около 682 строк | `apps/worker/index.ts` | Риск сломать fencing/отмену при изменении одного handler | Runtime + jobs; contract tests для lease/token/cancellation | Средняя/высокая |
| 6 | 2552 строки hand-written ES5 плюс отдельные transport/draft механизмы | `public/lite/lite.js` | Два UI-клиента могут расходиться | Сохранять ES5 output; сначала извлекать чистые общие правила по примеру generated merge/goals | Высокая |
| 7 | 2742 строки global CSS; стили темы пересекают feature-классы | `app/globals.css`, `theme.css` | Неявная связанность, риск визуальной регрессии | Токены + UI primitives + локальные feature styles малыми порциями | Средняя |
| 8 | `no-explicit-any` отключён; TypeScript strict при этом включён | ESLint, API/worker/editor data | Типы payload/query results обходят часть strict гарантий | Типизировать boundaries и query rows по мере выделения функций | Средняя |
| 9 | Обычный Knip считает все scripts entry, production mode раньше терял roots | `knip.json` | Ложное ощущение полной проверки и ложные unused dependencies | Production roots исправлены; manual scripts учитывать реестром отдельно | Низкая; первая часть выполнена |
| 10 | CI integration проверяет local Supabase/auth/несколько DB checks, но не весь import→scan→render | `.github/workflows/ci.yml`, `tests/e2e/global-setup.ts` | Большой набор E2E может стареть незаметно | Отдельный local integration job с renderer/ClamAV/storage и synthetic fixture-export | Средняя/высокая |
| 11 | Операционные scripts не имеют актуального реестра; часть требует внешних артефактов | `scripts/checks/` | Непонятно, что безопасно запускать и что устарело | Для каждого указать owner, вход, side effects, local-only/cloud/paid | Низкая/средняя |
| 12 | Private schema RLS включён, доступ anon/authenticated отозван; ownership enforcement находится в сервере | migration runner, auth identity, `owned()` | Привилегированное DB-соединение требует дисциплины tenant checks | Проверить отдельную runtime DB-role и интеграционные cross-owner tests; не добавлять RLS policies наугад | Высокая; только предложение |

Циклы TS/JS, разрешаемые текущим Knip, не обнаружены. Это не анализ семантических циклов SQL/Python/HTTP и не доказательство отсутствия runtime-зависимостей. В runtime `console.log`/`print` найдены структурированные worker logs и JSON CLI protocol; они не удалены как «debug». TODO/FIXME/HACK/debugger в рассмотренном runtime-поиске не выявлены.

## 6. Безопасные этапы и откат

| Этап | Действия | Проверка | Откат |
| --- | --- | --- | --- |
| 0, выполнен | Чистый baseline commit, отдельные worktree/ветка, inventory | Git status, baseline checks, history/source scan | Вернуться к исходному checkout; не трогать `.local` и cloud |
| 1, выполнен | Read-only `repository-audit.py`, production roots Knip, CI dependency gate | lint, typecheck, unit, web build, worker build; Knip оба режима | `git revert 87fc490` |
| 2, выполнен в этой ветке | Удалить только повторный недостижимый schema guard; исправить устаревший статус Railway; сохранить этот отчёт | Те же проверки; SQL/migration files не меняются, cloud/DB jobs не запускаются | Revert отдельного второго коммита; БД не восстанавливать |
| 3, план | Разобрать manual scripts, согласовать retention `.local`; завести реестр проверок | Входящие ссылки, реальный producer, локальная интеграция; paid tests только отдельно | Revert изменений исходников; удалённые личные файлы восстанавливать только из заранее проверенного backup |
| 4, план | Выделить общую server infrastructure без изменения API | Оба процесса собираются, client-boundary, полный local integration | Revert коммита переносов; compatibility imports на переходный период |
| 5, план | По одному ресурсу извлекать API и worker jobs | Ownership, idempotency, transaction rollback, lease/cancellation, synthetic end-to-end | Revert одного handler extraction; schema не менять тем же коммитом |
| 6, план | Разделить редакторы и CSS по фичам | RU/KK, React/Lite, темы, mobile/desktop, offline/session/conflict/approval states | Revert одного feature/style коммита |

Перед **каждым** изменяющим этапом: отдельная ветка или чистый коммит, проверенная резервная копия затрагиваемых данных. Не выполнять `git reset --hard`, `git clean -xfd`, удаление томов или rewrite истории ради этого аудита.

Проверки этапа:

```powershell
npm run check:source
npm run check:client
npm run check:unused
npm run check:unused:production
npm run lint
npm run typecheck
npm test
npm run test:parser
npm run test:security
npm run test:browser
npm run build
npm run build:worker
git diff --check
```

Публикация и `npm run migrate` в этот список намеренно не входят: это операции над окружением, а не безопасная локальная проверка очистки. Полный `test:e2e` запускать с отдельными local Supabase, renderer, ClamAV и storage; не направлять тесты с записью в действующие аккаунты.

## 7. Инструменты и границы автоматизации

Уже доступны и использованы: Knip 6.44.1, ESLint, TypeScript, Vitest, Playwright, pytest, project secret scanner, `git ls-files`, `git count-objects`, read-only inventory/history scan. `npm audit` на момент проверки: 0 vulnerabilities. `npm outdated` обнаружил новые версии, например Next 16.4.5 при текущем 16.4.3 и TypeScript 7.0.2 при текущем 6.0.3; это не означает, что текущий пакет лишний или что major upgrade безопасен.

```powershell
npm run check:repository -- --history
node node_modules/knip/bin/knip.js --cycles
node node_modules/knip/bin/knip.js --production --reporter json
node node_modules/knip/bin/knip.js --include-entry-exports --reporter json
npm outdated
npm audit --audit-level=moderate
python scripts/checks/scan-secrets.py
git count-objects -vH
git ls-files -ci --exclude-standard
```

Два последних Knip-режима — диагностические: test seams и framework exports не удалять по их выводу. Явный worker production root может давать informational hint о дублировании в обычном режиме, поскольку npm `worker` уже известен плагину; для production он нужен отдельно.

Дополнительные инструменты **не установлены и не запускались**. При необходимости сначала выбрать и закрепить версии в отдельной ветке/изолированной среде:

- `madge --circular --extensions ts,tsx --ts-config tsconfig.json app apps packages` — независимый статический граф; учитывать unresolved/dynamic imports. Текущий Knip уже поддерживает `--cycles`.
- `python -m vulture apps scripts --min-confidence 100` — Python-кандидаты; HTTP methods (`do_POST`), CLI, importlib и subprocess entrypoints сохранять, whitelist проверять вручную.
- PurgeCSS — только отчёт `rejected` с safelist для динамики; не включать auto-delete в build до browser coverage. DevTools coverage — дополнение, один сеанс не покрывает все состояния.
- `depcheck`, `ts-prune`, `unimported` — только второе мнение, не источник удаления; Knip уже покрывает основную задачу. Сам [depcheck сообщает об отсутствии активного сопровождения и рекомендует Knip](https://github.com/depcheck/depcheck). Не добавлять три дублирующих обязательных scanner-зависимости.
- `eslint-plugin-unused-imports` — необязателен: текущий ESLint/TypeScript уже проверяют часть этих случаев; массовый autofix сначала на diff.
- `git-sizer` и системный `du`/аналог — для будущего роста истории. Сейчас LFS и чистка pack не оправданы размером.
- Gitleaks/TruffleHog с закреплённой версией и redaction — более широкий независимый history scan; перед выводом секреты редактировать. Regex проекта не заменяет такой аудит.

Документация инструментов: [Knip production patterns](https://knip.dev/features/production-mode), [Knip configuration](https://knip.dev/reference/configuration), [Vulture](https://github.com/jendrikseipp/vulture), [PurgeCSS safelist](https://purgecss.com/safelisting).

## 8. Решения человека

1. Нужны ли старые ручные проверки и кто их запускает вне Git/CI? Без ответа их нельзя объявлять мёртвыми.
2. Каким старым API URL пользуются сохранённые ссылки и внешние клиенты? Для удаления нужны compatibility/deprecation сроки.
3. Нужен ли Lite с текущим уровнем совместимости? До решения сохраняются ES5, отдельные HTML/JS и генерируемые helpers.
4. Что хранить в `.local`, backups и старых Docker volumes и сколько времени? Доступность backup подтвердить до удаления источника.
5. Нужна ли миграция удаления legacy auth tables и какая роль PostgreSQL используется runtime? Требуется отдельная проверка действующей БД, не выполнявшаяся здесь.
6. Какие E2E должны стать обязательными до апробации и кто оплачивает реальные AI-проверки? Не запускать их скрыто из обычного test pipeline.
7. Когда переносить `server/` и редакторы? Сначала согласовать один ресурс/feature; не переносить всю базу сразу.

## 9. Итоговый чек-лист

| Раздел | Статус | Основание |
| --- | --- | --- |
| Дубликаты, пустые, tracked caches/артефакты | ✅ | Не найдены в baseline Git tree |
| Неиспользуемые ассеты | ✅ / ⚠️ | У всех public files есть строковые ссылки; browser runtime не покрыт исчерпывающе |
| Мёртвые TS/JS modules/dependencies | ✅ / ⚠️ | Обычный Knip зелёный; manual scripts и динамика требуют контекста |
| Недостижимая ветка | ✅ | Удалён повторный guard; первая защита и SQL сохранены |
| CSS и Python dead code | ⚠️ | Кандидаты без удаления; Vulture/PurgeCSS не запускались |
| Версии и supply chain | ✅ / ⚠️ | npm audit 0; обновления существуют, не применялись |
| Env/schema/config/lockfiles | ✅ / ⚠️ | 44/44 ключа представлены; values и remote settings не проверялись |
| Секреты в Git/истории | ⚠️ | Совпадений detector не найдено; ограниченный scope, не гарантия |
| Большие бинарники/LFS | ✅ | Текущий Git tree около 3 МБ, binary fixtures менее 100 КБ |
| Markdown-ссылки | ✅ | Отсутствующих локальных целей на baseline не найдено; внешние URL исчерпывающе не проверялись |
| Актуальность architecture/deploy docs | ✅ / ⚠️ | Исправлено противоречие Railway/ноутбук; live deployment в этом аудите не проверялся |
| Однонаправленные границы | ⚠️ | JS/TS cycles не найдены, но worker зависит от web/lib |
| Размер модулей/смешение ответственностей | ❌ | API, редакторы, worker, Lite и global CSS требуют поэтапного разделения |
| Стиль/типы | ✅ / ⚠️ | strict TS и lint проходят; `any` разрешён, Python style неоднороден |
| Тесты и CI | ✅ / ⚠️ | 300 unit, 60 parser, 51 security + 3 skipped, 17 browser; полный E2E/cloud не запускался |
| Безопасность очистки | ✅ | Нет массовых удалений, переноса DB, rewrite истории, cloud/deploy действий |

Отчёты машинных проверок лежат в `.local/reports/` этого worktree. При воспроизведении число tracked files и history blobs изменится из-за новых коммитов; baseline-числа выше относятся к исходному `ceb88e2`.
