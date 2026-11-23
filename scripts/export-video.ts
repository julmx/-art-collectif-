import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { baseImagePath } from '../server/src/database/base-image';
import { parsePaletteRgb } from '../shared/palette';
import { HEIGHT, WIDTH, applyCells, paintBrush } from '../shared/raster';
import type { DrawCommand } from '../shared/protocol';

export interface ExportVideoOptions {
  database: string;
  output: string;
  mode: 'activity' | 'chronological';
  moderation: 'raw' | 'moderated';
  duration: number;
  fps: number;
  scale: number;
  width?: number;
  height?: number;
  endSeq?: number;
  captureAt?: string;
  metadata?: string;
  skipBackup?: boolean;
}

type ProjectRow = {
  base_image_path: string | null;
  base_image_checksum: string | null;
  palette_json: string;
  started_at: string | null;
  closed_at: string | null;
  moderation_revision: number;
};

type ModerationRow = {
  participant_id: string;
  stroke_id: string;
  action: string;
};

type EventRow = {
  seq: number;
  command_json: string;
  created_at: string;
  hidden: number;
};

export async function exportVideo(args: ExportVideoOptions, capturedBase?: Buffer): Promise<void> {
  if (
    !['activity', 'chronological'].includes(args.mode) ||
    !['raw', 'moderated'].includes(args.moderation) ||
    !Number.isFinite(args.duration) ||
    args.duration <= 0 ||
    args.duration > 3600 ||
    !Number.isInteger(args.fps) ||
    args.fps < 1 ||
    args.fps > 60 ||
    !Number.isInteger(args.scale) ||
    args.scale < 1 ||
    args.scale > 8
  ) {
    throw new Error('Paramètres vidéo invalides');
  }

  if (
    (args.width !== undefined && args.width !== WIDTH * args.scale) ||
    (args.height !== undefined && args.height !== HEIGHT * args.scale) ||
    (args.captureAt !== undefined &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(args.captureAt) ||
        Number.isNaN(Date.parse(args.captureAt))))
  ) {
    throw new Error('Résolution ou instant de capture invalide');
  }

  let dir: string | undefined;
  let source: DatabaseSync | undefined;
  let copy: DatabaseSync | undefined;
  let terminateEncoder: (() => void) | undefined;

  try {
    if (args.skipBackup) {
      copy = new DatabaseSync(resolve(args.database), { readOnly: true });
    } else {
      dir = await mkdtemp(join(tmpdir(), 'art-video-'));
      source = new DatabaseSync(resolve(args.database), { readOnly: true });
      await backup(source, join(dir, 'capture.sqlite'));
      source.close();
      source = undefined;
      copy = new DatabaseSync(join(dir, 'capture.sqlite'), { readOnly: true });
    }

    const project = copy.prepare('SELECT * FROM project WHERE id=1').get() as ProjectRow;
    if (!project.base_image_path) {
      throw new Error('Fond absent');
    }
    if (args.mode === 'chronological' && !project.started_at) {
      throw new Error('Export chronologique impossible avant ouverture');
    }

    const base = capturedBase ?? (await readFile(baseImagePath(args.database, project.base_image_path)));
    if (createHash('sha256').update(base).digest('hex') !== project.base_image_checksum) {
      throw new Error('Fond incompatible avec la capture');
    }

    const max = Number(
      (copy.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM draw_events').get() as { n: number }).n,
    );
    const end = args.endSeq ?? max;
    if (!Number.isSafeInteger(end) || end < 0 || end > max) {
      throw new Error('Séquence de fin invalide');
    }

    const captureSeq =
      args.mode === 'chronological' && args.captureAt
        ? Number(
            copy
              .prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM draw_events WHERE seq<=? AND created_at<=?')
              .get(end, new Date(args.captureAt).toISOString())!.seq,
          )
        : end;

    if (args.metadata) {
      await writeFile(
        args.metadata,
        JSON.stringify({
          captureCompletedAt: new Date().toISOString(),
          sequence: captureSeq,
          moderationRevision: project.moderation_revision,
        }),
        { mode: 0o600 },
      );
    }

    // Materialise only the latest moderation decisions in a disk-backed TEMP table.
    copy.exec(
      'PRAGMA temp_store=FILE; CREATE TEMP TABLE hidden(participant_id TEXT,stroke_id TEXT,PRIMARY KEY(participant_id,stroke_id)) WITHOUT ROWID',
    );
    if (args.moderation === 'moderated') {
      const hide = copy.prepare('INSERT OR IGNORE INTO hidden VALUES(?,?)');
      const restore = copy.prepare('DELETE FROM hidden WHERE participant_id=? AND stroke_id=?');
      const actions = copy
        .prepare('SELECT participant_id,stroke_id,action FROM moderation_actions WHERE revision<=? ORDER BY revision')
        .iterate(project.moderation_revision) as IterableIterator<ModerationRow>;
      for (const action of actions) {
        (action.action === 'hide' ? hide : restore).run(action.participant_id, action.stroke_id);
      }
    }

    const events = copy
      .prepare(
        'SELECT e.seq,e.command_json,e.created_at,(h.participant_id IS NOT NULL) AS hidden FROM draw_events e LEFT JOIN hidden h ON h.participant_id=e.participant_id AND h.stroke_id=e.stroke_id WHERE e.seq<=? ORDER BY e.seq',
      )
      .iterate(captureSeq) as IterableIterator<EventRow>;
    let next = events.next();

    const last = copy
      .prepare('SELECT created_at FROM draw_events WHERE seq<=? ORDER BY seq DESC LIMIT 1')
      .get(captureSeq) as { created_at: string } | undefined;

    const palette = JSON.parse(project.palette_json) as string[];
    const paletteRgb = parsePaletteRgb(palette);
    const baseRgb = await sharp(base).removeAlpha().toColourspace('srgb').raw().toBuffer();
    if (baseRgb.length !== WIDTH * HEIGHT * 3) {
      throw new Error('Dimensions du fond invalides');
    }

    const grid = new Uint8Array(WIDTH * HEIGHT);
    const frameRgb = Buffer.allocUnsafe(WIDTH * HEIGHT * 3);
    const frames = Math.max(2, Math.round(args.duration * args.fps));
    const start = project.started_at ? Date.parse(project.started_at) : 0;
    const capture = args.captureAt ? Date.parse(args.captureAt) : Date.now();
    const endTime =
      args.endSeq !== undefined
        ? last
          ? Date.parse(last.created_at)
          : start
        : project.closed_at
          ? Math.min(Date.parse(project.closed_at), capture)
          : capture;

    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-s',
        `${WIDTH}x${HEIGHT}`,
        '-r',
        String(args.fps),
        '-i',
        'pipe:0',
        '-vf',
        `scale=${WIDTH * args.scale}:${HEIGHT * args.scale}:flags=neighbor`,
        '-c:v',
        'libx264',
        '-threads',
        '1',
        '-pix_fmt',
        'yuv420p',
        resolve(args.output),
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );

    terminateEncoder = () => {
      ffmpeg.stdin.destroy();
      if (ffmpeg.exitCode === null) {
        ffmpeg.kill('SIGTERM');
      }
    };
    ffmpeg.stdin.on('error', () => {});

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr = (stderr + String(data)).slice(-4096);
    });

    let encoderStopped: Error | undefined;
    let notifyWriteAbort: ((error: Error) => void) | undefined;
    const completed = new Promise<void>((ok, fail) => {
      ffmpeg.on('error', (error) => {
        encoderStopped = error;
        notifyWriteAbort?.(error);
        fail(error);
      });
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          encoderStopped = new Error('FFmpeg arrêté avant la fin');
          notifyWriteAbort?.(encoderStopped);
          ok();
        } else {
          const error = new Error(`FFmpeg: ${stderr}`);
          encoderStopped = error;
          notifyWriteAbort?.(error);
          fail(error);
        }
      });
    });
    void completed.catch(() => {});

    const writeFrame = (buffer: Buffer): Promise<void> =>
      new Promise<void>((resolveWrite, rejectWrite) => {
        if (encoderStopped) {
          rejectWrite(encoderStopped);
          return;
        }
        let settled = false;
        const done = (error?: Error | null) => {
          if (settled) return;
          settled = true;
          notifyWriteAbort = undefined;
          if (error) rejectWrite(error);
          else resolveWrite();
        };
        notifyWriteAbort = done;
        ffmpeg.stdin.write(buffer, (error) => done(error));
      });

    for (let frame = 0; frame < frames; frame++) {
      const ratio = frame / (frames - 1);
      const targetSeq = Math.floor(captureSeq * ratio);
      const targetTime = start + (endTime - start) * ratio;

      while (
        frame > 0 &&
        !next.done &&
        (frame === frames - 1 ||
          (args.mode === 'activity'
            ? next.value.seq <= targetSeq
            : Date.parse(next.value.created_at) <= targetTime))
      ) {
        const row = next.value;
        const command = JSON.parse(row.command_json) as DrawCommand;
        if (!row.hidden) {
          applyCells(grid, paintBrush(command.points, command.size, command.colorId));
        }
        next = events.next();
      }

      baseRgb.copy(frameRgb);
      for (let i = 0; i < grid.length; i++) {
        const colorId = grid[i];
        if (colorId !== 0) {
          const colorOffset = (colorId - 1) * 3;
          const pixelOffset = i * 3;
          frameRgb[pixelOffset] = paletteRgb[colorOffset];
          frameRgb[pixelOffset + 1] = paletteRgb[colorOffset + 1];
          frameRgb[pixelOffset + 2] = paletteRgb[colorOffset + 2];
        }
      }

      await writeFrame(frameRgb);
    }

    ffmpeg.stdin.end();
    await completed;
    terminateEncoder = undefined;
  } finally {
    terminateEncoder?.();
    source?.close();
    copy?.close();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) {
    options.set(process.argv[i], process.argv[i + 1]);
  }
  const required = (name: string) => {
    const value = options.get(name);
    if (!value) throw new Error(`${name} requis`);
    return value;
  };
  exportVideo({
    database: required('--database'),
    output: required('--output'),
    mode: (options.get('--mode') || 'activity') as 'activity' | 'chronological',
    moderation: (options.get('--moderation') || 'moderated') as 'raw' | 'moderated',
    duration: Number(options.get('--duration') || 180),
    fps: Number(options.get('--fps') || 25),
    scale: Number(options.get('--scale') || 2),
    width: options.has('--width') ? Number(options.get('--width')) : undefined,
    height: options.has('--height') ? Number(options.get('--height')) : undefined,
    captureAt: options.get('--capture-at'),
    endSeq: options.has('--end-seq') ? Number(options.get('--end-seq')) : undefined,
    metadata: options.get('--metadata'),
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
