import { it,expect } from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/src/database/store';
import {Snapshots} from '../server/src/renderer/snapshots';
it('validates snapshots and falls back when a cache is corrupt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-snapshot-'));const store=new Store(join(dir,'db.sqlite'));try{const cache=new Snapshots(store,join(dir,'snapshots'));store.grid[0]=4;store.seq=500;await cache.saveIfDue();expect((await cache.latest(500,0))?.grid[0]).toBe(4);expect(await cache.latest(500,1)).toBeNull();const row=store.db.prepare('SELECT file_path FROM snapshots').get() as {file_path:string};writeFileSync(row.file_path,'broken');expect(await cache.latest(500,0)).toBeNull();}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

it('a compatible snapshot and subsequent events match a full replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-snapshot-replay-'));const store=new Store(join(dir,'db.sqlite'));try{const {randomUUID}=await import('node:crypto');store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open'").run();const cache=new Snapshots(store,join(dir,'snapshots'));const command={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel' as const,colorId:3,size:1,points:[[10,20] as const]};store.submit('p',command);await cache.saveIfDue(Date.now()+16*60_000);const snapshot=await cache.latest(1,0);expect(snapshot).not.toBeNull();store.submit('p',{...command,opId:randomUUID(),strokeId:randomUUID(),points:[[30,40]]});expect(store.replay(2,'moderated',0,snapshot!)).toEqual(store.replay(2,'moderated',0));}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

it('reconstruit au démarrage avec un snapshot valide ou corrompu',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-start-')),path=join(dir,'db.sqlite');const store=new Store(path);const {randomUUID}=await import('node:crypto');let file='';try{store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open'").run();const cache=new Snapshots(store,join(dir,'snapshots'));store.submit('p',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:4,size:1,points:[[9,9]]});await cache.saveIfDue(Date.now()+16*60_000);file=(store.db.prepare('SELECT file_path FROM snapshots').get() as {file_path:string}).file_path;}finally{store.close();}
 try{const {createApp}=await import('../server/src/app');let server=await createApp({dbPath:path,origin:'http://localhost:4173'});expect(server.store.grid[9*720+9]).toBe(4);await server.app.ready();await server.app.close();writeFileSync(file,'corrompu');server=await createApp({dbPath:path,origin:'http://localhost:4173'});expect(server.store.grid[9*720+9]).toBe(4);await server.app.ready();await server.app.close();}finally{rmSync(dir,{recursive:true,force:true});}
},15000);
