import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm,readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {createWriteStream,createReadStream,openSync,writeSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import yazl from 'yazl';
import sharp from 'sharp';
import {WIDTH,HEIGHT,paintBrush,applyCells} from '../shared/raster';
import {exportVideo} from './export-video';
const codeRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function exportArchive(args:{database:string;output:string;moderation:'raw'|'moderated';videos?:boolean}) {
 const temp=await mkdtemp(join(tmpdir(),'art-archive-'));let original:DatabaseSync|undefined,db:DatabaseSync|undefined;
 try {
  if(!['raw','moderated'].includes(args.moderation))throw new Error('Modération invalide');
  original=new DatabaseSync(resolve(args.database),{readOnly:true});await backup(original,join(temp,'capture.sqlite'));original.close();original=undefined;db=new DatabaseSync(join(temp,'capture.sqlite'),{readOnly:true});
  const p=db.prepare('SELECT * FROM project WHERE id=1').get() as {status:string;palette_json:string;base_image_path:string|null;base_image_checksum:string;title:string;description:string;participation_terms:string;started_at:string|null;closed_at:string|null;moderation_revision:number};
  if(!p.base_image_path)throw new Error('Fond absent');const base=await readFile(p.base_image_path);if(createHash('sha256').update(base).digest('hex')!==p.base_image_checksum)throw new Error('Fond incompatible avec la capture');
  const maxSeq=Number((db.prepare('SELECT COALESCE(MAX(seq),0) n FROM draw_events').get() as {n:number}).n),captureAt=new Date().toISOString(),palette=JSON.parse(p.palette_json) as string[], hidden=new Set<string>();
  const files:string[]=[];const add=async(name:string,data:string|Uint8Array)=>{await mkdir(dirname(join(temp,name)),{recursive:true});await writeFile(join(temp,name),data);files.push(name);};
  await add('base.png',base);await add('project.json',JSON.stringify({width:WIDTH,height:HEIGHT,status:p.status,palette,title:p.title,description:p.description,participationTerms:p.participation_terms,termsHistory:db.prepare('SELECT terms,effective_after_seq,created_at FROM terms_history ORDER BY id').all(),startedAt:p.started_at,closedAt:p.closed_at},null,2));
  const moderationPath=join(temp,'moderation.jsonl'),mfd=openSync(moderationPath,'w');try{for(const row of db.prepare('SELECT revision,participant_id,stroke_id,action,reason,created_at FROM moderation_actions ORDER BY revision').iterate() as IterableIterator<{participant_id:string;stroke_id:string;action:string}>){writeSync(mfd,JSON.stringify(row)+'\n');const key=JSON.stringify([row.participant_id,row.stroke_id]);if(row.action==='hide')hidden.add(key);else hidden.delete(key);}}finally{closeSync(mfd);}files.push('moderation.jsonl');
  const grid=new Uint8Array(WIDTH*HEIGHT),eventsPath=join(temp,'events.jsonl'),efd=openSync(eventsPath,'w');try{for(const row of db.prepare('SELECT seq,participant_id,command_json,created_at FROM draw_events WHERE seq<=? ORDER BY seq').iterate(maxSeq) as IterableIterator<{seq:number;participant_id:string;command_json:string;created_at:string}>){const command=JSON.parse(row.command_json);writeSync(efd,JSON.stringify({seq:row.seq,participantId:row.participant_id,...command,createdAt:row.created_at})+'\n');if(args.moderation==='raw'||!hidden.has(JSON.stringify([row.participant_id,command.strokeId])))applyCells(grid,paintBrush(command.points,command.size,command.colorId));}}finally{closeSync(efd);}files.push('events.jsonl');
  const rgba=Buffer.alloc(WIDTH*HEIGHT*4);for(let i=0;i<grid.length;i++)if(grid[i]){const c=palette[grid[i]-1];rgba[i*4]=parseInt(c.slice(1,3),16);rgba[i*4+1]=parseInt(c.slice(3,5),16);rgba[i*4+2]=parseInt(c.slice(5,7),16);rgba[i*4+3]=255;}
  await add('overlay.png',await sharp(rgba,{raw:{width:WIDTH,height:HEIGHT,channels:4}}).png().toBuffer());await add('final.png',await sharp(base).composite([{input:rgba,raw:{width:WIDTH,height:HEIGHT,channels:4}}]).png().toBuffer());
  await mkdir(join(temp,'replay/shared'),{recursive:true});await mkdir(join(temp,'replay/scripts'),{recursive:true});for(const [src,dest] of [['shared/raster.ts','replay/shared/raster.ts'],['scripts/replay-archive.ts','replay/scripts/replay.ts'],['package.json','replay/package.json'],['package-lock.json','replay/package-lock.json']] as const){await copyFile(join(codeRoot,src),join(temp,dest));files.push(dest);}
  await add('README.txt','Relecture : cd replay ; npm ci ; npx tsx scripts/replay.ts [sequence] [fichier-sortie.png]. La politique de moderation du manifeste est appliquee retroactivement. Les contributions ne sont pas assorties d’une licence publique implicite.\n');
  if(args.videos)for(const mode of ['chronological','activity'] as const)for(const moderation of ['raw','moderated'] as const){const name=`timelapse-${mode}-${moderation}.mp4`;await exportVideo({database:join(temp,'capture.sqlite'),output:join(temp,name),mode,moderation,duration:180,fps:25,scale:2,captureAt});files.push(name);}
  const checksums:Record<string,string>={};for(const file of files){const hash=createHash('sha256');for await(const chunk of createReadStream(join(temp,file)))hash.update(chunk as Buffer);checksums[file]=hash.digest('hex');}
  let revision=process.env.CODE_REVISION;try{revision ||= execFileSync('git',['rev-parse','HEAD'],{cwd:codeRoot,encoding:'utf8'}).trim();}catch{} if(!revision)throw new Error('CODE_REVISION requis pour identifier le code');
  let ffmpeg='unavailable';try{ffmpeg=execFileSync('ffmpeg',['-version'],{encoding:'utf8'}).split('\n')[0];}catch{}
  await add('manifest.json',JSON.stringify({format:'art-collectif-archive-v1',eventFormat:'1',rasterVersion:'1',codeRevision:revision,node:process.version,ffmpeg,maxSeq,captureAt,revision:p.moderation_revision,moderation:args.moderation,videoParameters:args.videos?{duration:180,fps:25,scale:2}:null,checksums},null,2));
  const zip=new yazl.ZipFile(), output=createWriteStream(resolve(args.output),{mode:0o600});zip.outputStream.pipe(output);for(const file of files)zip.addFile(join(temp,file),file);zip.end();await once(output,'close');
 } finally{original?.close();db?.close();await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=new Map<string,string>();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);const database=args.get('--database'),output=args.get('--output');if(!database||!output)throw new Error('--database et --output requis');exportArchive({database,output,moderation:(args.get('--moderation')||'moderated') as 'raw'|'moderated',videos:args.get('--videos')==='true'}).catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});}
