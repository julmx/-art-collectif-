import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { Store } from '../server/src/database/store';
import { Snapshots } from '../server/src/renderer/snapshots';
import { parsePaletteRgb } from '../shared/palette';
import { HEIGHT, WIDTH } from '../shared/raster';

type RenderRequest = {
  database: string;
  output: string;
  snapshotDirectory: string;
  target: number;
  revision: number;
  mode: 'raw' | 'moderated';
  scale: number;
  palette: string[];
  baseImagePath: string | null;
  overlay: boolean;
  overrides?: { participantId: string; strokeId: string; action: 'hide' | 'restore' }[];
};

const parts: Buffer[] = [];
for await (const part of process.stdin) {
  parts.push(Buffer.from(part));
}
const request = JSON.parse(Buffer.concat(parts).toString('utf8')) as RenderRequest;

if (
  !Number.isSafeInteger(request.target) ||
  request.target < 0 ||
  !Number.isSafeInteger(request.revision) ||
  request.revision < 0 ||
  !['raw', 'moderated'].includes(request.mode) ||
  !Number.isInteger(request.scale) ||
  request.scale < 1 ||
  request.scale > 8 ||
  !Array.isArray(request.palette) ||
  request.palette.length !== 24
) {
  throw new Error('Invalid render request');
}

const paletteRgb = parsePaletteRgb(request.palette);
const store = new Store(resolve(request.database), true);

try {
  const snapshots = new Snapshots(store, resolve(request.snapshotDirectory));
  const cached =
    request.mode === 'moderated' && !request.overrides?.length
      ? await snapshots.latest(request.target, request.revision)
      : null;

  const grid = store.replay(
    request.target,
    request.mode,
    request.revision,
    cached ?? undefined,
    request.overrides,
  );
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let i = 0; i < grid.length; i++) {
    const colorId = grid[i];
    if (colorId !== 0) {
      const colorOffset = (colorId - 1) * 3;
      const pixelOffset = i * 4;
      pixels[pixelOffset] = paletteRgb[colorOffset];
      pixels[pixelOffset + 1] = paletteRgb[colorOffset + 1];
      pixels[pixelOffset + 2] = paletteRgb[colorOffset + 2];
      pixels[pixelOffset + 3] = 255;
    }
  }

  let image: Sharp;
  if (request.overlay) {
    image = sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } });
  } else {
    if (!request.baseImagePath) {
      throw new Error('Base absent');
    }
    image = sharp(await readFile(request.baseImagePath)).composite([
      { input: pixels, raw: { width: WIDTH, height: HEIGHT, channels: 4 } },
    ]);
  }

  const native = await image.png().toBuffer();
  const output =
    request.scale === 1
      ? native
      : await sharp(native)
          .resize(WIDTH * request.scale, HEIGHT * request.scale, { kernel: 'nearest' })
          .png()
          .toBuffer();

  await writeFile(resolve(request.output), output, { mode: 0o600 });
} finally {
  store.close();
}
