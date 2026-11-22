import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {expect, it} from 'vitest';
import {applyModeration} from '../server/src/admin/moderation-apply';
import {Store} from '../server/src/database/store';
import {WIDTH} from '../shared/raster';

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
    await expect(pending).resolves.toBe(1);
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
