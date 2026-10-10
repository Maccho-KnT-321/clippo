import test from 'node:test';
import assert from 'node:assert/strict';
import { planStoryEdit, storyRecipes } from '../story-planner.js';
import { projectDuration, clipDuration } from '../timeline.js';

const video = (id, duration = 60) => ({ id, type: 'video', duration });
const photo = id => ({ id, type: 'image' });
function assertLegal(plan, sources) {
  assert(plan.clips.length > 0 && plan.clips.length <= 60);
  assert(Number.isFinite(plan.duration) && plan.duration > 0);
  assert(plan.duration <= plan.target + 1e-8, 'the result never exceeds the target');
  assert.equal(plan.duration, projectDuration({ clips: plan.clips }));
  assert(new Set(plan.clips.map(clip => clip.assetId)).size <= 24);
  for (const clip of plan.clips) {
    const source = sources.find(item => item.id === clip.assetId);
    assert(source, 'source exists');
    assert(Number.isFinite(clip.in) && Number.isFinite(clip.out));
    assert(clip.in >= 0 && clip.out > clip.in);
    assert(clip.speed === 1);
    if (source.type === 'video') assert(clip.out <= source.duration + 1e-8);
  }
  assert.equal(plan.sections[0].start, 0);
  assert.equal(plan.sections.at(-1).end, plan.duration);
  for (let index = 0; index < plan.sections.length; index++) {
    const section = plan.sections[index];
    assert(section.end > section.start);
    assert(section.clipEnd > section.clipStart);
    if (index > 0) {
      assert.equal(section.start, plan.sections[index - 1].end);
      assert.equal(section.clipStart, plan.sections[index - 1].clipEnd);
    }
  }
  assert.equal(plan.sections.at(-1).clipEnd, plan.clips.length);
}

test('three purposes expose truthful recipe labels and defaults', () => {
  assert.deepEqual(storyRecipes.map(recipe => recipe.id), ['memory', 'social', 'explain']);
  for (const recipe of storyRecipes) for (const key of ['name', 'description', 'style', 'defaultTitle']) assert(recipe[key]);
  assert.doesNotMatch(JSON.stringify(storyRecipes), /AI|見どころ.*判定/);
});

test('all purposes fit supported target lengths with mixed sources and legal overlaps', () => {
  const sources = [video('one'), photo('two'), video('three', 24)];
  const before = structuredClone(sources);
  for (const recipe of storyRecipes) for (const seconds of [5, 15, 30, 60, 120]) {
    const plan = planStoryEdit(sources, { seconds, recipe: recipe.id });
    assertLegal(plan, sources);
    assert(Math.abs(plan.duration - seconds) < 1e-7, `${recipe.id} ${seconds}s fits`);
    assert.deepEqual(plan.sections.map(section => section.id), plan.clips.length >= 3 ? ['opening', 'middle', 'ending'] : ['opening', 'ending']);
  }
  assert.deepEqual(sources, before, 'planning does not mutate sources');
});

test('opening and closing get breathing room; middle has varied lengths', () => {
  for (const recipe of storyRecipes) {
    const plan = planStoryEdit([video('single', 90)], { seconds: 30, recipe: recipe.id });
    const spans = plan.clips.map(clipDuration);
    const middle = plan.sections.find(section => section.id === 'middle');
    const middleSpans = spans.slice(middle.clipStart, middle.clipEnd);
    assert(spans[0] > middleSpans[0]);
    assert(spans.at(-1) > middleSpans[0]);
    assert(new Set(middleSpans.map(span => span.toFixed(4))).size > 1);
  }
});

test('explanation uses readable shots, social uses a quicker rhythm', () => {
  const sources = [video('a'), video('b'), video('c')];
  const social = planStoryEdit(sources, { seconds: 30, recipe: 'social' });
  const explain = planStoryEdit(sources, { seconds: 30, recipe: 'explain' });
  assert(social.clips.length > explain.clips.length);
  assert(explain.clips.every(clip => clipDuration(clip) >= 2.5 - 1e-8));
  assert(social.clips.every(clip => clipDuration(clip) >= .9 - 1e-8));
  assert(social.clips.every(clip => clip.transition.type === 'none'));
  assert(explain.clips.slice(0, -1).every(clip => clip.transition.type === 'dissolve'));
});

test('too many sources are ordered and spaced, not squeezed into flashing cuts', () => {
  const sources = Array.from({ length: 24 }, (_, index) => video(String(index)));
  for (const recipe of storyRecipes) {
    const plan = planStoryEdit(sources, { seconds: 15, recipe: recipe.id });
    assertLegal(plan, sources);
    const firstCycle = [...new Set(plan.clips.map(clip => Number(clip.assetId)))];
    assert(firstCycle.length < 24);
    assert.equal(firstCycle[0], 0);
    assert.equal(firstCycle.at(-1), 23);
    assert.deepEqual(firstCycle, firstCycle.toSorted((a, b) => a - b));
    assert.match(plan.summary, /24素材のうち/);
    assert.match(plan.summary, /選んだ順序/);
  }
});

