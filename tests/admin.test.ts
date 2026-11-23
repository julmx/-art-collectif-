import { it, expect } from 'vitest';
import { mkdtempSync,rmSync,mkdirSync,writeFileSync,symlinkSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash,randomBytes,randomUUID,scryptSync } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/src/app';
import { PALETTE } from '../shared/palette';

it('protège la configuration, valide le fond et verrouille les paramètres à l’ouverture',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'art-admin-')), salt=randomBytes(16), password='test-password', passwordHash=`${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`;
  const {app,store}=await createApp({dbPath:join(dir,'db.sqlite'),origin:'http://localhost:4173',secureCookie:false,adminPasswordHash:passwordHash});
  const headers={origin:'http://localhost:4173'};
  try {
    for (const url of ['/api/admin/events','/api/admin/image.png','/api/admin/export/final.png','/api/admin/export/overlay.png','/api/admin/export/events.jsonl','/api/admin/export/moderation.jsonl','/api/admin/archives','/api/admin/archives/export']) expect((await app.inject({method:'GET',url})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/admin/login',headers,payload:{password:'wrong'}})).statusCode).toBe(401);
    const login=await app.inject({method:'POST',url:'/api/admin/login',headers,payload:{password}}); expect(login.statusCode).toBe(200);
    const cookie=(login.headers['set-cookie'] as string).split(';')[0], auth={...headers,cookie};
    mkdirSync(join(dir,'archives'));writeFileSync(join(dir,'archives','export.zip'),'archive');writeFileSync(join(dir,'private.txt'),'secret');symlinkSync(join(dir,'private.txt'),join(dir,'archives','escape.zip'));
    expect((await app.inject({method:'GET',url:'/api/admin/archives/export',headers:{cookie}})).body).toBe('archive');
    expect((await app.inject({method:'GET',url:'/api/admin/archives/escape',headers:{cookie}})).statusCode).toBe(404);

    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'open'}})).statusCode).toBe(409);
    const bad=await sharp({create:{width:720,height:480,channels:3,background:{r:255,g:0,b:0}}}).png().toBuffer();
    expect((await app.inject({method:'POST',url:'/api/admin/base-image',headers:{...auth,'content-type':'image/png'},payload:bad})).json().error).toBe('PNG_NOT_GRAYSCALE');
    const wrongSize=await sharp({create:{width:100,height:100,channels:3,background:'#808080'}}).png().toBuffer();
    expect((await app.inject({method:'POST',url:'/api/admin/base-image',headers:{...auth,'content-type':'image/png'},payload:wrongSize})).json().error).toBe('PNG_DIMENSIONS');
    const tooLarge=await sharp({create:{width:1440,height:960,channels:3,background:'#808080'}}).png().toBuffer();
    expect((await app.inject({method:'POST',url:'/api/admin/base-image',headers:{...auth,'content-type':'image/png'},payload:tooLarge})).json().error).toBe('PNG_DIMENSIONS');
    const transparent=await sharp({create:{width:720,height:480,channels:4,background:{r:100,g:100,b:100,alpha:0.5}}}).png().toBuffer();
    expect((await app.inject({method:'POST',url:'/api/admin/base-image',headers:{...auth,'content-type':'image/png'},payload:transparent})).json().error).toBe('PNG_TRANSPARENT');
    const good=await sharp({create:{width:720,height:480,channels:3,background:{r:100,g:100,b:100}}}).png().toBuffer();
    expect((await app.inject({method:'POST',url:'/api/admin/base-image',headers:{...auth,'content-type':'image/png'},payload:good})).statusCode).toBe(200);
    const config={palette:PALETTE,title:'Projet',description:'Description',participationTerms:'Conditions de participation'};
    expect((await app.inject({method:'PUT',url:'/api/admin/config',headers:auth,payload:config})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'open'}})).statusCode).toBe(200);
    store.db.prepare("INSERT INTO participants VALUES('test-participant','private-hash','now','now')").run();store.submit('test-participant',{opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:1,size:1,points:[[2,2]]});
    const exportedEvents=await app.inject({method:'GET',url:'/api/admin/export/events.jsonl',headers:{cookie}});expect(exportedEvents.statusCode).toBe(200);expect(exportedEvents.body).not.toContain('private-hash');expect(JSON.parse(exportedEvents.body.trim())).toMatchObject({seq:1,participantId:'test-participant'});

    const exported=await app.inject({method:'GET',url:'/api/admin/image.png?seq=0&moderation=raw',headers:{cookie}});
    expect(exported.statusCode).toBe(200); expect(exported.headers['x-art-sequence']).toBe('0');
    const image=await sharp(exported.rawPayload).raw().toBuffer({resolveWithObject:true}); expect([...image.data.subarray(0,3)]).toEqual([100,100,100]);
    const overlay=await app.inject({method:'GET',url:'/api/admin/export/overlay.png',headers:{cookie}}); const rgba=await sharp(overlay.rawPayload).raw().toBuffer(); expect(rgba[3]).toBe(0);
    const scaled=await app.inject({method:'GET',url:'/api/admin/image.png?seq=1&scale=2',headers:{cookie}});expect(scaled.statusCode).toBe(200);const rendered=await sharp(scaled.rawPayload).raw().toBuffer({resolveWithObject:true});expect(rendered.info.width).toBe(1440);const offset=(4*1440+4)*rendered.info.channels;expect([...rendered.data.subarray(offset,offset+3)]).toEqual([230,57,70]);

    expect((await app.inject({method:'GET',url:'/api/admin/image.png?seq=0&at=2026-01-01T00:00:00Z',headers:{cookie}})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/api/admin/image.png?at=2026-02-30T00:00:00Z',headers:{cookie}})).statusCode).toBe(400);

    expect((await app.inject({method:'PUT',url:'/api/admin/config',headers:auth,payload:{...config,participationTerms:'Nouvelles conditions'}})).statusCode).toBe(200);
    const changed=[...PALETTE]; [changed[0],changed[1]]=[changed[1],changed[0]];
    expect((await app.inject({method:'PUT',url:'/api/admin/config',headers:auth,payload:{...config,palette:changed}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'closed'}})).json().error).toBe('CLOSURE_CONFIRMATION_REQUIRED');
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'closed',confirmation:'oui'}})).statusCode).toBe(400);
    expect((await app.inject({method:'GET',url:'/api/project'})).json().status).toBe('open');
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'closed',confirmation:'CLOTURER'}})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'open'}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/admin/logout',headers:auth})).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:'/api/admin/events',headers:{cookie}})).statusCode).toBe(401);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
},15000);

