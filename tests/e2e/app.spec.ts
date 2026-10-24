import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('首页可加载，填姓后有候选卡片', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /取名 · 典籍取词/ })).toBeVisible();
  await page.getByLabel('姓（可复姓）').fill('苏');
  await expect(page.locator('article').first()).toBeVisible();
});

test('收藏一个名字后能在收藏页搜到', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  const card = page.locator('article').first();
  await card.getByRole('button', { name: '收藏' }).click();
  await expect(card.getByRole('button', { name: '已收藏' })).toBeVisible();
  await page.getByRole('link', { name: /收藏 1/ }).click();
  await expect(page.getByLabel('搜索收藏')).toBeVisible();
  await page.getByLabel('搜索收藏').fill('zzz-不存在');
  await expect(page.getByText(/没有符合搜索/)).toBeVisible();
});

test('页头昼夜三档：切深色后 html 出现 dark，切浅色后去掉，自选页也有', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: '昼夜主题' });
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: '深色主题' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await group.getByRole('button', { name: '浅色主题' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.goto('/#/compose');
  await expect(page.getByRole('group', { name: '昼夜主题' })).toBeVisible();
});

test('自选页：选字后给出出处与今译，无出处的组合明说没有', async ({ page }) => {
  await page.goto('/#/compose');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await page.getByLabel('选择第 1 字').click();
  await page.getByLabel('第 1 字搜索').fill('子');
  await page.locator('div.flex.max-h-56 button').first().click();
  await page.getByLabel('选择第 2 字').click();
  await page.getByLabel('第 2 字搜索').fill('归');
  await page.locator('div.flex.max-h-56 button').first().click();
  await expect(page.getByRole('heading', { name: '苏子归' })).toBeVisible();
  await expect(page.getByText(/江有汜，之子归/)).toBeVisible();
  await expect(page.getByText(/今译/)).toBeVisible();
  await expect(page.getByRole('button', { name: '收藏' })).toBeVisible();

  // 换一个典籍里没有的搭配
  await page.getByLabel('选择第 1 字').click();
  await page.getByLabel('第 1 字搜索').fill('龙凤');
  await page.getByRole('button', { name: '直接使用「龙凤」' }).click();
  await expect(page.getByText(/没有「龙凤」这个搭配的出处/)).toBeVisible();
  await expect(page.getByRole('button', { name: '收藏' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '分享卡' })).toBeVisible();
});

test('axe：自选页无 serious/critical 级可访问性问题', async ({ page }) => {
  await page.goto('/#/compose');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await page.getByLabel('选择第 1 字').click();
  await page.getByLabel('第 1 字搜索').fill('子');
  await page.locator('div.flex.max-h-56 button').first().click();
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
});

test('axe：生成页无 serious/critical 级可访问性问题', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('姓（可复姓）').fill('苏');
  await expect(page.locator('article').first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
});
