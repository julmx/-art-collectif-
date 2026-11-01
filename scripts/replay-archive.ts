import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {WIDTH,HEIGHT,applyCells,paintBrush} from '../shared/raster';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const project=JSON.parse(await readFile(join(root,'project.json'),'utf8')) as {palette:string[]};
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')) as {moderation:string;revision:number;maxSeq:number};
const target=process.argv[2]===undefined?manifest.maxSeq:Number(process.argv[2]);if(!Number.isSafeInteger(target)||target<0||target>manifest.maxSeq)throw new Error('Séquence invalide');
const hidden=new Set<string>(), actions=(await readFile(join(root,'moderation.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
if(manifest.moderation==='moderated') for(const a of actions){if(a.revision>manifest.revision)continue;const key=JSON.stringify([a.participant_id,a.stroke_id]);if(a.action==='hide')hidden.add(key);else hidden.delete(key);}
const grid=new Uint8Array(WIDTH*HEIGHT),events=(await readFile(join(root,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
for(const e of events){if(e.seq>target)break;if(!hidden.has(JSON.stringify([e.participantId,e.strokeId])))applyCells(grid,paintBrush(e.points,e.size,e.colorId));}
const rgba=Buffer.alloc(WIDTH*HEIGHT*4);for(let i=0;i<grid.length;i++)if(grid[i]){const c=project.palette[grid[i]-1];rgba[i*4]=parseInt(c.slice(1,3),16);rgba[i*4+1]=parseInt(c.slice(3,5),16);rgba[i*4+2]=parseInt(c.slice(5,7),16);rgba[i*4+3]=255;}
const image=await sharp(await readFile(join(root,'base.png'))).composite([{input:rgba,raw:{width:WIDTH,height:HEIGHT,channels:4}}]).png().toBuffer();await writeFile(resolve(process.argv[3] || 'reconstruction.png'),image);