it('isole les tentatives derrière le seul proxy de confiance et accepte les conditions UTF-8 longues',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-proxy-')),origin='http://localhost:4173',salt=randomBytes(16),password='correct';
 const {app}=await createApp({dbPath:join(dir,'db.sqlite'),origin,secureCookie:false,trustedProxy:'10.20.30.2',adminPasswordHash:`${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`});
 try {
   const login=(remoteAddress:string,forwarded:string,password:string)=>app.inject({method:'POST',url:'/api/admin/login',remoteAddress,headers:{origin,'x-forwarded-for':forwarded},payload:{password}});
   for(let i=0;i<5;i++)expect((await login('10.20.30.2','198.51.100.1','bad')).statusCode).toBe(401);
   expect((await login('10.20.30.2','198.51.100.1',password)).statusCode).toBe(429);
   const good=await login('10.20.30.2','198.51.100.2',password);expect(good.statusCode).toBe(200);
   for(let i=0;i<5;i++)expect((await login('10.20.30.3',`203.0.113.${i+1}`,'bad')).statusCode).toBe(401);
   expect((await login('10.20.30.3','203.0.113.99',password)).statusCode).toBe(429);
   const cookie=(good.headers['set-cookie'] as string).split(';')[0];
   const result=await app.inject({method:'PUT',url:'/api/admin/config',headers:{origin,cookie},payload:{palette:PALETTE,title:'Titre',description:'é'.repeat(4000),participationTerms:'😀'.repeat(10000)}});
   expect(result.statusCode).toBe(200);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
},15000);

it('vérifie la connexion asynchrone et supprime le PNG orphelin si le projet quitte le brouillon', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'art-admin-async-'));
  const origin = 'http://localhost:4173';
  const salt = randomBytes(16);
  const password = 'secret-async-password';
  const passwordHash = `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
  const { app, store } = await createApp({ dbPath: join(dir, 'db.sqlite'), origin, secureCookie: false, adminPasswordHash: passwordHash });
  const headers = { origin };
  try {
    const [badLogin, goodLogin] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/admin/login', headers, payload: { password: 'wrong-password' } }),
      app.inject({ method: 'POST', url: '/api/admin/login', headers, payload: { password } }),
    ]);
    expect(badLogin.statusCode).toBe(401);
    expect(goodLogin.statusCode).toBe(200);
    const cookie = (goodLogin.headers['set-cookie'] as string).split(';')[0];
    const auth = { ...headers, cookie };

    const activePng = await sharp({ create: { width: 720, height: 480, channels: 3, background: { r: 90, g: 90, b: 90 } } }).png().toBuffer();
    const activeName = `base-${createHash('sha256').update(activePng).digest('hex')}.png`;
    expect((await app.inject({ method: 'POST', url: '/api/admin/base-image', headers: { ...auth, 'content-type': 'image/png' }, payload: activePng })).statusCode).toBe(200);
    expect(existsSync(join(dir, activeName))).toBe(true);

    const orphanPng = await sharp({ create: { width: 720, height: 480, channels: 3, background: { r: 140, g: 140, b: 140 } } }).png().toBuffer();
    const orphanName = `base-${createHash('sha256').update(orphanPng).digest('hex')}.png`;

    const originalPrepare = store.db.prepare.bind(store.db);
    let intercepted = false;
    store.db.prepare = ((sql: string) => {
      if (sql.includes("UPDATE project SET base_image_path=?") && !intercepted) {
        intercepted = true;
        originalPrepare("UPDATE project SET status='open' WHERE id=1").run();
      }
      return originalPrepare(sql);
    }) as typeof store.db.prepare;
    try {
      const locked = await app.inject({ method: 'POST', url: '/api/admin/base-image', headers: { ...auth, 'content-type': 'image/png' }, payload: orphanPng });
      expect(intercepted).toBe(true);
      expect(locked.statusCode).toBe(409);
      expect(locked.json().error).toBe('PROJECT_LOCKED');
      expect(existsSync(join(dir, orphanName))).toBe(false);
      expect(existsSync(join(dir, activeName))).toBe(true);

      // Re-uploading the already active PNG while transitioning out of draft must not delete the active file.
      originalPrepare("UPDATE project SET status='draft' WHERE id=1").run();
      intercepted = false;
      const sameLocked = await app.inject({ method: 'POST', url: '/api/admin/base-image', headers: { ...auth, 'content-type': 'image/png' }, payload: activePng });
      expect(intercepted).toBe(true);
      expect(sameLocked.statusCode).toBe(409);
      expect(existsSync(join(dir, activeName))).toBe(true);
    } finally {
      store.db.prepare = originalPrepare;
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);
