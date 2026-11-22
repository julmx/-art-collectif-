import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io as client, type Socket } from 'socket.io-client';
import { createApp } from '../server/src/app';
import {applyCells, drawPartLength, paintBrush, WIDTH, HEIGHT, type Point} from '../shared/raster';

it('synchronise deux clients et ne rediffuse pas une retransmission', async () => {
  const dir=mkdtempSync(join(tmpdir(),'art-socket-'));
  const {app,store}=await createApp({dbPath:join(dir,'db.sqlite'),origin:'http://localhost:4173',secureCookie:false});
  let a:Socket|undefined,b:Socket|undefined;
  try {
    await app.listen({port:0,host:'127.0.0.1'}); const address=app.server.address(); if (!address || typeof address==='string') throw new Error('address'); const url=`http://127.0.0.1:${address.port}`;
    const session=await app.inject({method:'POST',url:'/api/session',headers:{origin:'http://localhost:4173'}}); expect(session.statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/session',headers:{origin:'http://evil.invalid'}})).statusCode).toBe(403);
    store.db.prepare("UPDATE project SET status='open'").run();
    const cookie=session.headers['set-cookie'] as string;
    const connect = async () => { const s=client(url,{extraHeaders:{cookie,origin:'http://localhost:4173'},transports:['websocket'],autoConnect:false}); const state=new Promise<Record<string,unknown>>(resolve=>s.once('canvas:state',resolve)); s.connect(); expect((await state).seq).toBe(0); return s; };
    a=await connect(); b=await connect();
    const received=new Promise<Record<string,unknown>>(resolve=>b!.once('draw:applied',resolve));
    const command={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:1,size:1,points:[[4,5]]};
    const ack=await a.emitWithAck('draw:submit',command); expect(ack).toMatchObject({accepted:true,seq:1});
    expect(await received).toMatchObject({seq:1,changes:[[3604,1]]});
    const retry=await a.emitWithAck('draw:submit',command); expect(retry).toMatchObject({accepted:true,seq:1,duplicate:true});
    expect(store.db.prepare('SELECT count(*) AS n FROM draw_events').get()?.n).toBe(1);
    const expensive={...command,opId:randomUUID(),strokeId:randomUUID(),tool:'brush',size:21,points:Array.from({length:64},(_,i)=>i%2?[719,479]:[0,0])};
    const refusal=await a.emitWithAck('draw:submit',expensive);expect(refusal).toMatchObject({accepted:false,code:'COST_LIMIT_EXCEEDED'});
    expect(store.db.prepare('SELECT count(*) AS n FROM draw_events').get()?.n).toBe(1);

    const points: Point[] = [[0,10],[719,10],[0,10],[719,10]];
    const pending = [...points];
    const strokeId = randomUUID();
    let partIndex = 0;
    while (pending.length) {
      const part = pending.splice(0, drawPartLength(pending, 21));
      const final = pending.length === 0;
      if (!final) pending.unshift(part.at(-1)!);
      const ack = await a.emitWithAck('draw:submit', {...command, opId:randomUUID(), strokeId, partIndex:partIndex++, tool:'brush', size:21, points:part, final});
      expect(ack).toMatchObject({accepted:true});
    }
    expect(partIndex).toBe(3);
    const expected = new Uint8Array(WIDTH * HEIGHT);
    applyCells(expected, paintBrush([[4,5]], 1, 1));
    applyCells(expected, paintBrush(points, 21, 1));
    expect(store.grid).toEqual(expected);
    expect(store.replay(store.seq, 'moderated', store.revision())).toEqual(expected);

  } finally {a?.disconnect();b?.disconnect();await app.close();rmSync(dir,{recursive:true,force:true});}
},15000);

it('annule les tracés du participant sans effacer ceux des autres', async () => {
  const dir=mkdtempSync(join(tmpdir(),'art-undo-'));
  const {app,store}=await createApp({dbPath:join(dir,'db.sqlite'),origin:'http://localhost:4173',secureCookie:false});
  const sockets:Socket[]=[];
  try {
    await app.listen({port:0,host:'127.0.0.1'});
    const address=app.server.address(); if(!address || typeof address==='string') throw new Error('address');
    store.db.prepare("UPDATE project SET status='open'").run();
    for(let i=0;i<2;i++) {
      const session=await app.inject({method:'POST',url:'/api/session',headers:{origin:'http://localhost:4173'}});
      const socket=client(`http://127.0.0.1:${address.port}`,{extraHeaders:{cookie:session.headers['set-cookie'] as string,origin:'http://localhost:4173'},transports:['websocket'],autoConnect:false});
      sockets.push(socket); const ready=new Promise<void>(resolve=>socket.once('canvas:state',()=>resolve())); socket.connect(); await ready;
    }
    const draw=async (socket:Socket,colorId:number,points:number[][])=>socket.emitWithAck('draw:submit',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'brush',colorId,size:1,points});
    expect((await draw(sockets[0],1,[[4,5],[5,5]])).accepted).toBe(true);
    expect((await draw(sockets[1],2,[[5,5]])).accepted).toBe(true);
    const reset=new Promise<any>(resolve=>sockets[1].once('canvas:reset',resolve));
    expect(await sockets[0].timeout(15000).emitWithAck('draw:undo')).toEqual({ok:true});
    const state=await reset; expect(state.grid[5*720+4]).toBe(0); expect(state.grid[5*720+5]).toBe(2);
    expect(await sockets[0].emitWithAck('draw:undo')).toEqual({ok:false,code:'EMPTY'});
    expect(store.grid[5*720+5]).toBe(2);
  } finally { sockets.forEach(s=>s.disconnect()); await app.close(); rmSync(dir,{recursive:true,force:true}); }
},30000);
