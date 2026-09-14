import { fileToAvatarDataUrl } from '../avatar.js';
import { currentUser } from '../auth.js';
import { url } from '../router.js';
import { themes, baseColors, paletteFromBase, defaultDesign, normalizeCard, cardLink, loadCard, saveCard, collectCard, loadCollection, removeCard, unpublishCard } from '../business-cards.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function cardMarkup(value, handle) {
  const c = normalizeCard(value), d = c.design;
  const style = `--card-front:${d.frontColor};--card-back:${d.backColor};--card-text:${d.textColor};--card-accent:${d.accentColor};--card-name-size:${d.nameSize}px;--card-radius:${d.radius}px`;
  const artwork = side => d.imagePlacement === 'artwork' && c.image_side === side && c.image_url;
  const artworkHtml = side => artwork(side) ? '<img class="business-card__artwork" src="' + esc(c.image_url) + '" alt="' + esc(c.name) + ' の名刺" referrerpolicy="no-referrer">' : '';
  const picture = side => {
    if (artwork(side) || !c.image_url || c.image_side !== side) return '';
    const img = `<img class="business-card__image" src="${esc(c.image_url)}" alt="${esc(c.name)} の名刺画像" referrerpolicy="no-referrer" style="width:${c.image_size}px;height:${c.image_size}px;border-radius:${c.image_shape === 'round' ? '50%' : '8px'}">`;
    return c.image_link ? `<a class="business-card__image-link" ${side === 'back' ? 'tabindex="-1"' : ''} href="${esc(c.image_link)}" target="_blank" rel="noopener noreferrer" aria-label="画像のリンクを開く">${img}</a>` : img;
  };
  const links = side => c.links_side !== side ? '' : `<div class="business-card__links">${c.links.map(link => `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" ${side === 'back' ? 'tabindex="-1"' : ''}>${esc(link.label || link.url)} ↗</a>`).join('')}</div>`;
  return `<div style="${style}" class="business-card business-card--${c.theme} business-card--${c.layout} business-card--font-${d.font} business-card--pattern-${d.pattern} business-card--${d.orientation} business-card--corners-${d.cornerStyle}" role="group" aria-label="${esc(c.name)} の名刺">
    <div class="business-card__body"><div class="business-card__face business-card__align-${d.frontAlign} ${artwork('front') ? 'business-card__face--artwork' : ''}">${artworkHtml('front')}<span class="business-card__brand">${esc(d.frontLabel)}</span><div class="business-card__identity">${picture('front')}<div><strong>${esc(c.name)}</strong><span>${esc(c.title)}</span><small>@${esc(handle)}</small></div></div>${links('front')}<button type="button" class="business-card__flip-accessible" data-card-flip aria-pressed="false" aria-label="名刺を裏返す"></button></div>
    <div class="business-card__face business-card__back business-card__align-${d.backAlign} ${artwork('back') ? 'business-card__face--artwork' : ''}" aria-hidden="true" inert>${artworkHtml('back')}<span class="business-card__brand">${esc(d.backLabel)}</span><div class="business-card__identity">${picture('back')}<div><span class="business-card__bio">${esc(c.bio || 'よろしくお願いします。')}</span><span>${esc(c.contact)}</span></div></div>${links('back')}<button type="button" class="business-card__flip-accessible" data-card-flip aria-pressed="false" tabindex="-1" aria-label="名刺を裏返す"></button></div></div></div>`;
}
export function renderBusinessCard(handle, collection = false) {
  return `<section class="card-page ${collection ? '' : 'card-page--showcase'}" data-card-page><nav class="card-actions"><a href="${url('/' + handle)}">← プロフィール</a><a href="${url('/' + handle + '/card')}">名刺</a>${currentUser()?.handle === handle ? `<a href="${url('/' + handle + '/cards')}">コレクション</a>` : ''}</nav><h1>${collection ? '名刺コレクション' : '名刺'}</h1><div data-card-content>読み込み中…</div><p role="status" aria-live="polite" data-card-status></p></section>`;
}
let refreshVisibleCard = null;
let refreshingCard = false;
async function refreshCardOnReturn() {
  if (document.visibilityState === 'hidden' || refreshingCard || !refreshVisibleCard) return;
  refreshingCard = true;
  try { await refreshVisibleCard(); } finally { refreshingCard = false; }
}
document.addEventListener('visibilitychange', refreshCardOnReturn);
if (typeof window !== 'undefined') window.addEventListener('focus', refreshCardOnReturn);

