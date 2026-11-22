import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/src/app';
import {exportVideo} from '../scripts/export-video';
import {Store} from '../server/src/database/store';
import {backupProject} from '../scripts/backup';
import {restoreProject} from '../scripts/restore';
it('produit une copie SQLite cohérente depuis une base active en WAL',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-backup-')),path=join(dir,'live.sqlite'),out=join(dir,'backup');const store=new Store(path);
 try{store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();await backupProject(path,out);await restoreProject(out,join(dir,'restored'));const restored=new DatabaseSync(join(dir,'restored','art.sqlite'));try{expect(restored.prepare('SELECT count(*) n FROM participants').get()?.n).toBe(1);expect(restored.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');expect(readFileSync(join(out,'SHA256SUMS'),'utf8')).toContain('project.sqlite');}finally{restored.close();}}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

it('sert le fond et exporte après déplacement d’un volume restauré',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-moved-')), database=join(dir,'live.sqlite'), store=new Store(database);
 try {
   const png=await sharp({create:{width:720,height:480,channels:3,background:'#888888'}}).png().toBuffer();
   writeFileSync(join(dir,'base.png'),png);
   store.db.prepare('UPDATE project SET base_image_path=?,base_image_checksum=?').run('/ancien/volume/base.png',createHash('sha256').update(png).digest('hex'));
   const backup=join(dir,'backup'), stage=join(dir,'stage'), live=join(dir,'service');
   await backupProject(database,backup);
   await restoreProject(backup,stage);
   renameSync(stage,live);
   const dbPath=join(live,'art.sqlite');
   const {app}=await createApp({dbPath,origin:'http://localhost:4173',secureCookie:false});
   try {
     const response=await app.inject({url:'/api/base.png'});
     expect(response.statusCode).toBe(200);
     expect(response.rawPayload.equals(png)).toBe(true);
     const output=join(dir,'export.mp4');
     await exportVideo({database:dbPath,output,mode:'activity',moderation:'raw',duration:1,fps:2,scale:1});
     expect(readFileSync(output).length).toBeGreaterThan(0);
   } finally { await app.close(); }
 } finally { store.close();rmSync(dir,{recursive:true,force:true}); }
});
