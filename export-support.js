// Best effort: refusal/unsupported browsers must never prevent export.
// Late permission resolution must not leave a lock held after cancellation.
export function keepScreenAwake(wakeLock=globalThis.navigator?.wakeLock){
  let sentinel,ended=false;
  const releaseSentinel=async()=>{const current=sentinel;sentinel=null;try{await current?.release();}catch{}};
  let request;
  try{request=wakeLock?.request?.('screen');}catch{}
  const ready=Promise.resolve(request).then(async lock=>{sentinel=lock;if(ended)await releaseSentinel();return !!lock;}).catch(()=>false);
  return {ready,async release(){ended=true;await releaseSentinel();}};
}

export function playbackMessage(error,context='playback'){
  if(error?.name==='NotAllowedError')return 'ブラウザが映像・音声の再生を許可しませんでした。'+(context==='export'?'この画面を閉じて再生ボタンをタップし、書き出しを再試行してください。':'再生ボタンをタップして再試行してください。')+'改善しない場合はSafariで開き直してください。';
  if(error?.name==='NotSupportedError')return 'このブラウザでは素材または保存形式に対応していません。H.264 / AACのMP4素材でお試しください。';
  return error?.message||'処理に失敗しました。もう一度お試しください。';
}
