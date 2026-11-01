import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';
import { WIDTH,HEIGHT,applyCells,paintBrush } from '../shared/raster';
import type { DrawCommand } from '../shared/protocol';

export async function exportVideo(args:{database:string;output:string;mode:'activity'|'chronological';moderation:'raw'|'moderated';duration:number;fps:number;scale:number;endSeq?:number;captureAt?:string}) {
  if(!['activity','chronological'].includes(args.mode)||!['raw','moderated'].includes(args.moderation)||!Number.isFinite(args.duration)||args.duration<=0||args.duration>3600||!Number.isInteger(args.fps)||args.fps<1||args.fps>60||!Number.isInteger(args.scale)||args.scale<1||args.scale>8) throw new Error('Paramètres vidéo invalides');
  const dir=await mkdtemp(join(tmpdir(),'art-video-'));let source:DatabaseSync|undefined,copy:DatabaseSync|undefined;
  try {
    source=new DatabaseSync(resolve(args.database),{readOnly:true}); await backup(source,join(dir,'capture.sqlite')); source.close();source=undefined;
    copy=new DatabaseSync(join(dir,'capture.sqlite'),{readOnly:true});
    const project=copy.prepare('SELECT * FROM project WHERE id=1').get() as {base_image_path:string|null;base_image_checksum:string|null;palette_json:string;started_at:string|null;closed_at:string|null;moderation_revision:number};
    if(!project.base_image_path) throw new Error('Fond absent'); if(args.mode==='chronological'&&!project.started_at) throw new Error('Export chronologique impossible avant ouverture');
    const base=await readFile(project.base_image_path); if(createHash('sha256').update(base).digest('hex')!==project.base_image_checksum) throw new Error('Fond incompatible avec la capture');
    const max=Number((copy.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM draw_events').get() as {n:number}).n), end=args.endSeq ?? max;
    if(!Number.isSafeInteger(end)||end<0||end>max) throw new Error('Séquence de fin invalide');
    const events=copy.prepare('SELECT seq,participant_id,command_json,created_at FROM draw_events WHERE seq<=? ORDER BY seq').all(end) as {seq:number;participant_id:string;command_json:string;created_at:string}[];
    const hidden=new Set<string>(); if(args.moderation==='moderated') for(const action of copy.prepare('SELECT participant_id,stroke_id,action FROM moderation_actions WHERE revision<=? ORDER BY revision').all(project.moderation_revision) as {participant_id:string;stroke_id:string;action:string}[]) {const key=JSON.stringify([action.participant_id,action.stroke_id]);if(action.action==='hide')hidden.add(key);else hidden.delete(key);}
    const palette=JSON.parse(project.palette_json) as string[], grid=new Uint8Array(WIDTH*HEIGHT), frames=Math.max(2,Math.round(args.duration*args.fps)), start=project.started_at ? Date.parse(project.started_at) : 0, capture=args.captureAt ? Date.parse(args.captureAt) : Date.now(), endTime=args.endSeq !== undefined ? (events.length ? Date.parse(events[events.length-1].created_at) : start) : (project.closed_at ? Date.parse(project.closed_at) : capture);
    const ffmpeg=spawn('ffmpeg',['-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',`${WIDTH}x${HEIGHT}`,'-r',String(args.fps),'-i','pipe:0','-vf',`scale=${WIDTH*args.scale}:${HEIGHT*args.scale}:flags=neighbor`,'-c:v','libx264','-pix_fmt','yuv420p',resolve(args.output)],{stdio:['pipe','ignore','pipe']});
    let stderr='';ffmpeg.stderr.on('data',data=>{stderr+=String(data).slice(0,4096);}); const completed=new Promise<void>((ok,fail)=>{ffmpeg.on('error',fail);ffmpeg.on('close',code=>code===0?ok():fail(new Error(`FFmpeg: ${stderr}`)));});
    let cursor=0;
    for(let frame=0;frame<frames;frame++) {
      const ratio=frame/(frames-1), targetSeq=Math.floor(end*ratio), targetTime=start+(endTime-start)*ratio;
      while(frame>0 && cursor<events.length && (frame===frames-1 || (args.mode==='activity' ? events[cursor].seq<=targetSeq : Date.parse(events[cursor].created_at)<=targetTime))) { const row=events[cursor++],c=JSON.parse(row.command_json) as DrawCommand;if(!hidden.has(JSON.stringify([row.participant_id,c.strokeId])))applyCells(grid,paintBrush(c.points,c.size,c.colorId)); }
      const overlay=Buffer.alloc(WIDTH*HEIGHT*4);for(let i=0;i<grid.length;i++)if(grid[i]){const c=palette[grid[i]-1];overlay[i*4]=parseInt(c.slice(1,3),16);overlay[i*4+1]=parseInt(c.slice(3,5),16);overlay[i*4+2]=parseInt(c.slice(5,7),16);overlay[i*4+3]=255;}
      const rgb=await sharp(base).composite([{input:overlay,raw:{width:WIDTH,height:HEIGHT,channels:4}}]).removeAlpha().raw().toBuffer();
      if(!ffmpeg.stdin.write(rgb)) await once(ffmpeg.stdin,'drain');
    }
    ffmpeg.stdin.end();await completed;
  } finally {source?.close();copy?.close();await rm(dir,{recursive:true,force:true});}
}
if (process.argv[1] && resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)) {
  const options=new Map<string,string>();for(let i=2;i<process.argv.length;i+=2) options.set(process.argv[i],process.argv[i+1]);
  const required=(name:string)=>{const value=options.get(name);if(!value)throw new Error(`${name} requis`);return value;};
  exportVideo({database:required('--database'),output:required('--output'),mode:(options.get('--mode')||'activity') as 'activity'|'chronological',moderation:(options.get('--moderation')||'moderated') as 'raw'|'moderated',duration:Number(options.get('--duration')||180),fps:Number(options.get('--fps')||25),scale:Number(options.get('--scale')||2),endSeq:options.has('--end-seq')?Number(options.get('--end-seq')):undefined}).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
}
