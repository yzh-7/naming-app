import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// 手机端：iPhone 12/13 的 390×844 与最窄的 320（旧 iPhone SE / 小屏安卓）都跑一遍
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 320, height: 640 }];

for (const vp of VIEWPORTS) {
  test.describe(`手机 ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test('四个页都不横向溢出', async ({ page }) => {
      for (const path of ['/', '/#/compose', '/#/fav', '/#/block']) {
        await page.goto(path);
        if (path === '/') await page.getByLabel('姓（可复姓）').fill('苏');
        await expect(page.locator('body')).toBeVisible();
        const w = await page.evaluate(() => Math.max(
          document.documentElement.scrollWidth, document.body.scrollWidth,
        ));
        expect(w, `${path} 出现横向滚动（${w}px > ${vp.width}px）`).toBeLessThanOrEqual(vp.width);
      }
    });

    test('输入框字号 ≥15px（否则手机端浏览器会自动放大页面）', async ({ page }) => {
      await page.goto('/');
      await page.getByLabel('姓（可复姓）').fill('苏');
      const sizes = await page.evaluate(() => Array.from(document.querySelectorAll('input, select, textarea'))
        .filter((el) => !(el instanceof HTMLInputElement && el.type === 'file'))
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          label: el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.closest('label')?.textContent || '',
          px: parseFloat(getComputedStyle(el).fontSize),
        })));
      // 至少要量到姓、搜索、篇名三个常驻输入框，并且姓那一个必须在里面；
      // 否则「一个都没量到」也能空过的断言就没意义了
      expect(sizes.length).toBeGreaterThanOrEqual(3);
      expect(sizes.find((s) => s.label.includes('姓')), '姓输入框没被量到（label 改名了？）').toBeTruthy();
      const tooSmall = sizes.filter((s) => s.px < 15);
      expect(tooSmall, JSON.stringify(tooSmall)).toEqual([]);
    });

    test('触控目标尺寸（axe 的 WCAG 2.2 target-size）无 serious/critical', async ({ page }) => {
      await page.goto('/');
      await page.getByLabel('姓（可复姓）').fill('苏');
      await expect(page.locator('article').first()).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag22aa']).analyze();
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad, bad.map((v) => `${v.id}: ${v.help}（${v.nodes.length} 处）`).join('\n')).toEqual([]);
    });

    test('深色模式下卡片可读：axe（含对比度）无 serious/critical', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('group', { name: '昼夜主题' }).getByRole('button', { name: '深色主题' }).click();
      await page.getByLabel('姓（可复姓）').fill('苏');
      await expect(page.locator('article').first()).toBeVisible();
      await expect(page.locator('html')).toHaveClass(/dark/);
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad, bad.map((v) => `${v.id}: ${v.help}（${v.nodes.length} 处）`).join('\n')).toEqual([]);
    });

    test('主题切换在手机上也能用（页头可见），字格可点', async ({ page }) => {
      await page.goto('/#/compose');
      const group = page.getByRole('group', { name: '昼夜主题' });
      await expect(group).toBeVisible();
      await group.getByRole('button', { name: '深色主题' }).click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await page.getByLabel('姓（可复姓）').fill('苏');
      await page.getByLabel('选择第 1 字').click();
      await expect(page.locator('[data-char-grid] button').first()).toBeVisible();
      const box = await page.locator('[data-char-grid] button').first().boundingBox();
      expect(box && box.width).toBeGreaterThanOrEqual(40);
      expect(box && box.height).toBeGreaterThanOrEqual(40);
    });
  });
}
