import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('首页可加载，填姓后有候选卡片', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /取名 · 典籍取词/ })).toBeVisible();
  await page.getByLabel('姓氏').fill('苏');
  await expect(page.locator('article').first()).toBeVisible();
});

test('收藏一个名字后能在收藏页搜到', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓氏').fill('苏');
  const card = page.locator('article').first();
  await card.getByRole('button', { name: '收藏' }).click();
  await expect(card.getByRole('button', { name: '已收藏' })).toBeVisible();
  await page.getByRole('tab', { name: /收藏 1/ }).click();
  await expect(page.getByLabel('搜索收藏')).toBeVisible();
  await page.getByLabel('搜索收藏').fill('zzz-不存在');
  await expect(page.getByText(/没有符合搜索/)).toBeVisible();
});

test('主题按钮循环到深色时 html 上出现 dark', async ({ page }) => {
  await page.goto('/');
  const btn = page.getByRole('button', { name: /主题/ });
  await btn.click();
  await btn.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('axe：生成页无 serious/critical 级可访问性问题', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓氏').fill('苏');
  await expect(page.locator('article').first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
});
