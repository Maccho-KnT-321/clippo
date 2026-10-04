import {chromium} from 'playwright';
import assert from 'node:assert/strict';

// Measure decoded output frames, not just blob size or the first/last frame.
for(const software of [false,true]){
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required',...(software?['--disable-accelerated-video-encode','--disable-accelerated-video-decode']:[])]});
  try{
    const page=await browser.newPage();await page.goto('http://127.0.0.1:4173');
    const result=await page.evaluate(async()=>{
      const {EditorEngine}=await import('/engine.js');
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;document.body.append(canvas);
      const ctx=canvas.getContext('2d'),stream=canvas.captureStream(30),chunks=[];
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
      recorder.ondataavailable=e=>chunks.push(e.data);const ended=new Promise(r=>recorder.onstop=r);recorder.start();
      const start=performance.now();await new Promise(resolve=>{
        function draw(){const elapsed=performance.now()-start;ctx.fillStyle=`rgb(${Math.floor(elapsed/12)%256},80,40)`;ctx.fillRect(0,0,320,180);if(elapsed>=2600){recorder.stop();resolve();}else requestAnimationFrame(draw);}draw();
      });await ended;stream.getTracks().forEach(t=>t.stop());
      const url=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
      const engine=new EditorEngine(canvas,new Map([['v',{type:'video',url}]]));
      const project={aspect:'16:9',clips:[{id:'v',assetId:'v',in:0,out:2.4,speed:1,volume:1}],texts:[],music:[]};
      // Match the app's modal export, where source decoders must stay rendered.
      const dialog=document.createElement('dialog');document.body.append(dialog);dialog.showModal();
      const blob=await engine.export(project,{height:720,mimeType:'video/mp4'});
      const source=engine.media.get('clip:v').el;
      const attached=source.isConnected&&dialog.contains(source);
      engine.dispose();dialog.close();dialog.remove();
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.src=URL.createObjectURL(blob);document.body.append(video);
      const sample=document.createElement('canvas');sample.width=sample.height=1;const pixels=sample.getContext('2d');
      const colors=new Set(),times=[];
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Output playback timed out')),15000);
        video.onended=()=>{clearTimeout(timer);resolve();};video.onerror=()=>{clearTimeout(timer);reject(new Error('Output playback failed'));};
        function frame(_now,meta){times.push(meta.mediaTime);pixels.drawImage(video,0,0,1,1);colors.add(pixels.getImageData(0,0,1,1).data[0]);if(!video.ended)video.requestVideoFrameCallback(frame);}
        video.requestVideoFrameCallback(frame);video.play().catch(reject);
      });
      const gaps=times.slice(1).map((t,i)=>t-times[i]);
      URL.revokeObjectURL(url);URL.revokeObjectURL(video.src);video.remove();canvas.remove();
      return {attached,frames:times.length,colors:colors.size,maxGap:Math.max(...gaps),seconds:times.at(-1)-times[0]};
    });
    assert(result.attached,'decoders are attached within the export modal');
    assert(result.frames/result.seconds>=20,`recorded output is smooth: ${JSON.stringify(result)}`);
    assert(result.colors>=30,`source motion survives encoding: ${JSON.stringify(result)}`);
    assert(result.maxGap<.25,`no long frozen output frames: ${JSON.stringify(result)}`);
    console.log(software?'Software export:':'Hardware export:',result);
    if(software){
      const slow=await page.evaluate(async()=>{
        const {EditorEngine}=await import('/engine.js');const c=document.createElement('canvas');c.width=c.height=20;document.body.append(c);
        const engine=new EditorEngine(c,new Map([['i',{type:'image',url:c.toDataURL()}]]));
        const draw=engine.draw.bind(engine);engine.draw=async(...args)=>{await new Promise(r=>setTimeout(r,120));return draw(...args);};
        let message='';try{await engine.export({aspect:'16:9',clips:[{id:'i',assetId:'i',in:0,out:3}],texts:[],music:[]},{height:720,mimeType:'video/mp4'});}catch(error){message=error.message;}
        const exporting=engine.exporting;engine.dispose();c.remove();return {message,exporting};
      });
      assert.match(slow.message,/映像処理が追いつかず/);assert.equal(slow.exporting,false);
      console.log('Slow rendering is rejected instead of returning a choppy successful export.');
    }
  }finally{await browser.close();}
}
