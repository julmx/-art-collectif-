import { it,expect,vi } from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {Store} from '../server/src/database/store';
import {exportVideo} from '../scripts/export-video';
import {PALETTE,parsePaletteRgb} from '../shared/palette';
it('produit une vidéo à partir d’une capture et refuse le rythme chronologique avant ouverture',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-video-test-')), db=join(dir,'db.sqlite'), base=join(dir,'base.png'), output=join(dir,'video.mp4');const store=new Store(db);
 try {const image=await sharp({create:{width:720,height:480,channels:3,background:{r:128,g:128,b:128}}}).png().toBuffer();writeFileSync(base,image);store.db.prepare('UPDATE project SET base_image_path=?,base_image_checksum=?').run(base,createHash('sha256').update(image).digest('hex'));const params={database:db,output,mode:'chronological' as const,moderation:'raw' as const,duration:1,fps:2,scale:1};await expect(exportVideo({...params,width:100})).rejects.toThrow('Résolution');await expect(exportVideo(params)).rejects.toThrow('avant ouverture');store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();store.db.prepare("UPDATE project SET status='open',started_at=?").run(new Date(Date.now()-1000).toISOString());store.submit('p',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'brush',colorId:1,size:21,points:[[20,20]]});await expect(exportVideo({...params,output:join(dir,'absent','fail.mp4')})).rejects.toThrow();await exportVideo(params);const result=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames','-of','json',output],{encoding:'utf8'}));expect(result.streams[0]).toMatchObject({width:720,height:480,nb_read_frames:'2'});
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
},30000);
it('inclut le fond initial et applique la modération aux deux rythmes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-video-modes-')), db=join(dir,'db.sqlite'), base=join(dir,'base.png');const store=new Store(db);
 try{const image=await sharp({create:{width:720,height:480,channels:3,background:{r:128,g:128,b:128}}}).png().toBuffer();writeFileSync(base,image);store.db.prepare('UPDATE project SET base_image_path=?,base_image_checksum=?,status=?,started_at=?').run(base,createHash('sha256').update(image).digest('hex'),'open',new Date(Date.now()-1000).toISOString());store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();const strokeId=randomUUID();store.submit('p',{opId:randomUUID(),strokeId,partIndex:0,final:true,tool:'brush',colorId:1,size:21,points:[[40,40]]});store.moderate('p',strokeId,'hide','test');const captureAt=new Date().toISOString();
 for(const mode of ['activity','chronological'] as const)for(const moderation of ['raw','moderated'] as const){const output=join(dir,`${mode}-${moderation}.mp4`);await exportVideo({database:db,output,mode,moderation,duration:1,fps:2,scale:1,captureAt});const frames=execFileSync('ffmpeg',['-v','error','-i',output,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:4*1024*1024});const index=(40*720+40)*3,size=720*480*3;expect(Math.abs(frames[index]-frames[index+1])).toBeLessThan(10);if(moderation==='raw')expect(frames[size+index]-frames[size+index+1]).toBeGreaterThan(80);else expect(Math.abs(frames[size+index]-frames[size+index+1])).toBeLessThan(10);}
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
},60000);

it('arrête les pixels et la séquence du timelapse à la capture demandée', async () => {
 const dir=mkdtempSync(join(tmpdir(),'art-video-cutoff-')), database=join(dir,'db.sqlite'), store=new Store(database);
 try {
   const base=join(dir,'base.png'), metadata=join(dir,'capture.json'), output=join(dir,'clip.mp4');
   const image=await sharp({create:{width:720,height:480,channels:3,background:'#808080'}}).png().toBuffer();
   writeFileSync(base,image);
   store.db.prepare("UPDATE project SET base_image_path=?,base_image_checksum=?,status='open',started_at=?").run(base,createHash('sha256').update(image).digest('hex'),'2026-01-01T00:00:00.000Z');
   store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();
   for (const [x, time] of [[40,'00:01'],[80,'00:03']] as const) {
     vi.setSystemTime(new Date(`2026-01-01T${time}:00Z`));
     expect(store.submit('p',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'brush',colorId:1,size:21,points:[[x,40]]}).accepted).toBe(true);
   }
   vi.useRealTimers();
   await exportVideo({database,output,metadata,mode:'chronological',moderation:'raw',duration:1,fps:2,scale:1,captureAt:'2026-01-01T00:02:00Z'});
   expect(JSON.parse(readFileSync(metadata,'utf8')).sequence).toBe(1);
   const frames=execFileSync('ffmpeg',['-v','error','-i',output,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:4*1024*1024});
   const redMinusGreen=(x:number)=>{const i=(720*480+40*720+x)*3; return frames[i]-frames[i+1];};
   expect(redMinusGreen(40)).toBeGreaterThan(80);
   expect(Math.abs(redMinusGreen(80))).toBeLessThan(10);
 } finally {vi.useRealTimers();store.close();rmSync(dir,{recursive:true,force:true});}
},30000);

