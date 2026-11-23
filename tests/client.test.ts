import {beforeEach,it,expect,vi} from 'vitest';
import type {DrawCommand} from '../shared/protocol';
const mocks=vi.hoisted(()=>({socket:null as unknown as {handlers:Map<string,(...args:unknown[])=>void>;sent:{command:DrawCommand;ack:(error:Error|null,result:unknown)=>void}[];on:(name:string,fn:(...args:unknown[])=>void)=>void;connect:()=>void;disconnect:()=>void;timeout:()=>unknown;emit:(name:string,...args:unknown[])=>void}}));
vi.mock('socket.io-client',()=>({io:()=>mocks.socket}));
import {CollaborationClient} from '../web/src/realtime/client';
const state=(seq=0)=>({grid:Array(720*480).fill(0),seq,moderationRevision:0,status:'open',palette:Array(24).fill('#ff0000')});
const command:DrawCommand={opId:'a',strokeId:'b',partIndex:0,final:true,tool:'pixel',colorId:1,size:1,points:[[1,1]]};
beforeEach(()=>{
 const handlers=new Map<string,(...args:unknown[])=>void>(),sent:{command:DrawCommand;ack:(error:Error|null,result:unknown)=>void}[]=[];
 mocks.socket={handlers,sent,on:(name,fn)=>{handlers.set(name,fn);},connect:()=>handlers.get('connect')?.(),disconnect:()=>handlers.get('disconnect')?.(),timeout:()=>mocks.socket,emit:(name,...args)=>{if(name==='draw:submit')sent.push({command:args[0] as DrawCommand,ack:args[1] as (error:Error|null,result:unknown)=>void});}};
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true})));
});
it('réconcilie une diffusion avant ou après son acquittement',async()=>{
 for(const ackFirst of [true,false]){const client=new CollaborationClient(()=>{});await client.connect();mocks.socket.handlers.get('canvas:state')?.(state());expect(client.submit(command)).toBe(true);expect(client.displayGrid()[721]).toBe(1);const sent=mocks.socket.sent.at(-1)!;const ack=()=>sent.ack(null,{accepted:true,seq:1,opId:'a'}),applied=()=>mocks.socket.handlers.get('draw:applied')?.({seq:1,moderationRevision:0,changes:[[721,1]]});if(ackFirst){ack();applied();}else{applied();ack();}expect(client.displayGrid()[721]).toBe(1);mocks.socket.handlers.get('draw:applied')?.({seq:2,moderationRevision:0,changes:[[721,2]]});expect(client.displayGrid()[721]).toBe(2);mocks.socket.sent.length=0;}
});
it('réémet une commande non confirmée et retire son aperçu lors d’un reset',async()=>{
 const client=new CollaborationClient(()=>{});await client.connect();mocks.socket.handlers.get('canvas:state')?.(state());client.submit(command);expect(client.displayGrid()[721]).toBe(1);mocks.socket.disconnect();mocks.socket.connect();mocks.socket.handlers.get('canvas:state')?.(state());expect(mocks.socket.sent).toHaveLength(2);expect(mocks.socket.sent[1].command).toEqual(command);mocks.socket.handlers.get('canvas:reset')?.({...state(),moderationRevision:1});expect(client.displayGrid()[721]).toBe(0);
});
it('retire un aperçu acquitté absent de l’état restauré par le serveur',async()=>{
 const client = new CollaborationClient(()=>{});
 await client.connect();
 const install = () => mocks.socket.handlers.get('canvas:state')?.(state());
 install();
 client.submit(command);
 mocks.socket.sent[0].ack(null,{accepted:true,seq:1,opId:command.opId});
 expect(client.displayGrid()[721]).toBe(1);

 mocks.socket.disconnect();
 mocks.socket.connect();
 install();

 expect(client.displayGrid()[721]).toBe(0);
 expect(client.canUndo()).toBe(true);
 expect(mocks.socket.sent).toHaveLength(1);
});
it('réessaie après une déconnexion imposée par le serveur',async()=>{
 vi.useFakeTimers();try{const client=new CollaborationClient(()=>{});await client.connect();const connect=vi.spyOn(mocks.socket,'connect');mocks.socket.handlers.get('disconnect')?.('io server disconnect');await vi.advanceTimersByTimeAsync(3000);expect(connect).toHaveBeenCalledTimes(1);}finally{vi.useRealTimers();}
});

