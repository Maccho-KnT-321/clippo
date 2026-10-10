import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 667 }, isMobile: true, hasTouch: true });
  await page.goto(process.env.CLIPPO_URL || 'http://127.0.0.1:4173');
  await page.locator('#welcomeDemo').tap();
  await page.locator('.track[data-kind=clips] .timeline-clip').nth(2).waitFor();
  for (let i = 0; i < 8; i++) await page.locator('#addTextBtn').tap();
  await page.locator('#undoBtn').tap();
  const timeline = page.locator('#timeline');
  const snapshot = () => page.evaluate(() => {
    const element = document.getElementById('timeline');
    const rect = element.getBoundingClientRect();
    return { x: element.scrollLeft, y: element.scrollTop, top: rect.top, pageY: window.scrollY };
  });
  const tapVisibleText = async (excludeId = null) => {
    const point = await page.evaluate(exclude => {
      const viewport = document.getElementById('timeline').getBoundingClientRect();
      for (const element of document.querySelectorAll('.text-clip')) {
        const rect = element.getBoundingClientRect();
        if (element.dataset.id === exclude || rect.top < viewport.top + 5 || rect.bottom > viewport.bottom - 5) continue;
        const left = Math.max(rect.left + 25, viewport.left + 90), right = Math.min(rect.right - 25, viewport.right - 15);
        if (left < right) return { x: (left + right) / 2, y: rect.top + rect.height / 2, id: element.dataset.id };
      }
      return null;
    }, excludeId);
    assert(point, 'a text clip is visible without scrolling it into view');
    await page.touchscreen.tap(point.x, point.y);
    return point.id;
  };
  await timeline.evaluate(element => { element.scrollLeft = 450; element.scrollTop = 140; });
  const before = await snapshot();
  assert(before.y >= 130, 'fixture has vertical timeline overflow');
  const firstId = await tapVisibleText();
  const after = await snapshot();
  assert.equal(after.y, before.y, 'first selection preserves vertical timeline position');
  assert.equal(after.x, before.x, 'visible selection preserves horizontal timeline position');
  assert.equal(after.top, before.top, 'opening inline controls does not move the timeline');
  assert.equal(after.pageY, before.pageY, 'selection does not move the page');
  assert.equal(await page.locator('.text-clip.selected').getAttribute('data-id'), firstId);

  const secondId = await tapVisibleText(firstId);
  const second = await snapshot();
  assert.deepEqual(second, after, 'switching between visible clips preserves the workspace');
  assert.equal(await page.locator('.text-clip.selected').getAttribute('data-id'), secondId);

  await page.locator('#deleteBtn').tap();
  const cleared = await snapshot();
  assert.equal(cleared.top, after.top, 'clearing selection does not expand the preview over the timeline');
  assert.equal(cleared.y, after.y, 'deleting one clip keeps the current vertical editing position');
  await page.locator('#undoBtn').tap();
  assert.equal((await snapshot()).y, after.y, 'undo preserves vertical timeline position');
  assert.equal(await page.locator('.text-clip').count(), 7, 'undo restores the deleted text');
  await page.screenshot({ path: 'test-results/selection-stability.png' });
  console.log('Selection stability: first selection, switching clips, deletion and undo preserve timeline position and mobile preview height.');
} finally {
  await browser.close();
}
