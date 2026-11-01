import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { io as client, type Socket } from 'socket.io-client';
import { createApp } from '../server/src/app';

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

  } finally {a?.disconnect();b?.disconnect();await app.close();rmSync(dir,{recursive:true,force:true});}
},15000);
