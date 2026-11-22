// @ts-check
/**
 * Локальная проверка Worker-обработчика без Cloudflare.
 *
 * Подменяем только платформенные детали (Cache API и привязку ASSETS),
 * сетевые запросы идут настоящие — так видно, дотягивается ли Worker
 * до championat.com и Rambler Comments.
 */

globalThis.caches = {
  default: {
    async match() {
      return undefined;
    },
    async put() {
      /* заглушка */
    },
  },
};

const { default: worker } = await import('../src/index.js');

const ctx = { waitUntil() {} };
const env = {
  ASSETS: {
    async fetch(request) {
      return new Response('static: ' + new URL(request.url).pathname, {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    },
  },
};

async function call(path) {
  const started = Date.now();
  const response = await worker.fetch(new Request(`https://example.test${path}`), env, ctx);
  const text = await response.text();
  console.log(`\n=== ${path} → ${response.status} (${Date.now() - started} мс)`);
  console.log(text.slice(0, 400));
  return response;
}

await call('/api/matches');
await call('/api/match/1316820');
await call('/api/comments/1316820');
await call('/api/unknown');
await call('/some/static/file');
