/**
 * Renders the app icon from its drawing.
 *
 * The home-screen icon used to be the text "4→5" on a purple square, which
 * said what the app was about and nothing about what it was. This draws a
 * controller instead, because that is what somebody recognises on a home
 * screen at 60 pixels without reading anything.
 *
 * It is a drawing, not PlayStation's mark. Sony's logo and its four face-
 * button glyphs are trademarks and are not reproduced here: a controller
 * silhouette is an ordinary object, it survives being shrunk, and it was
 * the alternative asked for.
 *
 * The source of truth is icon.svg next to this file, and these PNGs are
 * built from it, so the icon can be changed by editing a drawing rather
 * than by opening an image editor on four files. The maskable variant is
 * the same drawing with the rounded corners taken off, because Android
 * applies its own mask and a pre-rounded square gets rounded twice; the
 * controller sits inside the safe circle either way.
 *
 * Chromium does the rendering, through Playwright, which is already how the
 * smoke suite drives the app. Neither is a dependency of this project and
 * neither should become one for a script that runs by hand.
 *
 *   node scripts/icon/render.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    try {
      const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
      return await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);
    } catch {
      console.error('This needs playwright. Install it globally (npm i -g playwright).');
      process.exit(1);
    }
  }
}

const { chromium } = await loadPlaywright();
const here = new URL('.', import.meta.url);
const out = new URL('../../public/', import.meta.url).pathname;
const drawing = readFileSync(new URL('icon.svg', here), 'utf8');

/* Android masks the icon itself, so the maskable copy must be full bleed. */
const maskable = drawing.replace('rx="112" fill="url(#bg)"', 'fill="url(#bg)"');
if (maskable === drawing) {
  console.error('icon.svg no longer has the rounded plate the maskable copy strips.');
  process.exit(1);
}

const jobs = [
  [drawing, 'icon-512.png', 512],
  [drawing, 'icon-192.png', 192],
  [drawing, 'icon-180.png', 180],
  [maskable, 'icon-512-maskable.png', 512],
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });
for (const [svg, name, size] of jobs) {
  // deviceScaleFactor 1: these are icons at an exact pixel size, not
  // screenshots somebody will look at, so a 2x render would be the wrong
  // size rather than a sharper one.
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden}
     svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    { waitUntil: 'load' },
  );
  await page.screenshot({ path: join(out, name), omitBackground: true });
  await page.close();
  console.log(`${name.padEnd(24)} ${size}x${size}`);
}
await browser.close();
console.log('\npublic/favicon.svg is drawn separately: at 16 pixels the');
console.log('d-pad and buttons turn to mush, so it keeps only the sticks.');
