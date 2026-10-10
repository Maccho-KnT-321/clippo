import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {transitionDuration} from '../timeline.js';

const browser = await chromium.launch({channel: 'chrome', headless: true});
const url = process.env.CLIPPO_URL || 'http://127.0.0.1:4173';
const group = (page, key) => page.locator(`.mobile-context-actions [data-dock-group=${key}]`);
const field = (page, key) => page.locator(`#inspector .field[data-key=${key}] input`);
async function chooseGroup(page, key) {
  if (await page.locator('.mobile-color-choices').isVisible()) await page.locator('#mobileDockBack').tap();
  await group(page, key).tap();
}
async function savedProject(page) {
  await page.waitForFunction(() => document.getElementById('saveProjectBtn').dataset.recovery === 'saved');
  return page.evaluate(async () => {
    const {loadRecovery} = await import('./project-store.js');
    return (await loadRecovery()).project;
  });
}
const workspace = page => page.evaluate(() => {
  const timeline = document.getElementById('timeline');
  const preview = document.querySelector('.viewer-panel').getBoundingClientRect();
  const track = timeline.getBoundingClientRect();
  const dock = document.querySelector('.inspector-panel').getBoundingClientRect();
  const toolbar = document.getElementById('mobileEditorToolbar').getBoundingClientRect();
  return {preview: preview.height, previewBottom: preview.bottom, timeline: track.height,
    timelineTop: track.top, timelineBottom: track.bottom, dockTop: dock.top,
    dockBottom: dock.bottom, toolbarTop: toolbar.top, toolbarBottom: toolbar.bottom,
    x: timeline.scrollLeft, y: timeline.scrollTop, pageY: scrollY,
    width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight};
});
const previewSample = page => page.evaluate(() => {
  const canvas = document.getElementById('preview'), context = canvas.getContext('2d');
  const values = [];
  for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) {
    values.push(...context.getImageData(Math.floor(canvas.width * x / 6), Math.floor(canvas.height * y / 6), 1, 1).data);
  }
  return values.join(',');
});