it('signale un refus définitif et conserve les commandes des autres traits', async () => {
  const refused = vi.fn();
  const client = new CollaborationClient(() => {}, refused);
  await client.connect();
  mocks.socket.handlers.get('canvas:state')?.(state());
  client.submit(command);
  client.submit({...command, opId:'a2', partIndex:1});
  const other = {...command, opId:'c', strokeId:'d'};
  client.submit(other);

  mocks.socket.sent[0].ack(null, {opId:'a', accepted:false, code:'COST_LIMIT_EXCEEDED'});

  expect(refused).toHaveBeenCalledWith(command, 'COST_LIMIT_EXCEEDED');
  expect(mocks.socket.sent.map(item => item.command)).toEqual([command, other]);
});

it.each(['RATE_LIMITED', 'STORAGE_UNAVAILABLE', 'timeout'])('respecte le délai après %s malgré les soumissions et resynchronisations', async code => {
  vi.useFakeTimers();
  try {
    const client = new CollaborationClient(() => {});
    await client.connect();
    const install = () => mocks.socket.handlers.get('canvas:state')?.(state());
    install();
    client.submit(command);
    const next = {...command, opId:'c', strokeId:'d'};
    mocks.socket.sent[0].ack(code === 'timeout' ? new Error(code) : null, {accepted:false, code});
    client.submit(next);
    install();
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.socket.sent.map(s => s.command)).toEqual([command]);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.socket.sent.map(s => s.command)).toEqual([command, command]);
    mocks.socket.sent[1].ack(null, {accepted:true, seq:1});
    expect(mocks.socket.sent.map(s => s.command)).toEqual([command, command, next]);
  } finally { vi.useRealTimers(); }
});

it('décode les états binaires ArrayBuffer, Uint8Array et Buffer et rejette les tailles invalides', async () => {
  const client = new CollaborationClient(() => {});
  await client.connect();
  const disconnect = vi.spyOn(mocks.socket, 'disconnect');

  const u8 = new Uint8Array(720 * 480);
  u8[721] = 7;
  mocks.socket.handlers.get('canvas:state')?.({...state(1), grid:u8});
  expect(client.displayGrid()[721]).toBe(7);

  const ab = new ArrayBuffer(720 * 480);
  new Uint8Array(ab)[722] = 9;
  mocks.socket.handlers.get('canvas:state')?.({...state(2), grid:ab});
  expect(client.displayGrid()[722]).toBe(9);

  const buf = Buffer.alloc(720 * 480);
  buf[723] = 5;
  mocks.socket.handlers.get('canvas:state')?.({...state(3), grid:buf});
  expect(client.displayGrid()[723]).toBe(5);

  mocks.socket.handlers.get('canvas:state')?.({...state(4), grid:new ArrayBuffer(10)});
  expect(disconnect).toHaveBeenCalledTimes(1);
});

it('préserve l’aperçu local lors d’un canvas:reset avec preserveLocalStroke et l’efface sinon', async () => {
  const resets: boolean[] = [];
  const client = new CollaborationClient((_available, _status, _palette, reset) => { resets.push(reset); });
  await client.connect();
  mocks.socket.handlers.get('canvas:state')?.(state());
  client.submit(command);
  expect(client.displayGrid()[721]).toBe(1);

  resets.length = 0;
  mocks.socket.handlers.get('canvas:reset')?.({...state(), moderationRevision:1, preserveLocalStroke:true});
  expect(resets.at(-1)).toBe(false);
  expect(client.displayGrid()[721]).toBe(1);

  resets.length = 0;
  mocks.socket.handlers.get('canvas:reset')?.({...state(), moderationRevision:2});
  expect(resets.at(-1)).toBe(true);
  expect(client.displayGrid()[721]).toBe(0);
});

it('bloque submit() si le participant est banni et notifie avant canvas:resync sur changement invalide', async () => {
  const order: string[] = [];
  const client = new CollaborationClient((available) => { order.push(`changed:${available}`); });
  await client.connect();
  mocks.socket.handlers.get('canvas:state')?.(state());

  const originalEmit = mocks.socket.emit;
  mocks.socket.emit = (name, ...args) => {
    order.push(`emit:${name}`);
    originalEmit(name, ...args);
  };
  order.length = 0;
  mocks.socket.handlers.get('draw:applied')?.({seq:1, moderationRevision:0, changes:[[9999999, 1]]});
  expect(order).toEqual(['changed:false', 'emit:canvas:resync']);

  mocks.socket.handlers.get('canvas:state')?.(state(1));
  mocks.socket.handlers.get('participant:restriction')?.({banned:true});
  expect(client.submit(command)).toBe(false);
  expect(mocks.socket.sent).toHaveLength(0);
});

