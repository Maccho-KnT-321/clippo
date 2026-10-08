import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();await page.goto(process.env.CLIPPO_URL||'http://127.0.0.1:4173');
  const count=await page.evaluate(async()=>{
    const {EditorEngine}=await import('./engine.js');
    const source=document.createElement('canvas');source.width=source.height=20;source.getContext('2d').fillRect(0,0,20,20);
    const url=source.toDataURL();const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const engine=new EditorEngine(canvas,new Map([['a',{type:'image',url}]]));
    const project={clips:Array.from({length:40},(_,i)=>({id:String(i),assetId:'a',in:0,out:1,speed:1})),music:[],texts:[]};
    let max=0;for(let i=0;i<40;i++){await engine.render(project,i+.1);max=Math.max(max,engine.media.size);}
    engine.dispose();return max;
  });assert(count<=2);console.log('40 cuts reuse at most two visual slots:',count);
}finally{await browser.close();}
