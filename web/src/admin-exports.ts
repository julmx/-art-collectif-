type ExportItem = {
  file: string; kind: 'video' | 'archive'; date: string; dateKind: 'created' | 'modified'; size: number;
  metadata: null | { captureCompletedAt?: string; sequence?: number; mode?: string; moderation?: string; duration?: number; fps?: number; scale?: number; includeVideos?: boolean };
};
type Job = { status: string; error?: string };

export function initExports(
  request: (url: string, init?: RequestInit) => Promise<Response>,
  form: (selector: string, handler: (data: FormData) => Promise<void>) => void,
  json: (body: unknown) => RequestInit,
  tell: (text: string, error?: boolean) => void,
) {
  const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const video = el<HTMLFormElement>('#create-video'), archive = el<HTMLFormElement>('#create-archive');
  const videoButton = video.querySelector('button')!, archiveButton = archive.querySelector('button')!;
  const duration = video.querySelector<HTMLInputElement>('[name=duration]')!, fps = video.querySelector<HTMLInputElement>('[name=fps]')!;
  const progress = el('#export-progress');
  const number = new Intl.NumberFormat('fr-FR');
  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  let timer: ReturnType<typeof setTimeout>, version = 0, busy = false;

  function updateOptions() {
    const frames = Math.max(2, duration.valueAsNumber * fps.valueAsNumber);
    const excess = frames > 9000;
    const hint = el('#frames');
    hint.textContent = excess ? 'La vidéo dépasse 9 000 images. Réduisez la durée ou la cadence.' :
      Number.isFinite(frames) ? number.format(frames) + ' images sur 9 000 maximum.' : '9 000 images maximum.';
    hint.dataset.error = String(excess);
    fps.setCustomValidity(excess ? hint.textContent : '');
    videoButton.disabled = busy || excess;
    archiveButton.disabled = busy;
  }
  video.addEventListener('input', updateOptions);
  updateOptions();

  function fileRow(item: ExportItem) {
    const row = document.createElement('article'), info = document.createElement('div');
    row.className = 'generated-item'; info.className = 'generated-info';
    const title = document.createElement('strong');
    title.textContent = item.kind === 'archive' ? 'Archive ZIP' : 'Vidéo MP4';
    info.append(title);
    const m = item.metadata, parts = [];
    if (m?.moderation) parts.push(m.moderation === 'moderated' ? 'Modérée' : 'Brute');
    if (m?.mode) parts.push(m.mode === 'chronological' ? 'Temps écoulé' : 'Contributions');
    if (m?.duration) parts.push(m.duration + ' s');
    if (m?.fps) parts.push(m.fps + ' images/s');
    if (m?.scale) parts.push(m.scale + ' ×');
    if (typeof m?.includeVideos === 'boolean') parts.push(m.includeVideos ? 'Avec vidéos' : 'Sans vidéos');
    parts.push(number.format(Math.ceil(item.size / 1024)) + ' Kio');
    for (const text of [
      (item.dateKind === 'created' ? 'Créée le ' : 'Fichier modifié le ') + date.format(new Date(item.date)),
      parts.join(' · '),
      m?.captureCompletedAt && typeof m.sequence === 'number'
        ? 'Capture terminée le ' + date.format(new Date(m.captureCompletedAt)) + ' · jusqu’à la contribution n° ' + m.sequence
        : 'Date et contenu de la capture indisponibles pour cet ancien fichier.',
    ]) {
      const line = document.createElement('p'); line.textContent = text; info.append(line);
    }
    const link = document.createElement('a');
    link.href = '/api/admin/generated/' + encodeURIComponent(item.file);
    link.download = item.file; link.className = 'generated-download'; link.textContent = 'Télécharger';
    row.append(info, link);
    return row;
  }

  async function refresh() {
    const current = ++version;
    clearTimeout(timer);
    const [jobsResult, filesResult] = await Promise.all([
      request('/api/admin/export-jobs').then(r => r.json()), request('/api/admin/generated').then(r => r.json()),
    ]);
    if (current !== version) return;
    const jobs: Job[] = jobsResult.jobs, files: ExportItem[] = filesResult.items;
    busy = jobs.some(job => job.status === 'running');
    updateOptions();
    el('#generated-list').replaceChildren(...files.map(fileRow));
    progress.textContent = busy ? 'Génération en cours… Les fichiers s’actualisent automatiquement.' :
      jobs[0]?.status === 'failed' ? jobs[0].error || 'La génération a échoué.' :
      jobs[0]?.status === 'done' ? 'Génération terminée. Le fichier est disponible ci-dessous.' :
      files.length ? files.length + ' fichier(s) disponible(s).' : 'Aucun fichier généré.';
    if (busy) timer = setTimeout(() => void refresh().catch(error => tell(error.message, true)), 3000);
  }
  async function create(body: object) {
    if (busy) return;
    ++version;
    busy = true;
    updateOptions();
    try {
      await request('/api/admin/export-jobs', json(body));
      await refresh();
    } catch (error) {
      busy = false; updateOptions(); throw error;
    }
  }
  form('#create-archive', data => create({ kind: 'archive', moderation: data.get('moderation'), includeVideos: data.has('includeVideos') }));
  form('#create-video', data => create({
    kind: 'video', mode: data.get('mode'), moderation: data.get('moderation'), duration: Number(data.get('duration')),
    fps: Number(data.get('fps')), scale: Number(data.get('scale')),
  }));
  el('#refresh-exports').addEventListener('click', () => void refresh().catch(error => tell(error.message, true)));
  el('#archives').addEventListener('click', async () => {
    try {
      const { archives } = await request('/api/admin/archives').then(r => r.json());
      const list = el('#archive-list');
      list.replaceChildren();
      for (const item of archives) {
        const a = document.createElement('a'); a.href = '/api/admin/archives/' + encodeURIComponent(item.id);
        a.textContent = item.id; list.append(a);
      }
      if (!archives.length) list.textContent = 'Aucune ancienne archive.';
    } catch (error) { tell((error as Error).message, true); }
  });

  const moment = el<HTMLSelectElement>('[name=moment]');
  moment.addEventListener('change', () => {
    for (const name of ['seq', 'at']) {
      const input = el<HTMLInputElement>('#replay [name=' + name + ']');
      input.disabled = name !== moment.value; input.closest('label')!.hidden = input.disabled;
    }
  });
  let replayUrl: string | undefined;
  form('#replay', async data => {
    const query = new URLSearchParams({ moderation: String(data.get('mode')), scale: String(data.get('scale')) });
    if (data.has('seq')) query.set('seq', String(data.get('seq')));
    if (data.has('at')) query.set('at', new Date(String(data.get('at'))).toISOString());
    const image = el<HTMLImageElement>('#replay-image');
    image.hidden = true;
    const response = await request('/api/admin/image.png?' + query);
    if (replayUrl) URL.revokeObjectURL(replayUrl);
    replayUrl = URL.createObjectURL(await response.blob());
    image.src = replayUrl; image.hidden = false;
  });
  return refresh;
}
