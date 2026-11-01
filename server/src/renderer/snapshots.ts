import { createHash,randomBytes } from 'node:crypto';
import { mkdir,readFile,rename,unlink,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { gzipSync,gunzipSync } from 'node:zlib';
import { WIDTH,HEIGHT } from '../../../shared/raster';
import type { Store } from '../database/store';
const digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
export class Snapshots {
  private busy=false; private lastSeq=0; private lastTime=Date.now(); private lastDigest=''; private lastRevision=-1;
  constructor(private store:Store,private directory:string) {
    store.db.exec('CREATE TABLE IF NOT EXISTS snapshots(seq INTEGER NOT NULL,moderation_revision INTEGER NOT NULL,file_path TEXT NOT NULL,checksum TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(seq,moderation_revision))');
    this.lastSeq=store.seq;this.lastRevision=store.revision();this.lastDigest=digest(store.grid);
  }
  async saveIfDue(now=Date.now()) {
    if(this.busy) return; const seq=this.store.seq, revision=this.store.revision(), grid=this.store.grid.slice(), checksum=digest(grid);
    if(checksum===this.lastDigest && revision===this.lastRevision) return;
    if(seq-this.lastSeq<500 && now-this.lastTime<15*60_000) return;
    this.busy=true;
    try {
      await mkdir(this.directory,{recursive:true,mode:0o700}); const compressed=gzipSync(grid); const hash=digest(compressed); const path=join(this.directory,`${seq}-${revision}-${hash.slice(0,12)}.gz`), temp=join(this.directory,`.${randomBytes(12).toString('hex')}.tmp`);
      await writeFile(temp,compressed,{mode:0o600,flag:'wx'}); await rename(temp,path);
      this.store.db.prepare('INSERT OR REPLACE INTO snapshots(seq,moderation_revision,file_path,checksum,created_at) VALUES(?,?,?,?,?)').run(seq,revision,path,hash,new Date(now).toISOString());
      this.lastSeq=seq;this.lastTime=now;this.lastDigest=checksum;this.lastRevision=revision;
      const old=this.store.db.prepare('SELECT seq,moderation_revision,file_path FROM snapshots ORDER BY created_at DESC,seq DESC LIMIT -1 OFFSET 20').all() as {seq:number;moderation_revision:number;file_path:string}[];
      for(const item of old){this.store.db.prepare('DELETE FROM snapshots WHERE seq=? AND moderation_revision=?').run(item.seq,item.moderation_revision);if(resolve(item.file_path).startsWith(resolve(this.directory)+'/')) await unlink(item.file_path).catch(()=>{});}
    } finally {this.busy=false;}
  }
  async latest(target:number,revision:number):Promise<{seq:number;grid:Uint8Array}|null> {
    const rows=this.store.db.prepare('SELECT seq,file_path,checksum FROM snapshots WHERE seq<=? AND moderation_revision=? ORDER BY seq DESC').all(target,revision) as {seq:number;file_path:string;checksum:string}[];
    for(const row of rows) try {if(!resolve(row.file_path).startsWith(resolve(this.directory)+'/'))continue;const data=await readFile(row.file_path);if(digest(data)!==row.checksum)continue;const grid=gunzipSync(data,{maxOutputLength:WIDTH*HEIGHT});if(grid.length!==WIDTH*HEIGHT||grid.some(v=>v>24))continue;return {seq:row.seq,grid:new Uint8Array(grid)};} catch { /* fall back to an older snapshot or replay */ }
    return null;
  }
}