export async function hydrateBusinessCard(handle, collection = false, canRefresh = null) {
  const page = document.querySelector('[data-card-page]');
  if (!page) return;
  if (!canRefresh) refreshVisibleCard = null;
  const content = page.querySelector('[data-card-content]');
  const status = page.querySelector('[data-card-status]');
  const message = text => { if (page.isConnected) status.textContent = text; };
  try {
    if (collection) {
      if (currentUser()?.handle !== handle) throw new Error('自分のコレクションを見るにはログインしてください。');
      const rows = await loadCollection();
      if (!page.isConnected) return;
      content.innerHTML = `<p data-card-count>保存した名刺 ${rows.length} 枚</p><div class="card-collection">${rows.map(row => {
        const h = row.card?.profile?.handle;
        if (!h) return '';
        return `<article>${cardMarkup(row.card, h)}<div class="card-actions"><a href="${url('/' + h + '/card')}">@${esc(h)} の名刺</a><small>${esc(new Date(row.collected_at).toLocaleDateString())} に保存</small><button class="btn btn--ghost" data-remove-card="${esc(row.card_owner_id)}">取り除く</button></div></article>`;
      }).join('')}</div>${rows.length ? '' : '<p>まだ名刺がありません。相手のプロフィールや共有リンクから名刺を開き、保存するとここに並びます。</p>'}`;
      content.querySelectorAll('[data-remove-card]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try { await removeCard(button.dataset.removeCard);
          button.closest('article').remove();
          const remaining = content.querySelectorAll('.card-collection article').length;
          content.querySelector('[data-card-count]').textContent = '保存した名刺 ' + remaining + ' 枚';
          message(remaining ? '名刺を取り除きました。' : 'コレクションは空です。相手の名刺から保存できます。'); }
        catch (e) { message(e.message); button.disabled = false; }
      }));
      return;
    }
    const { profile, card } = await loadCard(handle);
    if (!page.isConnected || (canRefresh && !canRefresh())) return;
    const own = currentUser()?.id === profile.id;
    if (!card && !own) { content.innerHTML = '<p>このユーザーはまだ名刺を公開していません。</p>'; return; }
    const initial = normalizeCard(card || { name: profile.name });
    content.innerHTML = `<div class="card-showcase-wrap"><button type="button" class="btn btn--ghost card-fullscreen-open" data-card-fullscreen aria-label="名刺を全画面で表示">⛶ 全画面</button><div class="card-showcase" data-card-preview>${cardMarkup(initial, handle)}</div></div><div class="card-actions" data-card-sharing ${card ? '' : 'hidden'}><button class="btn btn--primary" data-share-card>名刺を共有</button><button class="btn btn--ghost" data-copy-card>リンクをコピー</button>${!own ? '<button class="btn btn--primary" data-collect-card>コレクションに保存</button>' : ''}</div><p>共有メニューからAirDropなどでリンクを送れます。相手が名刺を保存し、自分の名刺も送り返すと交換できます。</p>${own ? '<button class="btn btn--primary" data-edit-card aria-expanded="false">名刺を編集</button><div data-card-editor hidden>' + editor(initial, !!card) + '</div>' : ''}`;
    const link = cardLink(handle);
    content.querySelector('[data-share-card]').onclick = async () => {
      try {
        if (!navigator.share) { message('この端末では共有メニューを利用できません。「リンクをコピー」をお使いください。'); return; }
        await navigator.share({ title: profile.name + ' の名刺', url: link });
      } catch (e) { if (e.name !== 'AbortError') message('共有できませんでした。「リンクをコピー」をお試しください。'); }
    };
    content.querySelector('[data-copy-card]').onclick = async () => {
      try { await navigator.clipboard.writeText(link); message('リンクをコピーしました。'); }
      catch { message('このリンクをコピーしてください: ' + link); }
    };
    const collect = content.querySelector('[data-collect-card]');
    if (collect) collect.onclick = async () => {
      collect.disabled = true;
      try { await collectCard(profile.id); collect.textContent = '保存済み'; message('コレクションに保存しました。自分の名刺も共有して交換しましょう。'); }
      catch (e) { message(e.message); collect.disabled = false; }
    };
    refreshVisibleCard = () => {
      const ready = () => page.isConnected && !content.querySelector('form');
      if (ready()) return hydrateBusinessCard(handle, false, ready);
    };
    const form = content.querySelector('form');
    if (form) {
      content.querySelector('[data-edit-card]').onclick = event => {
        const panel = content.querySelector('[data-card-editor]'); panel.hidden = !panel.hidden;
        event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
        event.currentTarget.textContent = panel.hidden ? '名刺を編集' : '編集を閉じる';
        if (!panel.hidden) panel.scrollIntoView({behavior:'smooth',block:'start'});
      };
      let stagedImage = initial.image_url;
      let selectedTheme = initial.theme;
      const value = () => ({
        ...Object.fromEntries(new FormData(form)), image_url: stagedImage,
        theme: form.elements.theme.value === 'solid' ? selectedTheme : form.elements.theme.value
      });
      let savedValue = JSON.stringify(value());
      refreshVisibleCard = () => {
        const ready = () => page.isConnected && form.isConnected
          && content.querySelector('[data-card-editor]').hidden
          && !form.querySelector(':disabled') && JSON.stringify(value()) === savedValue;
        if (ready()) return hydrateBusinessCard(handle, false, ready);
      };
      let previewBack = false;
      const preview = content.querySelector('[data-card-preview]');
      function paintPreview() {
        previewBack = preview.querySelector('.business-card')?.classList.contains('is-flipped') || false;
        preview.innerHTML = cardMarkup(value(), handle);
        if (previewBack) preview.querySelector('[data-card-flip]').click();
        const base = form.elements.design_frontColor.value;
        form.querySelector('[data-base-color]').value = base;
        form.querySelectorAll('[data-base-chip]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.baseChip === base.toLowerCase())));
      }
      form.querySelector('[data-open-palette]').onclick = () => {
        const picker = form.querySelector('[data-base-color]');
        if (typeof picker.showPicker === 'function') picker.showPicker(); else picker.click();
      };
      form.querySelector('[data-card-image-file]').onchange = async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        form.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = true; });
        try {
          const image = await fileToAvatarDataUrl(file, 1650);
          if (!page.isConnected) return;
          stagedImage = image;
          form.querySelector('[data-card-image-url]').value = '';
          form.querySelector('[data-image-state]').textContent = '選択した画像を名刺に挿入しました。';
          message('画像を追加しました。「保存して公開」で反映されます。');
        } catch { message('画像を読み込めませんでした。8MB以下の画像を選んでください。'); }
        finally {
          form.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = false; });
          event.target.value = '';
          if (page.isConnected) paintPreview();
        }
      };
      form.querySelector('[data-card-template]').onclick = () => {
        const d = normalizeCard(value()).design;
        const w = d.orientation === 'portrait' ? 1000 : 1650, h = d.orientation === 'portrait' ? 1650 : 1000;
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><rect width="100%" height="100%" fill="' + d.frontColor + '"/><text x="80" y="200" font-family="sans-serif" font-size="72" fill="' + d.textColor + '">YOUR NAME</text><text x="80" y="300" font-family="sans-serif" font-size="36" fill="' + d.textColor + '">Title / Organization</text></svg>';
        const objectURL = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'}));
        const a = document.createElement('a'); a.href = objectURL; a.download = 'spotcode-card-template.svg'; a.click();
        setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
      };
      form.querySelector('[data-clear-card-image]').onclick = () => {
        stagedImage = ''; form.querySelector('[data-card-image-url]').value = '';
        form.querySelector('[data-image-state]').textContent = '画像なし'; paintPreview();
      };
      function applyBaseColor(color) {
        for (const [key, value] of Object.entries(paletteFromBase(color, form.elements.design_pattern.value, form.elements.theme.value))) form.elements['design_' + key].value = value;
      }
      form.querySelectorAll('[data-base-chip]').forEach(button => button.onclick = () => { applyBaseColor(button.dataset.baseChip); paintPreview(); });
      form.oninput = event => {
        if (event.target.matches('[data-base-color]')) applyBaseColor(event.target.value);
        if (event.target.matches('[data-card-image-file]')) return;
        if (event.target.matches('[data-card-image-url]')) {
          stagedImage = event.target.value;
          form.querySelector('[data-image-state]').textContent = stagedImage ? 'URLの画像を表示します。' : '画像なし';
        }
        if (event.target.name === 'theme') {
          if (event.target.value === 'solid') {
            form.elements.design_pattern.value = 'solid';
            form.elements.design_backColor.value = form.elements.design_frontColor.value;
          } else {
            selectedTheme = event.target.value;
            const defaults = defaultDesign(event.target.value, form.elements.layout.value);
            for (const key of ['frontColor','backColor','textColor','accentColor']) form.elements['design_' + key].value = defaults[key];
            form.elements.design_pattern.value = 'gradient';
            form.elements.design_font.value = defaults.font;
          }
        }
        if (event.target.name === 'layout') {
          for (const key of ['frontAlign','backAlign']) form.elements['design_' + key].value = event.target.value;
        }
        paintPreview();
      };
      form.onsubmit = async event => {
        event.preventDefault();
        const submitted = value();
        form.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = true; });
        try {
          await saveCard(submitted);
          if (!page.isConnected) return;
          content.querySelector('[data-card-sharing]').hidden = false;
          form.querySelector('[data-unpublish-card]').hidden = false;
          savedValue = JSON.stringify(submitted);
          message('名刺を保存しました。同じアカウントのWeb版・アプリ版に反映されます。');
        } catch (e) { message(e.message); }
        finally { form.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = false; }); }
      };
      form.querySelector('[data-unpublish-card]').onclick = async event => {
        if (!confirm('名刺の公開を停止しますか？相手のコレクションからも削除されます。')) return;
        const button = event.currentTarget; button.disabled = true;
        try { await unpublishCard(); content.querySelector('[data-card-sharing]').hidden = true; button.hidden = true; message('公開を停止しました。'); }
        catch (e) { message(e.message); }
        finally { button.disabled = false; }
      };
    }
  } catch (e) {
    if (!page.isConnected) return;
    if (canRefresh) { message('最新の名刺を取得できませんでした。接続を確認してください。'); return; }
    content.innerHTML = '<button class="btn btn--ghost" data-card-retry>再読み込み</button>';
    content.querySelector('button').onclick = () => hydrateBusinessCard(handle, collection);
    message(e.message);
  }
}
function editor(c, published) {
  return `<form class="card-editor"><h2>自分の名刺をデザイン</h2><p>保存するとリンクを知っている人が閲覧できます。掲載する情報だけを入力してください。</p>${[['name','名前（表）',60],['title','肩書き・組織（表）',100],['bio','自己紹介（裏）',280],['contact','連絡先・リンク（裏）',160]].map(([key,label,max]) => `<label>${label}${key === 'bio' ? `<textarea name="${key}" maxlength="${max}" rows="3">${esc(c[key])}</textarea>` : `<input name="${key}" maxlength="${max}" value="${esc(c[key])}" ${key === 'name' ? 'required' : ''}>`}</label>`).join('')}${baseColorEditor(c.design)}<label>テーマ<select name="theme">${Object.entries({...themes, solid: "単色"}).map(([key,label]) => `<option value="${key}" ${(c.design.pattern === 'solid' ? 'solid' : c.theme) === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>レイアウト<select name="layout"><option value="classic">左揃え</option><option value="centered" ${c.layout === 'centered' ? 'selected' : ''}>中央揃え</option></select></label>${mediaEditor(c)}${designEditor(c.design)}<div class="card-actions"><button class="btn btn--primary" type="submit">保存して公開</button><button class="btn btn--ghost" type="button" data-unpublish-card ${published ? '' : 'hidden'}>公開を停止</button></div></form>`;
}
function baseColorEditor(d) {
  return `<fieldset class="card-design"><legend>ベースカラー</legend><button type="button" class="btn btn--primary" data-open-palette>カラーパレットを開く</button><div class="card-color-chips" role="group" aria-label="ベースカラーを選択">${baseColors.map(([hex,label]) => `<button type="button" class="card-color-chip" data-base-chip="${hex}" style="--chip-color:${hex}" aria-label="${label}" title="${label}" aria-pressed="${hex === d.frontColor.toLowerCase()}"><span aria-hidden="true">✓</span></button>`).join('')}</div><label class="card-base-custom">好きな色を選ぶ<input type="color" data-base-color value="${d.frontColor}"></label><p>選んだ色をもとに表・裏・文字色をまとめて設定します。細かい色は後から調整できます。</p></fieldset>`;
}
function mediaEditor(c) {
  return `<fieldset class="card-design"><legend>画像を差し込む</legend><div class="card-editor">
    <label>画像を選択<input type="file" accept="image/*" data-card-image-file></label>
    <button type="button" class="btn btn--ghost" data-card-template>デザイン用テンプレートをダウンロード（SVG）</button><p>テンプレートを編集後、PNG/JPEGで書き出して取り込めます。実物の名刺は周囲を切り抜いた写真・スキャン画像を選んでください。画像は表または裏の1面に使えます。</p><label>画像の使い方<select name="design_imagePlacement"><option value="inline">画像を差し込む</option><option value="artwork" ${c.design.imagePlacement === 'artwork' ? 'selected' : ''}>名刺の1面として使う</option></select></label><p data-image-state>${c.image_url ? '画像を設定済み' : '画像なし'}</p>
    <label>または画像URL<input type="url" data-card-image-url value="${esc(c.image_url.startsWith('data:') ? '' : c.image_url)}" placeholder="https://example.com/photo.jpg"></label>
    <label>表示する面<select name="image_side"><option value="front">表</option><option value="back" ${c.image_side === 'back' ? 'selected' : ''}>裏</option></select></label>
    <label>画像の形<select name="image_shape"><option value="square">角丸</option><option value="round" ${c.image_shape === 'round' ? 'selected' : ''}>丸</option></select></label>
    <label>画像の大きさ（48〜100px）<input type="number" name="image_size" min="48" max="100" value="${c.image_size}"></label>
    <label>画像を押したときのリンク<input type="url" name="image_link" value="${esc(c.image_link)}" placeholder="https://example.com"></label>
    <button type="button" class="btn btn--ghost" data-clear-card-image>画像を取り除く</button></div></fieldset>
    <fieldset class="card-design"><legend>名刺に載せるリンク（3件まで）</legend><div class="card-editor"><label>表示する面<select name="links_side"><option value="front">表</option><option value="back" ${c.links_side === 'back' ? 'selected' : ''}>裏</option></select></label>${[0,1,2].map(i => `<label>リンク${i+1}の表示名<input name="link_${i}_label" maxlength="40" value="${esc(c.links[i]?.label || '')}" placeholder="ポートフォリオ / GitHub など"></label><label>リンク${i+1}のURL<input type="url" name="link_${i}_url" maxlength="2048" value="${esc(c.links[i]?.url || '')}" placeholder="https://example.com"></label>`).join('')}</div></fieldset>`;
}
function designEditor(d) {
  const options = (name, label, values) => `<label>${label}<select name="design_${name}">${values.map(([value,text]) => `<option value="${value}" ${d[name] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  const align = [['classic','左揃え'],['centered','中央揃え'],['right','右揃え']];
  return `<fieldset class="card-design"><legend>細かくデザイン</legend><div class="card-design__grid">${[['frontColor','表の背景'],['backColor','裏の背景'],['textColor','文字色'],['accentColor','見出しの色']].map(([key,label]) => `<label>${label}<input type="color" name="design_${key}" value="${d[key]}"></label>`).join('')}
    ${options('font','書体',[['sans','ゴシック'],['serif','明朝'],['mono','等幅']])}
    ${options('pattern','背景の装飾',[['solid','単色'],['gradient','グラデーション'],['stripe','ストライプ']])}
    ${options('frontAlign','表の文字揃え',align)}${options('backAlign','裏の文字揃え',align)}
    ${options('orientation','名刺の向き',[['landscape','横向き'],['portrait','縦向き']])}
    ${options('cornerStyle','角の形',[['rounded','すべて丸い'],['square','すべて直角'],['diagonal','左上・右下が丸い'],['diagonalReverse','右上・左下が丸い']])}
    <label>名前の大きさ（18〜36px）<input type="number" name="design_nameSize" min="18" max="36" value="${d.nameSize}"></label>
    <label>角丸（0〜28px）<input type="number" name="design_radius" min="0" max="28" value="${d.radius}"></label>
    ${[['frontLabel','表の見出し'],['backLabel','裏の見出し']].map(([key,label]) => `<label>${label}<input name="design_${key}" maxlength="40" value="${esc(d[key])}" placeholder="空欄で非表示"></label>`).join('')}</div><p>配色プリセットを変更すると4色が切り替わります。タップして裏面を確認しながら編集できます。</p></fieldset>`;
}
function openCardFullscreen(button) {
  const original = button.closest('.card-showcase-wrap')?.querySelector('.business-card');
  if (!original || document.querySelector('.card-fullscreen')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'card-fullscreen';
  dialog.setAttribute('aria-label', '名刺の全画面表示');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn--ghost card-fullscreen-close';
  close.textContent = '× 閉じる';
  const stage = document.createElement('div');
  stage.className = 'card-fullscreen-stage';
  stage.append(original.cloneNode(true));
  dialog.append(close, stage);
  document.body.append(dialog);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const closeDialog = () => dialog.close();
  const changedFullscreen = () => { if (!document.fullscreenElement) closeDialog(); };
  close.onclick = closeDialog;
  dialog.addEventListener('close', () => {
    if (document.fullscreenElement === dialog) document.exitFullscreen().catch(() => {});
    document.removeEventListener('fullscreenchange', changedFullscreen);
    window.removeEventListener('hashchange', closeDialog);
    document.body.style.overflow = previousOverflow;
    dialog.remove();
    if (button.isConnected) button.focus({preventScroll: true});
  }, {once: true});
  window.addEventListener('hashchange', closeDialog);
  dialog.showModal();
  close.focus({preventScroll: true});
  // Browsers without the Fullscreen API still get a viewport-sized modal.
  if (dialog.requestFullscreen) {
    dialog.requestFullscreen().then(() => {
      if (!dialog.isConnected) { document.exitFullscreen().catch(() => {}); return; }
      document.addEventListener('fullscreenchange', changedFullscreen);
    }).catch(() => {});
  }
}

function flipCard(card) {
  const flipped = card.classList.toggle('is-flipped');
  card.querySelectorAll('[data-card-flip]').forEach(button => button.setAttribute('aria-pressed', String(flipped)));
  card.querySelectorAll('.business-card__face').forEach((face, i) => {
    const hidden = i === (flipped ? 0 : 1);
    face.setAttribute('aria-hidden', String(hidden));
    face.toggleAttribute('inert', hidden);
    face.querySelectorAll('a, button').forEach(control => { control.tabIndex = hidden ? -1 : 0; });
  });
}

const cardSwipeState = new WeakMap();
document.addEventListener('click', event => {
  const fullscreen = event.target.closest('[data-card-fullscreen]');
  if (fullscreen) { openCardFullscreen(fullscreen); return; }
  const card = event.target.closest('.business-card');
  if (!card) return;
  if (Date.now() < (cardSwipeState.get(card)?.suppressClickUntil || 0)) { event.preventDefault(); return; }
  if (!event.target.closest('a')) flipCard(card);
});
document.addEventListener('pointerdown', event => {
  const card = event.target.closest('.business-card');
  if (card) cardSwipeState.set(card, {x:event.clientX,y:event.clientY});
});
document.addEventListener('pointerup', event => {
  const card = event.target.closest('.business-card'), state = card && cardSwipeState.get(card);
  if (!state) return;
  const dx = event.clientX-state.x, dy = event.clientY-state.y;
  if (Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*2) {
    state.suppressClickUntil = Date.now()+500; flipCard(card);
  }
});
document.addEventListener('wheel', event => {
  const card = event.target.closest('.business-card');
  if (!card || Math.abs(event.deltaX)<=Math.abs(event.deltaY)*2) return;
  event.preventDefault();
  const now=Date.now(), state=cardSwipeState.get(card)||{};
  if (now-(state.wheelAt||0)>250) {state.total=0;state.turned=false;}
  state.wheelAt=now; state.total=(state.total||0)+event.deltaX*(event.deltaMode===1?16:1);
  if (!state.turned && Math.abs(state.total)>60) {flipCard(card);state.turned=true;}
  cardSwipeState.set(card,state);
}, {passive:false});
