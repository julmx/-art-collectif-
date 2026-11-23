import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
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
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
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
    const resetSelf=new Promise<any>(resolve=>sockets[0].once('canvas:reset',resolve));
    const resetOther=new Promise<any>(resolve=>sockets[1].once('canvas:reset',resolve));
    expect(await sockets[0].timeout(15000).emitWithAck('draw:undo')).toEqual({ok:true});
    const stateSelf=await resetSelf, state=await resetOther;
    expect(stateSelf.preserveLocalStroke).toBeFalsy();
    expect(state.preserveLocalStroke).toBe(true);
    expect('participantId' in stateSelf).toBe(false);
    expect('participantId' in state).toBe(false);
    expect(state.grid).toBeInstanceOf(Uint8Array);
    expect(state.grid.length).toBe(WIDTH * HEIGHT);
    expect(state.grid[5*720+4]).toBe(0); expect(state.grid[5*720+5]).toBe(2);
    expect(await sockets[1].emitWithAck('draw:undo')).toEqual({ok:false,code:'RATE_LIMITED'});

    now += 1000;
    const participant = sockets[0];
    participant.disconnect();
    const reconnected = new Promise<void>(resolve => participant.once('canvas:state', resolve));
    participant.connect();
    await reconnected;
    expect(await participant.emitWithAck('draw:undo')).toEqual({ok:false,code:'RATE_LIMITED'});
    expect(store.revision()).toBe(1);

    now += 2000;
    expect(await sockets[0].emitWithAck('draw:undo')).toEqual({ok:false,code:'EMPTY'});
    expect(store.grid[5*720+5]).toBe(2);
  } finally { clock.mockRestore(); sockets.forEach(s=>s.disconnect()); await app.close(); rmSync(dir,{recursive:true,force:true}); }
},30000);

it('regroupe les resynchronisations et déconnecte un transport dont la file reste pleine', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-resync-'));
  const origin = 'http://localhost:4173';
  const {app, store, io} = await createApp({dbPath:join(dir, 'db.sqlite'), origin, secureCookie:false});
  const sockets: Socket[] = [];
  let spam: NodeJS.Timeout | undefined;
  try {
    await app.listen({port:0, host:'127.0.0.1'});
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    store.db.prepare("UPDATE project SET status='open'").run();
    for (let i = 0; i < 2; i++) {
      const session = await app.inject({method:'POST', url:'/api/session', headers:{origin}});
      const socket = client(`http://127.0.0.1:${address.port}`, {extraHeaders:{cookie:session.headers['set-cookie'] as string, origin}, transports:[i === 0 ? 'websocket' : 'polling'], autoConnect:false});
      sockets.push(socket);
      const ready = new Promise<void>(resolve => socket.once('canvas:state', resolve));
      socket.connect();
      await ready;
    }

    const [slow, normal] = sockets;
    const peer = io.sockets.sockets.get(slow.id!)!;
    const transport = peer.conn.transport;
    // Hold the first batch after Engine.IO has handed it to the transport.
    const send = vi.spyOn(transport, 'send').mockImplementationOnce(() => {
      transport.writable = false;
    });
    spam = setInterval(() => slow.emit('canvas:resync'), 20);
    await delay(200);
    expect(io.sockets.sockets.has(peer.id)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(peer.data.queuedBytes).toBeGreaterThan(0);
    expect(peer.data.queuedBytes).toBeLessThan(2 * 1024 * 1024);

    const ack = await normal.timeout(1000).emitWithAck('draw:submit', {
      opId:randomUUID(), strokeId:randomUUID(), partIndex:0, final:true, tool:'pixel', colorId:1, size:1, points:[[2,2]],
    });
    expect(ack).toMatchObject({accepted:true, seq:1});
    const bytesWithStateAndDraw = peer.data.queuedBytes;
    // Completing the first write releases its state, while the newer draw is still queued.
    transport.emit('drain');
    expect(peer.data.queuedBytes).toBeGreaterThan(0);
    expect(peer.data.queuedBytes).toBeLessThan(bytesWithStateAndDraw);
    await expect.poll(() => io.sockets.sockets.has(peer.id), {timeout:6000}).toBe(false);

    const state = new Promise<{seq:number}>(resolve => normal.once('canvas:state', resolve));
    normal.emit('canvas:resync');
    expect(await state).toMatchObject({seq:1});
    const normalPeer = io.sockets.sockets.get(normal.id!)!;
    await expect.poll(() => normalPeer.data.queuedBytes).toBe(0);
  } finally {
    clearInterval(spam);
    sockets.forEach(socket => socket.disconnect());
    await app.close();
    rmSync(dir, {recursive:true, force:true});
  }
}, 15000);

