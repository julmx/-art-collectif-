import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';
import { WIDTH,HEIGHT,applyCells,paintBrush } from '../shared/raster';
import type { DrawCommand } from '../shared/protocol';

export async function exportVideo(args:{database:string;output:string;mode:'activity'|'chronological';moderation:'raw'|'moderated';duration:number;fps:number;scale:number;width?:number;height?:number;endSeq?:number;captureAt?:string;metadata?:string}) {
  if(!['activity','chronological'].includes(args.mode)||!['raw','moderated'].includes(args.moderation)||!Number.isFinite(args.duration)||args.duration<=0||args.duration>3600||!Number.isInteger(args.fps)||args.fps<1||args.fps>60||!Number.isInteger(args.scale)||args.scale<1||args.scale>8) throw new Error('Paramètres vidéo invalides');
  if ((args.width !== undefined && args.width !== WIDTH*args.scale) || (args.height !== undefined && args.height !== HEIGHT*args.scale) || (args.captureAt !== undefined && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(args.captureAt) || Number.isNaN(Date.parse(args.captureAt))))) throw new Error('Résolution ou instant de capture invalide');
  const dir=await mkdtemp(join(tmpdir(),'art-video-'));let source:DatabaseSync|undefined,copy:DatabaseSync|undefined,terminateEncoder:(()=>void)|undefined;
  try {
    source=new DatabaseSync(resolve(args.database),{readOnly:true}); await backup(source,join(dir,'capture.sqlite')); source.close();source=undefined;
    copy=new DatabaseSync(join(dir,'capture.sqlite'),{readOnly:true});
    const project=copy.prepare('SELECT * FROM project WHERE id=1').get() as {base_image_path:string|null;base_image_checksum:string|null;palette_json:string;started_at:string|null;closed_at:string|null;moderation_revision:number};
    if(!project.base_image_path) throw new Error('Fond absent'); if(args.mode==='chronological'&&!project.started_at) throw new Error('Export chronologique impossible avant ouverture');
    const base=await readFile(project.base_image_path); if(createHash('sha256').update(base).digest('hex')!==project.base_image_checksum) throw new Error('Fond incompatible avec la capture');
    const max=Number((copy.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM draw_events').get() as {n:number}).n), end=args.endSeq ?? max;
    if(!Number.isSafeInteger(end)||end<0||end>max) throw new Error('Séquence de fin invalide');
    if(args.metadata)await writeFile(args.metadata,JSON.stringify({captureCompletedAt:new Date().toISOString(),sequence:end,moderationRevision:project.moderation_revision}),{mode:0o600});
    // Materialise only the latest moderation decisions in a disk-backed TEMP table.
    copy.exec('PRAGMA temp_store=FILE; CREATE TEMP TABLE hidden(participant_id TEXT,stroke_id TEXT,PRIMARY KEY(participant_id,stroke_id)) WITHOUT ROWID');
    if(args.moderation==='moderated') { const hide=copy.prepare('INSERT OR IGNORE INTO hidden VALUES(?,?)'),restore=copy.prepare('DELETE FROM hidden WHERE participant_id=? AND stroke_id=?'); for(const a of copy.prepare('SELECT participant_id,stroke_id,action FROM moderation_actions WHERE revision<=? ORDER BY revision').iterate(project.moderation_revision) as IterableIterator<{participant_id:string;stroke_id:string;action:string}>) (a.action==='hide'?hide:restore).run(a.participant_id,a.stroke_id); }
    type Row={seq:number;command_json:string;created_at:string;hidden:number};
    const events=copy.prepare('SELECT e.seq,e.command_json,e.created_at,(h.participant_id IS NOT NULL) AS hidden FROM draw_events e LEFT JOIN hidden h ON h.participant_id=e.participant_id AND h.stroke_id=e.stroke_id WHERE e.seq<=? ORDER BY e.seq').iterate(end) as IterableIterator<Row>;
    let next=events.next();const last=copy.prepare('SELECT created_at FROM draw_events WHERE seq<=? ORDER BY seq DESC LIMIT 1').get(end) as {created_at:string}|undefined;
    const palette=JSON.parse(project.palette_json) as string[], grid=new Uint8Array(WIDTH*HEIGHT), frames=Math.max(2,Math.round(args.duration*args.fps)), start=project.started_at ? Date.parse(project.started_at) : 0, capture=args.captureAt ? Date.parse(args.captureAt) : Date.now(), endTime=args.endSeq !== undefined ? (last ? Date.parse(last.created_at) : start) : (project.closed_at ? Date.parse(project.closed_at) : capture);
    const ffmpeg=spawn('ffmpeg',['-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',`${WIDTH}x${HEIGHT}`,'-r',String(args.fps),'-i','pipe:0','-vf',`scale=${WIDTH*args.scale}:${HEIGHT*args.scale}:flags=neighbor`,'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',resolve(args.output)],{stdio:['pipe','ignore','pipe']});
    terminateEncoder=()=>{ffmpeg.stdin.destroy();if(ffmpeg.exitCode===null)ffmpeg.kill('SIGTERM');};
    ffmpeg.stdin.on('error',()=>{});
    let stderr='';ffmpeg.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-4096);}); const completed=new Promise<void>((ok,fail)=>{ffmpeg.on('error',fail);ffmpeg.on('close',code=>code===0?ok():fail(new Error(`FFmpeg: ${stderr}`)));});void completed.catch(()=>{});
    for(let frame=0;frame<frames;frame++) {
      const ratio=frame/(frames-1), targetSeq=Math.floor(end*ratio), targetTime=start+(endTime-start)*ratio;
      while(frame>0 && !next.done && (frame===frames-1 || (args.mode==='activity' ? next.value.seq<=targetSeq : Date.parse(next.value.created_at)<=targetTime))) { const row=next.value,c=JSON.parse(row.command_json) as DrawCommand;if(!row.hidden)applyCells(grid,paintBrush(c.points,c.size,c.colorId));next=events.next(); }
      const overlay=Buffer.alloc(WIDTH*HEIGHT*4);for(let i=0;i<grid.length;i++)if(grid[i]){const c=palette[grid[i]-1];overlay[i*4]=parseInt(c.slice(1,3),16);overlay[i*4+1]=parseInt(c.slice(3,5),16);overlay[i*4+2]=parseInt(c.slice(5,7),16);overlay[i*4+3]=255;}
      const rgb=await sharp(base).composite([{input:overlay,raw:{width:WIDTH,height:HEIGHT,channels:4}}]).removeAlpha().raw().toBuffer();
      if(!ffmpeg.stdin.write(rgb)) await Promise.race([once(ffmpeg.stdin,'drain'),completed.then(()=>{throw new Error('FFmpeg arrêté avant la fin');})]);
    }
    ffmpeg.stdin.end();await completed;terminateEncoder=undefined;
  } finally {terminateEncoder?.();source?.close();copy?.close();await rm(dir,{recursive:true,force:true});}
}
if (process.argv[1] && resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)) {
  const options=new Map<string,string>();for(let i=2;i<process.argv.length;i+=2) options.set(process.argv[i],process.argv[i+1]);
  const required=(name:string)=>{const value=options.get(name);if(!value)throw new Error(`${name} requis`);return value;};
  exportVideo({database:required('--database'),output:required('--output'),mode:(options.get('--mode')||'activity') as 'activity'|'chronological',moderation:(options.get('--moderation')||'moderated') as 'raw'|'moderated',duration:Number(options.get('--duration')||180),fps:Number(options.get('--fps')||25),scale:Number(options.get('--scale')||2),width:options.has('--width')?Number(options.get('--width')):undefined,height:options.has('--height')?Number(options.get('--height')):undefined,captureAt:options.get('--capture-at'),endSeq:options.has('--end-seq')?Number(options.get('--end-seq')):undefined,metadata:options.get('--metadata')}).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
}
