import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function restoreProject(backupDirectory:string,destination:string){
 const source=resolve(backupDirectory),target=resolve(destination),lines=(await readFile(join(source,'SHA256SUMS'),'utf8')).trim().split('\n');
 const found=new Set<string>();for(const line of lines){const match=/^([a-f0-9]{64})  (project\.sqlite|base\.png|backup\.json|deployment\.env)$/.exec(line);if(!match||found.has(match[2]))throw new Error('Manifeste invalide');found.add(match[2]);const hash=createHash('sha256');for await(const chunk of createReadStream(join(source,match[2])))hash.update(chunk as Buffer);if(hash.digest('hex')!==match[1])throw new Error(`Somme invalide : ${match[2]}`);}
 if(!found.has('project.sqlite')||!found.has('backup.json'))throw new Error('Sauvegarde incomplète');
 await mkdir(target,{recursive:false,mode:0o700});await copyFile(join(source,'project.sqlite'),join(target,'art.sqlite'));if(found.has('base.png'))await copyFile(join(source,'base.png'),join(target,'base.png'));
 const db=new DatabaseSync(join(target,'art.sqlite'));try{if((db.prepare('PRAGMA integrity_check').get() as {integrity_check:string}).integrity_check!=='ok')throw new Error('Base invalide');const project=db.prepare('SELECT base_image_path FROM project WHERE id=1').get() as {base_image_path:string|null};if(project.base_image_path&&!found.has('base.png'))throw new Error('Fond manquant');if(project.base_image_path)db.prepare('UPDATE project SET base_image_path=? WHERE id=1').run(join(target,'base.png'));}finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [source,target]=process.argv.slice(2);if(!source||!target)throw new Error('Usage : restore.ts SAUVEGARDE DOSSIER_NOUVEAU');restoreProject(source,target).catch(e=>{process.stderr.write(`${e.message}\n`);process.exitCode=1;});}