it('prend en charge skipBackup et restitue exactement les couleurs RGB de la palette', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-video-rgb-'));
  const database = join(dir, 'db.sqlite');
  const basePath = join(dir, 'base.png');
  const output = join(dir, 'skip-backup.mp4');
  const store = new Store(database);
  try {
    const baseImage = await sharp({
      create: { width: 720, height: 480, channels: 3, background: { r: 64, g: 96, b: 128 } },
    })
      .png()
      .toBuffer();
    writeFileSync(basePath, baseImage);
    store.db
      .prepare("UPDATE project SET base_image_path=?,base_image_checksum=?,status='open',started_at=?")
      .run(basePath, createHash('sha256').update(baseImage).digest('hex'), '2026-01-01T00:00:00.000Z');
    store.db.prepare("INSERT INTO participants VALUES('p','h','now','now')").run();

    const samples = [
      { colorId: 1, x: 100, y: 120 },
      { colorId: 7, x: 240, y: 120 },
      { colorId: 12, x: 380, y: 120 },
    ] as const;

    for (const sample of samples) {
      expect(
        store.submit('p', {
          opId: randomUUID(),
          strokeId: randomUUID(),
          partIndex: 0,
          final: true,
          tool: 'brush',
          colorId: sample.colorId,
          size: 21,
          points: [[sample.x, sample.y]],
        }).accepted,
      ).toBe(true);
    }

    await exportVideo(
      {
        database,
        output,
        mode: 'activity',
        moderation: 'raw',
        duration: 1,
        fps: 2,
        scale: 1,
        skipBackup: true,
      },
      baseImage,
    );

    const paletteRgb = parsePaletteRgb(PALETTE);
    expect(paletteRgb.length).toBe(24 * 3);

    const frames = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    const frameSize = 720 * 480 * 3;
    const pixelAt = (frameIndex: number, x: number, y: number): [number, number, number] => {
      const offset = frameIndex * frameSize + (y * 720 + x) * 3;
      return [frames[offset], frames[offset + 1], frames[offset + 2]];
    };

    // Frame 0 : fond initial seul
    const [bR, bG, bB] = pixelAt(0, 100, 120);
    expect(Math.abs(bR - 64)).toBeLessThanOrEqual(10);
    expect(Math.abs(bG - 96)).toBeLessThanOrEqual(10);
    expect(Math.abs(bB - 128)).toBeLessThanOrEqual(10);

    // Frame 1 : pixels peints conformes à parsePaletteRgb(PALETTE)
    for (const sample of samples) {
      const [r, g, b] = pixelAt(1, sample.x, sample.y);
      const offset = (sample.colorId - 1) * 3;
      expect(Math.abs(r - paletteRgb[offset])).toBeLessThanOrEqual(15);
      expect(Math.abs(g - paletteRgb[offset + 1])).toBeLessThanOrEqual(15);
      expect(Math.abs(b - paletteRgb[offset + 2])).toBeLessThanOrEqual(15);
    }

    // Frame 1 : pixel non peint reste sur le fond initial
    const [uR, uG, uB] = pixelAt(1, 560, 300);
    expect(Math.abs(uR - 64)).toBeLessThanOrEqual(10);
    expect(Math.abs(uG - 96)).toBeLessThanOrEqual(10);
    expect(Math.abs(uB - 128)).toBeLessThanOrEqual(10);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
