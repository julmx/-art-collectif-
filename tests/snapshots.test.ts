import { it,expect } from 'vitest';
import { existsSync,mkdtempSync,renameSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute,join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { WIDTH,HEIGHT } from '../shared/raster';
import { Store } from '../server/src/database/store';
import { Snapshots } from '../server/src/renderer/snapshots';
it('validates snapshots and falls back when a cache is corrupt',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-snapshot-'));const store=new Store(join(dir,'db.sqlite'));try{const snapshotsDir=join(dir,'snapshots');const cache=new Snapshots(store,snapshotsDir);store.grid[0]=4;store.seq=500;await cache.saveIfDue();expect((await cache.latest(500,0))?.grid[0]).toBe(4);expect(await cache.latest(500,1)).toBeNull();const row=store.db.prepare('SELECT file_path FROM snapshots').get() as {file_path:string};expect(isAbsolute(row.file_path)).toBe(false);writeFileSync(join(snapshotsDir,row.file_path),'broken');expect(await cache.latest(500,0)).toBeNull();}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

it('a compatible snapshot and subsequent events match a full replay',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-snapshot-replay-'));const store=new Store(join(dir,'db.sqlite'));try{const {randomUUID}=await import('node:crypto');store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open'").run();const cache=new Snapshots(store,join(dir,'snapshots'));const command={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel' as const,colorId:3,size:1,points:[[10,20] as const]};store.submit('p',command);await cache.saveIfDue(Date.now()+16*60_000);const snapshot=await cache.latest(1,0);expect(snapshot).not.toBeNull();store.submit('p',{...command,opId:randomUUID(),strokeId:randomUUID(),points:[[30,40]]});expect(store.replay(2,'moderated',0,snapshot!)).toEqual(store.replay(2,'moderated',0));}finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

it('reconstruit au démarrage avec un snapshot valide ou corrompu',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-start-')),path=join(dir,'db.sqlite'),snapshotsDir=join(dir,'snapshots');const store=new Store(path);const {randomUUID}=await import('node:crypto');let file='';try{store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open'").run();const cache=new Snapshots(store,snapshotsDir);store.submit('p',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:4,size:1,points:[[9,9]]});await cache.saveIfDue(Date.now()+16*60_000);file=(store.db.prepare('SELECT file_path FROM snapshots').get() as {file_path:string}).file_path;}finally{store.close();}
 try{const {createApp}=await import('../server/src/app');let server=await createApp({dbPath:path,origin:'http://localhost:4173'});expect(server.store.grid[9*720+9]).toBe(4);await server.app.ready();await server.app.close();writeFileSync(join(snapshotsDir,file),'corrompu');server=await createApp({dbPath:path,origin:'http://localhost:4173'});expect(server.store.grid[9*720+9]).toBe(4);await server.app.ready();await server.app.close();}finally{rmSync(dir,{recursive:true,force:true});}
},15000);

it('reste utilisable après déplacement du dossier de données', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'art-snapshot-move-'));
  const dirA = join(parent, 'data-a');
  const dirB = join(parent, 'data-b');
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dirA, { recursive: true });
    const storeA = new Store(join(dirA, 'db.sqlite'));
    try {
      const cacheA = new Snapshots(storeA, join(dirA, 'snapshots'));
      storeA.grid[12] = 7;
      storeA.seq = 500;
      await cacheA.saveIfDue();
      const row = storeA.db.prepare('SELECT file_path FROM snapshots').get() as { file_path: string };
      expect(row.file_path).toMatch(/^\d+-\d+-[a-f0-9]{12}\.gz$/);
    } finally {
      storeA.close();
    }

    renameSync(dirA, dirB);
    const storeB = new Store(join(dirB, 'db.sqlite'));
    try {
      const cacheB = new Snapshots(storeB, join(dirB, 'snapshots'));
      const loaded = await cacheB.latest(500, 0);
      expect(loaded).not.toBeNull();
      expect(loaded?.seq).toBe(500);
      expect(loaded?.grid[12]).toBe(7);
    } finally {
      storeB.close();
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

it('rejette les traversées de chemin et accepte les anciens chemins absolus dans le dossier', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-snapshot-sec-'));
  const snapshotsDir = join(dir, 'snapshots');
  const store = new Store(join(dir, 'db.sqlite'));
  try {
    const cache = new Snapshots(store, snapshotsDir);
    const grid = new Uint8Array(WIDTH * HEIGHT);
    grid[3] = 9;
    const compressed = gzipSync(grid);
    const hash = createHash('sha256').update(compressed).digest('hex');
    const validName = `500-0-${hash.slice(0, 12)}.gz`;
    const outsideFile = join(dir, validName);
    writeFileSync(outsideFile, compressed);

    const invalidPaths = [
      `../${validName}`,
      outsideFile,
      `${snapshotsDir}/../${validName}`,
      `${snapshotsDir}/sub/../${validName}`,
      'invalid-name.gz',
    ];
    for (const [index, badPath] of invalidPaths.entries()) {
      store.db.prepare('DELETE FROM snapshots').run();
      store.db.prepare('INSERT INTO snapshots(seq,moderation_revision,file_path,checksum,created_at) VALUES(?,?,?,?,?)').run(500 + index, 0, badPath, hash, new Date().toISOString());
      expect(await cache.latest(1000, 0)).toBeNull();
    }

    // Legacy absolute path inside snapshotsDir remains readable.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(snapshotsDir, { recursive: true });
    const legacyPath = join(snapshotsDir, validName);
    writeFileSync(legacyPath, compressed);
    store.db.prepare('DELETE FROM snapshots').run();
    store.db.prepare('INSERT INTO snapshots(seq,moderation_revision,file_path,checksum,created_at) VALUES(?,?,?,?,?)').run(500, 0, legacyPath, hash, new Date().toISOString());
    expect((await cache.latest(500, 0))?.grid[3]).toBe(9);

    // Purge must never unlink a file outside snapshotsDir.
    store.db.prepare('DELETE FROM snapshots').run();
    for (let i = 0; i < 21; i++) {
      const createdAt = new Date(Date.now() - (30 - i) * 60_000).toISOString();
      const targetPath = i === 0 ? `../${validName}` : `${i + 1}-0-${hash.slice(0, 12)}.gz`;
      store.db.prepare('INSERT INTO snapshots(seq,moderation_revision,file_path,checksum,created_at) VALUES(?,?,?,?,?)').run(i + 1, 0, targetPath, hash, createdAt);
    }
    store.grid[0] = 5;
    store.seq = 1000;
    await cache.saveIfDue(Date.now() + 20 * 60_000);
    expect(existsSync(outsideFile)).toBe(true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
