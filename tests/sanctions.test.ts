import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import {createApp} from '../server/src/app';
it('le bannissement est persistant, réversible et refuse les nouvelles contributions',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'art-sanctions-')),dbPath=join(dir,'db.sqlite'),origin='http://localhost:4173',salt=Buffer.alloc(16,1),password='test-password';let context=await createApp({dbPath,origin,secureCookie:false,adminPasswordHash:`${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`});
 try{const {app,store}=context;store.db.prepare("INSERT INTO participants VALUES('p','hash','now','now')").run();store.db.prepare("UPDATE project SET status='open'").run();const command={opId:randomUUID(),strokeId:randomUUID(),partIndex:0,final:true,tool:'pixel',colorId:1,size:1,points:[[1,1]]};expect(store.submit('p',command).accepted).toBe(true);
 const login=await app.inject({method:'POST',url:'/api/admin/login',headers:{origin},payload:{password}}),cookie=(login.headers['set-cookie'] as string).split(';')[0],headers={origin,cookie};
 expect((await app.inject({method:'POST',url:'/api/admin/participant-sanction',headers,payload:{participantId:'p',action:'ban',reason:'abus'}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:'/api/admin/participant-sanction',headers,payload:{participantId:'p',action:'ban',reason:'abus',confirmation:'BANNIR'}})).statusCode).toBe(200);
 expect(store.submit('p',command)).toMatchObject({accepted:true,duplicate:true});expect(store.submit('p',{...command,opId:randomUUID(),strokeId:randomUUID()})).toMatchObject({accepted:false,code:'PARTICIPANT_BANNED'});await app.close();context=await createApp({dbPath,origin,secureCookie:false});expect(context.store.isBanned('p')).toBe(true);context.store.sanction('p','unban','erreur');expect(context.store.submit('p',{...command,opId:randomUUID(),strokeId:randomUUID()}).accepted).toBe(true);
 }finally{await context.app.close();rmSync(dir,{recursive:true,force:true});}
},15000);
