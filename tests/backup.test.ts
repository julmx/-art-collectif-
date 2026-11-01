import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../server/src/database/store';
import {backupProject} from '../scripts/backup';
import {restoreProject} from '../scripts/restore';
it('produit une copie SQLite cohérente depuis une base active en WAL',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-backup-')),path=join(dir,'live.sqlite'),out=join(dir,'backup');const store=new Store(path);
 try{store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();await backupProject(path,out);await restoreProject(out,join(dir,'restored'));const restored=new DatabaseSync(join(dir,'restored','art.sqlite'));try{expect(restored.prepare('SELECT count(*) n FROM participants').get()?.n).toBe(1);expect(restored.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');expect(readFileSync(join(out,'SHA256SUMS'),'utf8')).toContain('project.sqlite');}finally{restored.close();}}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
