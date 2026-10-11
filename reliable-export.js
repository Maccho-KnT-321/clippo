import { layoutClips, projectDuration } from './timeline.js';
import { EXPORT_SAMPLE_RATE, mixDecodedBuffer, limitAudio } from './export-audio.js';

const FPS=30;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const abortError=()=>new DOMException('キャンセルしました','AbortError');
const check=signal=>{if(signal?.aborted)throw abortError();};
const unsupported=reason=>({supported:false,reason});
let modulePromise;
const library=()=>modulePromise||=import('./vendor/mediabunny/mediabunny.js');
function guarded(promise,signal){
  return new Promise((resolve,reject)=>{
    const abort=()=>{clean();reject(abortError());};
    const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const timer=setTimeout(()=>{clean();reject(new Error('映像処理の応答がありません。編集は残っています。解像度を下げるか、別の方式で再試行してください。'));},45000);
    Promise.resolve(promise).then(value=>{clean();resolve(value);},error=>{clean();reject(error);});
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
export function exportDimensions(aspect,height=720){
  const [aw,ah]=String(aspect).split(':').map(Number),ratio=aw/ah;
  if(!Number.isFinite(ratio)||ratio<=0||!Number.isFinite(height)||height<100||height>2160)throw new Error('書き出しサイズが不正です');
  return {width:Math.round((ratio>=1?height*ratio:height)/2)*2,height:Math.round((ratio>=1?height:height/ratio)/2)*2};
}
export async function supportsReliableEncoding(aspect='16:9',height=720){
  if(!globalThis.VideoEncoder||!globalThis.VideoDecoder)return false;
  const m=await library(),size=exportDimensions(aspect,height);
  return m.canEncodeVideo('avc',{...size,frameRate:FPS,bitrate:Math.max(3500000,height*height*8)});
}

export async function prepareReliableExport(project,assets,{height=720,mimeType,signal,onPrepare=()=>{}}={}){
  check(signal);
  if(mimeType&&!mimeType.startsWith('video/mp4')&&mimeType!=='auto')return unsupported('WebMは互換方式で保存します');
  if(!globalThis.VideoEncoder||!globalThis.VideoDecoder)return unsupported('このブラウザのフレーム処理APIが未対応です');
  const m=await library(),dimensions=exportDimensions(project.aspect,height);
  if(!await guarded(supportsReliableEncoding(project.aspect,height),signal))return unsupported('この解像度のH.264エンコードが未対応です');
  const total=projectDuration(project),layout=layoutClips(project.clips),sources=new Map(),inputs=[];
  const audible=volume=>clamp(volume??1,0,2)>0;
  const music=(project.music||[]).filter(item=>item.start<total&&item.start+item.out-item.in>0&&audible(item.volume));
  const used=new Set([...project.clips,...music].map(item=>item.assetId));
  const dispose=()=>{for(const input of inputs)try{input.dispose();}catch{}};
  try{
    for(const [index,id]of [...used].entries()){
      check(signal);const asset=assets.get(id);
      if(!asset?.file||!(asset.file instanceof Blob)){dispose();return unsupported('元の素材ファイルがないため再生録画を使います');}
      onPrepare(`素材の対応を確認中 ${index+1}/${used.size}：${asset.name||asset.file.name}`);
      if(asset.type==='image'){sources.set(id,{asset});continue;}
      const input=new m.Input({source:new m.BlobSource(asset.file),formats:m.ALL_FORMATS});inputs.push(input);
      let video,audio;
      try{
        video=asset.type==='video'?await guarded(input.getPrimaryVideoTrack(),signal):null;
        audio=await guarded(input.getPrimaryAudioTrack(),signal);
        if(asset.type==='video'&&(!video||!await guarded(video.canDecode(),signal))){dispose();return unsupported('素材の映像方式をフレーム単位で読み取れません');}
        const needsAudio=project.clips.some(c=>c.assetId===id&&audible(c.volume))||music.some(c=>c.assetId===id);
        if(needsAudio&&audio&&!await guarded(audio.canDecode(),signal)){dispose();return unsupported('素材の音声方式をフレーム単位で読み取れません');}
        if(asset.type==='audio'&&!audio){dispose();return unsupported('音楽の音声トラックを読み取れません');}
        if(audio&&project.clips.some(c=>c.assetId===id&&audible(c.volume)&&Math.abs((c.speed||1)-1)>1e-9)){
          dispose();return unsupported('速度変更した動画の音程を保つため再生録画を使います（動画音量0なら品質優先を利用できます）');
        }
      }catch(error){if(error.name==='AbortError')throw error;dispose();return unsupported('この素材形式のフレーム処理が未対応です');}
      sources.set(id,{asset,input,video,audio,firstVideo:video?await guarded(video.getFirstTimestamp(),signal):0,
        width:video?await guarded(video.getDisplayWidth(),signal):0,height:video?await guarded(video.getDisplayHeight(),signal):0});
    }
    const segments=[];
    for(const [index,entry]of layout.entries()){
      const clip=entry.clip,source=sources.get(clip.assetId);
      if(source.audio&&audible(clip.volume))segments.push({id:'video:'+clip.id,source,start:entry.start,end:entry.end,in:clip.in,speed:1,volume:clip.volume,fadeIn:clip.fadeIn||0,fadeOut:clip.fadeOut||0,crossIn:layout[index-1]?.overlap||0,crossOut:entry.overlap||0});
    }
    for(const item of music)segments.push({id:'music:'+item.id,source:sources.get(item.assetId),start:item.start,end:item.start+item.out-item.in,in:item.in,speed:1,volume:item.volume,fadeIn:item.fadeIn||0,fadeOut:item.fadeOut||0});
    if(segments.length&&(!globalThis.AudioEncoder||!await guarded(m.canEncodeAudio('aac',{sampleRate:EXPORT_SAMPLE_RATE,numberOfChannels:2,bitrate:192000}),signal))){dispose();return unsupported('このブラウザのAAC音声エンコードが未対応です');}
    return {supported:true,m,dimensions,total,layout,sources,segments,dispose};
  }catch(error){dispose();throw error;}
}

export async function renderReliableExport(engine,project,plan,{signal,onProgress=()=>{},onPrepare=()=>{}}={}){
  const {m,dimensions,total,layout,sources,segments}=plan;
  const oldWidth=engine.canvas.width,oldHeight=engine.canvas.height;
  const videoReaders=new Map(),audioReaders=new Map(),images=new Map();
  let output,completed=false;
  const abort=()=>{plan.dispose();if(output)void output.cancel().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  const releaseReader=async reader=>{try{await reader.iterator.return();}catch{}};
  try{
    check(signal);engine.canvas.width=dimensions.width;engine.canvas.height=dimensions.height;
    const target=new m.BufferTarget();output=new m.Output({format:new m.Mp4OutputFormat({fastStart:'in-memory'}),target});
    const video=new m.CanvasSource(engine.canvas,{codec:'avc',bitrate:Math.max(3500000,dimensions.height*dimensions.width*8),keyFrameInterval:2,hardwareAcceleration:'no-preference'});
    const audio=segments.length?new m.AudioBufferSource({codec:'aac',bitrate:192000}):null;
    output.addVideoTrack(video,{frameRate:FPS});if(audio)output.addAudioTrack(audio);
    onPrepare('品質優先：映像と音声を時刻に合わせて処理します。端末が遅くてもフレームを飛ばしません。');
    await guarded(output.start(),signal);
    const frames=Math.ceil(total*FPS-1e-8);let audioWritten=0;
    const samples=Math.round(total*EXPORT_SAMPLE_RATE);
    const writeAudio=async()=>{
      const length=Math.min(EXPORT_SAMPLE_RATE,samples-audioWritten);if(length<=0)return;
      const start=audioWritten/EXPORT_SAMPLE_RATE,end=(audioWritten+length)/EXPORT_SAMPLE_RATE;
      const channels=[new Float32Array(length),new Float32Array(length)];
      for(const segment of segments){
        if(segment.end<=start||segment.start>=end)continue;
        let reader=audioReaders.get(segment.id);
        if(!reader){const sink=new m.AudioBufferSink(segment.source.audio);reader={iterator:sink.buffers(segment.in,segment.in+(segment.end-segment.start)),current:null,done:false};audioReaders.set(segment.id,reader);}
        const sourceEnd=segment.in+(Math.min(end,segment.end)-segment.start);
        while(!reader.done){
          if(!reader.current){const result=await guarded(reader.iterator.next(),signal);reader.done=result.done;reader.current=result.value;if(reader.done)break;}
          if(reader.current.timestamp>=sourceEnd-1e-9)break;
          mixDecodedBuffer(channels,start,EXPORT_SAMPLE_RATE,segment,reader.current);
          const bufferEnd=reader.current.timestamp+reader.current.buffer.duration;
          if(bufferEnd>=sourceEnd-1e-9)break;
          reader.current=null;
        }
      }
      for(const [id,reader]of audioReaders){const segment=segments.find(s=>s.id===id);if(segment.end<=end+1e-9){await releaseReader(reader);audioReaders.delete(id);}}
      limitAudio(channels);const buffer=new AudioBuffer({length,numberOfChannels:2,sampleRate:EXPORT_SAMPLE_RATE});
      channels.forEach((channel,index)=>buffer.copyToChannel(channel,index));await guarded(audio.add(buffer),signal);audioWritten+=length;
    };
    for(let frame=0;frame<frames;frame++){
      check(signal);const time=frame/FPS,visible=layout.filter(entry=>time>=entry.start-1e-9&&time<entry.end-1e-9),visuals=[];
      for(const entry of visible){
        const clip=entry.clip,source=sources.get(clip.assetId);let visual;
        if(source.asset.type==='image'){
          visual=images.get(clip.assetId);
          if(!visual){visual=new Image();visual.src=source.asset.url;await guarded(visual.decode(),signal);images.set(clip.assetId,visual);}
        }else{
          let reader=videoReaders.get(clip.id);
          if(!reader){
            const first=Math.ceil(entry.start*FPS-1e-8),last=Math.ceil(entry.end*FPS-1e-8),rate=clamp(clip.speed||1,.25,4);
            const times=function*(){for(let index=first;index<last;index++)yield Math.max(source.firstVideo,clip.in+(index/FPS-entry.start)*rate);};
            const sideways=Number(clip.rotation)%180!==0,rw=sideways?source.height:source.width,rh=sideways?source.width:source.height;
            const needed=(clip.fit==='cover'?Math.max(dimensions.width/rw,dimensions.height/rh):Math.min(dimensions.width/rw,dimensions.height/rh))*clamp(clip.zoom??1,1,3);
            // Keep decoded display surfaces at the size needed for this cut,
            // not at 4K when the final composition is only 720p.
            const sink=new m.CanvasSink(source.video,{poolSize:1,width:Math.max(1,Math.round(source.width*Math.min(1,needed)))});reader={iterator:sink.canvasesAtTimestamps(times())};videoReaders.set(clip.id,reader);
          }
          const result=await guarded(reader.iterator.next(),signal);visual=result.value?.canvas;
          if(!visual)throw new Error('素材の映像フレームを取得できませんでした。編集は残っています。');
        }
        const elapsed=clamp(time-entry.start,0,entry.duration);
        const fade=Math.min(1,clip.fadeIn>0?elapsed/clip.fadeIn:1,clip.fadeOut>0?(entry.duration-elapsed)/clip.fadeOut:1);
        visuals.push({visual,clip,fade});
      }
      for(const [id,reader]of videoReaders)if(!visible.some(entry=>entry.clip.id===id)){await releaseReader(reader);videoReaders.delete(id);}
      const progress=visible.length>1?clamp((time-visible[1].start)/visible[0].overlap,0,1):0;
      engine.paintFrame(project,time,visuals,visible,progress);
      await guarded(video.add(time,Math.min(1/FPS,total-time)),signal);
      if(audio&&audioWritten/EXPORT_SAMPLE_RATE<=time+1e-9)await writeAudio();
      onProgress((frame+1)/frames*.98);
      // Yield to touch/cancel events without tying the output to wall-clock time.
      if(frame%5===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    while(audio&&audioWritten<samples){check(signal);await writeAudio();}
    onPrepare('MP4を仕上げています…');await guarded(output.finalize(),signal);check(signal);completed=true;
    if(!target.buffer?.byteLength)throw new Error('完成動画を生成できませんでした');
    onProgress(1);return new Blob([target.buffer],{type:'video/mp4'});
  }finally{
    signal?.removeEventListener('abort',abort);
    plan.dispose();
    if(!completed&&output)try{await output.cancel();}catch{}
    for(const reader of [...videoReaders.values(),...audioReaders.values()])await releaseReader(reader);
    engine.canvas.width=oldWidth;engine.canvas.height=oldHeight;
  }
}
