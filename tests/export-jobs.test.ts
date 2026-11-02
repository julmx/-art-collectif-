import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,scryptSync} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/src/app';

it('crée des archives et vidéos privées et refuse les paramètres invalides',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-jobs-')),salt=randomBytes(16),password='mot-de-passe-test',passwordHash=`${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`;
 const {app}=await createApp({dbPath:join(dir,'art.sqlite'),origin:'http://localhost:4173',secureCookie:false,adminPasswordHash:passwordHash});
 const origin='http://localhost:4173';
 try{
  expect((await app.inject({method:'POST',url:'/api/admin/export-jobs',headers:{origin},payload:{kind:'archive',moderation:'raw',includeVideos:false}})).statusCode).toBe(401);
  const login=await app.inject({method:'POST',url:'/api/admin/login',headers:{origin},payload:{password}}),cookie=(login.headers['set-cookie'] as string).split(';')[0],headers={origin,cookie};
  const base=await sharp({create:{width:720,height:480,channels:3,background:'#808080'}}).png().toBuffer();expect((await app.inject({method:'POST',url:'/api/admin/base-image',headers:{...headers,'content-type':'image/png'},payload:base})).statusCode).toBe(200);
  expect((await app.inject({method:'POST',url:'/api/admin/export-jobs',headers,payload:{kind:'video',mode:'activity',moderation:'raw',duration:600,fps:30,scale:1}})).statusCode).toBe(400);
  async function generate(payload:object){const start=await app.inject({method:'POST',url:'/api/admin/export-jobs',headers,payload});expect(start.statusCode).toBe(202);const id=start.json().id;let job;for(let i=0;i<150;i++){await new Promise(r=>setTimeout(r,100));const response=await app.inject({method:'GET',url:'/api/admin/export-jobs',headers:{cookie}});job=response.json().jobs.find((j:{id:string})=>j.id===id);if(job.status!=='running')break;}expect(job.status,job.error).toBe('done');expect((await app.inject({method:'GET',url:`/api/admin/generated/${job.file}`})).statusCode).toBe(401);const download=await app.inject({method:'GET',url:`/api/admin/generated/${job.file}`,headers:{cookie}});expect(download.statusCode).toBe(200);expect(download.rawPayload.length).toBeGreaterThan(100);return job.file;}
  const archive=await generate({kind:'archive',moderation:'moderated',includeVideos:false});const video=await generate({kind:'video',mode:'activity',moderation:'moderated',duration:1,fps:2,scale:1});
  const files=(await app.inject({method:'GET',url:'/api/admin/generated',headers:{cookie}})).json().files;expect(files).toContain(archive);expect(files).toContain(video);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
},40000);
