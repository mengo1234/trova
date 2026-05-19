import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const sourceArg = process.argv[2];

if (!sourceArg) {
  console.error("Usage: node scripts/generate-home-assets.mjs /path/to/generated-home-sheet.png");
  process.exit(1);
}

const source = path.resolve(sourceArg);
const outDir = path.join(ROOT, "src", "assets", "home", "generated");
const phases = [
  ["morning", "home-landscape-morning.png"],
  ["rain", "home-landscape-rain.png"],
  ["sunset", "home-landscape-sunset.png"],
  ["night", "home-landscape-night.png"],
];

await fs.mkdir(outDir, { recursive: true });
await fs.copyFile(source, path.join(outDir, "home-landscape-sheet-source.png"));

const metadata = await sharp(source).metadata();
const panelWidth = Math.floor((metadata.width || 0) / phases.length);
const panelHeight = metadata.height || 0;

if (!panelWidth || !panelHeight) {
  throw new Error(`Invalid generated home sheet: ${source}`);
}

for (const [index, [name, fileName]] of phases.entries()) {
  const filePath = path.join(outDir, fileName);
  await sharp(source)
    .extract({ left: index * panelWidth, top: 0, width: panelWidth, height: panelHeight })
    .resize(1920, 1080, { fit: "cover", position: "center" })
    .png({ quality: 92, compressionLevel: 9, adaptiveFiltering: true })
    .toFile(filePath);
  console.log(`${name}: ${filePath}`);
}

await sharp({
  create: {
    width: 960,
    height: 540,
    channels: 4,
    background: "#f8fafd",
  },
})
  .composite(
    await Promise.all(
      phases.map(async ([, fileName], index) => ({
        input: await sharp(path.join(outDir, fileName)).resize(456, 256, { fit: "cover" }).png().toBuffer(),
        left: 16 + (index % 2) * 488,
        top: 16 + Math.floor(index / 2) * 268,
      })),
    ),
  )
  .png()
  .toFile(path.join(outDir, "home-landscape-preview.png"));
