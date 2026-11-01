import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { createApp } from '../../server/src/app';
const dir=mkdtempSync(join(tmpdir(),'art-e2e-'));
const {app,store}=await createApp({dbPath:join(dir,'db.sqlite'),origin:'http://127.0.0.1:4173',secureCookie:false,adminPasswordHash:`${'01'.repeat(16)}:${scryptSync('test-password',Buffer.from('01'.repeat(16),'hex'),64).toString('hex')}`});
store.db.prepare("UPDATE project SET status='open'").run();
await app.listen({port:3000,host:'127.0.0.1'});
