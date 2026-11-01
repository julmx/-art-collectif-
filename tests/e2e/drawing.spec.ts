import { test, expect } from '@playwright/test';
test('un clic dessine une cellule et le déplacement ne dessine pas', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('canvas'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas invisible');
  const pixel = () => canvas.evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(360,240,1,1).data]);
  const before = await pixel();
  await page.mouse.click(box.x + box.width * 360.5 / 720, box.y + box.height * 240.5 / 480);
  expect(await pixel()).not.toEqual(before);
  const painted = await pixel();
  await page.getByRole('button', { name: /Déplacer/ }).click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 10); await page.mouse.up();
  expect(await pixel()).toEqual(painted);
});
test('palette et zoom sont accessibles', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Couleur 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Couleur 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Augmenter le zoom' }).click();
  await expect(page.locator('#zoom-label')).toHaveText('125 %');
});
