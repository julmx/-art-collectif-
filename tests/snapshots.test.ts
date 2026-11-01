import { it,expect } from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/src/database/store';
import {Snapshots} from '../server/src/renderer/snapshots';
it('validates snapshots and falls back when a cache is corrupt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-snapshot-'));const store=new Store(join(dir,'db.sqlite'));try{const cache=new Snapshots(store,join(dir,'snapshots'));store.grid[0]=4;store.seq=500;await cache.saveIfDue();expect((await cache.latest(500,0))?.grid[0]).toBe(4);expect(await cache.latest(500,1)).toBeNull();const row=store.db.prepare('SELECT file_path FROM snapshots').get() as {file_path:string};writeFileSync(row.file_path,'broken');expect(await cache.latest(500,0)).toBeNull();}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
