# Интерфейс и бренд

Переработка 15 октября 2026 года: тёплый бумажный фон, графитовый текст, тёмный оливковый акцент и сдержанный коричневый для второстепенных обозначений. Синие и фиолетовые акценты и градиенты не используются. Основной текст набран системным Segoe UI/Arial, крупные заголовки — Georgia. Внешние web fonts, декоративное видео, параллакс и тяжёлые фоновые изображения не загружаются.

Главная задача учителя видна в маршруте «загрузить план → проверить → создать задания». КТП, задания и документы имеют отдельные списки. Поиск истории и библиотеки выполняется на сервере по всему набору, выдача — по 20 материалов. Пустое состояние содержит объяснение и полезное действие. Ошибка сети не сбрасывает правки; переход с несохранённым материалом требует подтверждения.

Мобильное меню закрывается по Escape, удерживает фокус и блокирует фон. Есть skip link, видимый focus, подписи полей, status/alert сообщения, responsive таблица КТП и reduced-motion режим. Проверки доступа и владения не зависят от UI.

## Логотип

За основу взято вложение владельца: симметричная сова с академической шапочкой и схемами. Встроенный **imagegen** удалил круг и градиент, сохранил узнаваемый рисунок и сделал одноцветную версию на прозрачном фоне. Файлы интерфейса: `public/brand-owl.png`, `public/favicon.png`. Размеры для доставки получены из сгенерированного master с сохранением alpha. Старый условный `owl.svg` удалён.

Финальный промпт:

> Edit the attached ZiyatAI owl logo. Preserve the recognizable sophisticated symmetric line-art owl, large round eyes, pointed ear tufts/wings, central beak, academic mortarboard above, and circuit traces linking head to cap. Remove the entire gradient circle and white rounded square background; output genuinely transparent alpha. Recolor ALL visible logo strokes one solid very dark olive #39452e. No blue, purple, gradient, shading, background, text, watermarks or new objects. Center whole mark with tidy narrow safe padding, crisp clean consistent linework, readable at small icon size. This is the project production logo, faithful to the supplied silhouette.

Права на исходный предоставленный знак и итоговую коммерческую айдентику подтверждает владелец. В репозиторий не включены платные шрифты или посторонние стоковые изображения.
