import { validPalette } from '../../shared/palette';
import { initModeration } from './moderation';
import { initExports } from './admin-exports';
import './admin.css';

const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const controls = el('#controls');
const message = el('#message');
const palette = el<HTMLTextAreaElement>('[name=palette]');
const login = el<HTMLFormElement>('#login');
const closeDialog = el<HTMLDialogElement>('#close-dialog');
const closeInput = el<HTMLInputElement>('#close-confirmation');
const confirmClose = el<HTMLButtonElement>('#confirm-close');
const cancelClose = el<HTMLButtonElement>('#cancel-close');

type Status = 'draft' | 'open' | 'paused' | 'closed';
interface Project {
  title: string; description: string; participationTerms: string; palette: string[];
  status: Status; hasBaseImage: boolean; startedAt: string | null; closedAt: string | null;
}
let project: Project | undefined;
let feedbackTimer: ReturnType<typeof setTimeout>;
function tell(text: string, error = false) {
  clearTimeout(feedbackTimer);
  message.textContent = text;
  message.dataset.error = String(error);
  if (!error) feedbackTimer = setTimeout(() => { message.textContent = ''; }, 5000);
}
const errors: Record<string, string> = {
  INVALID_CREDENTIALS: 'Mot de passe incorrect.',
  UNAUTHENTICATED: 'Votre session a expiré. Reconnectez-vous.',
  INVALID_PNG: 'Le fichier doit être une image PNG valide.',
  PNG_DIMENSIONS: 'Le fond doit mesurer exactement 720 × 480 pixels.',
  PNG_TRANSPARENT: 'Le fond doit être entièrement opaque.',
  PNG_NOT_GRAYSCALE: 'Le fond doit être en niveaux de gris.',
  MODERATION_STATE_CHANGED: 'La toile a changé. Actualisez l’aperçu puis réessayez.',
  MODERATION_BUSY: 'Une décision de modération est déjà en cours.',
  INVALID_TRANSITION: 'L’état du projet a changé. Rechargez la page.',
  PROJECT_LOCKED: 'Le fond et la palette sont figés après l’ouverture.',
  PROJECT_NOT_CONFIGURED: 'Importez le fond et enregistrez la palette et les conditions avant l’ouverture.',
  INVALID_CONFIG: 'Vérifiez le titre, les conditions et la palette.',
  RATE_LIMITED: 'Trop de tentatives. Réessayez dans quinze minutes.',
  EXPORT_JOB_BUSY: 'Une génération est déjà en cours.',
  EXPORT_BUSY: 'Le serveur prépare déjà des exports. Réessayez dans un instant.',
  BASE_IMAGE_MISSING: 'Importez le fond dans Configuration pour afficher la toile.',
  PROJECT_NOT_STARTED: 'Ouvrez le projet avant de créer une vidéo chronologique.',
  INVALID_EXPORT: 'Vérifiez les paramètres vidéo (9 000 images maximum).',
  INVALID_QUERY: 'Vérifiez la séquence ou la date demandée.',
};
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'same-origin' });
  if (response.ok) return response;
  const { error } = await response.json().catch(() => ({}));
  if (error === 'UNAUTHENTICATED' && project) location.reload();
  if (response.status === 413) throw new Error(path.endsWith('base-image') ? 'Le fond dépasse 5 Mio.' : 'La configuration est trop volumineuse.');
  throw new Error(errors[error] || (response.status >= 500 ? 'Le serveur a rencontré une erreur. Réessayez.' : 'Cette opération a échoué.'));
}
function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
function form(selector: string, handler: (data: FormData) => Promise<void>) {
  const target = el<HTMLFormElement>(selector);
  target.addEventListener('submit', async event => {
    event.preventDefault();
    if (target.getAttribute('aria-busy') === 'true') return;
    target.setAttribute('aria-busy', 'true');
    try { await handler(new FormData(target)); }
    catch (error) { tell(error instanceof Error ? error.message : 'Opération impossible.', true); }
    finally { target.removeAttribute('aria-busy'); }
  });
}
const refreshModeration = initModeration(request);
const refreshExports = initExports(request, form, json, tell);
let moderationLoaded = false;
const views = [...document.querySelectorAll<HTMLElement>('.view')];
function navigate(focus: boolean) {
  if (!project) return;
  const view = views.find(item => '#' + item.id === location.hash) ?? views[0];
  for (const item of views) item.hidden = item !== view;
  for (const link of document.querySelectorAll<HTMLAnchorElement>('nav a')) {
    if (link.hash === '#' + view.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const title = view.querySelector('h1')!;
  document.title = title.textContent + ' — Administration · Art Collectif';
  if (focus) {
    title.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  if (view.id === 'moderation' && !moderationLoaded) {
    moderationLoaded = true;
    refreshModeration();
  }
  if (view.id === 'exports') void refreshExports().catch(error => tell(error.message, true));
}
window.addEventListener('hashchange', () => navigate(true));
el('.skip').addEventListener('click', event => {
  event.preventDefault();
  const target = project ? el<HTMLElement>('.view:not([hidden]) h1') : login.querySelector('input')!;
  target.focus();
});

function updateStatus() {
  if (!project) return;
  const { status, hasBaseImage, participationTerms, startedAt, closedAt } = project;
  const draft = status === 'draft';
  const ready = hasBaseImage && !!participationTerms.trim() && validPalette(project.palette);
  const labels = { draft: 'Brouillon', open: 'Ouvert', paused: 'Suspendu', closed: 'Clôturé' };
  const help = {
    draft: ready ? 'Le projet est prêt à ouvrir. L’ouverture figera le fond et la palette.' : 'Préparez les éléments ci-dessous avant d’accueillir les participants.',
    open: 'Les participants peuvent dessiner. Vous pouvez suspendre temporairement les contributions.',
    paused: 'Les contributions sont suspendues. Reprenez la participation quand vous le souhaitez.',
    closed: 'La participation est définitivement clôturée. L’œuvre et ses exports restent accessibles.',
  };
  el('#project-name').textContent = project.title;
  el('#project-status').textContent = labels[status];
  el('#project-status').dataset.state = status;
  el('#status-help').textContent = help[status];
  el('#project-date-label').textContent = closedAt ? 'Clôture' : 'Ouverture';
  const date = closedAt || startedAt;
  el('#project-date').textContent = date ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(date)) : 'À venir';
  const setup = el('#setup-list');
  setup.replaceChildren();
  for (const item of [!hasBaseImage && 'Importer le fond PNG', !participationTerms.trim() && 'Renseigner les conditions de participation', !validPalette(project.palette) && 'Valider les 24 couleurs']) {
    if (item) { const li = document.createElement('li'); li.textContent = item; setup.append(li); }
  }
  el('#setup').hidden = !draft || ready;
  el('#base-help').textContent = (hasBaseImage ? 'Fond importé. ' : '') + (draft ? 'PNG opaque de 720 × 480 pixels en niveaux de gris, 5 Mio maximum.' : 'Le fond et la palette sont verrouillés depuis l’ouverture du projet.');
  el<HTMLButtonElement>('#base button').disabled = !draft;
  el<HTMLInputElement>('#base input').disabled = !draft;
  palette.readOnly = !draft;
  const open = el<HTMLButtonElement>('[data-status=open]');
  open.textContent = draft ? 'Ouvrir le projet' : 'Reprendre la participation';
  open.hidden = !draft && status !== 'paused';
  open.disabled = open.hidden || !ready;
  el('[data-status=paused]').hidden = status !== 'open';
  el('[data-status=closed]').hidden = status !== 'open' && status !== 'paused';
}
const colors = () => palette.value.split(/[\s,;]+/).filter(Boolean);
function updatePalette() {
  const values = colors(), valid = validPalette(values);
  const preview = el('#palette-preview');
  preview.replaceChildren();
  for (const color of values.filter(value => /^#[0-9a-f]{6}$/i.test(value)).slice(0,24)) {
    const swatch = document.createElement('span');
    swatch.style.background = color; swatch.title = color; preview.append(swatch);
  }
  const hint = valid ? 'Palette valide · 24 couleurs distinctes.' : 'Saisissez 24 couleurs distinctes et suffisamment chromatiques, au format #RRGGBB, séparées par des espaces ou des virgules.';
  palette.setCustomValidity(valid ? '' : hint);
  el('#palette-feedback').textContent = hint;
}
palette.addEventListener('input', updatePalette);

async function loadProject() {
  const data: Project = await request('/api/admin/config').then(r => r.json());
  project = data;
  el<HTMLInputElement>('[name=title]').value = data.title;
  el<HTMLTextAreaElement>('[name=description]').value = data.description;
  el<HTMLTextAreaElement>('[name=terms]').value = data.participationTerms;
  palette.value = data.palette.join(', ');
  updatePalette();
  updateStatus();
  el('#loading').hidden = true;
  el('#login-view').hidden = true;
  controls.hidden = false;
  navigate(true);
}
form('#login', async data => {
  await request('/api/admin/login', json({ password: data.get('password') }));
  login.reset();
  await loadProject();
  tell('Connexion établie.');
});
el('#logout').addEventListener('click', async () => {
  try { await request('/api/admin/logout', json({})); location.reload(); }
  catch (error) { tell((error as Error).message, true); }
});
form('#base', async data => {
  const file = data.get('image');
  if (!(file instanceof File) || !project) return;
  await request('/api/admin/base-image', { method: 'POST', headers: { 'content-type': 'image/png' }, body: file });
  project.hasBaseImage = true;
  moderationLoaded = false;
  updateStatus();
  tell('Fond importé et vérifié.');
});
form('#config', async data => {
  if (!project) return;
  const body = { title: String(data.get('title')), description: String(data.get('description')), participationTerms: String(data.get('terms')), palette: colors() };
  await request('/api/admin/config', { ...json(body), method: 'PUT' });
  Object.assign(project, body);
  moderationLoaded = false;
  updateStatus();
  tell('Configuration enregistrée.');
});

async function changeStatus(status: Status, confirmation?: string) {
  await request('/api/admin/status', json({ status, confirmation }));
  const data: Project = await request('/api/admin/config').then(r => r.json());
  project = data;
  if (data.status !== 'draft') { palette.value = data.palette.join(', '); updatePalette(); }
  updateStatus();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-status]')) {
  button.addEventListener('click', async () => {
    const status = button.dataset.status as Status;
    if (status === 'closed') { closeDialog.showModal(); cancelClose.focus(); return; }
    button.disabled = true;
    try { await changeStatus(status); tell('État du projet mis à jour.'); }
    catch (error) { tell((error as Error).message, true); }
    finally { button.disabled = false; updateStatus(); }
  });
}
closeInput.addEventListener('input', () => { confirmClose.disabled = closeInput.value !== 'CLOTURER'; });
cancelClose.addEventListener('click', () => closeDialog.close());
closeDialog.addEventListener('cancel', event => { if (closeInput.disabled) event.preventDefault(); });
closeDialog.addEventListener('close', () => {
  closeInput.value = ''; confirmClose.disabled = true; el('#close-error').textContent = '';
});
confirmClose.addEventListener('click', async () => {
  if (closeInput.value !== 'CLOTURER' || closeInput.disabled) return;
  confirmClose.disabled = cancelClose.disabled = closeInput.disabled = true;
  try { await changeStatus('closed', closeInput.value); closeDialog.close(); tell('Le projet est définitivement clôturé.'); }
  catch (error) { el('#close-error').textContent = (error as Error).message; confirmClose.disabled = false; }
  finally { cancelClose.disabled = closeInput.disabled = false; }
});

const history = el<HTMLButtonElement>('#history'), more = el<HTMLButtonElement>('#history-next');
let after = 0, historyLoaded = false;
async function loadHistory(reset: boolean) {
  if (history.disabled) return;
  history.disabled = more.disabled = true;
  try {
    const { events } = await request('/api/admin/events?limit=100&after=' + (reset ? 0 : after)).then(r => r.json());
    const list = el('#events');
    if (reset) { list.replaceChildren(); after = 0; }
    for (const event of events) {
      const row = document.createElement('pre');
      row.textContent = '#' + event.seq + ' · ' + new Date(event.created_at).toLocaleString('fr-FR') + '\nParticipant : ' + event.participant_id + '\n' + event.command_json;
      list.append(row); after = event.seq;
    }
    historyLoaded = true;
    more.hidden = events.length < 100;
    el('#history-info').textContent = list.childElementCount ? list.childElementCount + ' contribution(s) affichée(s).' : 'Aucune contribution enregistrée.';
  } catch (error) { tell((error as Error).message, true); }
  finally { history.disabled = more.disabled = false; }
}
el<HTMLDetailsElement>('#technical').addEventListener('toggle', () => {
  if (el<HTMLDetailsElement>('#technical').open && !historyLoaded) void loadHistory(true);
});
history.addEventListener('click', () => void loadHistory(true));
more.addEventListener('click', () => void loadHistory(false));

void loadProject().catch(error => {
  el('#loading').hidden = true;
  el('#login-view').hidden = false;
  if (error.message !== errors.UNAUTHENTICATED) tell(error.message, true);
});