try {
  const page = await browser.newPage({viewport: {width: 390, height: 744}, isMobile: true, hasTouch: true});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mkdir('test-results', {recursive: true});
  await page.goto(url); await page.locator('#welcomeDemo').tap();
  const clips = page.locator('.track[data-kind=clips] .timeline-clip');
  await clips.nth(2).waitFor(); await clips.first().tap();
  await group(page, 'volume').tap();
  assert(await page.locator('body').evaluate(element => element.classList.contains('mobile-reference')));

  // A large preview and an open native adjustment leave a usable timeline,
  // including on a short phone. Nothing covers the tracks or scrolls the page.
  for (const [width, height] of [[320, 568], [390, 667], [390, 744], [430, 844]]) {
    await page.setViewportSize({width, height});
    const size = await workspace(page);
    assert(size.preview >= (height <= 620 ? 120 : 180), JSON.stringify(size));
    assert(size.timeline >= 80, JSON.stringify(size));
    assert(size.previewBottom <= size.timelineTop + 1);
    assert(size.timelineBottom <= size.dockTop + 1);
    assert(size.dockBottom <= size.toolbarTop + 1);
    assert(size.toolbarBottom <= height + 1);
    assert(size.width <= width && size.height <= height, JSON.stringify(size));
    assert.equal(size.pageY, 0);
  }
  await page.setViewportSize({width: 390, height: 744});

  // The top-bar setting is the export dialog's real resolution choice.
  await page.locator('#quickExportQuality').selectOption('1080');
  assert.equal(await page.locator('#exportQuality').inputValue(), '1080');
  await page.locator('#exportBtn').tap();
  await page.locator('#exportQuality').selectOption('720');
  await page.locator('#closeExportBtn').tap();
  assert.equal(await page.locator('#quickExportQuality').inputValue(), '720');

  // Keep the original volume gesture, including one undo for multiple inputs.
  await group(page, 'volume').tap();
  await field(page, 'volume').evaluate(input => {
    input.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 1}));
    for (const value of [.6, 1.4, 1.5]) {
      input.value = String(value); input.dispatchEvent(new Event('input', {bubbles: true}));
    }
    input.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 1}));
  });
  assert.equal((await savedProject(page)).clips[0].volume, 1.5);
  await page.locator('#undoBtn').tap(); await clips.first().tap(); await group(page, 'volume').tap();
  assert.equal((await savedProject(page)).clips[0].volume, 1);
  await page.locator('#redoBtn').tap(); await clips.first().tap(); await group(page, 'volume').tap();
  assert.equal(await field(page, 'volume').inputValue(), '1.5');

  // Color choices reveal one real slider. Input previews smoothly without
  // replacing the slider under the finger; release commits one history step.
  await group(page, 'color').tap();
  await page.locator('.mobile-color-choices [data-color-key=brightness]').tap();
  assert.equal(await page.locator('#inspector .field[data-dock-visible=true] input[type=range]').count(), 1);
  assert.equal(await field(page, 'brightness').getAttribute('type'), 'range');
  const originalPreview = await previewSample(page);
  await field(page, 'brightness').evaluate(input => {
    window.referenceColorInput = input;
    input.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 2}));
    input.value = '.6'; input.dispatchEvent(new Event('input', {bubbles: true}));
  });
  await page.waitForFunction(before => {
    const canvas = document.getElementById('preview'), context = canvas.getContext('2d'), values = [];
    for (let y = 1; y < 6; y++) for (let x = 1; x < 6; x++) values.push(...context.getImageData(Math.floor(canvas.width * x / 6), Math.floor(canvas.height * y / 6), 1, 1).data);
    return values.join(',') !== before;
  }, originalPreview);
  assert(await field(page, 'brightness').evaluate(input => input === window.referenceColorInput && input.isConnected));
  await field(page, 'brightness').evaluate(async input => {
    for (const value of [1.4, 1.2]) {
      input.value = String(value); input.dispatchEvent(new Event('input', {bubbles: true}));
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!input.isConnected) throw new Error('live color input was replaced during the gesture');
    }
    input.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 2}));
  });
  assert.equal((await savedProject(page)).clips[0].brightness, 1.2);
  await page.locator('#undoBtn').tap(); await clips.first().tap(); await chooseGroup(page, 'color');
  await page.locator('.mobile-color-choices [data-color-key=brightness]').tap();
  assert.equal((await savedProject(page)).clips[0].brightness, 1);
  await page.locator('#redoBtn').tap(); await clips.first().tap(); await chooseGroup(page, 'color');
  await page.locator('.mobile-color-choices [data-color-key=brightness]').tap();
  assert.equal(await field(page, 'brightness').inputValue(), '1.2');
  await page.screenshot({path: 'test-results/reference-mobile-color.png'});

  // Selecting another clip retains the chosen subcategory and tracks' scroll.
  await page.locator('.mobile-color-choices [data-color-key=contrast]').tap();
  await page.locator('#timeline').evaluate(element => {element.scrollLeft = 130;});
  const beforeSelection = await workspace(page);
  const visibleClip = await clips.nth(1).evaluate(element => {
    const rect = element.getBoundingClientRect(), viewport = document.getElementById('timeline').getBoundingClientRect();
    const left = Math.max(rect.left + 24, viewport.left + 80), right = Math.min(rect.right - 24, viewport.right - 8);
    if (left >= right) throw new Error('the next clip must have a visible tappable area');
    return {x: (left + right) / 2, y: rect.top + rect.height / 2};
  });
  await page.touchscreen.tap(visibleClip.x, visibleClip.y);
  const afterSelection = await workspace(page);
  assert.equal(await page.locator('body').getAttribute('data-dock-group'), 'color');
  assert.equal(await field(page, 'contrast').isVisible(), true);
  assert.equal(await field(page, 'contrast').inputValue(), '1');
  assert.equal(await field(page, 'brightness').isVisible(), false);
  assert.equal(afterSelection.x, beforeSelection.x);
  assert.equal(afterSelection.y, beforeSelection.y);
  assert.equal(afterSelection.timelineTop, beforeSelection.timelineTop);

  // Full preview is an inline mode, then returns to the precise editing space.
  const beforeResize = await workspace(page);
  await page.locator('#workspaceDivider').focus(); await page.keyboard.press('ArrowUp');
  const beforeFocus = await workspace(page);
  assert(beforeFocus.preview < beforeResize.preview - 20, 'the divider adjusts the real preview height');
  assert(beforeFocus.timeline > beforeResize.timeline + 20, 'shrinking the preview adds timeline space');
  await page.locator('#previewFocusBtn').tap();
  assert(await page.locator('body').evaluate(element => element.classList.contains('preview-focused')));
  assert.equal(await page.locator('#timeline').isVisible(), false);
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  await page.locator('#previewFocusBtn').tap();
  const afterFocus = await workspace(page);
  for (const key of ['preview', 'timeline', 'timelineTop', 'x', 'y']) assert.equal(afterFocus[key], beforeFocus[key], key);

  // Transition cards and their duration update the real project. Applying to
  // every boundary is one undoable operation and keeps the final clip intact.
  await page.locator('#timeline').evaluate(element => {element.scrollLeft = 0;});
  await clips.first().tap(); await page.locator('#mobileDockBack').tap();
  await group(page, 'transition').tap();
  await page.locator('#inspector .transition-presets [data-effect=dissolve]').tap();
  const duration = page.getByRole('slider', {name: '効果の長さ（秒）', exact: true});
  await duration.fill('0.8'); await duration.dispatchEvent('input'); await duration.dispatchEvent('change');
  const singleTransition = await savedProject(page);
  assert.deepEqual(singleTransition.clips[0].transition, {type: 'dissolve', duration: .8});
  await duration.fill('5'); await duration.dispatchEvent('input'); await duration.dispatchEvent('change');
  const clampedTransition = await savedProject(page), actualOverlap = transitionDuration(clampedTransition.clips, 0);
  assert.equal(clampedTransition.clips[0].transition.duration, 5);
  assert(actualOverlap < 5, 'the fixture clamps overlap to the available source duration');
  const visibleDurationCaption = page.locator('#inspector .field[data-key=transitionDuration]>span');
  assert.equal(await visibleDurationCaption.isVisible(), true);
  assert((await visibleDurationCaption.innerText()).includes('重なりは' + actualOverlap + '秒'));
  await page.locator('#undoBtn').tap();
  assert.deepEqual((await savedProject(page)).clips, singleTransition.clips, 'one undo restores the unclamped requested transition');
  await clips.first().tap(); await group(page, 'transition').tap();
  assert.equal(await duration.inputValue(), '0.8');
  for (const [width, height] of [[320, 568], [390, 667]]) {
    await page.setViewportSize({width, height});
    const size = await workspace(page);
    assert(size.timeline >= 80, 'transition choices retain editing space: ' + JSON.stringify(size));
    assert(size.timelineBottom <= size.dockTop + 1 && size.dockBottom <= size.toolbarTop + 1);
    assert(size.width <= width && size.height <= height);
    assert.equal(await duration.isVisible(), true);
    if (width === 320) await page.screenshot({path: 'test-results/reference-mobile-transition-small.png'});
  }
  await page.setViewportSize({width: 390, height: 744});
  await page.locator('#applyAllTransitions').tap();
  const allTransitions = await savedProject(page);
  assert(allTransitions.clips.slice(0, -1).every(clip => clip.transition.type === 'dissolve' && clip.transition.duration === .8));
  assert.deepEqual(allTransitions.clips.at(-1).transition, singleTransition.clips.at(-1).transition);
  await page.locator('#undoBtn').tap(); assert.deepEqual((await savedProject(page)).clips, singleTransition.clips);
  await page.locator('#redoBtn').tap(); assert.deepEqual((await savedProject(page)).clips, allTransitions.clips);
  await clips.first().tap(); await group(page, 'transition').tap();
  await page.locator('#mobileDockBack').tap();
  assert.equal(await page.locator('#inspector .transition-presets').isVisible(), false);

  const openDock = await workspace(page);
  await page.locator('#mobileDockDone').tap();
  assert(await page.locator('body').evaluate(element => element.classList.contains('mobile-dock-collapsed')));
  assert((await workspace(page)).timeline > openDock.timeline + 50);
  await group(page, 'volume').tap();
  assert.equal(await field(page, 'volume').isVisible(), true);
  assert.equal(await page.locator('#mobileToolsDialog').isVisible(), false);
  await page.locator('#workspaceDivider').focus(); await page.keyboard.press('Home');
  await page.screenshot({path: 'test-results/reference-mobile.png'});

  // Breakpoint changes restore every real desktop node and numeric field.
  await page.setViewportSize({width: 1440, height: 1000});
  assert.equal(await page.locator('.workspace>.inspector-panel').count(), 1);
  assert.equal(await field(page, 'volume').getAttribute('type'), 'number');
  assert.equal(await field(page, 'brightness').getAttribute('type'), 'number');
  for (const id of ['splitBtn', 'addTextBtn', 'addMusicBtn', 'deleteBtn', 'undoBtn', 'redoBtn']) assert.equal(await page.locator(`#${id}`).count(), 1);
  const advanced = page.locator('#inspector .advanced-controls');
  if (await advanced.evaluate(element => element.open)) await advanced.locator('summary').click();
  assert.equal(await advanced.evaluate(element => element.open), false);
  await page.setViewportSize({width: 390, height: 744});
  await group(page, 'volume').tap();
  assert.equal(await field(page, 'volume').getAttribute('type'), 'range');
  await group(page, 'color').tap(); await page.locator('.mobile-color-choices [data-color-key=brightness]').tap();
  await field(page, 'brightness').fill('1.4'); await field(page, 'brightness').dispatchEvent('change');
  assert.equal((await savedProject(page)).clips[0].brightness, 1.4);
  await page.setViewportSize({width: 1440, height: 1000});
  assert.equal(await advanced.evaluate(element => element.open), false, 'mobile color editing preserves the closed desktop disclosure');

  // Committing with Tab must allow focus to leave the replaced input. A text
  // edit and a numeric timing edit both exercise refresh while tabbing away.
  await page.setViewportSize({width: 390, height: 744});
  await page.locator('#addTextBtn').tap(); await chooseGroup(page, 'text');
  const textInput = page.getByLabel('テキスト', {exact: true});
  await textInput.fill('Tabで次の操作へ'); await textInput.press('Tab');
  assert.equal((await savedProject(page)).texts.at(-1).text, 'Tabで次の操作へ');
  assert.equal(await textInput.evaluate(input => input === document.activeElement), false, 'Tab leaves text editing after the commit');
  await group(page, 'timing').tap();
  const timingInput = page.getByLabel('表示開始（秒）', {exact: true});
  await timingInput.fill('0.1'); await timingInput.press('Tab');
  assert.equal((await savedProject(page)).texts.at(-1).start, .1);
  assert.equal(await timingInput.evaluate(input => input === document.activeElement), false, 'Tab leaves the committed timing input');
  assert.deepEqual(errors, []);
  console.log('Reference mobile: short-phone fit, quality sync, native volume/color gestures, saved edits and undo, stable category/scroll, inline full preview, all-boundary transitions, visible overlap clamp, dock close/reopen, desktop restoration/disclosure and Tab focus passed.');
} finally {
  await browser.close();
}
