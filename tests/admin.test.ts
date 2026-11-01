import { it, expect } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes,scryptSync } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/src/app';
import { PALETTE } from '../shared/palette';

it('protège la configuration, valide le fond et verrouille les paramètres à l’ouverture',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'art-admin-')), salt=randomBytes(16), password='test-password', passwordHash=`${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`;
  const {app}=await createApp({dbPath:join(dir,'db.sqlite'),origin:'http://localhost:4173',secureCookie:false,adminPasswordHash:passwordHash});
  const headers={origin:'http://localhost:4173'};
  try {
    expect((await app.inject({method:'GET',url:'/api/admin/events'})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/api/admin/login',headers,payload:{password:'wrong'}})).statusCode).toBe(401);
    const login=await app.inject({method:'POST',url:'/api/admin/login',headers,payload:{password}}); expect(login.statusCode).toBe(200);
    const cookie=(login.headers['set-cookie'] as string).split(';')[0], auth={...headers,cookie};
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'open'}})).statusCode).toBe(409);
    const bad=await sharp({create:{width:720,height:480,channels:3,background:{r:255,g:0,b:0}}}).png().toBuffer();
    expect((await app.inject({method:'POST',url:'/api/admin/base-image',headers:{...auth,'content-type':'image/png'},payload:bad})).statusCode).toBe(400);
    const good=await sharp({create:{width:720,height:480,channels:3,background:{r:100,g:100,b:100}}}).png().toBuffer();
    expect((await app.inject({method:'POST',url:'/api/admin/base-image',headers:{...auth,'content-type':'image/png'},payload:good})).statusCode).toBe(200);
    const config={palette:PALETTE,title:'Projet',description:'Description',participationTerms:'Conditions de participation'};
    expect((await app.inject({method:'PUT',url:'/api/admin/config',headers:auth,payload:config})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'open'}})).statusCode).toBe(200);
    expect((await app.inject({method:'PUT',url:'/api/admin/config',headers:auth,payload:config})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'closed'}})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/admin/status',headers:auth,payload:{status:'open'}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/admin/logout',headers:auth})).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:'/api/admin/events',headers:{cookie}})).statusCode).toBe(401);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
},15000);
