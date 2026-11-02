import type { FastifyInstance } from 'fastify';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Store } from '../database/store';

type Job={id:string;kind:'archive'|'video';status:'running'|'done'|'failed';file:string;error?:string};
export function registerExportJobs(app:FastifyInstance,store:Store,options:{dataDir:string;dbPath:string}) {
  const jobs=new Map<string,Job>();let running:ChildProcess|undefined;
  const dir=join(options.dataDir,'archives');
  app.post('/api/admin/export-jobs',async(req,reply)=>{
    const body=req.body as {kind?:unknown;moderation?:unknown;mode?:unknown;duration?:unknown;fps?:unknown;scale?:unknown;includeVideos?:unknown};
    if(!body || !['archive','video'].includes(String(body.kind)) || !['raw','moderated'].includes(String(body.moderation)))return reply.code(400).send({error:'INVALID_EXPORT'});
    if(body.kind==='archive' && typeof body.includeVideos!=='boolean')return reply.code(400).send({error:'INVALID_EXPORT'});
    if(body.kind==='video' && (!['activity','chronological'].includes(String(body.mode)) || typeof body.duration!=='number' || !Number.isInteger(body.duration) || body.duration<1 || body.duration>600 || typeof body.fps!=='number' || !Number.isInteger(body.fps) || body.fps<1 || body.fps>30 || typeof body.scale!=='number' || !Number.isInteger(body.scale) || body.scale<1 || body.scale>3 || body.duration*body.fps>9000))return reply.code(400).send({error:'INVALID_EXPORT'});
    if(running)return reply.code(429).send({error:'EXPORT_JOB_BUSY'});
    const p=store.db.prepare('SELECT base_image_path,started_at FROM project WHERE id=1').get() as {base_image_path:string|null;started_at:string|null};
    if(!p.base_image_path)return reply.code(409).send({error:'BASE_IMAGE_MISSING'});
    if(!p.started_at && ((body.kind==='video' && body.mode==='chronological') || (body.kind==='archive' && body.includeVideos)))return reply.code(409).send({error:'PROJECT_NOT_STARTED'});
    await mkdir(dir,{recursive:true,mode:0o700});
    // Check again after asynchronous filesystem work before reserving the one worker.
    if(running)return reply.code(429).send({error:'EXPORT_JOB_BUSY'});
    const id=randomUUID(),kind=body.kind as 'archive'|'video',file=`${kind}-${id}.${kind==='archive'?'zip':'mp4'}`,partial=join(dir,`.${id}.partial.${kind==='archive'?'zip':'mp4'}`),output=join(dir,file),captureFile=join(dir,`.${id}.capture.json`),metadataFile=join(dir,`${file}.json`),metadataTemp=join(dir,`.${id}.metadata.json`);
    const script=fileURLToPath(new URL(kind==='archive'?'../../../scripts/export-archive.ts':'../../../scripts/export-video.ts',import.meta.url));
    const args=kind==='archive'?['--database',options.dbPath,'--output',partial,'--moderation',String(body.moderation),'--videos',String(body.includeVideos),'--metadata',captureFile]:['--database',options.dbPath,'--output',partial,'--moderation',String(body.moderation),'--mode',String(body.mode),'--duration',String(body.duration),'--fps',String(body.fps),'--scale',String(body.scale),'--metadata',captureFile];
    const child=spawn('nice',['-n','10',process.execPath,'--max-old-space-size=512','--import','tsx',script,...args],{stdio:['ignore','ignore','pipe'],detached:true});running=child;
    const job:Job={id,kind,status:'running',file};jobs.set(id,job);while(jobs.size>30){const oldest=[...jobs.values()].find(j=>j.status!=='running');if(!oldest)break;jobs.delete(oldest.id);}
    let stderr='';child.stderr?.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-4000);});
    let completed=false;const finish=async(error?:Error)=>{if(completed)return;completed=true;clearTimeout(timer);let published=false;try{if(error)throw error;const capture=JSON.parse(await readFile(captureFile,'utf8')) as {captureCompletedAt:string;sequence:number;moderationRevision:number};const metadata={...capture,completedAt:new Date().toISOString(),kind,moderation:body.moderation,...(kind==='video'?{mode:body.mode,duration:body.duration,fps:body.fps,scale:body.scale}:{includeVideos:body.includeVideos})};await writeFile(metadataTemp,JSON.stringify(metadata),{mode:0o600,flag:'wx'});await rename(metadataTemp,metadataFile);published=true;await rename(partial,output);job.status='done';}catch(err){job.status='failed';job.error='La génération a échoué. Consultez les journaux du serveur.';app.log.error({err,stderr},'Échec de génération d’export');await rm(partial,{force:true}).catch(()=>{});if(published)await rm(metadataFile,{force:true}).catch(()=>{});}finally{await Promise.all([rm(captureFile,{force:true}),rm(metadataTemp,{force:true})]).catch(()=>{});if(running===child)running=undefined;}};
    const timer=setTimeout(()=>{if(child.pid)try{process.kill(-child.pid,'SIGTERM');}catch{}void finish(new Error('Délai de génération dépassé'));},2*60*60*1000);timer.unref();
    child.once('error',err=>void finish(err));child.once('close',code=>void finish(code===0?undefined:new Error(`Export terminé avec le code ${code}`)));
    return reply.code(202).send(job);
  });
  app.get('/api/admin/export-jobs',async(_req,reply)=>reply.header('Cache-Control','no-store').send({jobs:[...jobs.values()].reverse()}));
  app.get('/api/admin/generated',async(_req,reply)=>{const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]);const names=entries.filter(e=>e.isFile()&&/^(archive-[0-9a-f-]{36}\.zip|video-[0-9a-f-]{36}\.mp4)$/.test(e.name)).map(e=>e.name);const items=(await Promise.all(names.map(async file=>{try{const info=await stat(join(dir,file));let metadata:Record<string,unknown>|undefined;try{metadata=JSON.parse(await readFile(join(dir,`${file}.json`),'utf8')) as Record<string,unknown>;}catch{}const completedAt=typeof metadata?.completedAt==='string'&&!Number.isNaN(Date.parse(metadata.completedAt))?metadata.completedAt:undefined;return {file,kind:file.startsWith('video-')?'video':'archive',date:completedAt??info.mtime.toISOString(),dateKind:completedAt?'created':'modified',size:info.size,metadata:metadata??null};}catch{return null;}}))).filter(item=>item!==null).sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.file.localeCompare(b.file));return reply.header('Cache-Control','no-store').send({files:items.map(item=>item.file),items});});
  app.get('/api/admin/generated/:file',async(req,reply)=>{const name=(req.params as {file:string}).file;if(!/^(archive-[0-9a-f-]{36}\.zip|video-[0-9a-f-]{36}\.mp4)$/.test(name))return reply.code(404).send();try{const root=await realpath(dir),path=await realpath(join(root,name));if(!path.startsWith(root+'/')||!(await stat(path)).isFile())return reply.code(404).send();return reply.header('Cache-Control','no-store').header('Content-Disposition',`attachment; filename="${name}"`).type(name.endsWith('.zip')?'application/zip':'video/mp4').send(createReadStream(path));}catch{return reply.code(404).send();}});
  app.addHook('onClose',async()=>{if(running?.pid)try{process.kill(-running.pid,'SIGTERM');}catch{}});
}
