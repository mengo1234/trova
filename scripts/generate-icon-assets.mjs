import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = "src/assets/icons/generated";
const sheetPath = join(outDir, "trova-icon-sheet-source.png");
const tutorialSheetPath = join(outDir, "trova-tutorial-ui-sheet-source.png");

const assetNames = [
  "icon-search.png",
  "icon-folder.png",
  "icon-settings.png",
  "icon-database.png",
  "icon-watcher.png",
  "icon-semantic.png",
  "icon-vision.png",
  "icon-remote.png",
  "icon-text.png",
  "icon-image.png",
  "icon-audio.png",
  "icon-video.png",
  "icon-code.png",
  "icon-document-stack.png",
  "icon-cloud.png",
  "icon-shield.png",
  "icon-tools.png",
  "icon-sync.png",
  "icon-archive.png",
  "icon-sparkle.png",
];

const tutorialAssetNames = [
  "tutorial-control-index.png",
  "tutorial-control-model-downloads.png",
  "tutorial-control-preview.png",
  "tutorial-control-privacy.png",
  "tutorial-button-index.png",
  "tutorial-button-download.png",
  "tutorial-button-open-folder.png",
  "tutorial-button-finish.png",
  "tutorial-progress-meter.png",
  "tutorial-progress-dots.png",
  "tutorial-cloud-toggle.png",
  "tutorial-model-card.png",
];

const tutorialAssetBoxes = [
  { left: 64, top: 72, width: 304, height: 304 },
  { left: 404, top: 70, width: 340, height: 318 },
  { left: 780, top: 76, width: 340, height: 320 },
  { left: 1158, top: 76, width: 330, height: 320 },
  { left: 86, top: 430, width: 278, height: 224 },
  { left: 430, top: 430, width: 290, height: 224 },
  { left: 790, top: 428, width: 304, height: 224 },
  { left: 1160, top: 428, width: 300, height: 224 },
  { left: 62, top: 746, width: 306, height: 144 },
  { left: 412, top: 720, width: 330, height: 166 },
  { left: 784, top: 690, width: 320, height: 232 },
  { left: 1144, top: 712, width: 330, height: 204 },
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
  const pad = 18;
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(info.width - 1, maxX + pad);
  const bottom = Math.min(info.height - 1, maxY + pad);

  return image
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .png()
    .toBuffer();
}

async function fitTransparentCanvas(buffer, width, height, padding = 26) {
  const resized = await sharp(buffer)
    .resize({
      width: width - padding * 2,
      height: height - padding * 2,
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toBuffer();
}

async function cropSheet({
  source,
  names,
  rows,
  columns,
  outputWidth,
  outputHeight,
  previewName,
  previewWidth,
  fixedCanvas = false,
  boxes = null,
}) {
  const metadata = await sharp(source).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error(`Cannot read sheet dimensions: ${source}`);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const index = row * columns + col;
      const box = boxes?.[index];
      const left = box?.left ?? Math.round((col * width) / columns);
      const top = box?.top ?? Math.round((row * height) / rows);
      const cropWidth = box?.width ?? Math.round(((col + 1) * width) / columns) - left;
      const cropHeight = box?.height ?? Math.round(((row + 1) * height) / rows) - top;
      const cropped = await sharp(source)
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .png()
        .toBuffer();
      const transparent = await trimTransparent(await removeGreenScreen(cropped));
      const output = fixedCanvas
        ? await fitTransparentCanvas(transparent, outputWidth, outputHeight)
        : await sharp(transparent)
          .resize({ width: outputWidth, height: outputHeight, fit: "inside", withoutEnlargement: false })
          .png()
          .toBuffer();
      await sharp(output).png().toFile(join(outDir, names[index]));
    }
  }

  await sharp(source).resize({ width: previewWidth }).png().toFile(join(outDir, previewName));
}

async function generate() {
  await cropSheet({
    source: sheetPath,
    names: assetNames,
    rows: 4,
    columns: 5,
    outputWidth: 256,
    outputHeight: 256,
    previewName: "trova-icon-sheet-preview.png",
    previewWidth: 1400,
  });

  await cropSheet({
    source: tutorialSheetPath,
    names: tutorialAssetNames,
    rows: 3,
    columns: 4,
    outputWidth: 360,
    outputHeight: 220,
    previewName: "trova-tutorial-ui-sheet-preview.png",
    previewWidth: 1400,
    fixedCanvas: true,
    boxes: tutorialAssetBoxes,
  });

  console.log(`Generated ${assetNames.length} app icon assets.`);
  console.log(`Generated ${tutorialAssetNames.length} tutorial UI assets.`);
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
