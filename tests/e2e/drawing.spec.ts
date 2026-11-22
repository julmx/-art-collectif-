import sharp from 'sharp';
import { test, expect } from '@playwright/test';
test('la toile utilise la place disponible sur ordinateur et tient sur mobile',async({page})=>{
  await page.setViewportSize({width:1600,height:1000});await page.goto('/');
  const canvas=page.locator('canvas');const desktop=await canvas.boundingBox();expect(desktop).not.toBeNull();expect(desktop!.width).toBeGreaterThan(1000);
  await page.setViewportSize({width:375,height:812});const mobile=await canvas.boundingBox(),viewport=await page.locator('#viewport').boundingBox();expect(mobile).not.toBeNull();expect(viewport).not.toBeNull();expect(mobile!.width).toBeLessThanOrEqual(viewport!.width);expect(mobile!.width).toBeGreaterThan(250);const zoom=await page.locator('#zoom-in').boundingBox(), tools=await page.locator('aside').boundingBox();expect(zoom).not.toBeNull();expect(tools).not.toBeNull();expect(zoom!.y).toBeLessThan(tools!.y);expect(zoom!.y).toBeLessThan(812);
});
test('un clic dessine une cellule et le déplacement ne dessine pas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status')).toContainText('dessin ouvert');
  await page.getByRole('group', { name: 'Épaisseur du pinceau' }).getByRole('button', { name: '1', exact: true }).click();
  const canvas = page.locator('canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas invisible');
  await canvas.evaluate((c: HTMLCanvasElement) => { (window as unknown as {before:Uint8ClampedArray}).before = c.getContext('2d')!.getImageData(0,0,c.width,c.height).data; });
  const differences = () => canvas.evaluate((c: HTMLCanvasElement) => { const before=(window as unknown as {before:Uint8ClampedArray}).before, after=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data; let count=0; for(let i=0;i<after.length;i+=4) if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2]) count++; return count; });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(differences).toBe(1);
  await page.getByRole('button', { name: /Déplacer/ }).click();
  await canvas.scrollIntoViewIfNeeded(); const movedBox=await canvas.boundingBox(); if (!movedBox) throw new Error('Canvas invisible');
  await page.mouse.move(movedBox.x + movedBox.width / 2, movedBox.y + movedBox.height / 2);
  await page.mouse.down(); await page.mouse.move(movedBox.x + movedBox.width / 2 + 25, movedBox.y + movedBox.height / 2 + 10); await page.mouse.up();
  expect(await differences()).toBe(1);
});
test('regroupe les peintures d’une rafale et affiche la même toile que le serveur',async({page})=>{
  const origin='http://127.0.0.1:4173';
  const {io}=await import('socket.io-client');
  const session=await fetch(origin+'/api/session',{method:'POST',headers:{origin}});
  const sender=io('http://127.0.0.1:3000',{extraHeaders:{origin,cookie:session.headers.get('set-cookie')!},transports:['websocket'],autoConnect:false});
  try {
    const ready=new Promise<void>(resolve=>sender.once('canvas:state',()=>resolve()));
    sender.connect();
    await ready;
    await page.goto('/');
    await expect(page.locator('.status')).toContainText('dessin ouvert');
    const canvas=page.locator('#canvas');
    await expect.poll(()=>canvas.evaluate((c:HTMLCanvasElement)=>c.getContext('2d')!.getImageData(0,0,1,1).data[0])).toBe(128);
    const paints=await canvas.evaluateHandle((c:HTMLCanvasElement)=>{
      const frames:number[]=[];
      let frame=0;
      function tick(){frame++;requestAnimationFrame(tick);}
      requestAnimationFrame(tick);
      const ctx=c.getContext('2d')!, original=ctx.putImageData.bind(ctx);
      ctx.putImageData=new Proxy(original,{apply(target,receiver,args){frames.push(frame);return Reflect.apply(target,receiver,args);}});
      return frames;
    });
    const results=await Promise.all(Array.from({length:30},(_,i)=>sender.timeout(5000).emitWithAck('draw:submit',{
      opId:crypto.randomUUID(),strokeId:crypto.randomUUID(),partIndex:0,final:true,tool:'pixel',size:1,colorId:i===29?2:1,points:[[300+i,60]],
    })));
    expect(results.every(r=>r.accepted)).toBe(true);
    await expect.poll(()=>canvas.evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(329,60,1,1).data])).toEqual([240,100,73,255]);
    const frames=await paints.jsonValue();
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.length).toBeLessThan(30);
    expect(new Set(frames).size).toBe(frames.length);
    expect((await page.request.post('/api/admin/login',{headers:{origin},data:{password:'test-password'}})).status()).toBe(200);
    const matches=await canvas.evaluate(async(c:HTMLCanvasElement)=>{
      const response=await fetch('/api/admin/export/final.png');
      const image=await createImageBitmap(await response.blob());
      const ctx=new OffscreenCanvas(c.width,c.height).getContext('2d')!;
      ctx.drawImage(image,0,0);
      const expected=ctx.getImageData(0,0,c.width,c.height).data;
      return c.getContext('2d')!.getImageData(0,0,c.width,c.height).data.every((v,i)=>v===expected[i]);
    });
    expect(matches).toBe(true);
  } finally {sender.disconnect();}
});
test('palette et zoom sont accessibles', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Couleur 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Couleur 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Augmenter le zoom' }).click();
  await expect(page.locator('#zoom-label')).toHaveText('125 %');
});
test('deux navigateurs convergent et retrouvent le dessin après rechargement', async ({ browser }) => {
  const first=await browser.newContext(), second=await browser.newContext();
  try {
    const a=await first.newPage(), b=await second.newPage();
    await Promise.all([a.goto('/'),b.goto('/')]);
    await Promise.all([expect(a.locator('.status')).toContainText('dessin ouvert'),expect(b.locator('.status')).toContainText('dessin ouvert')]);
    const canvasA=a.locator('canvas'); await canvasA.scrollIntoViewIfNeeded(); const box=await canvasA.boundingBox(); if(!box) throw new Error('Canvas invisible');
    const pixel=()=>b.locator('canvas').evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(120,120,1,1).data]);
    await a.getByRole('button',{name:'Couleur 2',exact:true}).click();
    await canvasA.scrollIntoViewIfNeeded(); const target=await canvasA.boundingBox(); if(!target) throw new Error('Canvas invisible');
    await a.mouse.click(target.x+target.width*120.5/720,target.y+target.height*120.5/480);
    await expect.poll(pixel).toEqual([240,100,73,255]);
    await b.reload(); await expect(b.locator('.status')).toContainText('dessin ouvert');
    await expect.poll(pixel).toEqual([240,100,73,255]);
  } finally { await first.close(); await second.close(); }
});
test('interface privée : connexion et consultation de l’historique',async({page})=>{
  await page.goto('/admin.html');
  await expect(page.getByRole('heading',{name:'Connexion'})).toBeVisible();
  await page.getByLabel('Mot de passe').fill('test-password');
  await page.getByRole('button',{name:'Se connecter'}).click();
  await expect(page.getByRole('heading',{name:'Vue d’ensemble'})).toBeVisible();
  await expect(page.locator('#project-status')).toHaveText('Ouvert');
  await expect(page.locator('[data-status=open]')).toBeHidden();
  await expect(page.locator('[data-status=paused]')).toBeEnabled();
  await page.getByRole('link',{name:'Configuration',exact:true}).click();
  await expect(page.locator('[name=palette]')).toHaveAttribute('readonly','');
  await expect(page.locator('#base input')).toBeDisabled();
  await expect(page.locator('#palette-feedback')).toContainText('Palette valide');
  await expect(page.locator('#palette-preview span')).toHaveCount(24);
  await page.getByRole('link',{name:'Modération',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Historique et modération'})).toBeVisible();
  await expect(page.getByLabel('Identifiant participant')).toHaveCount(0);
  await expect(page.getByLabel('Identifiant du trait')).toHaveCount(0);
  await page.getByText('Historique technique').click();
  await expect(page.locator('#events pre').first()).toBeVisible();
  await page.getByRole('button',{name:'Se déconnecter'}).click();
  await expect(page.getByRole('heading',{name:'Connexion'})).toBeVisible();
});
test('administration : création et téléchargement d’une archive',async({page})=>{
 await page.goto('/admin.html');await page.getByLabel('Mot de passe').fill('test-password');await page.getByRole('button',{name:'Se connecter'}).click();
 await page.getByRole('link',{name:'Exports',exact:true}).click();
 await page.getByLabel('Durée (s)').fill('600');
 await expect(page.getByRole('button',{name:'Créer la vidéo'})).toBeDisabled();
 await expect(page.locator('#frames')).toContainText('dépasse');
 await page.getByLabel('Durée (s)').fill('30');
 await expect(page.getByRole('button',{name:'Créer la vidéo'})).toBeEnabled();
 await page.getByRole('button',{name:'Créer l’archive'}).click();await expect(page.locator('#export-progress')).toContainText('terminée',{timeout:30000});
 await expect(page.locator('#generated-list article').first()).toContainText('Archive ZIP');await expect(page.locator('#generated-list article').first()).toContainText('Capture terminée le');await expect(page.locator('#generated-list article').first()).toContainText('contribution n°');
 const download=page.waitForEvent('download');await page.locator('#generated-list a').first().click();expect((await download).suggestedFilename()).toMatch(/^archive-.*\.zip$/);
});
test('la sortie puis la rentrée du pointeur ne relient pas artificiellement le trait',async({page})=>{
 await page.goto('/');await expect(page.locator('.status')).toContainText('dessin ouvert');const canvas=page.locator('canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();if(!box)throw new Error('Canvas invisible');
 const middle=()=>canvas.evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(350,300,1,1).data]);const before=await middle();const lastRegion=()=>canvas.evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(498,298,5,5).data]);const beforeLast=await lastRegion();
 const y=box.y+box.height*300/480;await page.mouse.move(box.x+box.width*200/720,y);await page.mouse.down();await page.mouse.move(box.x-4,y);await page.mouse.move(box.x+box.width*500/720,y);await page.mouse.up();expect(await middle()).toEqual(before);await expect.poll(lastRegion).not.toEqual(beforeLast);
});
test('masquer puis restaurer un trait conserve les écritures ultérieures',async({browser})=>{
 const ctxA=await browser.newContext(),ctxB=await browser.newContext(),ctxAdmin=await browser.newContext();
 try{
  const a=await ctxA.newPage(),b=await ctxB.newPage(),admin=await ctxAdmin.newPage();await Promise.all([a.goto('/'),b.goto('/'),admin.goto('/admin.html#moderation')]);await Promise.all([expect(a.locator('.status')).toContainText('dessin ouvert'),expect(b.locator('.status')).toContainText('dessin ouvert')]);
  await admin.getByLabel('Mot de passe').fill('test-password');await admin.getByRole('button',{name:'Se connecter'}).click();await expect(admin.getByRole('heading',{name:'Historique et modération'})).toBeVisible();
  const ca=a.locator('canvas');await ca.scrollIntoViewIfNeeded();const box=await ca.boundingBox();if(!box)throw new Error('Canvas invisible');const y=box.y+box.height*350.5/480;
  await a.mouse.move(box.x+box.width*200.5/720,y);await a.mouse.down();await a.mouse.move(box.x+box.width*300.5/720,y);await a.mouse.up();
  const counts=()=>b.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>{const d=canvas.getContext('2d')!.getImageData(195,346,110,9).data;let red=0,orange=0;for(let i=0;i<d.length;i+=4){if(d[i]===230&&d[i+1]===57&&d[i+2]===70)red++;if(d[i]===240&&d[i+1]===100&&d[i+2]===73)orange++;}return {red,orange};});
  await expect.poll(async()=> (await counts()).red).toBeGreaterThan(30);
  const history=await admin.evaluate(async()=>await (await fetch('/api/admin/events?limit=100')).json());const first=history.events.find((event:{command_json:string})=>{const c=JSON.parse(event.command_json);return c.points.some((p:number[])=>p[0]>=198&&p[0]<=202&&p[1]>=348&&p[1]<=352);});expect(first).toBeTruthy();const stroke=JSON.parse(first.command_json).strokeId;
  await b.getByRole('button',{name:'Couleur 2',exact:true}).click();const cb=b.locator('canvas');await cb.scrollIntoViewIfNeeded();const target=await cb.boundingBox();if(!target)throw new Error('Canvas invisible');await b.mouse.click(target.x+target.width*250.5/720,target.y+target.height*350.5/480);await expect.poll(async()=> (await counts()).orange).toBeGreaterThan(0);
  const moderate=async(action:'hide'|'restore')=>admin.evaluate(async({participantId,strokeId,action})=>(await fetch('/api/admin/moderation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({participantId,strokeId,action,reason:'essai'})})).status,{participantId:first.participant_id,strokeId:stroke,action});
  expect(await moderate('hide')).toBe(200);await expect.poll(async()=> (await counts()).red).toBe(0);expect((await counts()).orange).toBeGreaterThan(0);
  expect(await moderate('restore')).toBe(200);await expect.poll(async()=> (await counts()).red).toBeGreaterThan(30);expect((await counts()).orange).toBeGreaterThan(0);
 }finally{await ctxA.close();await ctxB.close();await ctxAdmin.close();}
});
test('modération visuelle : sélection, aperçu, restauration et bannissement',async({browser})=>{
 test.setTimeout(60000);const participant=await browser.newContext(),administrator=await browser.newContext();
 try{const p=await participant.newPage(),a=await administrator.newPage();await p.goto('/');await expect(p.locator('.status')).toContainText('dessin ouvert');const canvas=p.locator('canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();if(!box)throw new Error('Toile absente');const pixel=()=>canvas.evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(500,400,1,1).data]);await expect.poll(pixel).toEqual([128,128,128,255]);const initial=await pixel();await canvas.click({position:{x:box.width*500.5/720,y:box.height*400.5/480}});await expect.poll(pixel).toEqual([230,57,70,255]);
 await a.goto('/admin.html#moderation');await a.getByLabel('Mot de passe').fill('test-password');await a.getByRole('button',{name:'Se connecter'}).click();const img=a.locator('#mod-image');await expect(img).toBeVisible();await expect.poll(()=>img.evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0)).toBe(true);await img.scrollIntoViewIfNeeded();const rect=await img.boundingBox();if(!rect)throw new Error('Image absente');await img.click({position:{x:rect.width*500.5/720,y:rect.height*400.5/480}});await expect(a.locator('#mod-results .mod-row')).toHaveCount(1,{timeout:10000});await expect(a.locator('#mod-results input[type=checkbox]').first()).toBeChecked();await expect(a.locator('#mod-selected-list')).toContainText('Trait #');await expect(a.locator('#mod-reason')).toHaveCount(0);await a.getByRole('button',{name:'Aperçu du masquage'}).click();await expect(a.locator('#mod-preview')).toBeVisible();a.once('dialog',d=>d.accept());await a.getByRole('button',{name:'Confirmer la décision'}).click();await expect(a.locator('#mod-status')).toContainText('Décision appliquée');await expect.poll(pixel).toEqual(initial);
 const answers=['BANNIR'];const answerDialog=(d:import('@playwright/test').Dialog)=>{void d.accept(d.type()==='prompt'?answers.shift():undefined);};a.on('dialog',answerDialog);await a.getByRole('button',{name:'Bannir le participant du trait surligné'}).click();await expect(p.locator('.status')).toContainText('Participation suspendue');await p.reload();await expect(p.locator('.status')).toContainText('Participation suspendue');await a.getByRole('button',{name:'Lever le bannissement'}).click();a.off('dialog',answerDialog);await expect(p.locator('.status')).toContainText('dessin ouvert');
 await a.getByRole('button',{name:'Voir les traits masqués'}).click();await expect(a.locator('#mod-results .mod-row')).toHaveCount(1,{timeout:20000});await a.locator('#mod-results input[type=checkbox]').first().check();await a.getByRole('button',{name:'Aperçu de la restauration'}).click();await expect(a.locator('#mod-preview')).toBeVisible();a.once('dialog',d=>d.accept());await a.getByRole('button',{name:'Confirmer la décision'}).click();await expect.poll(pixel).not.toEqual(initial);
 }finally{await participant.close();await administrator.close();}
});
test('annule le geste interrompu après reconnexion et conserve le trait précédent au rejeu', async ({page, context}) => {
  let cutConnection: (() => void) | undefined;
  await context.routeWebSocket('**/socket.io/**', route => {
    const server = route.connectToServer();
    cutConnection = () => {
      server.close({code:1001});
      route.close({code:1001});
    };
  });
  await page.goto('/');
  await expect(page.locator('.status')).toContainText('dessin ouvert');
  const canvas=page.locator('#canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();
  if (!box) throw new Error('Toile absente');
  const x=(cell:number)=>box.x+(cell+0.5)*box.width/720, y=box.y+80.5*box.height/480;
  const undo=page.getByRole('button',{name:/Annuler/});
  await page.mouse.click(x(600),y);
  await expect(undo).toBeEnabled();
  await page.mouse.move(x(640),y);
  await page.mouse.down();

  // A second session observes the broadcast of the unfinished part.
  const disconnectDrawingPage=cutConnection;
  if (!disconnectDrawingPage) throw new Error('WebSocket de dessin absent');
  const observer=await context.newPage();
  await observer.goto('/');
  await expect(observer.locator('.status')).toContainText('dessin ouvert');
  const pixel=(cell:number)=>observer.locator('#canvas').evaluate((c:HTMLCanvasElement,x)=>[...c.getContext('2d')!.getImageData(x,80,1,1).data],cell);
  await expect.poll(()=>pixel(640)).toEqual([230,57,70,255]);
  await expect(undo).toBeEnabled();
  disconnectDrawingPage();
  await expect(page.locator('.status')).toContainText('Déconnecté');
  await page.mouse.up();
  await expect(page.locator('.status')).toContainText('dessin ouvert');
  await undo.click();
  await expect.poll(()=>pixel(640)).toEqual([128,128,128,255]);
  expect(await pixel(600)).toEqual([230,57,70,255]);

  const origin='http://127.0.0.1:4173';
  expect((await page.request.post('/api/admin/login',{headers:{origin},data:{password:'test-password'}})).status()).toBe(200);
  const exported=await page.request.get('/api/admin/export/final.png');
  expect(exported.status()).toBe(200);
  const {data,info}=await sharp(await exported.body()).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const replayPixel=(x:number)=>[...data.subarray((80*info.width+x)*3,(80*info.width+x)*3+3)];
  expect(replayPixel(600)).toEqual([230,57,70]);
  expect(replayPixel(640)).toEqual([128,128,128]);
});
test('la clôture exige une saisie explicite et un second clic',async({page})=>{
 await page.goto('/admin.html');await page.getByLabel('Mot de passe').fill('test-password');await page.getByRole('button',{name:'Se connecter'}).click();
 await page.getByRole('button',{name:'Clôturer',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Clôturer définitivement le projet ?'});await expect(dialog).toBeVisible();const confirm=dialog.getByRole('button',{name:'Clôturer définitivement'});await expect(confirm).toBeDisabled();
 await dialog.getByLabel('Pour confirmer, saisissez CLOTURER').fill('CLOTURER');await expect(confirm).toBeEnabled();await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Annuler'}).click();await expect(dialog).not.toBeVisible();
 expect((await page.request.get('/api/project')).status()).toBe(200);expect((await (await page.request.get('/api/project')).json()).status).toBe('open');
 await page.getByRole('button',{name:'Clôturer',exact:true}).click();await expect(confirm).toBeDisabled();await dialog.getByLabel('Pour confirmer, saisissez CLOTURER').fill('CLOTURER');await confirm.click();await expect(dialog).not.toBeVisible();await expect(page.locator('#message')).toContainText('définitivement clôturé');expect((await (await page.request.get('/api/project')).json()).status).toBe('closed');
});
