// Generates PNG app icons from public/favicon.svg for PWA install.
// Run: npm run gen:icons   (requires the `sharp` dev dependency)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');
const svg = readFileSync(join(pub, 'favicon.svg'));

// Composite the multi-color logo, centered, onto a solid square so the result
// works as a maskable icon (logo kept inside the safe zone) and on iOS.
async function makeIcon(size, logoRatio, out, bg = '#ffffff') {
  const logoSize = Math.round(size * logoRatio);
  const logo = await sharp(svg, { density: 384 })
    .resize(logoSize, logoSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const offset = Math.round((size - logoSize) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, top: offset, left: offset }])
    .png()
    .toFile(join(pub, out));
  console.log('wrote', out, `(${size}px)`);
}

await makeIcon(192, 0.64, 'icon-192.png');
await makeIcon(512, 0.64, 'icon-512.png');
await makeIcon(180, 0.72, 'apple-touch-icon.png');
console.log('done');
