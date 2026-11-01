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

it('replays moderation retroactively without moving later contributions', () => {
  const dir=mkdtempSync(join(tmpdir(),'art-moderation-')), path=join(dir,'db.sqlite'); const store=new Store(path);
  try {
    store.db.prepare('INSERT INTO participants VALUES(?,?,?,?)').run('p','hash','now','now'); store.db.prepare("UPDATE project SET status='open'").run();
    const a:DrawCommand={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:false,tool:'pixel',colorId:1,size:1,points:[[5,5],[6,5]]};
    const b:DrawCommand={...a,opId:randomUUID(),strokeId:randomUUID(),colorId:2,final:true,points:[[5,5]]};
    expect(store.submit('p',a).accepted).toBe(true); expect(store.submit('p',b).accepted).toBe(true);
    expect(store.moderate('p',a.strokeId,'hide','test')).toBe(1);
    expect(store.grid[5*720+5]).toBe(2); expect(store.grid[5*720+6]).toBe(0);
    const later:DrawCommand={...a,opId:randomUUID(),partIndex:1,final:true,points:[[6,5],[7,5]]};
    expect(store.submit('p',later).accepted).toBe(true); expect(store.grid[5*720+7]).toBe(0);
    expect(store.replay(3,'raw',1)[5*720+7]).toBe(1);
    expect(store.moderate('p',a.strokeId,'restore','test')).toBe(2);
    expect(store.grid[5*720+5]).toBe(2); expect(store.grid[5*720+7]).toBe(1);
    expect(store.replay(3,'moderated',1)[5*720+7]).toBe(0);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});

it('suspend les écritures si la reconstruction après modération échoue',()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-broken-replay-'));const store=new Store(join(dir,'db.sqlite'));try{store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open'").run();const c:DrawCommand={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:1,size:1,points:[[1,1]]};store.submit('p',c);store.rebuild=()=>{throw new Error('simulation');};expect(()=>store.moderate('p',c.strokeId,'hide','test')).toThrow();expect(store.healthy).toBe(false);expect(store.submit('p',{...c,opId:randomUUID(),strokeId:randomUUID()})).toMatchObject({accepted:false,code:'STORAGE_UNAVAILABLE'});}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
