import {createHash} from 'node:crypto';
import {readFileSync, realpathSync} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {gunzipSync} from 'node:zlib';
import {WIDTH, HEIGHT, paintBrush, applyCells} from '../shared/raster';
import type {DrawCommand} from '../shared/protocol';

const [path, seqText, revisionText, overridesText, snapshotDirectory] = process.argv.slice(2);
const seq = Number(seqText), revision = Number(revisionText);
const overrides = JSON.parse(Buffer.from(overridesText, 'base64url').toString()) as {participantId:string;strokeId:string;action:'hide'|'restore'}[];
const db = new DatabaseSync(path, {readOnly:true});
try {
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('BEGIN');
  const hidden = new Set<string>();
  for (const d of db.prepare('SELECT participant_id,stroke_id,action FROM moderation_actions WHERE revision<=? ORDER BY revision').iterate(revision) as IterableIterator<{participant_id:string;stroke_id:string;action:string}>) {
    const k = JSON.stringify([d.participant_id, d.stroke_id]);
    if (d.action === 'hide') hidden.add(k); else hidden.delete(k);
  }
  for (const d of overrides) {
    const k = JSON.stringify([d.participantId, d.strokeId]);
    if (d.action === 'hide') hidden.add(k); else hidden.delete(k);
  }

  let grid = new Uint8Array(WIDTH * HEIGHT);
  let startSeq = 0;
  if (snapshotDirectory && overrides.length > 0) {
    try {
      let minAffectedSeq = Infinity;
      const minSeqStmt = db.prepare('SELECT MIN(seq) AS min_seq FROM draw_events WHERE participant_id=? AND stroke_id=?');
      for (const d of overrides) {
        const row = minSeqStmt.get(d.participantId, d.strokeId) as {min_seq:number|null} | undefined;
        if (row?.min_seq == null) { minAffectedSeq = 0; break; }
        if (row.min_seq < minAffectedSeq) minAffectedSeq = row.min_seq;
      }
      const hasSnapshots = minAffectedSeq > 1 && !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='snapshots'").get();
      if (hasSnapshots) {
        const baseDir = resolve(snapshotDirectory);
        const realBase = realpathSync(baseDir);
        const rows = db.prepare('SELECT seq,file_path,checksum FROM snapshots WHERE moderation_revision=? AND seq<? AND seq<=? ORDER BY seq DESC').all(revision, minAffectedSeq, seq) as {seq:number;file_path:string;checksum:string}[];
        for (const row of rows) {
          try {
            const candidate = isAbsolute(row.file_path) ? resolve(row.file_path) : resolve(baseDir, row.file_path);
            const rel = relative(baseDir, candidate);
            if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
            const realCandidate = realpathSync(candidate);
            const realRel = relative(realBase, realCandidate);
            if (!realRel || realRel.startsWith('..') || isAbsolute(realRel)) continue;
            const data = readFileSync(realCandidate);
            if (createHash('sha256').update(data).digest('hex') !== row.checksum) continue;
            const unpacked = gunzipSync(data, {maxOutputLength: WIDTH * HEIGHT});
            if (unpacked.length !== WIDTH * HEIGHT || unpacked.some(v => v > 24)) continue;
            grid = new Uint8Array(unpacked);
            startSeq = row.seq;
            break;
          } catch {
            // Try an older snapshot or fall back to full replay.
          }
        }
      }
    } catch {
      grid = new Uint8Array(WIDTH * HEIGHT);
      startSeq = 0;
    }
  }

  for (const row of db.prepare('SELECT participant_id,command_json FROM draw_events WHERE seq>? AND seq<=? ORDER BY seq').iterate(startSeq, seq) as IterableIterator<{participant_id:string;command_json:string}>) {
    const c = JSON.parse(row.command_json) as DrawCommand;
    if (!hidden.has(JSON.stringify([row.participant_id, c.strokeId]))) applyCells(grid, paintBrush(c.points, c.size, c.colorId));
  }
  process.stdout.write(Buffer.from(grid));
  db.exec('COMMIT');
} finally { db.close(); }
