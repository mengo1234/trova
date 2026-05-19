import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = "src/assets/settings/generated";
const sheetPath = join(outDir, "settings-material-sheet-source.png");

const assetNames = [
  "settings-overview.png",
  "settings-folders.png",
  "settings-components.png",
  "settings-vision.png",
  "settings-remote.png",
  "settings-cloud.png",
  "settings-advanced.png",
];

mkdirSync(outDir, { recursive: true });

function isGreenScreen(r, g, b) {
  return g > 92 && g - r > 18 && g - b > 18;
}

function softenGreenEdge(data, info, mask) {
  const width = info.width;
  const height = info.height;
  const edgeMask = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = y * width + x;
      if (!mask[point]) continue;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
          const neighbor = yy * width + xx;
          if (mask[neighbor]) continue;
          const offset = neighbor * 4;
          const r = data[offset];
          const g = data[offset + 1];
          const b = data[offset + 2];
          if (g > 74 && g - r > 8 && g - b > 8) edgeMask[neighbor] = 1;
        }
      }
    }
  }

  for (let point = 0; point < edgeMask.length; point += 1) {
    if (!edgeMask[point]) continue;
    const offset = point * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const greenLead = Math.max(0, g - Math.max(r, b));
    const alphaFactor = Math.max(0.18, Math.min(0.82, 1 - greenLead / 130));
    data[offset + 1] = Math.round(g * 0.56 + Math.max(r, b) * 0.44);
    data[offset + 3] = Math.round(data[offset + 3] * alphaFactor);
  }
}

async function removeGreenScreen(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const mask = new Uint8Array(width * height);
  const queue = [];

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const point = y * width + x;
    if (mask[point]) return;
    const offset = point * 4;
    if (!isGreenScreen(data[offset], data[offset + 1], data[offset + 2])) return;
    mask[point] = 1;
    queue.push(point);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index];
    const x = point % width;
    const y = Math.floor(point / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  softenGreenEdge(data, info, mask);

  for (let point = 0; point < mask.length; point += 1) {
    if (mask[point]) data[point * 4 + 3] = 0;
  }

  return sharp(data, { raw: info }).png().toBuffer();
}

async function trimTransparent(buffer) {
  const image = sharp(buffer).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha <= 10) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) return buffer;
  const pad = 22;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(info.width - 1, maxX + pad);
  const bottom = Math.min(info.height - 1, maxY + pad);

  return image
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
}

async function generate() {
  const metadata = await sharp(sheetPath).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error("Cannot read settings material sheet dimensions.");

  for (let column = 0; column < 7; column += 1) {
    const left = Math.round((column * width) / 7);
    const right = Math.round(((column + 1) * width) / 7);
    const cropped = await sharp(sheetPath)
      .extract({ left, top: 0, width: right - left, height })
      .png()
      .toBuffer();
    const transparent = await trimTransparent(await removeGreenScreen(cropped));
    await sharp(transparent)
      .resize({ width: 520, height: 420, fit: "inside", withoutEnlargement: false })
      .png()
      .toFile(join(outDir, assetNames[column]));
  }

  await sharp(sheetPath).resize({ width: 1600 }).png().toFile(join(outDir, "settings-material-sheet-preview.png"));
  console.log(`Generated ${assetNames.length} settings tab assets.`);
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