it.each([
  {code: 'RATE_LIMITED', expected: 'RATE_LIMITED'},
  {code: 'timeout', expected: 'ACK_TIMEOUT'},
])('applique un backoff exponentiel borné à 6 tentatives puis abandonne le trait (%s)', async ({code, expected}) => {
  vi.useFakeTimers();
  try {
    const refused = vi.fn();
    const client = new CollaborationClient(() => {}, refused);
    await client.connect();
    mocks.socket.handlers.get('canvas:state')?.(state());

    const part2 = {...command, opId:'a2', partIndex:1};
    const other = {...command, opId:'c', strokeId:'d'};
    client.submit(command);
    client.submit(part2);
    client.submit(other);

    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < delays.length; i++) {
      expect(mocks.socket.sent).toHaveLength(i + 1);
      mocks.socket.sent[i].ack(code === 'timeout' ? new Error(code) : null, code === 'timeout' ? undefined : {accepted:false, code});
      await vi.advanceTimersByTimeAsync(delays[i] - 1);
      expect(mocks.socket.sent).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.socket.sent).toHaveLength(i + 2);
      expect(mocks.socket.sent[i + 1].command).toEqual(command);
    }

    // 6th attempt fails -> abandon stroke (command + part2) and flush next stroke (other).
    mocks.socket.sent[5].ack(code === 'timeout' ? new Error(code) : null, code === 'timeout' ? undefined : {accepted:false, code});
    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused).toHaveBeenCalledWith(command, expected);
    expect(mocks.socket.sent).toHaveLength(7);
    expect(mocks.socket.sent[6].command).toEqual(other);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.socket.sent).toHaveLength(7);
  } finally { vi.useRealTimers(); }
});

it('applique un lot draw:applied (fromSeq..seq), réconcilie les attentes et resynchronise en cas de trou', async () => {
  const client = new CollaborationClient(() => {});
  await client.connect();
  mocks.socket.handlers.get('canvas:state')?.(state(0));

  const resyncs: string[] = [];
  const originalEmit = mocks.socket.emit;
  mocks.socket.emit = (name, ...args) => {
    if (name === 'canvas:resync') resyncs.push(name);
    originalEmit(name, ...args);
  };

  const c1: DrawCommand = {...command, opId:'op-1', strokeId:'s-1', points:[[1,1]], colorId:1};
  const c2: DrawCommand = {...command, opId:'op-2', strokeId:'s-2', points:[[2,1]], colorId:2};
  client.submit(c1);
  client.submit(c2);
  mocks.socket.sent[0].ack(null, {accepted:true, seq:1, opId:'op-1'});
  mocks.socket.sent[1].ack(null, {accepted:true, seq:2, opId:'op-2'});

  // Single batched update covering seq 1..3 reconciles both pending ops and applies seq 3.
  mocks.socket.handlers.get('draw:applied')?.({
    fromSeq: 1,
    seq: 3,
    moderationRevision: 0,
    changes: [[721, 1], [722, 2], [723, 3]],
  });
  expect(client.displayGrid()[721]).toBe(1);
  expect(client.displayGrid()[722]).toBe(2);
  expect(client.displayGrid()[723]).toBe(3);
  expect(client.canUndo()).toBe(true);
  expect(resyncs).toHaveLength(0);

  // Duplicate older batch is ignored.
  mocks.socket.handlers.get('draw:applied')?.({
    fromSeq: 1,
    seq: 3,
    moderationRevision: 0,
    changes: [[721, 9]],
  });
  expect(client.displayGrid()[721]).toBe(1);
  expect(resyncs).toHaveLength(0);

  // Gap (fromSeq=5 while client is at seq=3) triggers resync.
  mocks.socket.handlers.get('draw:applied')?.({
    fromSeq: 5,
    seq: 6,
    moderationRevision: 0,
    changes: [[724, 4]],
  });
  expect(resyncs).toHaveLength(1);
  expect(client.displayGrid()[724]).toBe(0);
});