it('refuse draw:undo si le projet cesse d’être ouvert ou si le participant est banni pendant la reconstruction', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-undo-race-'));
  const origin = 'http://localhost:4173';
  const {app, store} = await createApp({dbPath:join(dir, 'db.sqlite'), origin, secureCookie:false});
  let socket: Socket | undefined;
  let now = performance.now();
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    await app.listen({port:0, host:'127.0.0.1'});
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    store.db.prepare("UPDATE project SET status='open'").run();
    const session = await app.inject({method:'POST', url:'/api/session', headers:{origin}});
    socket = client(`http://127.0.0.1:${address.port}`, {
      extraHeaders:{cookie:session.headers['set-cookie'] as string, origin},
      transports:['websocket'],
      autoConnect:false,
    });
    const ready = new Promise<void>(resolve => socket!.once('canvas:state', () => resolve()));
    socket.connect();
    await ready;
    const ack = await socket.emitWithAck('draw:submit', {
      opId:randomUUID(), strokeId:randomUUID(), partIndex:0, final:true, tool:'pixel', colorId:1, size:1, points:[[3,3]],
    });
    expect(ack).toMatchObject({accepted:true, seq:1});

    const originalValidate = store.validateModeration.bind(store);
    const validateSpy = vi.spyOn(store, 'validateModeration').mockImplementationOnce((strokes, action, reason) => {
      originalValidate(strokes, action, reason);
      store.db.prepare("UPDATE project SET status='paused'").run();
    });
    expect(await socket.timeout(15000).emitWithAck('draw:undo')).toEqual({ok:false, code:'UNAVAILABLE'});
    expect(store.revision()).toBe(0);
    expect(store.grid[3 * WIDTH + 3]).toBe(1);

    // Reopen project and simulate participant ban during rebuild.
    store.db.prepare("UPDATE project SET status='open'").run();
    now += 5000;
    const participant = store.db.prepare('SELECT id FROM participants LIMIT 1').get() as {id:string};
    validateSpy.mockImplementationOnce((strokes, action, reason) => {
      originalValidate(strokes, action, reason);
      store.sanction(participant.id, 'ban', 'test');
    });
    expect(await socket.timeout(15000).emitWithAck('draw:undo')).toEqual({ok:false, code:'UNAVAILABLE'});
    expect(store.revision()).toBe(0);
    expect(store.grid[3 * WIDTH + 3]).toBe(1);
    validateSpy.mockRestore();
  } finally {
    clock.mockRestore();
    socket?.disconnect();
    await app.close();
    rmSync(dir, {recursive:true, force:true});
  }
}, 20000);

it('limite la création de nouvelles sessions par IP sans bloquer une session existante', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-session-rate-'));
  const origin = 'http://localhost:4173';
  let now = 10_000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const {app} = await createApp({dbPath:join(dir, 'db.sqlite'), origin, secureCookie:false});
  try {
    let validCookie = '';
    for (let i = 0; i < 120; i++) {
      const res = await app.inject({method:'POST', url:'/api/session', headers:{origin}});
      expect(res.statusCode).toBe(200);
      if (i === 0) validCookie = (res.headers['set-cookie'] as string).split(';')[0];
    }
    // 121st new session exceeds burst limit.
    const blocked = await app.inject({method:'POST', url:'/api/session', headers:{origin}});
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({error:'RATE_LIMITED'});

    // Existing valid session does not consume tokens and still passes.
    const existing = await app.inject({method:'POST', url:'/api/session', headers:{origin, cookie:validCookie}});
    expect(existing.statusCode).toBe(200);
    expect(existing.json()).toEqual({ok:true});

    // After 500 ms (2/s refill), 1 new session is allowed again.
    now += 500;
    const refilled = await app.inject({method:'POST', url:'/api/session', headers:{origin}});
    expect(refilled.statusCode).toBe(200);
  } finally {
    clock.mockRestore();
    await app.close();
    rmSync(dir, {recursive:true, force:true});
  }
}, 15000);

