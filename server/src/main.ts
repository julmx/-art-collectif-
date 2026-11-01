import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app';
const dir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dir,{recursive:true,mode:0o700});
const origin = process.env.APP_ORIGIN;
if (!origin) throw new Error('APP_ORIGIN is required');
const {app} = await createApp({dbPath:resolve(dir,'art.sqlite'),origin,secureCookie:!origin.startsWith('http://localhost') && !origin.startsWith('http://127.0.0.1')});
await app.listen({port:Number(process.env.PORT || 3000),host:process.env.HOST || '127.0.0.1'});
