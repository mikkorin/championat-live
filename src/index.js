/**
 * Cloudflare Worker: динамическая версия «Хоккей на Чемпионате».
 *
 *   GET /api/matches       список матчей КХЛ
 *   GET /api/match/:id     заголовок матча + текстовая трансляция
 *   GET /api/comments/:id  ветка комментариев
 *
 * Всё остальное отдаётся из статических файлов (привязка ASSETS).
 * Ответы API кэшируются на ребре Cloudflare, поэтому клиент может дёргать
 * сервер каждые 10 секунд, не нагружая championat.com.
 */

import { fetchComments, fetchMatch, fetchMatches, moscowToday } from './championat.js';

const MATCHES_TTL_SEC = 30;
const MATCH_TTL_SEC = 8;
const COMMENTS_TTL_SEC = 8;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'accept, content-type',
};

/** Кэш в пределах инстанса: спасает, пока ответ готовится. */
const memory = new Map();

function memoryGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttlMs) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

function memorySet(key, value, ttlMs) {
  memory.set(key, { at: Date.now(), value, ttlMs });
  if (memory.size > 200) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

/**
 * Отдаёт JSON из кэша ребра; при промахе собирает ответ и кладёт в кэш.
 * @param {Request} request
 * @param {URL} url
 * @param {number} ttlSec
 * @param {() => Promise<unknown>} produce
 * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
 */
async function cachedJson(request, url, ttlSec, produce, ctx) {
  const force = url.searchParams.get('refresh') === '1';
  const keyUrl = new URL(url.toString());
  keyUrl.searchParams.delete('refresh');
  const key = keyUrl.toString();

  if (!force) {
    const hot = memoryGet(key);
    if (hot) return json(hot);

    try {
      const edge = await caches.default.match(key);
      if (edge) {
        const payload = await edge.json();
        memorySet(key, payload, ttlSec * 1000);
        return json(payload);
      }
    } catch {
      /* кэш ребра недоступен — работаем без него */
    }
  }

  const payload = await produce();
  memorySet(key, payload, ttlSec * 1000);

  try {
    const response = new Response(JSON.stringify(payload), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=0, s-maxage=${ttlSec}`,
      },
    });
    ctx.waitUntil(caches.default.put(key, response));
  } catch {
    /* кэш ребра недоступен — это не повод отдавать ошибку */
  }

  return json(payload);
}

async function handleApi(request, url, ctx) {
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/api/matches') {
    return cachedJson(request, url, MATCHES_TTL_SEC, async () => {
      const matches = await fetchMatches();
      return { matches, today: moscowToday(), updatedAt: new Date().toISOString() };
    }, ctx);
  }

  const matchMatch = /^\/api\/match\/(\d+)$/.exec(path);
  if (matchMatch) {
    const id = matchMatch[1];
    return cachedJson(request, url, MATCH_TTL_SEC, async () => {
      const match = await fetchMatch(id);
      return { match, updatedAt: new Date().toISOString() };
    }, ctx);
  }

  const commentsMatch = /^\/api\/comments\/(\d+)$/.exec(path);
  if (commentsMatch) {
    const id = commentsMatch[1];
    return cachedJson(request, url, COMMENTS_TTL_SEC, async () => {
      const comments = await fetchComments(id);
      return {
        ...comments,
        sourceUrl: `https://www.championat.com/hockey/_superleague/tournament/7092/match/${id}/#comments`,
        updatedAt: new Date().toISOString(),
      };
    }, ctx);
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      try {
        return await handleApi(request, url, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
        return json({ error: 'upstream_failed', message }, 502);
      }
    }

    if (!env.ASSETS) {
      return json({ error: 'assets_missing' }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};
