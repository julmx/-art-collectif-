import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync, backup } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp, { type Sharp } from 'sharp';
import { WIDTH,HEIGHT } from '../../../shared/raster';
import type { Store } from '../database/store';
import type { Snapshots } from '../renderer/snapshots';

type Query={seq?:string;at?:string;moderation?:string;scale?:string};
export function registerExports(app:FastifyInstance,store:Store,snapshots:Snapshots,dbPath:string) {
  let active=0;
  async function image(req:FastifyRequest,reply:FastifyReply,overlayOnly:boolean) {
    const q=req.query as Query, p=store.db.prepare('SELECT palette_json,base_image_path,moderation_revision FROM project WHERE id=1').get() as {palette_json:string;base_image_path:string|null;moderation_revision:number};
    const mode=q.moderation || 'moderated', scale=q.scale===undefined?1:Number(q.scale);
    if ((mode!=='raw'&&mode!=='moderated') || !Number.isInteger(scale)||scale<1||scale>8 || (q.seq!==undefined&&q.at!==undefined)) return reply.code(400).send({error:'INVALID_QUERY'});
    let target=store.seq;
    if(q.seq!==undefined) { if(!/^(0|[1-9]\d*)$/.test(q.seq)) return reply.code(400).send({error:'INVALID_QUERY'}); target=Number(q.seq); if(!Number.isSafeInteger(target)||target>store.seq) return reply.code(400).send({error:'INVALID_QUERY'}); }
    if(q.at!==undefined) { if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(q.at)||Number.isNaN(Date.parse(q.at))) return reply.code(400).send({error:'INVALID_QUERY'}); const date=new Date(q.at).toISOString(); target=Number((store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM draw_events WHERE created_at<=?').get(date) as {seq:number}).seq); }
    if(!overlayOnly && !p.base_image_path) return reply.code(409).send({error:'BASE_IMAGE_MISSING'});
    const cache=mode==='moderated' ? await snapshots.latest(target,p.moderation_revision) : null;
    const grid=store.replay(target,mode,p.moderation_revision,cache ?? undefined), palette=JSON.parse(p.palette_json) as string[];
    const pixels=Buffer.alloc(WIDTH*HEIGHT*4);
    for(let i=0;i<grid.length;i++) if(grid[i]) {const hex=palette[grid[i]-1]; pixels[i*4]=parseInt(hex.slice(1,3),16);pixels[i*4+1]=parseInt(hex.slice(3,5),16);pixels[i*4+2]=parseInt(hex.slice(5,7),16);pixels[i*4+3]=255;}
    let image:Sharp;
    if(overlayOnly) image=sharp(pixels,{raw:{width:WIDTH,height:HEIGHT,channels:4}});
    else { const background=await readFile(p.base_image_path!); image=sharp(background).composite([{input:pixels,raw:{width:WIDTH,height:HEIGHT,channels:4}}]); }
    const native=await image.png().toBuffer();
    const output=scale===1 ? native : await sharp(native).resize(WIDTH*scale,HEIGHT*scale,{kernel:'nearest'}).png().toBuffer();
    return reply.header('Cache-Control','no-store').header('X-Art-Sequence',target).header('X-Art-Moderation-Revision',p.moderation_revision).header('X-Art-Moderation',mode).type('image/png').send(output);
  }
  const imageRoute=(overlay:boolean)=>async(req:FastifyRequest,reply:FastifyReply)=>{if(active>=2)return reply.code(429).send({error:'EXPORT_BUSY'});active++;try{return await image(req,reply,overlay);}finally{active--;}};
  app.get('/api/admin/image.png',imageRoute(false));
  app.get('/api/admin/export/final.png',imageRoute(false));
  app.get('/api/admin/export/overlay.png',imageRoute(true));
  async function jsonl(reply:FastifyReply,kind:'events'|'moderation') {
    if(active>=2)return reply.code(429).send({error:'EXPORT_BUSY'});active++;
    let dir:string|undefined,source:DatabaseSync|undefined,copy:DatabaseSync|undefined,handedOff=false;
    try {
      dir=await mkdtemp(join(tmpdir(),'art-jsonl-'));source=new DatabaseSync(dbPath,{readOnly:true});await backup(source,join(dir,'capture.sqlite'));source.close();source=undefined;copy=new DatabaseSync(join(dir,'capture.sqlite'),{readOnly:true});
      const database=copy, directory=dir;
      function* rows(){if(kind==='events'){for(const row of database.prepare('SELECT seq,participant_id,command_json,created_at FROM draw_events ORDER BY seq').iterate() as IterableIterator<{seq:number;participant_id:string;command_json:string;created_at:string}>)yield JSON.stringify({seq:row.seq,participantId:row.participant_id,...JSON.parse(row.command_json),createdAt:row.created_at})+'\n';}else for(const row of database.prepare('SELECT revision,participant_id,stroke_id,action,reason,created_at FROM moderation_actions ORDER BY revision').iterate())yield JSON.stringify(row)+'\n';}
      const stream=Readable.from(rows()),cleanup=()=>{if(!handedOff)return;handedOff=false;database.close();void rm(directory,{recursive:true,force:true});active--;};handedOff=true;stream.once('close',cleanup);stream.once('error',cleanup);reply.raw.once('close',()=>stream.destroy());
      return reply.header('Cache-Control','no-store').type('application/x-ndjson').send(stream);
    } catch(error){source?.close();if(!handedOff){copy?.close();if(dir)await rm(dir,{recursive:true,force:true});active--;}throw error;}
  }
  app.get('/api/admin/export/events.jsonl',(_req,reply)=>jsonl(reply,'events'));
  app.get('/api/admin/export/moderation.jsonl',(_req,reply)=>jsonl(reply,'moderation'));
}
