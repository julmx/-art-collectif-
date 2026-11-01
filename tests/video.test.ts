import { it,expect } from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {Store} from '../server/src/database/store';
import {exportVideo} from '../scripts/export-video';
it('produit une vidéo à partir d’une capture et refuse le rythme chronologique avant ouverture',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-video-test-')), db=join(dir,'db.sqlite'), base=join(dir,'base.png'), output=join(dir,'video.mp4');const store=new Store(db);
 try {const image=await sharp({create:{width:720,height:480,channels:3,background:{r:128,g:128,b:128}}}).png().toBuffer();writeFileSync(base,image);store.db.prepare('UPDATE project SET base_image_path=?,base_image_checksum=?').run(base,createHash('sha256').update(image).digest('hex'));const params={database:db,output,mode:'chronological' as const,moderation:'raw' as const,duration:1,fps:2,scale:1};await expect(exportVideo(params)).rejects.toThrow('avant ouverture');store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open',started_at=?").run(new Date(Date.now()-1000).toISOString());store.submit('p',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'brush',colorId:1,size:21,points:[[20,20]]});await exportVideo(params);const result=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames','-of','json',output],{encoding:'utf8'}));expect(result.streams[0]).toMatchObject({width:720,height:480,nb_read_frames:'2'});
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
},30000);
