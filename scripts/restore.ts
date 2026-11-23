import { DatabaseSync } from 'node:sqlite';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function restoreProject(backupDirectory: string, destination: string): Promise<void> {
  const source = resolve(backupDirectory);
  const target = resolve(destination);
  const lines = (await readFile(join(source, 'SHA256SUMS'), 'utf8')).trim().split('\n');

  const checksums = new Map<string, string>();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (project\.sqlite|base\.png|backup\.json|deployment\.env)$/.exec(line);
    if (!match || checksums.has(match[2])) {
      throw new Error('Manifeste invalide');
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(source, match[2]))) {
      hash.update(chunk as Buffer);
    }
    const digest = hash.digest('hex');
    if (digest !== match[1]) {
      throw new Error(`Somme invalide : ${match[2]}`);
    }
    checksums.set(match[2], digest);
  }

  if (!checksums.has('project.sqlite') || !checksums.has('backup.json')) {
    throw new Error('Sauvegarde incomplète');
  }

  await mkdir(target, { recursive: false, mode: 0o700 });
  await copyFile(join(source, 'project.sqlite'), join(target, 'art.sqlite'));
  if (checksums.has('base.png')) {
    await copyFile(join(source, 'base.png'), join(target, 'base.png'));
  }

  const db = new DatabaseSync(join(target, 'art.sqlite'));
  try {
    if ((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check !== 'ok') {
      throw new Error('Base invalide');
    }
    const project = db
      .prepare('SELECT base_image_path, base_image_checksum FROM project WHERE id=1')
      .get() as { base_image_path: string | null; base_image_checksum: string | null };
    if (project.base_image_path) {
      const baseChecksum = checksums.get('base.png');
      if (!baseChecksum) {
        throw new Error('Fond manquant');
      }
      if (!project.base_image_checksum || baseChecksum !== project.base_image_checksum) {
        throw new Error('Somme du fond incompatible avec la base SQLite');
      }
      db.prepare('UPDATE project SET base_image_path=? WHERE id=1').run('base.png');
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) {
    throw new Error('Usage : restore.ts SAUVEGARDE DOSSIER_NOUVEAU');
  }
  restoreProject(source, target).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
