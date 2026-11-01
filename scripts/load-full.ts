import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {io as makeClient,type Socket} from 'socket.io-client';
import {fork} from 'node:child_process';
import {backupProject} from './backup';
import {WIDTH,HEIGHT} from '../shared/raster';
import type {DrawCommand} from '../shared/protocol';
const seconds=Number(process.argv[2]||1800);if(!Number.isInteger(seconds)||seconds<5||seconds>3600)throw new Error('Durée attendue entre 5 et 3600 secondes');
const dir=await mkdtemp(join(tmpdir(),'art-load-full-')),db=join(dir,'db.sqlite');
const server=fork('scripts/load-server.ts',[db],{execArgv:['--import','tsx'],silent:true});
const message=(type:string)=>new Promise<Record<string,unknown>>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(`Serveur de charge : ${type} expiré`)),30000);const handler=(m:Record<string,unknown>)=>{if(m.type===type){clearTimeout(timeout);server.off('message',handler);resolve(m);}};server.on('message',handler);server.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Serveur arrêté : ${code}`));});});
type Monitor={socket:Socket;grid:Uint8Array;seq:number;revision:number;ready:boolean;gaps:number};
const clients:Monitor[]=[],times:number[]=[],inflight=new Map<string,number>();let sent=0,accepted=0,rejected=0,retries=0,peak=0,reconnects=0,backupOk=0,backupFailed=0,maxRss=0,backupWork:Promise<void>=Promise.resolve();
try {
 const ready=await message('ready');const url=`http://127.0.0.1:${ready.port}`;
 for(let i=0;i<50;i++){
  const session=await fetch(`${url}/api/session`,{method:'POST',headers:{origin:'http://localhost:4173'}}),cookie=session.headers.get('set-cookie') || '';if(!session.ok||!cookie)throw new Error('Session refusée');
  const socket=makeClient(url,{extraHeaders:{cookie,origin:'http://localhost:4173'},transports:['websocket'],autoConnect:false});const monitor:Monitor={socket,grid:new Uint8Array(WIDTH*HEIGHT),seq:0,revision:0,ready:false,gaps:0};clients.push(monitor);
  socket.on('canvas:state',(state:{grid:number[];seq:number;moderationRevision:number})=>{monitor.grid=Uint8Array.from(state.grid);monitor.seq=state.seq;monitor.revision=state.moderationRevision;monitor.ready=true;});
  socket.on('draw:applied',(update:{seq:number;moderationRevision:number;changes:[number,number][]})=>{if(!monitor.ready)return;if(update.seq<=monitor.seq)return;if(update.seq!==monitor.seq+1||update.moderationRevision!==monitor.revision){monitor.ready=false;monitor.gaps++;socket.emit('canvas:resync');return;}for(const [index,color] of update.changes)monitor.grid[index]=color;monitor.seq=update.seq;});
  socket.on('disconnect',()=>{monitor.ready=false;});const ready=new Promise<void>((ok,fail)=>{socket.once('canvas:state',()=>ok());socket.once('connect_error',fail);});socket.connect();await ready;
 }
 const start=performance.now(),stop=start+seconds*1000;let tick=0;
 const send=(client:Monitor,command:DrawCommand,started:number,attempt=0)=>{client.socket.timeout(10000).emit('draw:submit',command,(error:Error|null,result:{accepted:boolean;code?:string})=>{if(!inflight.has(command.opId))return;if(error||result?.code==='RATE_LIMITED'||result?.code==='STORAGE_UNAVAILABLE'){if(attempt<3){retries++;setTimeout(()=>send(client,command,started,attempt+1),1000);}else{inflight.delete(command.opId);rejected++;}return;}inflight.delete(command.opId);if(result?.accepted){accepted++;times.push(performance.now()-started);}else rejected++;});};
 while(performance.now()<stop){await delay(Math.max(0,start+tick*100-performance.now()));
  if(tick>0&&tick%100===0){const client=clients[Math.floor(tick/100)%clients.length];client.socket.disconnect();client.socket.connect();reconnects++;}
  if(tick===10||tick>10&&(tick-10)%18000===0){const path=join(dir,`backup-${tick}`);backupWork=backupWork.then(()=>backupProject(db,path).then(()=>{backupOk++;}).catch(()=>{backupFailed++;}));}
  for(let i=0;i<clients.length;i++){const client=clients[i];if(!client.ready||!client.socket.connected)continue;if(inflight.size>=5000){rejected++;continue;}const complex=(tick*50+i)%25===0,brush=complex||(tick+i)%4===0,x=(i*13+tick)%700+10,y=(tick*3+i*7)%460+10;const points:DrawCommand['points']=complex?Array.from({length:64},(_,n)=>[x+n%4,y+Math.floor(n/4)%4] as const):[[x,y],[x+1,y+1]];const command:DrawCommand={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:brush?'brush':'pixel',colorId:i%24+1,size:brush?(complex?21:[1,3,5,9,15][(tick+i)%5]):1,points};const now=performance.now();inflight.set(command.opId,now);sent++;send(client,command,now);}
  peak=Math.max(peak,inflight.size);maxRss=Math.max(maxRss,process.memoryUsage().rss);tick++;
 }
 const drain=Date.now()+30000;while(inflight.size&&Date.now()<drain)await delay(100);await backupWork;
 await Promise.all(clients.map(client=>new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Resynchronisation expirée')),10000);client.socket.once('canvas:state',()=>{clearTimeout(timeout);resolve();});client.socket.emit('canvas:resync');})));
 const capturePromise=message('capture');server.send({type:'capture'});const capture=await capturePromise,sequence=Number(capture.seq),count=Number(capture.count),serverGrid=Buffer.from(String(capture.grid),'base64');const convergence=clients.every(c=>c.seq===sequence&&Buffer.from(c.grid).equals(serverGrid));const replay=Boolean(capture.replay);const disk=(await stat(db)).size+(await stat(db+'-wal').catch(()=>({size:0}))).size;times.sort((a,b)=>a-b);const p95=times[Math.floor(times.length*.95)]??null;
 const report={seconds,clients:50,targetMessagesPerSecond:500,sent,accepted,rejected,retries,pending:inflight.size,peakPending:peak,p95Ms:p95,sequence,eventCount:count,reconnects,sequenceGaps:clients.reduce((sum,c)=>sum+c.gaps,0),convergence,replay,backupsLocalOk:backupOk,backupFailed,maxRssBytes:maxRss,serverPeakRssBytes:capture.peakRss,databaseAndWalBytes:disk,limits:'Clients et serveur locaux ; sauvegarde hors site, matériel cible, essais aux limites invalides et rafales restent à vérifier séparément.'};process.stdout.write(JSON.stringify(report,null,2)+'\n');if(sent<seconds*500*.98||accepted!==sent||count!==accepted||inflight.size||rejected||!convergence||!replay||backupFailed||p95===null||p95>=500)process.exitCode=1;
} finally {for(const client of clients)client.socket.disconnect();if(server.connected){const closed=new Promise<void>(resolve=>{server.once('exit',()=>resolve());setTimeout(()=>{server.kill();resolve();},5000).unref();});server.send({type:'stop'});await closed;}await rm(dir,{recursive:true,force:true});}
