import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WIDTH,HEIGHT} from '../../../shared/raster';
import type {Store} from '../database/store';

const busy=new WeakSet<Store>();
export async function applyModeration(store:Store, dbPath:string, strokes:{participantId:string;strokeId:string}[], action:'hide'|'restore', reason:string, expectedSeq:number, expectedRevision:number):Promise<number> {
  store.validateModeration(strokes,action,reason);
  if(store.seq!==expectedSeq || store.revision()!==expectedRevision) throw new Error('MODERATION_STATE_CHANGED');
  if(busy.has(store))throw new Error('MODERATION_BUSY');
  busy.add(store);
  try {
  const encoded=Buffer.from(JSON.stringify(strokes.map(s=>({...s,action})))).toString('base64url');
  const worker=spawn('nice',['-n','10',process.execPath,'--max-old-space-size=256','--import','tsx',fileURLToPath(new URL('../../../scripts/moderation-rebuild.ts',import.meta.url)),dbPath,String(expectedSeq),String(expectedRevision),encoded],{stdio:['ignore','pipe','pipe']});
  const chunks:Buffer[]=[];let size=0,error='';
  worker.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>WIDTH*HEIGHT)worker.kill('SIGKILL');else chunks.push(chunk);});
  worker.stderr.on('data',chunk=>{error=(error+String(chunk)).slice(-2000);});
  const timer=setTimeout(()=>worker.kill('SIGKILL'),120_000);
  try {await new Promise<void>((resolve,reject)=>{worker.once('error',reject);worker.once('close',code=>code===0?resolve():reject(new Error(`Reconstruction interrompue : ${error}`)));});} finally {clearTimeout(timer);}
  if(size!==WIDTH*HEIGHT)throw new Error('INVALID_REBUILD');
  if(store.seq!==expectedSeq || store.revision()!==expectedRevision)throw new Error('MODERATION_STATE_CHANGED');
  return store.commitModeration(strokes,action,reason,new Uint8Array(Buffer.concat(chunks)));
  } finally {busy.delete(store);}
}
