import {DatabaseSync,backup} from 'node:sqlite';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReadStream} from 'node:fs';
export async function backupProject(database:string,output:string){
 const destination=resolve(output);await mkdir(destination,{recursive:false,mode:0o700});let source:DatabaseSync|undefined,copy:DatabaseSync|undefined;
 try{source=new DatabaseSync(resolve(database),{readOnly:true});await backup(source,join(destination,'project.sqlite'));source.close();source=undefined;copy=new DatabaseSync(join(destination,'project.sqlite'),{readOnly:true});
 const integrity=copy.prepare('PRAGMA integrity_check').get() as {integrity_check:string};if(integrity.integrity_check!=='ok')throw new Error('Sauvegarde SQLite invalide');
 const project=copy.prepare('SELECT base_image_path,base_image_checksum FROM project WHERE id=1').get() as {base_image_path:string|null;base_image_checksum:string|null};const files=['project.sqlite'];
 if(project.base_image_path){const image=await readFile(project.base_image_path);if(createHash('sha256').update(image).digest('hex')!==project.base_image_checksum)throw new Error('Fond non conforme à la capture');await copyFile(project.base_image_path,join(destination,'base.png'));files.push('base.png');}
 await writeFile(join(destination,'backup.json'),JSON.stringify({createdAt:new Date().toISOString(),maxSeq:(copy.prepare('SELECT COALESCE(MAX(seq),0) n FROM draw_events').get() as {n:number}).n,files},null,2),{mode:0o600});
 const checksums=[];for(const name of [...files,'backup.json']){const hash=createHash('sha256');for await(const chunk of createReadStream(join(destination,name)))hash.update(chunk as Buffer);checksums.push(`${hash.digest('hex')}  ${name}`);}await writeFile(join(destination,'SHA256SUMS'),checksums.join('\n')+'\n',{mode:0o600});
 }finally{source?.close();copy?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [database,output]=process.argv.slice(2);if(!database||!output)throw new Error('Usage : backup.ts BASE_SQLITE DOSSIER_NOUVEAU');backupProject(database,output).catch(e=>{process.stderr.write(`${e.message}\n`);process.exitCode=1;});}
