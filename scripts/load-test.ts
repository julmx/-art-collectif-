import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {io as makeClient,type Socket} from 'socket.io-client';
import {createApp} from '../server/src/app';
const seconds=Number(process.argv[2]||1800);if(!Number.isInteger(seconds)||seconds<1||seconds>3600)throw new Error('Durée invalide (1–3600 secondes)');
const dir=await mkdtemp(join(tmpdir(),'art-load-'));const {app,store}=await createApp({dbPath:join(dir,'db.sqlite'),origin:'http://localhost:4173',secureCookie:false});const clients:Socket[]=[],latencies:number[]=[];let sent=0,accepted=0,rejected=0,timeouts=0,pending=0,peakPending=0;
try{
 await app.listen({port:0,host:'127.0.0.1'});const address=app.server.address();if(!address||typeof address==='string')throw new Error('address');const url=`http://127.0.0.1:${address.port}`;store.db.prepare("UPDATE project SET status='open'").run();
 for(let i=0;i<50;i++){const response=await app.inject({method:'POST',url:'/api/session',headers:{origin:'http://localhost:4173'}});const cookie=response.headers['set-cookie'] as string;const socket=makeClient(url,{extraHeaders:{cookie,origin:'http://localhost:4173'},transports:['websocket'],autoConnect:false});const connected=new Promise<void>((resolve,reject)=>{socket.once('canvas:state',()=>resolve());socket.once('connect_error',reject);});socket.connect();await connected;clients.push(socket);}
 const start=performance.now(), stop=start+seconds*1000;let tick=0;
 while(performance.now()<stop){const deadline=start+tick*100;await delay(Math.max(0,deadline-performance.now()));for(let i=0;i<clients.length;i++){const now=performance.now();sent++;pending++;peakPending=Math.max(peakPending,pending);clients[i].timeout(10000).emit('draw:submit',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:i%24+1,size:1,points:[[i*10%720,(tick+i)%480]]},(error:Error|null,result:{accepted:boolean})=>{pending--;if(error)timeouts++;else if(result.accepted){accepted++;latencies.push(performance.now()-now);}else rejected++;});}tick++;}
 const drain=Date.now()+15000;while(pending>0&&Date.now()<drain)await delay(100);latencies.sort((a,b)=>a-b);const seq=store.seq;const measured=performance.now()-start;const result={seconds,clients:50,targetMessagesPerSecond:500,sent,accepted,rejected,timeouts,pending,peakPending,elapsedSeconds:measured/1000,p95Ms:latencies[Math.floor(latencies.length*.95)]||null,seq,limitations:'Test local : pixels uniques seulement, sans sauvegarde extérieure ni profils complets ; ne constitue pas la recette §12.2.'};process.stdout.write(JSON.stringify(result,null,2)+'\n');if(seq!==accepted||rejected||timeouts||pending||!latencies.length||result.p95Ms===null||result.p95Ms>=500)process.exitCode=1;
}finally{for(const client of clients)client.disconnect();await app.close();await rm(dir,{recursive:true,force:true});}
