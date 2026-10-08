import assert from 'node:assert/strict';
import { planAutoEdit } from '../auto-edit.js';
import {chromium} from 'playwright';
const sources=[{id:'a',type:'video',duration:60},{id:'b',type:'video',duration:20}];
for(const style of ['bright','calm'])for(const seconds of [15,30,60]){const plan=planAutoEdit(sources,{seconds,style});assert(Math.abs(plan.duration-seconds)<.001);for(const clip of plan.clips){assert(clip.in>=0);assert(clip.out<=sources.find(a=>a.id===clip.assetId).duration);assert(clip.out>clip.in);}}
assert.throws(()=>planAutoEdit([]));assert.throws(()=>planAutoEdit(sources,{seconds:NaN}));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:390,height:744},isMobile:true,hasTouch:true});await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');await page.locator('#welcomeDemo').click();await page.locator('.timeline-clip').nth(2).waitFor();await page.locator('#autoEditBtn').tap();await page.locator('#autoStyle').selectOption('calm');await page.locator('#autoTitle').fill('夏の思い出');await page.locator('#autoCreateBtn').click();await page.locator('#autoEditDialog').waitFor({state:'hidden'});assert(await page.locator('.timeline-clip').count()>3);assert.match(await page.locator('.text-clip').innerText(),/夏の思い出/);assert(await page.locator('.audio-clip').count()>0);await page.locator('#undoBtn').tap();assert.equal(await page.locator('.timeline-clip').count(),3);console.log('Auto edit: duration, valid trim bounds, mobile generation, BGM, title and undo passed.');}finally{await browser.close();}
