import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setImmediate as yieldToIO} from 'node:timers/promises';
import {WIDTH,HEIGHT} from '../../../shared/raster';
import type {Store} from '../database/store';

const busy=new WeakSet<Store>();
const REBUILD_TIMEOUT_MS = 120_000;
const REPLAY_CHUNK_SIZE = 16;

export async function applyModeration(store:Store, dbPath:string, strokes:{participantId:string;strokeId:string}[], action:'hide'|'restore', reason:string, expectedSeq:number, expectedRevision:number, options:{requireUnchangedSequence?:boolean} = {}):Promise<number> {
  store.validateModeration(strokes,action,reason);
  if(store.seq!==expectedSeq || store.revision()!==expectedRevision) throw new Error('MODERATION_STATE_CHANGED');
  if(busy.has(store))throw new Error('MODERATION_BUSY');
  busy.add(store);
  try {
  const deadline = performance.now() + REBUILD_TIMEOUT_MS;
  const decisions = strokes.map(stroke => ({...stroke, action}));
  const encoded=Buffer.from(JSON.stringify(decisions)).toString('base64url');
  const worker=spawn('nice',['-n','10',process.execPath,'--max-old-space-size=256','--import','tsx',fileURLToPath(new URL('../../../scripts/moderation-rebuild.ts',import.meta.url)),dbPath,String(expectedSeq),String(expectedRevision),encoded],{stdio:['ignore','pipe','pipe']});
  const chunks:Buffer[]=[];let size=0,error='';
  worker.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>WIDTH*HEIGHT)worker.kill('SIGKILL');else chunks.push(chunk);});
  worker.stderr.on('data',chunk=>{error=(error+String(chunk)).slice(-2000);});
  const timer=setTimeout(()=>worker.kill('SIGKILL'),REBUILD_TIMEOUT_MS);
  try {await new Promise<void>((resolve,reject)=>{worker.once('error',reject);worker.once('close',code=>code===0?resolve():reject(new Error(`Reconstruction interrompue : ${error}`)));});} finally {clearTimeout(timer);}
  if(size!==WIDTH*HEIGHT)throw new Error('INVALID_REBUILD');
  const grid = new Uint8Array(Buffer.concat(chunks));
  const hidden = store.hiddenStrokes(expectedRevision, decisions);
  let appliedSeq = expectedSeq;
  for (;;) {
    if (!store.healthy) throw new Error('STORAGE_UNAVAILABLE');
    if (store.revision() !== expectedRevision || (options.requireUnchangedSequence && store.seq !== expectedSeq)) {
      throw new Error('MODERATION_STATE_CHANGED');
    }
    if (performance.now() >= deadline) throw new Error('MODERATION_BUSY');
    if (appliedSeq === store.seq) return store.commitModeration(strokes, action, reason, grid);

    const target = Math.min(store.seq, appliedSeq + REPLAY_CHUNK_SIZE);
    store.replayInto(grid, appliedSeq, target, hidden);
    appliedSeq = target;
    if (appliedSeq < store.seq) await yieldToIO();
  }
  } finally {busy.delete(store);}
}
