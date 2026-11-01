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
