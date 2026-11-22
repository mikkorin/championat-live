// @ts-check
/**
 * Готовит статику для Worker: копирует сайт и включает живой режим API.
 *
 * Исходник сайта лежит в соседнем каталоге championat-pages/site — он же
 * используется для статической версии на GitHub Pages. Здесь в index.html
 * добавляется строка `window.API_BASE = ''`: пустая строка означает «живой
 * API на том же origin», а её отсутствие — «статический снимок».
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, '..', 'championat-pages', 'site');
const PUBLIC = join(ROOT, 'public');

const LIVE_FLAG = '<script>window.API_BASE = "";</script>';

async function main() {
  await rm(PUBLIC, { recursive: true, force: true });
  await mkdir(PUBLIC, { recursive: true });
  await cp(SOURCE, PUBLIC, { recursive: true });

  const indexPath = join(PUBLIC, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  if (html.includes('window.API_BASE')) {
    throw new Error('В index.html уже есть window.API_BASE — флаг добавляется один раз');
  }
  const patched = html.replace(
    '<script src="assets/app.js" defer></script>',
    `${LIVE_FLAG}\n    <script src="assets/app.js" defer></script>`,
  );
  if (patched === html) {
    throw new Error('Не найден тег подключения assets/app.js в index.html');
  }
  await writeFile(indexPath, patched, 'utf8');

  console.log('статика для Worker готова → public/ (живой режим API включён)');
}

main().catch((error) => {
  console.error('Не удалось собрать статику:', error);
  process.exitCode = 1;
});
