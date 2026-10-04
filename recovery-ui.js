// Integration is supplied by the editor; persistence itself lives in project-store.
export function recoveryUI(){
  document.querySelector('.studio-label').textContent='BETA';document.querySelector('.brand').title='Clippo 公開ベータ · 対応端末を検証中';
  const status=document.createElement('p');status.id='recoveryStatus';status.className='recovery-status';status.setAttribute('role','status');
  document.querySelector('.media-footer').prepend(status);
  const notice=document.createElement('section');notice.id='recoveryNotice';notice.className='recovery-notice';notice.hidden=true;notice.setAttribute('aria-label','前回の編集を復元');
  notice.innerHTML='<div><strong>前回の編集が残っています</strong><p id="recoveryDescription"></p></div><div class="recovery-actions"><button id="restoreRecoveryBtn" class="button primary">続きを編集</button><button id="startFreshBtn" class="button subtle">新しく始める</button></div>';
  document.body.append(notice);
  return {status,notice,setState(state,message){
    status.textContent=message;const button=document.getElementById('saveProjectBtn');button.dataset.recovery=state;button.querySelector('span').textContent=state==='error'?'未保存':'保存';
    button.title=message+'。この端末の保存とは別に、素材込みのプロジェクトファイルをダウンロードできます。';
    button.setAttribute('aria-label',message+'。素材込みのプロジェクトをバックアップ保存');
    document.querySelector('.local-label').textContent=state==='saved'?'自動保存済み':state==='saving'?'保存中…':state==='error'?'自動保存できません':'この端末で編集';
  }};
}