test('first pass keeps selected order, repeated excerpts advance through recordings', () => {
  const sources = [video('a'), video('b'), video('c')];
  const plan = planStoryEdit(sources, { seconds: 60, recipe: 'memory' });
  assert.deepEqual(plan.clips.slice(0, 3).map(clip => clip.assetId), ['a', 'b', 'c']);
  for (const source of sources) {
    const uses = plan.clips.filter(clip => clip.assetId === source.id);
    assert(uses.length > 1);
    assert.equal(uses[0].in, 0);
    assert(Math.abs(uses.at(-1).out - source.duration) < 1e-8);
    assert(uses.every((clip, index) => index === 0 || clip.in > uses[index - 1].in));
  }
  assert.match(plan.summary, /再使用/);
});

test('photos need no duration metadata and use valid bounded display lengths', () => {
  const sources = [photo('a'), photo('b')];
  for (const recipe of storyRecipes) {
    const plan = planStoryEdit(sources, { seconds: 60, recipe: recipe.id });
    assertLegal(plan, sources);
    assert(Math.abs(plan.duration - 60) < 1e-7);
    assert(plan.clips.every(clip => clip.in === 0 && clip.out <= 9));
  }
});

test('tiny or insufficient video sources stay legal and report an honestly shorter film', () => {
  for (const sources of [[video('tiny', .05)], [video('a', .05), video('b', .1), video('c', .2)]]) {
    for (const recipe of storyRecipes) {
      const plan = planStoryEdit(sources, { seconds: 120, recipe: recipe.id });
      assertLegal(plan, sources);
      assert.equal(plan.clips.length, 60);
      assert(plan.duration < 120);
      assert(plan.clips.every(clip => clip.transition.type === 'none'));
      assert.match(plan.summary, /指定の120秒に届きません/);
    }
  }
});

test('minimum-readable cuts may yield a slightly shorter target rather than inventing footage', () => {
  const sources = [video('a', 1)];
  const plan = planStoryEdit(sources, { seconds: 5.5, recipe: 'memory' });
  assertLegal(plan, sources);
  assert.equal(plan.duration, 5);
  assert.match(plan.summary, /最短カット/);
});

test('material and cut limits stay bounded even with hundreds of sources', () => {
  const sources = Array.from({ length: 300 }, (_, index) => video(String(index), 8));
  const plan = planStoryEdit(sources, { seconds: 120, recipe: 'social' });
  assertLegal(plan, sources);
  assert(plan.clips.every(clip => Number(clip.assetId) < 24));
  assert.match(plan.summary, /先頭24個/);
});

test('invalid inputs fail clearly; invalid and duplicate assets are excluded', () => {
  for (const sources of [undefined, null, {}, [], [null], [video('bad', 0)], [video('bad', Infinity)], [{ id: 'audio', type: 'audio', duration: 60 }]]) {
    assert.throws(() => planStoryEdit(sources));
  }
  for (const seconds of [0, 4.99, 121, NaN, Infinity, 'oops', null]) assert.throws(() => planStoryEdit([photo('a')], { seconds }), /5〜120/);
  for (const recipe of ['unknown', 'constructor', 'toString', '__proto__', null, {}]) assert.throws(() => planStoryEdit([photo('a')], { recipe }), /用途/);
  const sources = [null, video('bad', NaN), video('a', 20), video('a', 20), photo('b')];
  const plan = planStoryEdit(sources, { seconds: '15', recipe: 'memory' });
  assert.equal(plan.target, 15);
  assert.deepEqual([...new Set(plan.clips.map(clip => clip.assetId))], ['a', 'b']);
});

test('planning is deterministic and finite at numerical source-duration extremes', () => {
  const sources = [video('a', 1e18), photo('b')];
  const first = planStoryEdit(sources, { seconds: 30, recipe: 'memory' });
  assertLegal(first, sources);
  assert.deepEqual(planStoryEdit(sources, { seconds: 30, recipe: 'memory' }), first);
});

test('mixed-duration edge cases remain bounded across deterministic randomized inputs', () => {
  let seed = 123;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let index = 0; index < 300; index++) {
    const sources = Array.from({ length: 1 + Math.floor(random() * 30) }, (_, source) => ({ id: String(source), type: random() < .2 ? 'image' : 'video', duration: random() * 80 + .01 }));
    assertLegal(planStoryEdit(sources, { seconds: 5 + random() * 115, recipe: storyRecipes[index % 3].id }), sources);
  }
});
