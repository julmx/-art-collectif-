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
 for(const ackFirst of [true,false]){let grid=new Uint8Array(0);const client=new CollaborationClient(g=>{grid=g as Uint8Array<ArrayBuffer>;});await client.connect();mocks.socket.handlers.get('canvas:state')?.(state());expect(client.submit(command)).toBe(true);expect(grid[721]).toBe(1);const sent=mocks.socket.sent.at(-1)!;const ack=()=>sent.ack(null,{accepted:true,seq:1,opId:'a'}),applied=()=>mocks.socket.handlers.get('draw:applied')?.({seq:1,moderationRevision:0,changes:[[721,1]]});if(ackFirst){ack();applied();}else{applied();ack();}expect(grid[721]).toBe(1);mocks.socket.handlers.get('draw:applied')?.({seq:2,moderationRevision:0,changes:[[721,2]]});expect(grid[721]).toBe(2);mocks.socket.sent.length=0;}
});
it('réémet une commande non confirmée et retire son aperçu lors d’un reset',async()=>{
 let grid=new Uint8Array(0);const client=new CollaborationClient(g=>{grid=g as Uint8Array<ArrayBuffer>;});await client.connect();mocks.socket.handlers.get('canvas:state')?.(state());client.submit(command);expect(grid[721]).toBe(1);mocks.socket.disconnect();mocks.socket.connect();mocks.socket.handlers.get('canvas:state')?.(state());expect(mocks.socket.sent).toHaveLength(2);expect(mocks.socket.sent[1].command).toEqual(command);mocks.socket.handlers.get('canvas:reset')?.({...state(),moderationRevision:1});expect(grid[721]).toBe(0);
});
