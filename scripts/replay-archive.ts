import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { HEIGHT, WIDTH, applyCells, paintBrush } from '../shared/raster';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const project = JSON.parse(await readFile(join(root, 'project.json'), 'utf8')) as { palette: string[] };
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as {
  moderation: string;
  revision: number;
  maxSeq: number;
};

const target = process.argv[2] === undefined ? manifest.maxSeq : Number(process.argv[2]);
if (!Number.isSafeInteger(target) || target < 0 || target > manifest.maxSeq) {
  throw new Error('Séquence invalide');
}

const hidden = new Set<string>();
if (manifest.moderation === 'moderated') {
  for await (const line of createInterface({
    input: createReadStream(join(root, 'moderation.jsonl')),
    crlfDelay: Infinity,
  })) {
    if (!line) continue;
    const action = JSON.parse(line);
    if (action.revision > manifest.revision) continue;
    const key = JSON.stringify([action.participant_id, action.stroke_id]);
    if (action.action === 'hide') {
      hidden.add(key);
    } else {
      hidden.delete(key);
    }
  }
}

const grid = new Uint8Array(WIDTH * HEIGHT);
for await (const line of createInterface({
  input: createReadStream(join(root, 'events.jsonl')),
  crlfDelay: Infinity,
})) {
  if (!line) continue;
  const event = JSON.parse(line);
  if (event.seq > target) break;
  if (!hidden.has(JSON.stringify([event.participantId, event.strokeId]))) {
    applyCells(grid, paintBrush(event.points, event.size, event.colorId));
  }
}

const paletteRgb = new Uint8Array(project.palette.length * 3);
for (let i = 0; i < project.palette.length; i++) {
  const color = project.palette[i];
  const offset = i * 3;
  paletteRgb[offset] = parseInt(color.slice(1, 3), 16);
  paletteRgb[offset + 1] = parseInt(color.slice(3, 5), 16);
  paletteRgb[offset + 2] = parseInt(color.slice(5, 7), 16);
}

const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
for (let i = 0; i < grid.length; i++) {
  const colorId = grid[i];
  if (colorId !== 0) {
    const colorOffset = (colorId - 1) * 3;
    const pixelOffset = i * 4;
    rgba[pixelOffset] = paletteRgb[colorOffset];
    rgba[pixelOffset + 1] = paletteRgb[colorOffset + 1];
    rgba[pixelOffset + 2] = paletteRgb[colorOffset + 2];
    rgba[pixelOffset + 3] = 255;
  }
}

const image = await sharp(await readFile(join(root, 'base.png')))
  .composite([{ input: rgba, raw: { width: WIDTH, height: HEIGHT, channels: 4 } }])
  .png()
  .toBuffer();

await writeFile(resolve(process.argv[3] || 'reconstruction.png'), image);
