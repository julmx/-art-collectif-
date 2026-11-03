import {DatabaseSync} from 'node:sqlite';
import {WIDTH, HEIGHT, paintBrush, applyCells} from '../shared/raster';
import type {DrawCommand} from '../shared/protocol';
const [path, seqText, revisionText, overridesText] = process.argv.slice(2);
const seq=Number(seqText), revision=Number(revisionText);
const overrides=JSON.parse(Buffer.from(overridesText,'base64url').toString()) as {participantId:string;strokeId:string;action:'hide'|'restore'}[];
const db=new DatabaseSync(path,{readOnly:true});
try {
  db.exec('BEGIN');
  const hidden=new Set<string>();
  for(const d of db.prepare('SELECT participant_id,stroke_id,action FROM moderation_actions WHERE revision<=? ORDER BY revision').iterate(revision) as IterableIterator<{participant_id:string;stroke_id:string;action:string}>) {const k=JSON.stringify([d.participant_id,d.stroke_id]);if(d.action==='hide')hidden.add(k);else hidden.delete(k);}
  for(const d of overrides){const k=JSON.stringify([d.participantId,d.strokeId]);if(d.action==='hide')hidden.add(k);else hidden.delete(k);}
  const grid=new Uint8Array(WIDTH*HEIGHT);
  for(const row of db.prepare('SELECT participant_id,command_json FROM draw_events WHERE seq<=? ORDER BY seq').iterate(seq) as IterableIterator<{participant_id:string;command_json:string}>){const c=JSON.parse(row.command_json) as DrawCommand;if(!hidden.has(JSON.stringify([row.participant_id,c.strokeId])))applyCells(grid,paintBrush(c.points,c.size,c.colorId));}
  process.stdout.write(Buffer.from(grid));
  db.exec('COMMIT');
} finally {db.close();}
