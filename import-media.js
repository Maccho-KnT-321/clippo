function mediaFailure(element){
  const code=element.error?.code;
  return new Error(code===3?'映像・音声をデコードできません。撮影方式がこのブラウザに対応していないか、ファイルが壊れています。':code===2?'ファイルを読み取れませんでした。端末にダウンロード済みのファイルで再試行してください。':code===1?'読み込みが中断されました。もう一度選んでください。':'この動画・音楽の方式はこのブラウザでは再生できません。H.264 / AAC のMP4をお試しください。');
}
function waitMedia(element,predicate,events,timeout=45000){
  return new Promise((resolve,reject)=>{
    const clean=()=>{clearTimeout(timer);for(const event of events)element.removeEventListener(event,check);element.removeEventListener('error',fail);};
    const check=()=>{if(predicate()){clean();resolve();}};
    const fail=()=>{clean();reject(mediaFailure(element));};
    const timer=setTimeout(()=>{clean();reject(new Error('読み込みに時間がかかっています。iCloud等の素材は端末にダウンロードしてから再度選んでください。'));},timeout);
    for(const event of events)element.addEventListener(event,check);element.addEventListener('error',fail);if(element.error)fail();else check();
  });
}
export async function inspectLocalFile(file){
  if(!file.size)throw new Error('ファイルが空です。クラウド上の素材は端末にダウンロードしてから選んでください。');
  const ext=file.name.split('.').pop().toLowerCase();
  const type=file.type.startsWith('audio/')||['mp3','m4a','wav','aac','ogg','flac'].includes(ext)?'audio':file.type.startsWith('image/')||['jpg','jpeg','png','webp','gif','heic','heif'].includes(ext)?'image':'video';
  const url=URL.createObjectURL(file),asset={id:crypto.randomUUID(),file,url,name:file.name,type,duration:4,width:0,height:0,thumb:null};
  const element=type==='image'?new Image():document.createElement(type);
  try{
    if(type==='image'){
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('画像を読み込めませんでした。JPEGまたはPNGをお試しください。')),45000);element.onload=()=>{clearTimeout(timer);resolve();};element.onerror=()=>{clearTimeout(timer);reject(new Error('この画像形式は読み込めません。JPEGまたはPNGをお試しください。'));};element.src=url;});
    }else{
      element.preload='auto';element.muted=true;element.autoplay=true;element.playsInline=true;element.setAttribute('muted','');element.setAttribute('playsinline','');element.setAttribute('webkit-playsinline','');
      // iOS may defer detached media. Keep a muted inline loader in the document.
      element.style.cssText='position:fixed;right:0;top:52px;width:2px;height:2px;opacity:.01;pointer-events:none';element.setAttribute('aria-hidden','true');document.body.append(element);
      const metadata=waitMedia(element,()=>element.readyState>=1,['loadedmetadata','durationchange']);element.src=url;element.load();element.play().catch(()=>{});await metadata;
      if(!Number.isFinite(element.duration)){
        // Some browser-recorded WebM files omit duration until seeking near EOF.
        const durationReady=waitMedia(element,()=>Number.isFinite(element.duration)&&element.duration>0,['durationchange','timeupdate','seeked']);element.currentTime=1e10;await durationReady;element.currentTime=0;
      }
      if(element.duration<=0)throw new Error('再生時間を取得できませんでした。別の動画でお試しください。');
      asset.duration=element.duration;
      if(element.readyState<2){const frame=waitMedia(element,()=>element.readyState>=2,['loadeddata','canplay','seeked']);element.play().catch(()=>{});await frame;}
      element.pause();
    }
    asset.width=element.videoWidth||element.naturalWidth||0;asset.height=element.videoHeight||element.naturalHeight||0;
    // Thumbnail failure must not discard an otherwise readable video.
    if(type!=='audio'&&asset.width&&asset.height){try{const canvas=document.createElement('canvas');canvas.width=256;canvas.height=144;const ctx=canvas.getContext('2d');ctx.fillStyle='#141821';ctx.fillRect(0,0,256,144);const ratio=Math.min(256/asset.width,144/asset.height);ctx.drawImage(element,(256-asset.width*ratio)/2,(144-asset.height*ratio)/2,asset.width*ratio,asset.height*ratio);asset.thumb=canvas.toDataURL('image/jpeg',.75);}catch{asset.thumb=null;}}
    return asset;
  }catch(error){URL.revokeObjectURL(url);throw error;}
  finally{if(type!=='image'){element.pause();element.removeAttribute('src');element.load();element.remove();}}
}
