import {createHistogram} from 'node:perf_hooks';
import {createApp} from '../server/src/app';

const db = process.argv[2];
if (!db || !process.send) throw new Error('Usage interne du test de charge');

const rateLimits = {participant:0,queue:0};
let firstRateLimit: {reason:keyof typeof rateLimits;queueDepth:number} | null = null;
let peakQueueDepth = 0;
let batches = 0, batchCommands = 0;
const phaseNames = [
  'totalMs','selectionMs','sqliteBeginMs','sqliteInsertMs','sqliteCommitMs','rasterMs',
  'storeOtherMs','broadcastMs','otherMs',
] as const;
const phases = phaseNames.map(name => ({name,totalMs:0,durations:createHistogram()}));
const {app,store} = await createApp({
  dbPath:db,
  origin:'http://localhost:4173',
  secureCookie:false,
  drawDiagnostics:{
    onQueueDepth(depth) {
      peakQueueDepth = Math.max(peakQueueDepth, depth);
    },
    onRateLimit(reason, queueDepth) {
      rateLimits[reason]++;
      firstRateLimit ??= {reason,queueDepth};
    },
    onBatch(timings) {
      batches++;
      batchCommands += timings.commands;
      for (const phase of phases) {
        const ms = timings[phase.name];
        phase.totalMs += ms;
        // Histograms take positive integer nanoseconds. A skipped phase rounds back to 0 ms.
        phase.durations.record(Math.max(1, Math.round(ms * 1e6)));
      }
    },
  },
});
await app.listen({port:0,host:'127.0.0.1'});
store.db.prepare("UPDATE project SET status='open'").run();
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('Adresse absente');
let peakRss = 0;
const monitor = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
},1000);
monitor.unref();
process.send({type:'ready',port:address.port});

process.on('message', async (message:{type?:string}) => {
  if (message.type === 'capture') {
    const batchTimings = {
      batches,commands:batchCommands,
      phases:Object.fromEntries(phases.map(({name,totalMs,durations}) => [name,{
        totalMs:Number(totalMs.toFixed(3)),
        p95Ms:batches ? Number((durations.percentile(95) / 1e6).toFixed(3)) : null,
        maxMs:batches ? Number((durations.max / 1e6).toFixed(3)) : null,
      }])),
    };
    const replay = Buffer.from(store.replay(store.seq,'moderated',store.revision())).equals(Buffer.from(store.grid));
    const count = Number(store.db.prepare('SELECT COUNT(*) n FROM draw_events').get()?.n);
    process.send?.({
      type:'capture',seq:store.seq,count,grid:Buffer.from(store.grid).toString('base64'),replay,peakRss,
      drawDiagnostics:{rateLimits,firstRateLimit,peakQueueDepth,batchTimings},
    });
  } else if (message.type === 'stop') {
    clearInterval(monitor);
    await app.close();
    process.exit(0);
  }
});
