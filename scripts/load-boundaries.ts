import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {io as createClient,type Socket} from 'socket.io-client';
import {createApp} from '../server/src/app';
const dir=await mkdtemp(join(tmpdir(),'art-boundaries-')),{app,store}=await createApp({dbPath:join(dir,'db.sqlite'),origin:'http://localhost:4173',secureCookie:false});let client:Socket|undefined;
try{
 await app.listen({port:0,host:'127.0.0.1'});const address=app.server.address();if(!address||typeof address==='string')throw new Error('Adresse indisponible');const url=`http://127.0.0.1:${address.port}`,session=await app.inject({method:'POST',url:'/api/session',headers:{origin:'http://localhost:4173'}});store.db.prepare("UPDATE project SET status='open'").run();
 client=createClient(url,{extraHeaders:{cookie:session.headers['set-cookie'] as string,origin:'http://localhost:4173'},transports:['websocket'],autoConnect:false});const ready=new Promise<void>(ok=>client!.once('canvas:state',()=>ok()));client.connect();await ready;
 const base={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'brush',colorId:1,size:21,points:Array.from({length:64},(_,i)=>[100+i%4,100+Math.floor(i/4)%4])};
 const valid=await client.timeout(5000).emitWithAck('draw:submit',base);if(!valid.accepted)throw new Error(`Limite valide refusée : ${valid.code}`);
 const invalids=[{value:{...base,opId:randomUUID(),colorId:0},code:'INVALID_COLOR'},{value:{...base,opId:randomUUID(),size:2},code:'INVALID_SIZE'},{value:{...base,opId:randomUUID(),points:[[720,0]]},code:'INVALID_COORDINATES'},{value:{...base,colorId:2},code:'OP_ID_CONFLICT'},{value:{...base,opId:randomUUID(),points:Array.from({length:65},()=>[1,1])},code:'INVALID_MESSAGE'}];
 for(const item of invalids){const result=await client.timeout(5000).emitWithAck('draw:submit',item.value);if(result.accepted||result.code!==item.code)throw new Error(`Refus incorrect : ${JSON.stringify(result)}`);}
 const times:number[]=[],pending:Promise<void>[]=[];let accepted=0,rejected=0;const start=performance.now();for(let i=0;i<100;i++){await delay(Math.max(0,start+i*50-performance.now()));const at=performance.now(),command={...base,opId:randomUUID(),strokeId:randomUUID(),tool:'pixel',size:1,points:[[i%720,200]]};pending.push(client.timeout(10000).emitWithAck('draw:submit',command).then(result=>{if(result.accepted){accepted++;times.push(performance.now()-at);}else rejected++;}));}await Promise.all(pending);times.sort((a,b)=>a-b);const report={valid64PointBrush:valid.accepted,invalidCases:invalids.length,burstIntervalMs:50,burstMessages:100,accepted,rejected,p95Ms:times[Math.floor(times.length*.95)]??null,scope:'Un client local ; ne remplace pas les scénarios complets sur le VPS.'};process.stdout.write(JSON.stringify(report,null,2)+'\n');if(accepted!==100||rejected)process.exitCode=1;
}finally{client?.disconnect();await app.close();await rm(dir,{recursive:true,force:true});}
