import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {Store} from '../server/src/database/store';
import {exportArchive} from '../scripts/export-archive';
it('produit une archive privée dont la relecture est autonome',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-archive-test-')), db=join(dir,'db.sqlite'), base=join(dir,'base.png'), zip=join(dir,'export.zip'), unpack=join(dir,'out');const store=new Store(db);
 try{const image=await sharp({create:{width:720,height:480,channels:3,background:{r:100,g:100,b:100}}}).png().toBuffer();writeFileSync(base,image);store.db.prepare('UPDATE project SET base_image_path=?,base_image_checksum=?,status=?').run(base,createHash('sha256').update(image).digest('hex'),'open');store.db.prepare("INSERT INTO participants VALUES('p','secret-hash','now','now')").run();store.submit('p',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'brush',colorId:1,size:5,points:[[5,5]]});await exportArchive({database:db,output:zip,moderation:'moderated'});execFileSync('unzip',['-q',zip,'-d',unpack]);const events=readFileSync(join(unpack,'events.jsonl'),'utf8');expect(events).not.toContain('secret-hash');expect(JSON.parse(readFileSync(join(unpack,'manifest.json'),'utf8')).maxSeq).toBe(1);execFileSync('npm',['ci','--ignore-scripts'],{cwd:join(unpack,'replay'),stdio:'pipe',timeout:120000});execFileSync('npx',['tsx','scripts/replay.ts','1',join(dir,'replayed.png')],{cwd:join(unpack,'replay'),stdio:'pipe',timeout:30000});const a=await sharp(join(dir,'replayed.png')).raw().toBuffer(),b=await sharp(join(unpack,'final.png')).raw().toBuffer();expect(a.equals(b)).toBe(true);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
},180000);
