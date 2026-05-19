import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = "src/assets/setup/generated";
const sheetPath = join(outDir, "setup-material-sheet-source.png");
const mockupPath = join(outDir, "setup-app-mockup-generated.png");

const assetNames = [
  "setup-local-search.png",
  "setup-folders.png",
  "setup-documents.png",
  "setup-image-search.png",
  "setup-ocr.png",
  "setup-audio.png",
  "setup-video.png",
  "setup-cloud-privacy.png",
  "setup-local-ai.png",
  "setup-app-window.png",
];

mkdirSync(outDir, { recursive: true });

function isGreenScreen(r, g, b) {
  return g > 92 && g - r > 18 && g - b > 18;
}

function softenGreenEdge(data, info, mask) {
  const width = info.width;
  const height = info.height;
  const nextMask = new Uint8Array(mask.length);

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
          if (g > 74 && g - r > 8 && g - b > 8) {
            nextMask[neighbor] = 1;
          }
        }
      }
    }
  }

  for (let point = 0; point < nextMask.length; point += 1) {
    if (!nextMask[point]) continue;
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
    if (!mask[point]) continue;
    const offset = point * 4;
    data[offset + 3] = 0;
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
  const pad = 18;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(info.width - 1, maxX + pad);
  const bottom = Math.min(info.height - 1, maxY + pad);

  return image
    .extract({
      left,
      top,
      width: right - left + 1,
      height: bottom - top + 1,
    })
    .png()
    .toBuffer();
}

async function generate() {
  const sheet = sharp(sheetPath);
  const metadata = await sheet.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) {
    throw new Error("Cannot read setup material sheet dimensions.");
  }

  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const index = row * 5 + col;
      const left = Math.round((col * width) / 5);
      const right = Math.round(((col + 1) * width) / 5);
      const top = Math.round((row * height) / 2);
      const bottom = Math.round(((row + 1) * height) / 2);
      const cropped = await sharp(sheetPath)
        .extract({ left, top, width: right - left, height: bottom - top })
        .png()
        .toBuffer();
      const transparent = await trimTransparent(await removeGreenScreen(cropped));
      await sharp(transparent)
        .resize({ width: 520, height: 400, fit: "inside", withoutEnlargement: false })
        .png()
        .toFile(join(outDir, assetNames[index]));
    }
  }

  await sharp(sheetPath).resize({ width: 1280 }).png().toFile(join(outDir, "setup-material-sheet-preview.png"));
  await sharp(mockupPath).resize({ width: 1280 }).png().toFile(join(outDir, "setup-app-mockup-wide.png"));
  console.log(`Generated ${assetNames.length + 2} setup assets.`);
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
