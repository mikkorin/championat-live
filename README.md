# Хоккей на Чемпионате — динамическая версия

Cloudflare Worker, который отдаёт сайт и живые данные championat.com.

**Прод:** <https://championat-live.mikkorin.workers.dev>

Статическая версия (снимок данных, обновляется по cron GitHub Actions) живёт
отдельно: <https://mikkorin.github.io/> — исходники в репозитории
`mikkorin.github.io`, общий код сайта берётся из `championat-pages/site`.

## Маршруты

| Маршрут               | Ответ                                                             |
| --------------------- | ----------------------------------------------------------------- |
| `GET /api/matches`     | `{ matches, today, updatedAt }` — список матчей КХЛ                |
| `GET /api/match/:id`   | `{ match: { status, score, url, broadcast, preview }, updatedAt }`  |
| `GET /api/comments/:id`| `{ roots, total, sourceUrl, updatedAt }` — комментарии              |
| всё остальное         | статика из `public/` (привязка `ASSETS`)                           |

Параметр `?refresh=1` заставляет Worker не брать ответ из кэша.

## Почему Worker, а не GitHub Pages

Pages умеет только статику, а championat.com не отдаёт CORS-заголовки, и Rambler
Comments API принимает запросы только с `Origin: championat.com`. То есть
браузер не может ходить туда напрямую — нужен серверный посредник. Worker
выполняет запросы сам (без заголовка Origin) и отдаёт результат с
`Access-Control-Allow-Origin: *`.

## Бесплатный тариф Cloudflare

- 100 000 запросов в сутки.
- 10 мс CPU на запрос. Парсинг HTML championat.com занимает ~1.5 мс,
  основное время уходит на ожидание сети (в CPU не засчитывается).
- Карта не требуется.

Один пользователь с интервалом 10 секунд — это ~8 600 запросов в сутки на все
три маршрута. Запас есть на десятки одновременных пользователей.

## Кэширование

Ответы кладутся в кэш ребра Cloudflare (`caches.default`) с `s-maxage`:

- список матчей — 30 секунд,
- трансляция и комментарии — 8 секунд (короче минимального клиентского
  интервала в 10 секунд, иначе кэш скрывал бы обновления).

Дополнительно есть кэш в памяти инстанса.

## Разработка

```bash
npm install
npm run build     # готовит public/ из ../championat-pages/site
npm run dev       # локальный запуск в workerd
npm run deploy    # публикация на workers.dev
```

`scripts/build-site.mjs` копирует общий исходник сайта и добавляет в
`index.html` строку `window.API_BASE = ""` — она переключает клиент на живой
режим API на том же origin.

`scripts/test-worker.mjs` прогоняет все маршруты локально в Node (платформенные
детали подменяются заглушками, сеть настоящая) — удобно проверять разбор
страниц без деплоя.

## Парсер championat.com

`src/championat.js` — копия парсера из Mini App и из
`championat-pages/scripts/championat.mjs`, но HTTP-слой переписан на глобальный
`fetch` (в Workers нет `node:http`). При изменении правил разбора страниц
правки нужно переносить во все три места.
