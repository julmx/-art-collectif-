import { test, expect } from '@playwright/test';
test('un clic dessine une cellule et le déplacement ne dessine pas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status')).toContainText('dessin ouvert');
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
  await expect(page.getByRole('heading',{name:'Historique et modération'})).toBeVisible();
  await expect(page.locator('#palette-feedback')).toContainText('Palette valide');
  await expect(page.locator('#palette-preview span')).toHaveCount(24);
  await page.getByRole('button',{name:'Actualiser l’historique'}).click();
  await expect(page.locator('#events pre').first()).toBeVisible();
  await page.getByRole('button',{name:'Se déconnecter'}).click();
  await expect(page.getByRole('heading',{name:'Connexion'})).toBeVisible();
});
test('la sortie puis la rentrée du pointeur ne relient pas artificiellement le trait',async({page})=>{
 await page.goto('/');await expect(page.locator('.status')).toContainText('dessin ouvert');const canvas=page.locator('canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();if(!box)throw new Error('Canvas invisible');
 const middle=()=>canvas.evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(350,300,1,1).data]);const before=await middle();const lastRegion=()=>canvas.evaluate((c:HTMLCanvasElement)=>[...c.getContext('2d')!.getImageData(498,298,5,5).data]);const beforeLast=await lastRegion();
 const y=box.y+box.height*300/480;await page.mouse.move(box.x+box.width*200/720,y);await page.mouse.down();await page.mouse.move(box.x-4,y);await page.mouse.move(box.x+box.width*500/720,y);await page.mouse.up();expect(await middle()).toEqual(before);await expect.poll(lastRegion).not.toEqual(beforeLast);
});
test('masquer puis restaurer un trait conserve les écritures ultérieures',async({browser})=>{
 const ctxA=await browser.newContext(),ctxB=await browser.newContext(),ctxAdmin=await browser.newContext();
 try{
  const a=await ctxA.newPage(),b=await ctxB.newPage(),admin=await ctxAdmin.newPage();await Promise.all([a.goto('/'),b.goto('/'),admin.goto('/admin.html')]);await Promise.all([expect(a.locator('.status')).toContainText('dessin ouvert'),expect(b.locator('.status')).toContainText('dessin ouvert')]);
  await admin.getByLabel('Mot de passe').fill('test-password');await admin.getByRole('button',{name:'Se connecter'}).click();await expect(admin.getByRole('heading',{name:'Historique et modération'})).toBeVisible();
  const ca=a.locator('canvas');await ca.scrollIntoViewIfNeeded();const box=await ca.boundingBox();if(!box)throw new Error('Canvas invisible');const y=box.y+box.height*350.5/480;
  await a.mouse.move(box.x+box.width*200.5/720,y);await a.mouse.down();await a.mouse.move(box.x+box.width*300.5/720,y);await a.mouse.up();
  const counts=()=>b.locator('canvas').evaluate((canvas:HTMLCanvasElement)=>{const d=canvas.getContext('2d')!.getImageData(195,346,110,9).data;let red=0,orange=0;for(let i=0;i<d.length;i+=4){if(d[i]===230&&d[i+1]===57&&d[i+2]===70)red++;if(d[i]===240&&d[i+1]===100&&d[i+2]===73)orange++;}return {red,orange};});
  await expect.poll(async()=> (await counts()).red).toBeGreaterThan(30);
  const history=await admin.evaluate(async()=>await (await fetch('/api/admin/events?limit=100')).json());const first=history.events.find((event:{command_json:string})=>{const c=JSON.parse(event.command_json);return c.points.some((p:number[])=>p[0]>=198&&p[0]<=202&&p[1]>=348&&p[1]<=352);});expect(first).toBeTruthy();const stroke=JSON.parse(first.command_json).strokeId;
  await b.getByRole('button',{name:'Couleur 2',exact:true}).click();const cb=b.locator('canvas');await cb.scrollIntoViewIfNeeded();const target=await cb.boundingBox();if(!target)throw new Error('Canvas invisible');await b.mouse.click(target.x+target.width*250.5/720,target.y+target.height*350.5/480);await expect.poll(async()=> (await counts()).orange).toBeGreaterThan(0);
  await admin.locator('[name=participant]').fill(first.participant_id);await admin.locator('[name=stroke]').fill(stroke);await admin.locator('[name=reason]').fill('essai');await admin.getByRole('button',{name:'Appliquer la décision'}).click();await expect.poll(async()=> (await counts()).red).toBe(0);expect((await counts()).orange).toBeGreaterThan(0);
  await admin.locator('[name=action]').selectOption('restore');await admin.getByRole('button',{name:'Appliquer la décision'}).click();await expect.poll(async()=> (await counts()).red).toBeGreaterThan(30);expect((await counts()).orange).toBeGreaterThan(0);
 }finally{await ctxA.close();await ctxB.close();await ctxAdmin.close();}
});
