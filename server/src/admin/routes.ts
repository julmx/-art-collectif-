import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { writeFile, rename, readFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { validPalette } from '../../../shared/palette';
import { WIDTH, HEIGHT } from '../../../shared/raster';
import type { Store } from '../database/store';
import { registerExports } from './exports';
import { registerExportJobs } from './jobs';
import { applyModeration } from './moderation-apply';
import { registerModerationView } from './moderation-view';

export function registerAdmin(app:FastifyInstance,store:Store,io:Server,options:{dataDir:string;dbPath:string;passwordHash?:string;secureCookie:boolean; state:()=>unknown}) {
  const sessions=new Map<string,number>(), attempts=new Map<string,{count:number;until:number}>();
  const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
  const verify=(password:string) => {
    const [salt,digest] = (options.passwordHash || '').split(':');
    if (!salt || !/^[a-f0-9]{32}$/i.test(salt) || !digest || !/^[a-f0-9]{128}$/i.test(digest)) return false;
    const actual=scryptSync(password,Buffer.from(salt,'hex'),64); return timingSafeEqual(actual,Buffer.from(digest,'hex'));
  };
  const authorized=(token:string|undefined) => { if (!token) return false; const expiry=sessions.get(hash(token)); return !!expiry && expiry>Date.now(); };
  app.addHook('preHandler',async (req,reply)=>{ if (req.url.startsWith('/api/admin/') && req.url.split('?')[0] !== '/api/admin/login' && !authorized(req.cookies.art_admin)) return reply.code(401).send({error:'UNAUTHENTICATED'}); });
  registerExports(app,store,options.dbPath);
  registerExportJobs(app,store,options);
  registerModerationView(app,store,io,options.dbPath,options.state);
  app.post('/api/admin/login',async (req,reply)=>{
    const attempt=attempts.get(req.ip); if(attempt && attempt.until>Date.now() && attempt.count>=5) return reply.code(429).send({error:'RATE_LIMITED'});
    const password=(req.body as {password?:unknown})?.password;
    if(typeof password !== 'string' || password.length>512 || !verify(password)) { const current=attempt && attempt.until>Date.now() ? attempt : {count:0,until:Date.now()+15*60_000}; current.count++; attempts.set(req.ip,current); return reply.code(401).send({error:'INVALID_CREDENTIALS'}); }
    attempts.delete(req.ip); const token=randomBytes(32).toString('hex'); sessions.set(hash(token),Date.now()+8*60*60_000); reply.setCookie('art_admin',token,{httpOnly:true,secure:options.secureCookie,sameSite:'strict',path:'/api/admin',maxAge:8*60*60}); return {ok:true};
  });
  app.post('/api/admin/logout',async (req,reply)=>{ if(req.cookies.art_admin) sessions.delete(hash(req.cookies.art_admin)); reply.clearCookie('art_admin',{path:'/api/admin'}); return {ok:true}; });
  app.addContentTypeParser('image/png',{parseAs:'buffer',bodyLimit:5*1024*1024},(_req,body,done)=>done(null,body));
  app.post('/api/admin/base-image',async (req,reply)=>{
    if ((store.db.prepare('SELECT status FROM project WHERE id=1').get() as {status:string}).status !== 'draft') return reply.code(409).send({error:'PROJECT_LOCKED'});
    if(!Buffer.isBuffer(req.body)) return reply.code(400).send({error:'INVALID_PNG'});
    try {
      const metadata=await sharp(req.body,{limitInputPixels:false}).metadata();
      if(metadata.format!=='png'||metadata.pages && metadata.pages!==1) return reply.code(400).send({error:'INVALID_PNG'});
      if(metadata.width!==WIDTH||metadata.height!==HEIGHT) return reply.code(400).send({error:'PNG_DIMENSIONS'});
      const {data,info}=await sharp(req.body,{limitInputPixels:WIDTH*HEIGHT}).ensureAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
      if(info.channels!==4) throw new Error();
      let transparent=false,colored=false;for(let i=0;i<data.length;i+=4){if(data[i+3]!==255)transparent=true;if(data[i]!==data[i+1]||data[i]!==data[i+2])colored=true;}
      if(transparent)return reply.code(400).send({error:'PNG_TRANSPARENT'});
      if(colored)return reply.code(400).send({error:'PNG_NOT_GRAYSCALE'});
    } catch {return reply.code(400).send({error:'INVALID_PNG'});}
      await mkdir(options.dataDir,{recursive:true,mode:0o700}); const digest=createHash('sha256').update(req.body).digest('hex'); const name=`base-${digest}.png`, path=join(options.dataDir,name), temp=join(options.dataDir,`.${randomBytes(12).toString('hex')}.tmp`);
      await writeFile(temp,req.body,{mode:0o600,flag:'wx'}); await rename(temp,path);
      // Another request could open the project while the PNG is being decoded.
      const result=store.db.prepare("UPDATE project SET base_image_path=?,base_image_checksum=? WHERE id=1 AND status='draft'").run(path,digest);
      if(!result.changes) return reply.code(409).send({error:'PROJECT_LOCKED'});
      return {ok:true,checksum:digest};
  });
  app.get('/api/admin/config',async(_req,reply)=>{const p=store.db.prepare('SELECT status,palette_json,title,description,participation_terms,started_at,closed_at FROM project WHERE id=1').get() as {status:string;palette_json:string;title:string;description:string;participation_terms:string;started_at:string|null;closed_at:string|null};return reply.header('Cache-Control','no-store').send({status:p.status,palette:JSON.parse(p.palette_json),title:p.title,description:p.description,participationTerms:p.participation_terms,startedAt:p.started_at,closedAt:p.closed_at});});
  app.put('/api/admin/config',{bodyLimit: 256 * 1024},async(req,reply)=>{
    const body=req.body as {palette?:unknown;title?:unknown;description?:unknown;participationTerms?:unknown};
    if (!body || !Array.isArray(body.palette) || !validPalette(body.palette) || typeof body.title!=='string' || !body.title.trim() || body.title.length>160 || typeof body.description!=='string' || body.description.length>4000 || typeof body.participationTerms!=='string' || !body.participationTerms.trim() || body.participationTerms.length>20000) return reply.code(400).send({error:'INVALID_CONFIG'});
    const current=store.db.prepare('SELECT status,palette_json,participation_terms FROM project WHERE id=1').get() as {status:string;palette_json:string;participation_terms:string};
    if(current.status!=='draft' && JSON.stringify((JSON.parse(current.palette_json) as string[]).map(c=>c.toLowerCase()))!==JSON.stringify((body.palette as string[]).map(c=>c.toLowerCase()))) return reply.code(409).send({error:'PROJECT_LOCKED'});
    store.db.exec('BEGIN IMMEDIATE');try {
      store.db.prepare('UPDATE project SET palette_json=?,title=?,description=?,participation_terms=? WHERE id=1').run(current.status==='draft'?JSON.stringify(body.palette):current.palette_json,body.title,body.description,body.participationTerms);
      if(current.participation_terms!==body.participationTerms) store.db.prepare('INSERT INTO terms_history(terms,effective_after_seq,created_at) VALUES(?,?,?)').run(body.participationTerms,store.seq,new Date().toISOString());
      store.db.exec('COMMIT');
    } catch(error){store.db.exec('ROLLBACK');throw error;}
    io.emit('project:updated');return {ok:true};
  });
  app.post('/api/admin/status',async(req,reply)=>{
    const body=req.body as {status?:unknown;confirmation?:unknown},next=body?.status; const p=store.db.prepare('SELECT * FROM project WHERE id=1').get() as {status:string;base_image_path:string|null;palette_json:string;participation_terms:string;started_at:string|null};
    const allowed:Record<string,string[]>={draft:['open'],open:['paused','closed'],paused:['open','closed'],closed:[]};
    if(typeof next!=='string' || !allowed[p.status].includes(next)) return reply.code(409).send({error:'INVALID_TRANSITION'});
    if(next==='closed' && body.confirmation!=='CLOTURER') return reply.code(400).send({error:'CLOSURE_CONFIRMATION_REQUIRED'});
    if(next==='open' && (!p.base_image_path || !validPalette(JSON.parse(p.palette_json)) || !p.participation_terms.trim())) return reply.code(409).send({error:'PROJECT_NOT_CONFIGURED'});
    const now=new Date().toISOString(); store.db.prepare('UPDATE project SET status=?, started_at=?, closed_at=? WHERE id=1').run(next,p.started_at || (next==='open'?now:null),next==='closed'?now:null);
    io.emit('project:status',{status:next}); if(next==='open') io.emit('canvas:reset',options.state()); return {ok:true,status:next};
  });
  app.get('/api/admin/events',async(req,reply)=>{
    const q=req.query as {after?:string;limit?:string}; const after=Number(q.after || 0), limit=Number(q.limit || 100);
    if (!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100) return reply.code(400).send({error:'INVALID_QUERY'});
    reply.header('Cache-Control','no-store'); return {events:store.db.prepare('SELECT seq,participant_id,command_json,created_at FROM draw_events WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit)};
  });
  app.post('/api/admin/moderation',async(req,reply)=>{
    const b=req.body as {participantId?:unknown;strokeId?:unknown;action?:unknown;reason?:unknown};
    if(typeof b?.participantId!=='string'||typeof b.strokeId!=='string'||(b.action!=='hide'&&b.action!=='restore')||(b.reason!==undefined&&typeof b.reason!=='string')) return reply.code(400).send({error:'INVALID_MODERATION'});
    try { const revision=await applyModeration(store,options.dbPath,[{participantId:b.participantId,strokeId:b.strokeId}],b.action,typeof b.reason==='string'?b.reason:'',store.seq,store.revision()); io.emit('canvas:reset',options.state()); return {revision}; } catch(error) {if(error instanceof Error && error.message==='MODERATION_BUSY')return reply.code(429).send({error:'MODERATION_BUSY'});if(error instanceof Error && error.message==='MODERATION_STATE_CHANGED')return reply.code(409).send({error:'MODERATION_STATE_CHANGED'});if(!store.healthy){io.disconnectSockets(true);return reply.code(503).send({error:'STORAGE_UNAVAILABLE'});}if(error instanceof Error && error.message==='INVALID_MODERATION')return reply.code(400).send({error:'INVALID_MODERATION'});app.log.error(error,'moderation rebuild failed');return reply.code(503).send({error:'STORAGE_UNAVAILABLE'});}
  });
  app.post('/api/admin/participant-sanction',async(req,reply)=>{
    const b=req.body as {participantId?:unknown;action?:unknown;reason?:unknown;confirmation?:unknown};
    if(typeof b?.participantId!=='string'||(b.action!=='ban'&&b.action!=='unban')||(b.reason!==undefined&&typeof b.reason!=='string')||(b.action==='ban'&&b.confirmation!=='BANNIR'))return reply.code(400).send({error:'INVALID_SANCTION'});
    try{store.sanction(b.participantId,b.action,typeof b.reason==='string'?b.reason:'');for(const socket of io.sockets.sockets.values())if(socket.data.participantId===b.participantId)socket.emit('participant:restriction',{banned:b.action==='ban'});return {ok:true,banned:b.action==='ban'};}catch{return reply.code(400).send({error:'INVALID_SANCTION'});}
  });
  app.get('/api/admin/archives',async(_req,reply)=>{
    const dir=join(options.dataDir,'archives'); const entries=await readdir(dir,{withFileTypes:true}).catch(()=>[]); const archives=entries.filter(e=>e.isFile()&&/^[A-Za-z0-9_-]{1,100}\.zip$/.test(e.name)).map(e=>({id:e.name.slice(0,-4)}));return reply.header('Cache-Control','no-store').send({archives});
  });
  app.get('/api/admin/archives/:archiveId',async(req,reply)=>{
    const id=(req.params as {archiveId:string}).archiveId;if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))return reply.code(404).send();
    try {const dir=await realpath(join(options.dataDir,'archives')),file=await realpath(join(dir,`${id}.zip`));if(!file.startsWith(dir+'/')||!(await stat(file)).isFile())return reply.code(404).send();return reply.header('Cache-Control','no-store').header('Content-Disposition',`attachment; filename="${id}.zip"`).type('application/zip').send(createReadStream(file));} catch{return reply.code(404).send();}
  });
  app.get('/api/base.png',async (_req,reply)=>{ const p=store.db.prepare('SELECT base_image_path FROM project WHERE id=1').get() as {base_image_path:string|null}; if(!p.base_image_path || !resolve(p.base_image_path).startsWith(resolve(options.dataDir)+'/')) return reply.code(404).send(); try {return reply.header('Cache-Control','no-store').type('image/png').send(await readFile(p.base_image_path));} catch {return reply.code(404).send();} });
}
