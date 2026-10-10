import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { planStoryEdit, storyRecipes } from '../story-planner.js';
import { textLooks, soundMixes } from '../finishing.js';
import { projectDuration } from '../timeline.js';

const url = process.env.CLIPPO_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function savedProject(page) {
  await page.waitForFunction(() => document.getElementById('saveProjectBtn').dataset.recovery === 'saved');
  return page.evaluate(async () => { const { loadRecovery } = await import('./project-store.js'); return (await loadRecovery()).project; });
}
const round = value => Math.round(value * 1e8) / 1e8;
const planFields = clips => clips.map(({ assetId, in: start, out, transition }) => ({ assetId, in: round(start), out: round(out), transition }));

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 744 }, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.locator('#welcomeDemo').tap(); await page.locator('.timeline-clip').nth(2).waitFor();
  const baseline = await savedProject(page);
  assert.equal(baseline.clips.length, 3); assert.equal(baseline.music.length, 0);

  // Recipe controls must actually bind to the structural planner, not just
  // update a decorative card. Verify saved source trims against that planner.
  await page.locator('#autoEditBtn').tap();
  assert.equal(await page.locator('#autoRecipeCards button[data-recipe]').count(), 3);
  assert.equal(await page.locator('#autoClosing').isChecked(), false);
  await page.locator('#autoSeconds').selectOption('15');
  for (const recipe of storyRecipes) {
    const button = page.locator(`#autoRecipeCards button[data-recipe=${recipe.id}]`);
    await button.click(); assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#autoStyle').inputValue(), recipe.style);
    assert.equal(await page.locator('#autoAspect').inputValue(), recipe.aspect);
    assert.equal(await page.locator('#autoSeconds').inputValue(), '15', 'a recipe does not overwrite the chosen duration');
  }
  await page.locator('#autoSeconds').selectOption('30');
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/taskforce-recipes-mobile.png' });
  await page.locator('#autoAspect').selectOption('9:16');
  await page.locator('#autoTitle').fill('わたしたちの休日'); await page.locator('#autoClosing').check();
  await page.locator('#autoCreateBtn').click(); await page.locator('#autoEditDialog').waitFor({ state: 'hidden' });
  const composed = await savedProject(page);
  const expected = planStoryEdit(baseline.clips.map(item => ({ id: item.assetId, type: 'image', duration: 4 })), { seconds: 30, recipe: 'explain' });
  assert.deepEqual(planFields(composed.clips), planFields(expected.clips));
  assert.equal(composed.name, 'わたしたちの休日'); assert.equal(composed.aspect, '9:16');
  assert.equal(composed.texts.length, 2, 'opening and closing titles are optional, editable timeline items');
  assert(composed.texts.every(text => text.text === 'わたしたちの休日'));
  assert.equal(composed.texts[0].start, 0); assert(Math.abs(composed.texts.at(-1).end - projectDuration(composed)) < .001);
  assert(composed.music.length > 0); assert(composed.clips.length > baseline.clips.length);
  await page.locator('#undoBtn').tap(); const reverted = await savedProject(page);
  assert.deepEqual(reverted, baseline, 'one undo restores the entire pre-recipe edit');
  await page.locator('#redoBtn').tap(); assert.deepEqual(await savedProject(page), composed);

  // Text presets preserve words and timing, reset custom positioning, and
  // participate in the normal single-step undo/redo history.
  await page.locator('.text-clip').first().tap();
  await page.locator('.mobile-context-actions [data-dock-group=style]').tap();
  for (const look of textLooks) {
    await page.locator(`#inspector .finishing-presets[data-finishing=text] button[data-look=${look.id}]`).click();
    const current = (await savedProject(page)).texts[0];
    for (const key of ['size', 'color', 'position', 'background']) assert.equal(current[key], look[key]);
    for (const key of ['id', 'text', 'start', 'end']) assert.equal(current[key], composed.texts[0][key]);
    assert(!Object.hasOwn(current, 'x') && !Object.hasOwn(current, 'y'));
  }
  await page.locator('#undoBtn').tap(); assert.equal((await savedProject(page)).texts[0].size, 70);
  await page.locator('#redoBtn').tap(); assert.equal((await savedProject(page)).texts[0].size, 56);

  // Global sound choices have audible outer boundaries, not fade-outs between
  // every repeat. Source placement, words, and editing geometry stay intact.
  await page.locator('.audio-clip').first().tap();
  await page.locator('.mobile-context-actions [data-dock-group=style]').tap();
  for (const mix of soundMixes) {
    await page.locator(`#inspector .finishing-presets[data-finishing=sound] button[data-mix=${mix.id}]`).click();
    const current = await savedProject(page), total = projectDuration(current);
    assert(current.clips.every(clip => clip.volume === mix.clipVolume));
    assert(current.music.every(item => item.volume === mix.musicVolume));
    assert.equal(current.music[0].fadeIn, .25); assert.equal(current.music.at(-1).fadeOut, .8);
    assert(Math.abs(current.music.at(-1).start + current.music.at(-1).out - current.music.at(-1).in - total) < .001);
    for (const [index, item] of current.music.entries()) {
      if (index) assert.equal(item.fadeIn, 0);
      if (index < current.music.length - 1) assert.equal(item.fadeOut, 0);
    }
  }
  const beforeMusic = await savedProject(page);
  // Picking a new song replaces by default, so repeated "add" does not
  // silently stack music. Deliberate layering remains available and undoable.
  await page.locator('#addMusicBtn').tap(); assert.equal(await page.locator('#replaceMusic').isChecked(), true);
  await page.locator('#presetMusicList .music-row').first().getByRole('button', { name: '追加', exact: true }).click();
  await page.locator('#musicDialog').waitFor({ state: 'hidden' }); const replaced = await savedProject(page);
  assert.equal(new Set(replaced.music.map(item => item.assetId)).size, 1);
  assert(replaced.music.every(item => !beforeMusic.music.some(old => old.id === item.id)));
  assert.equal(replaced.music[0].start, 0, 'default replacement covers the complete film, not the selected cut time');
  await page.locator('#undoBtn').tap(); assert.deepEqual((await savedProject(page)).music, beforeMusic.music);
  await page.locator('#addMusicBtn').tap(); await page.locator('#replaceMusic').uncheck();
  await page.locator('#presetMusicList .music-row').first().getByRole('button', { name: '追加', exact: true }).click();
  await page.locator('#musicDialog').waitFor({ state: 'hidden' }); const layered = await savedProject(page);
  assert(layered.music.length > beforeMusic.music.length); assert(beforeMusic.music.every(item => layered.music.some(current => current.id === item.id)));
  await page.locator('#undoBtn').tap(); assert.deepEqual((await savedProject(page)).music, beforeMusic.music);

  // Warnings are actionable, not blocking confirmations. Selecting a warning
  // returns straight to the real timeline item so it can be corrected there.
  await page.locator('.text-clip').first().tap();
  await page.locator('.mobile-context-actions [data-dock-group=timing]').tap();
  await page.getByLabel('表示終了（秒）', { exact: true }).fill('0.2');
  await page.getByLabel('表示終了（秒）', { exact: true }).dispatchEvent('change');
  const shortened = await savedProject(page); assert.equal(shortened.texts[0].end, .2);
  await page.locator('#exportBtn').tap();
  const warning = page.locator('#exportChecks [data-code=text_short]'); await warning.waitFor();
  assert.match(await warning.innerText(), /0.6秒/); assert.equal(await page.locator('#startExportBtn').isDisabled(), false);
  await warning.getByRole('button', { name: '見直す', exact: true }).click();
  await page.locator('#exportDialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.text-clip.selected').count(), 1);
  assert.equal(await page.getByLabel('テキスト', { exact: true }).inputValue(), 'わたしたちの休日');
  assert.equal(await page.getByLabel('表示終了（秒）', { exact: true }).inputValue(), '0.2');
  await page.getByLabel('表示終了（秒）', { exact: true }).fill('2');
  await page.getByLabel('表示終了（秒）', { exact: true }).dispatchEvent('change');
  await savedProject(page); await page.locator('#exportBtn').tap();
  assert.equal(await page.locator('#exportChecks [data-code=text_short]').count(), 0);
  assert.equal(await page.locator('#startExportBtn').isDisabled(), false);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/taskforce-export-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('Taskforce UI: structural recipe and closing title, one-operation undo, three text looks, three sound mixes, song replacement/layering, actionable preflight warning, and mobile fit passed.');
} finally { await browser.close(); }