it('libère queuedBytes lors d’un upgrade de transport polling vers websocket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-upgrade-'));
  const origin = 'http://localhost:4173';
  const {app, io} = await createApp({dbPath:join(dir, 'db.sqlite'), origin, secureCookie:false});
  let socket: Socket | undefined;
  try {
    await app.listen({port:0, host:'127.0.0.1'});
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    const session = await app.inject({method:'POST', url:'/api/session', headers:{origin}});
    socket = client(`http://127.0.0.1:${address.port}`, {
      extraHeaders:{cookie:session.headers['set-cookie'] as string, origin},
      transports:['polling', 'websocket'],
      autoConnect:false,
    });
    const ready = new Promise<void>(resolve => socket!.once('canvas:state', () => resolve()));
    socket.connect();
    await ready;
    const peer = io.sockets.sockets.get(socket.id!)!;
    await expect.poll(() => peer.conn.transport.name, {timeout:5000}).toBe('websocket');
    await expect.poll(() => peer.data.queuedBytes, {timeout:5000}).toBe(0);
  } finally {
    socket?.disconnect();
    await app.close();
    rmSync(dir, {recursive:true, force:true});
  }
}, 15000);

it('regroupe la diffusion draw:applied par lot en conservant la dernière couleur par cellule', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-batch-broadcast-'));
  const origin = 'http://localhost:4173';
  const {app, store} = await createApp({dbPath:join(dir, 'db.sqlite'), origin, secureCookie:false});
  const sockets: Socket[] = [];
  try {
    await app.listen({port:0, host:'127.0.0.1'});
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    store.db.prepare("UPDATE project SET status='open'").run();
    for (let i = 0; i < 2; i++) {
      const session = await app.inject({method:'POST', url:'/api/session', headers:{origin}});
      const socket = client(`http://127.0.0.1:${address.port}`, {
        extraHeaders:{cookie:session.headers['set-cookie'] as string, origin},
        transports:['websocket'],
        autoConnect:false,
      });
      sockets.push(socket);
      const ready = new Promise<void>(resolve => socket.once('canvas:state', () => resolve()));
      socket.connect();
      await ready;
    }

    const [sender, observer] = sockets;
    const updates: {fromSeq:number; seq:number; moderationRevision:number; changes:[number,number][]}[] = [];
    observer.on('draw:applied', update => updates.push(update));

    // Submit 3 commands simultaneously so they land in the same 15ms flush batch,
    // with two commands painting the same cell (10, 10) with different colors.
    const acks = await Promise.all([
      sender.emitWithAck('draw:submit', {opId:randomUUID(), strokeId:randomUUID(), partIndex:0, final:true, tool:'pixel', colorId:1, size:1, points:[[10, 10]]}),
      sender.emitWithAck('draw:submit', {opId:randomUUID(), strokeId:randomUUID(), partIndex:0, final:true, tool:'pixel', colorId:2, size:1, points:[[11, 10]]}),
      sender.emitWithAck('draw:submit', {opId:randomUUID(), strokeId:randomUUID(), partIndex:0, final:true, tool:'pixel', colorId:3, size:1, points:[[10, 10]]}),
    ]);
    expect(acks.every(a => a.accepted)).toBe(true);
    await expect.poll(() => updates.at(-1)?.seq).toBe(3);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({fromSeq:1, seq:3, moderationRevision:0});
    const byIndex = new Map(updates[0].changes);
    expect(byIndex.size).toBe(2);
    expect(byIndex.get(10 * WIDTH + 10)).toBe(3);
    expect(byIndex.get(10 * WIDTH + 11)).toBe(2);
  } finally {
    sockets.forEach(s => s.disconnect());
    await app.close();
    rmSync(dir, {recursive:true, force:true});
  }
}, 15000);
