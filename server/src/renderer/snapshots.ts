import { createHash,randomBytes } from 'node:crypto';
import { mkdir,readFile,rename,unlink,writeFile } from 'node:fs/promises';
import { basename,dirname,isAbsolute,join,resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip,gunzipSync } from 'node:zlib';
import { WIDTH,HEIGHT } from '../../../shared/raster';
import type { Store } from '../database/store';
const digest=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const gzipAsync=promisify(gzip);
const SNAPSHOT_NAME=/^\d+-\d+-[a-f0-9]{12}\.gz$/;
export class Snapshots {
  private busy=false; private lastSeq=0; private lastTime=Date.now(); private lastDigest=''; private lastRevision=-1;
  constructor(private store:Store,private directory:string) {
    store.db.exec('CREATE TABLE IF NOT EXISTS snapshots(seq INTEGER NOT NULL,moderation_revision INTEGER NOT NULL,file_path TEXT NOT NULL,checksum TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(seq,moderation_revision))');
    this.lastSeq=store.seq;this.lastRevision=store.revision();this.lastDigest=digest(store.grid);
  }
  private resolvePath(storedPath:string):string|null {
    if(!storedPath || storedPath.includes('\0') || storedPath.includes('\\')) return null;
    const baseDir=resolve(this.directory);
    if(isAbsolute(storedPath)) {
      if(storedPath.split('/').includes('..')) return null;
      const candidate=resolve(storedPath);
      if(dirname(candidate)!==baseDir) return null;
      return SNAPSHOT_NAME.test(basename(candidate)) ? candidate : null;
    }
    if(!SNAPSHOT_NAME.test(storedPath)) return null;
    const candidate=resolve(baseDir,storedPath);
    return dirname(candidate)===baseDir ? candidate : null;
  }
  resetBaseline(snapshot?:{seq:number;grid:Uint8Array;createdAt:string}|null) { this.lastSeq=snapshot?.seq ?? 0; this.lastRevision=snapshot ? this.store.revision() : 0; this.lastDigest=digest(snapshot?.grid ?? new Uint8Array(WIDTH*HEIGHT)); this.lastTime=snapshot ? Date.parse(snapshot.createdAt) : Date.now(); }
  async saveIfDue(now=Date.now()) {
    if(this.busy) return; const seq=this.store.seq, revision=this.store.revision(), grid=this.store.grid.slice(), checksum=digest(grid);
    if(checksum===this.lastDigest && revision===this.lastRevision) return;
    if(seq-this.lastSeq<500 && now-this.lastTime<15*60_000) return;
    this.busy=true;
    try {
      await mkdir(this.directory,{recursive:true,mode:0o700}); const compressed=await gzipAsync(grid); const hash=digest(compressed); const fileName=`${seq}-${revision}-${hash.slice(0,12)}.gz`, path=join(this.directory,fileName), temp=join(this.directory,`.${randomBytes(12).toString('hex')}.tmp`);
      await writeFile(temp,compressed,{mode:0o600,flag:'wx'}); await rename(temp,path);
      this.store.db.prepare('INSERT OR REPLACE INTO snapshots(seq,moderation_revision,file_path,checksum,created_at) VALUES(?,?,?,?,?)').run(seq,revision,fileName,hash,new Date(now).toISOString());
      this.lastSeq=seq;this.lastTime=now;this.lastDigest=checksum;this.lastRevision=revision;
      const old=this.store.db.prepare('SELECT seq,moderation_revision,file_path FROM snapshots ORDER BY created_at DESC,seq DESC LIMIT -1 OFFSET 20').all() as {seq:number;moderation_revision:number;file_path:string}[];
      for(const item of old){this.store.db.prepare('DELETE FROM snapshots WHERE seq=? AND moderation_revision=?').run(item.seq,item.moderation_revision);const filePath=this.resolvePath(item.file_path);if(filePath) await unlink(filePath).catch(()=>{});}
    } finally {this.busy=false;}
  }
  async latest(target:number,revision:number):Promise<{seq:number;grid:Uint8Array;createdAt:string}|null> {
    const rows=this.store.db.prepare('SELECT seq,file_path,checksum,created_at FROM snapshots WHERE seq<=? AND moderation_revision=? ORDER BY seq DESC').all(target,revision) as {seq:number;file_path:string;checksum:string;created_at:string}[];
    for(const row of rows) try {const filePath=this.resolvePath(row.file_path);if(!filePath)continue;const data=await readFile(filePath);if(digest(data)!==row.checksum)continue;const grid=gunzipSync(data,{maxOutputLength:WIDTH*HEIGHT});if(grid.length!==WIDTH*HEIGHT||grid.some(v=>v>24))continue;return {seq:row.seq,grid:new Uint8Array(grid),createdAt:row.created_at};} catch { /* fall back to an older snapshot or replay */ }
    return null;
  }
}
