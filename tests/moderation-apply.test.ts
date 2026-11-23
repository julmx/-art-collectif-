import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {expect, it, vi} from 'vitest';
import {applyModeration} from '../server/src/admin/moderation-apply';
import {Store} from '../server/src/database/store';
import {HEIGHT, WIDTH} from '../shared/raster';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'art-moderation-'));
  const path = join(dir, 'db.sqlite');
  const store = new Store(path);
  store.db.prepare("UPDATE project SET status='open'").run();
  for (const id of ['alice', 'bob']) {
    const now = new Date().toISOString();
    store.db.prepare('INSERT INTO participants VALUES(?,?,?,?)').run(id, id, now, now);
  }
  function draw(participantId: string, colorId: number, x: number) {
    const strokeId = randomUUID();
    const result = store.submit(participantId, {
      opId:randomUUID(), strokeId, partIndex:0, final:true, tool:'pixel', colorId, size:1, points:[[x, 1]],
    });
    expect(result.accepted).toBe(true);
    return {participantId, strokeId};
  }
  function close() {
    store.close();
    rmSync(dir, {recursive:true, force:true});
  }
  return {store, path, draw, close};
}

it('masque le trait ciblé et rejoue les dessins acceptés pendant la reconstruction', async () => {
  const {store, path, draw, close} = setup();
  try {
    const target = draw('alice', 1, 0);
    const pending = applyModeration(store, path, [target], 'hide', 'annulation', store.seq, store.revision());
    for (let x = 1; x < 40; x++) draw('bob', 2, x);
    const history = vi.spyOn(store, 'hiddenStrokes');
    await expect(pending).resolves.toBe(1);
    expect(history).not.toHaveBeenCalled();
    expect(store.seq).toBe(40);
    expect(store.grid[WIDTH]).toBe(0);
    expect(store.grid[WIDTH + 39]).toBe(2);
    expect(store.grid).toEqual(store.replay(store.seq, 'moderated', store.revision()));
  } finally { close(); }
}, 15000);

it('refuse de publier une reconstruction faite sur une ancienne révision de modération', async () => {
  const {store, path, draw, close} = setup();
  try {
    const target = draw('alice', 1, 0);
    const other = draw('bob', 2, 1);
    const pending = applyModeration(store, path, [target], 'hide', 'annulation', store.seq, store.revision());
    store.moderate(other.participantId, other.strokeId, 'hide', 'décision concurrente');
    await expect(pending).rejects.toThrow('MODERATION_STATE_CHANGED');
    expect(store.revision()).toBe(1);
    expect(store.grid[WIDTH]).toBe(1);
    expect(store.grid[WIDTH + 1]).toBe(0);
  } finally { close(); }
}, 15000);

it('publie la grille du processus sans relire la visibilité si aucun dessin n’est arrivé', async () => {
  const {store, path, draw, close} = setup();
  try {
    const target = draw('alice', 1, 0);
    const history = vi.spyOn(store, 'hiddenStrokes');
    const replay = vi.spyOn(store, 'replayInto');
    await applyModeration(store, path, [target], 'hide', 'test', store.seq, store.revision());
    expect(history).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    expect(store.grid[WIDTH]).toBe(0);
  } finally { close(); }
});

it('réutilise un snapshot valide antérieur au trait ciblé et retombe sur un rejeu complet sinon', async () => {
  const {store, path, draw, close} = setup();
  try {
    store.db.exec('CREATE TABLE IF NOT EXISTS snapshots(seq INTEGER NOT NULL,moderation_revision INTEGER NOT NULL,file_path TEXT NOT NULL,checksum TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(seq,moderation_revision))');
    draw('alice', 1, 0);
    draw('bob', 2, 1);
    const snapDir = join(dirname(path), 'snapshots');
    mkdirSync(snapDir, {recursive:true});

    // Place a sentinel pixel in the snapshot at seq 2 to prove the worker started from it.
    const snapGrid = store.grid.slice();
    const sentinel = 10 * WIDTH + 10;
    snapGrid[sentinel] = 19;
    const compressed = gzipSync(snapGrid);
    const checksum = createHash('sha256').update(compressed).digest('hex');
    const relName = '2-0-valid.gz';
    writeFileSync(join(snapDir, relName), compressed);
    store.db.prepare('INSERT INTO snapshots(seq,moderation_revision,file_path,checksum,created_at) VALUES(?,?,?,?,?)').run(2, 0, relName, checksum, new Date().toISOString());

    const target = draw('alice', 3, 2); // seq 3
    draw('bob', 4, 3); // seq 4

    await expect(applyModeration(store, path, [target], 'hide', 'annulation', store.seq, store.revision())).resolves.toBe(1);
    expect(store.grid[sentinel]).toBe(19);
    expect(store.grid[WIDTH]).toBe(1);
    expect(store.grid[WIDTH + 1]).toBe(2);
    expect(store.grid[WIDTH + 2]).toBe(0);
    expect(store.grid[WIDTH + 3]).toBe(4);

    // Invalid traversal path + corrupt checksum at revision 1 must silently fall back to full replay from seq 0.
    const outsidePath = join(dirname(path), 'outside.gz');
    writeFileSync(outsidePath, compressed);
    store.db.prepare('INSERT INTO snapshots(seq,moderation_revision,file_path,checksum,created_at) VALUES(?,?,?,?,?)').run(4, 1, '../outside.gz', checksum, new Date().toISOString());
    const badPath = join(snapDir, '3-1-bad.gz');
    writeFileSync(badPath, Buffer.from('not-gzip'));
    store.db.prepare('INSERT INTO snapshots(seq,moderation_revision,file_path,checksum,created_at) VALUES(?,?,?,?,?)').run(3, 1, badPath, 'deadbeef', new Date().toISOString());

    const target2 = draw('alice', 5, 4); // seq 5
    await expect(applyModeration(store, path, [target2], 'hide', 'annulation', store.seq, store.revision())).resolves.toBe(2);
    expect(store.grid[sentinel]).toBe(0);
    expect(store.grid[WIDTH + 4]).toBe(0);
    expect(store.grid).toEqual(store.replay(store.seq, 'moderated', store.revision()));
  } finally { close(); }
}, 20000);

it('refuse le commit si validateBeforeCommit renvoie false', async () => {
  const {store, path, draw, close} = setup();
  try {
    const target = draw('alice', 1, 0);
    await expect(
      applyModeration(store, path, [target], 'hide', 'annulation', store.seq, store.revision(), {
        validateBeforeCommit: () => false,
      }),
    ).rejects.toThrow('MODERATION_UNAVAILABLE');
    expect(store.revision()).toBe(0);
    expect(store.grid[WIDTH]).toBe(1);
  } finally { close(); }
}, 15000);
