import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/src/database/store';
import type { DrawCommand } from '../shared/protocol';

it('commits before acknowledgement, handles retries and rebuilds after restart', () => {
  const dir = mkdtempSync(join(tmpdir(),'art-store-')), path = join(dir,'db.sqlite');
  let store = new Store(path);
  try {
    store.db.prepare('INSERT INTO participants VALUES(?,?,?,?)').run('p','hash','now','now');
    store.db.prepare("UPDATE project SET status='open'").run();
    const cmd: DrawCommand = {opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:false,tool:'pixel',colorId:1,size:1,points:[[1,1],[2,1]]};
    expect(store.submit('p',cmd)).toMatchObject({accepted:true,seq:1,duplicate:false});
    expect(store.submit('p',cmd)).toMatchObject({accepted:true,seq:1,duplicate:true});
    expect(store.submit('p',{...cmd,colorId:2})).toMatchObject({accepted:false,code:'OP_ID_CONFLICT'});
    expect(store.submit('p',{...cmd,opId:randomUUID(),partIndex:1,points:[[9,9]]})).toMatchObject({accepted:false,code:'CONTINUITY_ERROR'});
    const end = {...cmd,opId:randomUUID(),partIndex:1,final:true,points:[]};
    expect(store.submit('p',end)).toMatchObject({accepted:true,seq:2});
    expect(store.submit('p',{...end,opId:randomUUID(),partIndex:2})).toMatchObject({accepted:false,code:'STROKE_CLOSED'});
    store.db.prepare("UPDATE project SET status='paused'").run();
    expect(store.submit('p',cmd)).toMatchObject({accepted:true,seq:1,duplicate:true});
    expect(store.submit('p',{...cmd,opId:randomUUID()})).toMatchObject({accepted:false,code:'PROJECT_NOT_OPEN'});
    const original = store.grid.slice(); store.close(); store = new Store(path);
    expect(store.seq).toBe(2); expect(store.grid).toEqual(original);
  } finally { store.close(); rmSync(dir,{recursive:true,force:true}); }
});
