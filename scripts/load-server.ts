import {createApp} from '../server/src/app';

const db = process.argv[2];
if (!db || !process.send) throw new Error('Usage interne du test de charge');

const rateLimits = {participant:0,queue:0};
let firstRateLimit: {reason:keyof typeof rateLimits;queueDepth:number} | null = null;
let peakQueueDepth = 0;
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
    const replay = Buffer.from(store.replay(store.seq,'moderated',store.revision())).equals(Buffer.from(store.grid));
    const count = Number(store.db.prepare('SELECT COUNT(*) n FROM draw_events').get()?.n);
    process.send?.({
      type:'capture',seq:store.seq,count,grid:Buffer.from(store.grid).toString('base64'),replay,peakRss,
      drawDiagnostics:{rateLimits,firstRateLimit,peakQueueDepth},
    });
  } else if (message.type === 'stop') {
    clearInterval(monitor);
    await app.close();
    process.exit(0);
  }
});
