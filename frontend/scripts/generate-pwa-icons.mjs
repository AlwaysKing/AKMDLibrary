// One-shot script: rasterize frontend/public/vite.svg into the PNG icons
// required by the PWA manifest. Run manually after changing the logo.
//
// Usage: node scripts/generate-pwa-icons.mjs
//
// Produces:
//   frontend/public/icons/icon-192.png           (purpose: any)
//   frontend/public/icons/icon-512.png           (purpose: any)
//   frontend/public/icons/icon-512-maskable.png  (purpose: maskable, 80% center + white padding)
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const svgPath = join(publicDir, 'vite.svg');
const iconsDir = join(publicDir, 'icons');
mkdirSync(iconsDir, { recursive: true });

const svgBuf = readFileSync(svgPath);
// density bumped so the rasterized "M" glyph stays crisp at small sizes.
const density = 384;

// Maskable: composite the source at 80% on a 512x512 opaque white canvas,
// leaving ~10% safe-zone padding on all sides per Android maskable spec.
async function bakeMaskable() {
  const inner = await sharp(svgBuf, { density })
    .resize(410, 410, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: inner, gravity: 'center' }])
    .png()
    .toFile(join(iconsDir, 'icon-512-maskable.png'));
}

await sharp(svgBuf, { density }).resize(192, 192).png().toFile(join(iconsDir, 'icon-192.png'));
await sharp(svgBuf, { density }).resize(512, 512).png().toFile(join(iconsDir, 'icon-512.png'));
await bakeMaskable();
console.log('PWA icons generated under frontend/public/icons/');
