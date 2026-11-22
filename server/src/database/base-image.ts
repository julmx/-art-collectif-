import {dirname, resolve, win32} from 'node:path';

/** Older volumes stored the host or container path to the same managed PNG. */
export function baseImagePath(database:string, storedPath:string):string {
  const name = win32.basename(storedPath);
  if (!/^base(?:-[a-f0-9]{64})?\.png$/.test(name)) throw new Error('Nom de fond invalide');
  return resolve(dirname(database), name);
}
