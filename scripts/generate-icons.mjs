import sharp from "sharp";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public", "logo-dev.svg");
const out = path.join(root, "public", "icons");

const background = "#0f172a";

/** Raster density used to measure the artwork. At 72 DPI, 1 SVG unit = 1 px. */
const DENSITY = 300;
const PX_PER_UNIT = DENSITY / 72;

/** Favicon tile: 64x64 units, rounded corners, logo padded like the PWA icons. */
const FAVICON_SIZE = 64;
const FAVICON_PADDING = 0.12;
const FAVICON_RADIUS = 14;
const ICO_SIZES = [16, 32, 48];

async function renderLogo() {
  const { data, info } = await sharp(src, { density: DENSITY })
    .ensureAlpha()
    .trim()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

/**
 * Measure the artwork's bounding box in SVG user units by scanning a high-res
 * render. Do NOT use sharp's trimOffset* metadata here: libvips reports bogus
 * negative offsets for this SVG, which put the logo off-center in the tile.
 */
async function artworkBounds(innerSvg) {
  const measureSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 297 297" width="297" height="297" overflow="visible" style="fill-rule:evenodd;clip-rule:evenodd;stroke-miterlimit:10;">${innerSvg}</svg>`;

  const { data, info } = await sharp(Buffer.from(measureSvg), { density: DENSITY })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("no artwork found in logo render");

  const toUnits = (px) => px / PX_PER_UNIT;
  return {
    left: toUnits(minX),
    top: toUnits(minY),
    width: toUnits(maxX - minX + 1),
    height: toUnits(maxY - minY + 1),
  };
}

async function composite(logo, size, paddingRatio) {
  const padding = size * paddingRatio;
  const inner = size - padding * 2;

  const layer = sharp(logo.data, { raw: logo.info })
    .resize({ width: Math.round(inner), height: Math.round(inner), fit: "inside" })
    .png()
    .toBuffer();

  const logoResized = await layer;

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: logoResized, gravity: "center" }])
    .flatten({ background })
    .png()
    .toFile(path.join(out, `icon-${size}x${size}.png`));
}

async function compositeMaskable(logo, size) {
  const safe = 0.6;
  const layer = sharp(logo.data, { raw: logo.info })
    .resize({ width: Math.round(size * safe), height: Math.round(size * safe), fit: "inside" })
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: await layer, gravity: "center" }])
    .flatten({ background })
    .png()
    .toFile(path.join(out, `maskable-icon-${size}x${size}.png`));
}

/**
 * Build the favicon tile SVG: navy rounded square with the full logo artwork.
 * The artwork is embedded as vector data so the favicon stays crisp at any
 * size. `innerSvg` is the logo's drawing without its root <svg> wrapper and
 * without the Serif DrawPlus serif:id attributes (those need a namespace
 * declaration to stay valid XML).
 */
function faviconSvg(bounds, innerSvg) {
  const { left, top, width, height } = bounds;
  const inner = FAVICON_SIZE * (1 - FAVICON_PADDING * 2);
  const scale = Math.min(inner / width, inner / height);
  const tx = FAVICON_SIZE / 2 - scale * (left + width / 2);
  const ty = FAVICON_SIZE / 2 - scale * (top + height / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}">
  <rect width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" rx="${FAVICON_RADIUS}" fill="${background}"/>
  <g style="fill-rule:evenodd;clip-rule:evenodd;stroke-miterlimit:10;" transform="translate(${tx} ${ty}) scale(${scale})">
${innerSvg}
  </g>
</svg>
`;
}

/** Multi-size .ico with PNG-encoded entries (Vista+ format; no BMP fallback needed). */
function toIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  pngs.forEach((png, i) => {
    const size = ICO_SIZES[i];
    const e = 6 + i * 16;
    header[e] = size;
    header[e + 1] = size;
    header[e + 2] = 0; // palette colors
    header[e + 3] = 0; // reserved
    header.writeUInt16LE(1, e + 4); // color planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });

  return Buffer.concat([header, ...pngs]);
}

async function main() {
  const logo = await renderLogo();
  console.log(`logo ${logo.info.width}x${logo.info.height}px (trimmed)`);

  // Vector drawing without the root <svg> wrapper (we supply our own viewBox)
  // and without serif:id attributes, which would need a namespace declaration.
  const rawLogo = await readFile(src, "utf8");
  const innerSvg = rawLogo
    .replace(/^[\s\S]*?<svg[^>]*>/i, "")
    .replace(/<\/svg>\s*$/i, "")
    .replace(/\s+serif:id="[^"]*"/g, "")
    .trim();

  const bounds = await artworkBounds(innerSvg);
  console.log(
    `art ${bounds.width.toFixed(1)}x${bounds.height.toFixed(1)} @ (${bounds.left.toFixed(1)}, ${bounds.top.toFixed(1)})`,
  );

  await mkdir(out, { recursive: true });

  for (const [size, padding] of [
    [192, 0.12],
    [512, 0.12],
    [1024, 0.12],
  ]) {
    await composite(logo, size, padding);
    console.log(`icon-${size}x${size}.png`);
  }

  await compositeMaskable(logo, 512);
  console.log("maskable-icon-512x512.png");

  const apple = sharp(logo.data, { raw: logo.info })
    .resize({ width: 144, height: 144, fit: "inside" })
    .png()
    .toBuffer();

  await sharp({
    create: { width: 180, height: 180, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: await apple, gravity: "center" }])
    .flatten({ background })
    .png()
    .toFile(path.join(out, "apple-touch-icon.png"));
  console.log("apple-touch-icon.png");

  const svg = faviconSvg(bounds, innerSvg);
  await writeFile(path.join(root, "public", "favicon.svg"), svg);
  console.log("favicon.svg");

  const pngs = [];
  for (const size of ICO_SIZES) {
    const density = (size * 72) / FAVICON_SIZE;
    pngs.push(await sharp(Buffer.from(svg), { density }).resize(size, size).png().toBuffer());
  }
  await writeFile(path.join(root, "public", "favicon.ico"), toIco(pngs));
  console.log("favicon.ico");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
