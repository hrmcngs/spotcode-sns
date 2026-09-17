import { t } from './i18n.js';

let closeCurrent;

// Camera access starts only after the user chooses Take a photo.
export function openPostCamera({ onLibrary, onPhoto }) {
  closeCurrent?.();
  const dialog = document.createElement('dialog');
  dialog.className = 'post-camera';
  const title = document.createElement('h2'); title.textContent = t('写真を添付');
  title.id = 'post-camera-title'; dialog.setAttribute('aria-labelledby', title.id);
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const video = document.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true; video.hidden = true;
  const canvas = document.createElement('canvas'); canvas.hidden = true;
  const controls = document.createElement('div'); controls.className = 'post-camera__controls';
  function button(label, action) {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'btn'; el.textContent = t(label);
    el.addEventListener('click', action); controls.append(el); return el;
  }
  let stream = null, closed = false, request = 0;
  const stop = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null; };
  const close = () => {
    if (closed) return;
    closed = true; request++; stop(); dialog.close(); dialog.remove();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', close);
    window.removeEventListener('hashchange', close);
    window.removeEventListener('popstate', close);
    if (closeCurrent === close) closeCurrent = null;
  };
  const library = button('写真ライブラリから選択', () => { close(); onLibrary(); });
  const start = button('写真を撮影', async () => {
    const generation = ++request;
    stop(); canvas.hidden = true; attach.hidden = true; shutter.hidden = true;
    start.disabled = true; status.textContent = t('カメラを準備しています…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('UNAVAILABLE');
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (closed || generation !== request) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
        if (closed || generation !== request) return;
        stop(); shutter.hidden = true; start.disabled = false;
        status.textContent = t('カメラが切断されました。再試行してください。');
      });
      video.hidden = false; video.srcObject = stream;
      await video.play();
      if (closed || generation !== request) return;
      shutter.hidden = false; status.textContent = ''; shutter.focus();
    } catch (error) {
      if (closed || generation !== request) return;
      stop(); video.hidden = true;
      status.textContent = t(error.name === 'NotAllowedError' ? 'ブラウザの設定でカメラを許可してください。'
        : error.message === 'UNAVAILABLE' ? 'カメラを利用できません。HTTPSで開くか、写真ライブラリから選択してください。'
        : 'カメラを開始できません。接続や他のアプリでの使用状況を確認してください。');
    } finally { if (!closed && generation === request) start.disabled = false; }
  });
  const shutter = button('撮影', () => {
    if (!video.videoWidth || !video.videoHeight) return;
    const scale = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) { status.textContent = t('撮影できませんでした。再試行してください。'); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    stop(); video.hidden = true; canvas.hidden = false; shutter.hidden = true;
    start.textContent = t('撮り直す'); attach.hidden = false; attach.focus();
  });
  const attach = button('この写真を添付', () => {
    attach.disabled = true; start.disabled = true;
    canvas.toBlob(async blob => {
      if (closed) return;
      if (!blob) { status.textContent = t('写真を添付できませんでした。'); attach.disabled = false; start.disabled = false; return; }
      try {
        const attached = await onPhoto(new File([blob], 'spotcode-camera.jpg', { type: 'image/jpeg' }), () => !closed);
        if (attached !== false) close();
        else status.textContent = t('写真を添付できませんでした。');
      } catch { status.textContent = t('写真を添付できませんでした。'); }
      finally { attach.disabled = false; start.disabled = false; }
    }, 'image/jpeg', 0.85);
  });
  button('Cancel', close);
  shutter.hidden = true; attach.hidden = true;
  dialog.append(title, video, canvas, status, controls);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', close);
  function onVisibility() { if (document.hidden) close(); }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', close);
  window.addEventListener('hashchange', close);
  window.addEventListener('popstate', close);
  document.body.append(dialog); closeCurrent = close; dialog.showModal(); library.focus();
}
