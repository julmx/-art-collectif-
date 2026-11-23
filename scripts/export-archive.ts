import { DatabaseSync, backup } from 'node:sqlite';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { closeSync, createReadStream, createWriteStream, openSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import yazl from 'yazl';
import sharp from 'sharp';
import { baseImagePath } from '../server/src/database/base-image';
import { parsePaletteRgb } from '../shared/palette';
import { HEIGHT, WIDTH, applyCells, paintBrush } from '../shared/raster';
import { exportVideo } from './export-video';

const codeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface ExportArchiveOptions {
  database: string;
  output: string;
  moderation: 'raw' | 'moderated';
  videos?: boolean;
  metadata?: string;
}

type ProjectRow = {
  status: string;
  palette_json: string;
  base_image_path: string | null;
  base_image_checksum: string;
  title: string;
  description: string;
  participation_terms: string;
  started_at: string | null;
  closed_at: string | null;
  moderation_revision: number;
};

type ModerationRow = {
  revision: number;
  participant_id: string;
  stroke_id: string;
  action: string;
  reason: string;
  created_at: string;
};

type DrawEventRow = {
  seq: number;
  participant_id: string;
  command_json: string;
  created_at: string;
};

export async function exportArchive(args: ExportArchiveOptions): Promise<void> {
  const temp = await mkdtemp(join(tmpdir(), 'art-archive-'));
  let original: DatabaseSync | undefined;
  let db: DatabaseSync | undefined;

  try {
    if (!['raw', 'moderated'].includes(args.moderation)) {
      throw new Error('Modération invalide');
    }

    const captureDbPath = join(temp, 'capture.sqlite');
    original = new DatabaseSync(resolve(args.database), { readOnly: true });
    await backup(original, captureDbPath);
    original.close();
    original = undefined;
    db = new DatabaseSync(captureDbPath, { readOnly: true });

    const project = db.prepare('SELECT * FROM project WHERE id=1').get() as ProjectRow;
    if (!project.base_image_path) {
      throw new Error('Fond absent');
    }

    const base = await readFile(baseImagePath(args.database, project.base_image_path));
    if (createHash('sha256').update(base).digest('hex') !== project.base_image_checksum) {
      throw new Error('Fond incompatible avec la capture');
    }

    const maxSeq = Number(
      (db.prepare('SELECT COALESCE(MAX(seq),0) n FROM draw_events').get() as { n: number }).n,
    );
    const captureAt = new Date().toISOString();
    const palette = JSON.parse(project.palette_json) as string[];
    const paletteRgb = parsePaletteRgb(palette);
    const hidden = new Set<string>();

    if (args.metadata) {
      await writeFile(
        args.metadata,
        JSON.stringify({
          captureCompletedAt: captureAt,
          sequence: maxSeq,
          moderationRevision: project.moderation_revision,
        }),
        { mode: 0o600 },
      );
    }

    const files: string[] = [];
    const add = async (name: string, data: string | Uint8Array) => {
      await mkdir(dirname(join(temp, name)), { recursive: true });
      await writeFile(join(temp, name), data);
      files.push(name);
    };

    await add('base.png', base);
    await add(
      'project.json',
      JSON.stringify(
        {
          width: WIDTH,
          height: HEIGHT,
          status: project.status,
          palette,
          title: project.title,
          description: project.description,
          participationTerms: project.participation_terms,
          termsHistory: db
            .prepare('SELECT terms,effective_after_seq,created_at FROM terms_history ORDER BY id')
            .all(),
          startedAt: project.started_at,
          closedAt: project.closed_at,
        },
        null,
        2,
      ),
    );

    const moderationPath = join(temp, 'moderation.jsonl');
    const moderationFd = openSync(moderationPath, 'w');
    try {
      const actions = db
        .prepare('SELECT revision,participant_id,stroke_id,action,reason,created_at FROM moderation_actions ORDER BY revision')
        .iterate() as IterableIterator<ModerationRow>;
      for (const row of actions) {
        writeSync(moderationFd, JSON.stringify(row) + '\n');
        const key = JSON.stringify([row.participant_id, row.stroke_id]);
        if (row.action === 'hide') {
          hidden.add(key);
        } else {
          hidden.delete(key);
        }
      }
    } finally {
      closeSync(moderationFd);
    }
    files.push('moderation.jsonl');

    const grid = new Uint8Array(WIDTH * HEIGHT);
    const eventsPath = join(temp, 'events.jsonl');
    const eventsFd = openSync(eventsPath, 'w');
    try {
      const events = db
        .prepare('SELECT seq,participant_id,command_json,created_at FROM draw_events WHERE seq<=? ORDER BY seq')
        .iterate(maxSeq) as IterableIterator<DrawEventRow>;
      for (const row of events) {
        const command = JSON.parse(row.command_json);
        writeSync(
          eventsFd,
          JSON.stringify({
            seq: row.seq,
            participantId: row.participant_id,
            ...command,
            createdAt: row.created_at,
          }) + '\n',
        );
        if (args.moderation === 'raw' || !hidden.has(JSON.stringify([row.participant_id, command.strokeId]))) {
          applyCells(grid, paintBrush(command.points, command.size, command.colorId));
        }
      }
    } finally {
      closeSync(eventsFd);
    }
    files.push('events.jsonl');

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

    await add(
      'overlay.png',
      await sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer(),
    );
    await add(
      'final.png',
      await sharp(base)
        .composite([{ input: rgba, raw: { width: WIDTH, height: HEIGHT, channels: 4 } }])
        .png()
        .toBuffer(),
    );

    await mkdir(join(temp, 'replay/shared'), { recursive: true });
    await mkdir(join(temp, 'replay/scripts'), { recursive: true });
    for (const [src, dest] of [
      ['shared/raster.ts', 'replay/shared/raster.ts'],
      ['scripts/replay-archive.ts', 'replay/scripts/replay.ts'],
      ['package.json', 'replay/package.json'],
      ['package-lock.json', 'replay/package-lock.json'],
    ] as const) {
      await copyFile(join(codeRoot, src), join(temp, dest));
      files.push(dest);
    }

    await add(
      'README.txt',
      'Relecture : cd replay ; npm ci ; npx tsx scripts/replay.ts [sequence] [fichier-sortie.png]. La politique de moderation du manifeste est appliquee retroactivement. Les contributions ne sont pas assorties d’une licence publique implicite.\n',
    );

    if (args.videos) {
      for (const mode of ['chronological', 'activity'] as const) {
        for (const moderation of ['raw', 'moderated'] as const) {
          const name = `timelapse-${mode}-${moderation}.mp4`;
          await exportVideo(
            {
              database: captureDbPath,
              output: join(temp, name),
              mode,
              moderation,
              duration: 180,
              fps: 25,
              scale: 2,
              captureAt,
              skipBackup: true,
            },
            base,
          );
          files.push(name);
        }
      }
    }

    const checksums: Record<string, string> = {};
    for (const file of files) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(join(temp, file))) {
        hash.update(chunk as Buffer);
      }
      checksums[file] = hash.digest('hex');
    }

    let revision = process.env.CODE_REVISION;
    try {
      revision ||= execFileSync('git', ['rev-parse', 'HEAD'], { cwd: codeRoot, encoding: 'utf8' }).trim();
    } catch {}
    if (!revision) {
      throw new Error('CODE_REVISION requis pour identifier le code');
    }

    let ffmpeg = 'unavailable';
    try {
      ffmpeg = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0];
    } catch {}

    await add(
      'manifest.json',
      JSON.stringify(
        {
          format: 'art-collectif-archive-v1',
          eventFormat: '1',
          rasterVersion: '1',
          codeRevision: revision,
          node: process.version,
          ffmpeg,
          maxSeq,
          captureAt,
          revision: project.moderation_revision,
          moderation: args.moderation,
          videoParameters: args.videos ? { duration: 180, fps: 25, scale: 2 } : null,
          checksums,
        },
        null,
        2,
      ),
    );

    const zip = new yazl.ZipFile();
    const output = createWriteStream(resolve(args.output), { mode: 0o600 });
    zip.outputStream.pipe(output);
    for (const file of files) {
      zip.addFile(join(temp, file), file);
    }
    zip.end();
    await once(output, 'close');
  } finally {
    original?.close();
    db?.close();
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    args.set(process.argv[i], process.argv[i + 1]);
  }
  const database = args.get('--database');
  const output = args.get('--output');
  if (!database || !output) {
    throw new Error('--database et --output requis');
  }
  exportArchive({
    database,
    output,
    moderation: (args.get('--moderation') || 'moderated') as 'raw' | 'moderated',
    videos: args.get('--videos') === 'true',
    metadata: args.get('--metadata'),
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
