import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Server } from 'socket.io';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Store } from './database/store';
import { WIDTH, HEIGHT, paintBrush } from '../../shared/raster';
import { PALETTE } from '../../shared/palette';
import type { DrawCommand } from '../../shared/protocol';
import { registerAdmin } from './admin/routes';
import { dirname } from 'node:path';

export async function createApp(options: { dbPath: string; origin: string; secureCookie?: boolean; adminPasswordHash?:string }) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  await app.register(cookie);
  const store = new Store(options.dbPath);
  const io = new Server(app.server, { maxHttpBufferSize: 16384, cors: { origin: options.origin }, allowRequest: (req, cb) => cb(null, !req.headers.origin || req.headers.origin === options.origin) });
  const hash = (token:string) => createHash('sha256').update(token).digest('hex');
  const identity = (token: string | undefined) => token && /^[a-f0-9]{64}$/.test(token) ? store.db.prepare('SELECT id FROM participants WHERE token_hash=?').get(hash(token)) as {id:string}|undefined : undefined;
  app.addHook('onRequest', async (request, reply) => { if (request.method !== 'GET' && request.headers.origin !== options.origin) return reply.code(403).send({error:'ORIGIN_FORBIDDEN'}); });
  app.get('/api/health', async () => ({ready:true}));
  app.get('/api/project', async () => { const row = store.db.prepare('SELECT status,palette_json,title,description,participation_terms FROM project WHERE id=1').get() as {status:string;palette_json:string;title:string;description:string;participation_terms:string}; return {width:WIDTH,height:HEIGHT,status:row.status,palette:JSON.parse(row.palette_json),title:row.title,description:row.description,participationTerms:row.participation_terms}; });
  app.post('/api/session', async (request, reply) => {
    let participant = identity(request.cookies.art_session);
    if (!participant) { const token = randomBytes(32).toString('hex'), now = new Date().toISOString(); participant = {id:randomUUID()}; store.db.prepare('INSERT INTO participants(id,token_hash,created_at,last_seen_at) VALUES(?,?,?,?)').run(participant.id,hash(token),now,now); reply.setCookie('art_session',token,{httpOnly:true,secure:options.secureCookie !== false,sameSite:'strict',path:'/',maxAge:90*24*60*60}); }
    return {ok:true};
  });
  io.use((socket,next) => { const raw = socket.handshake.headers.cookie || ''; const token = raw.split(';').map(x => x.trim()).find(x => x.startsWith('art_session='))?.slice('art_session='.length); const participant = identity(token); if (!participant) return next(new Error('UNAUTHENTICATED')); socket.data.participantId = participant.id; next(); });
  function state() { const p = store.db.prepare('SELECT status,palette_json,moderation_revision FROM project WHERE id=1').get() as {status:string;palette_json:string;moderation_revision:number}; return {width:WIDTH,height:HEIGHT,grid:Array.from(store.grid),palette:JSON.parse(p.palette_json) as typeof PALETTE,seq:store.seq,moderationRevision:p.moderation_revision,status:p.status}; }
  registerAdmin(app,store,io,{dataDir:dirname(options.dbPath),passwordHash:options.adminPasswordHash,secureCookie:options.secureCookie !== false,state});
  // Per-participant token bucket: burst 40, sustained 20 commands per second.
  const buckets = new Map<string,{tokens:number; time:number}>();
  io.on('connection', socket => {
    socket.emit('canvas:state',state());
    socket.on('disconnect', () => { if (![...io.sockets.sockets.values()].some(s => s.data.participantId === socket.data.participantId)) buckets.delete(socket.data.participantId as string); });
    socket.on('canvas:resync', () => socket.emit('canvas:state',state()));
    socket.on('draw:submit',(input:unknown,ack:unknown) => {
      if (typeof ack !== 'function') return;
      const id = socket.data.participantId as string, now = Date.now();
      const bucket = buckets.get(id) ?? {tokens:40,time:now};
      bucket.tokens = Math.min(40,bucket.tokens + (now-bucket.time)*0.02); bucket.time=now;
      buckets.set(id,bucket);
      if (bucket.tokens < 1) { (ack as (r:unknown)=>void)({opId:typeof (input as {opId?:unknown})?.opId === 'string' ? (input as {opId:string}).opId : '',accepted:false,code:'RATE_LIMITED'}); return; }
      bucket.tokens -= 1;
      const result = store.submit(socket.data.participantId as string,input);
      (ack as (r:unknown)=>void)(result);
      if (!result.accepted || result.duplicate) return;
      const command = input as DrawCommand;
      const cells = store.hidden(socket.data.participantId as string,command.strokeId,store.revision()) ? [] : paintBrush(command.points,command.size,command.colorId);
      const unique = new Map<number,number>(); for (const [x,y,color] of cells) unique.set(y*WIDTH+x,color);
      const revision = (store.db.prepare('SELECT moderation_revision FROM project WHERE id=1').get() as {moderation_revision:number}).moderation_revision;
      io.emit('draw:applied',{seq:result.seq,moderationRevision:revision,changes:[...unique]});
    });
  });
  app.addHook('onClose', async () => { io.close(); store.close(); });
  return {app,store,io};
}
