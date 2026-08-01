import sharp from "sharp";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "public", "logo-dev.svg");
const out = path.join(root, "public", "icons");

const background = "#0f172a";
const base = 1024;

async function renderLogo() {
  return sharp(src, { density: 300 })
    .ensureAlpha()
    .trim()
    .raw()
    .toBuffer({ resolveWithObject: true });
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

async function main() {
  const logo = await renderLogo();
  console.log(`rendered logo ${logo.info.width}x${logo.info.height}`);

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
