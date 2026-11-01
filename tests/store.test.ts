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
    expect(store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    expect(store.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
    store.db.prepare('INSERT INTO participants VALUES(?,?,?,?)').run('p','hash','now','now');
    store.db.prepare("UPDATE project SET status='open'").run();
    const cmd: DrawCommand = {opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:false,tool:'pixel',colorId:1,size:1,points:[[1,1],[2,1]]};
    expect(store.submit('p',cmd)).toMatchObject({accepted:true,seq:1,duplicate:false});
    expect(()=>store.db.prepare('UPDATE draw_events SET color_id=2 WHERE seq=1').run()).toThrow();
    expect(()=>store.db.prepare('DELETE FROM draw_events WHERE seq=1').run()).toThrow();

    expect(store.submit('p',cmd)).toMatchObject({accepted:true,seq:1,duplicate:true});
    expect(store.submit('p',{...cmd,colorId:2})).toMatchObject({accepted:false,code:'OP_ID_CONFLICT'});
    expect(store.submit('p',{...cmd,colorId:0})).toMatchObject({accepted:false,code:'OP_ID_CONFLICT'});
    expect(store.submit('p',{...cmd,opId:randomUUID(),colorId:0})).toMatchObject({accepted:false,code:'INVALID_COLOR'});
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

it('ne confirme pas une commande dont la transaction échoue',()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-write-fail-'));const store=new Store(join(dir,'db.sqlite'));try{store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open'").run();store.db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON draw_events BEGIN SELECT RAISE(ABORT,'disk failure'); END");const c:DrawCommand={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:1,size:1,points:[[1,1]]};expect(store.submit('p',c)).toMatchObject({accepted:false,code:'STORAGE_UNAVAILABLE'});expect(store.seq).toBe(0);expect(store.grid[721]).toBe(0);expect(store.db.prepare('SELECT count(*) AS n FROM draw_events').get()?.n).toBe(0);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

it('valide un lot atomiquement et annule tout le lot si une écriture échoue',()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-batch-'));const store=new Store(join(dir,'db.sqlite'));try{store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open'").run();const a:DrawCommand={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:1,size:1,points:[[1,1]]},b={...a,opId:randomUUID(),strokeId:randomUUID(),points:[[2,1] as const]};const first=store.submitBatch([{participantId:'p',input:a},{participantId:'p',input:b}]);expect(first.map(x=>x.result)).toMatchObject([{accepted:true,seq:1},{accepted:true,seq:2}]);store.db.exec("CREATE TRIGGER fail_batch BEFORE INSERT ON draw_events WHEN NEW.color_id=2 BEGIN SELECT RAISE(ABORT,'write error'); END");const c={...a,opId:randomUUID(),strokeId:randomUUID(),points:[[3,1] as const]},d={...b,opId:randomUUID(),strokeId:randomUUID(),colorId:2};const failed=store.submitBatch([{participantId:'p',input:c},{participantId:'p',input:d}]);expect(failed.map(x=>x.result)).toMatchObject([{accepted:false,code:'STORAGE_UNAVAILABLE'},{accepted:false,code:'STORAGE_UNAVAILABLE'}]);expect(store.seq).toBe(2);expect(store.grid[723]).toBe(0);expect(store.db.prepare('SELECT count(*) n FROM draw_events').get()?.n).toBe(2);}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
