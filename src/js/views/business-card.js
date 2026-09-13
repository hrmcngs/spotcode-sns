import { currentUser } from '../auth.js';
import { url } from '../router.js';
import { themes, normalizeCard, cardLink, loadCard, saveCard, collectCard, loadCollection, removeCard, unpublishCard } from '../business-cards.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function cardMarkup(value, handle) {
  const c = normalizeCard(value);
  return `<button type="button" class="business-card business-card--${c.theme} business-card--${c.layout}" data-card-flip aria-label="名刺を裏返す" aria-pressed="false">
    <span class="business-card__body"><span class="business-card__face"><span class="business-card__brand">SPOTCODE / BUSINESS CARD</span><strong>${esc(c.name)}</strong><span>${esc(c.title)}</span><small>@${esc(handle)}</small><span class="business-card__hint">タップして裏面へ ↻</span></span>
    <span class="business-card__face business-card__back" aria-hidden="true"><span class="business-card__brand">LET’S CONNECT</span><span class="business-card__bio">${esc(c.bio || 'よろしくお願いします。')}</span><span>${esc(c.contact)}</span><small>@${esc(handle)}</small><span class="business-card__hint">タップして表面へ ↻</span></span></span></button>`;
}
export function renderBusinessCard(handle, collection = false) {
  return `<section class="card-page" data-card-page><nav class="card-actions"><a href="${url('/' + handle)}">← プロフィール</a><a href="${url('/' + handle + '/card')}">名刺</a>${currentUser()?.handle === handle ? `<a href="${url('/' + handle + '/cards')}">コレクション</a>` : ''}</nav><h1>${collection ? '名刺コレクション' : '名刺'}</h1><div data-card-content>読み込み中…</div><p role="status" aria-live="polite" data-card-status></p></section>`;
}
export async function hydrateBusinessCard(handle, collection = false) {
  const page = document.querySelector('[data-card-page]');
  if (!page) return;
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
    if (!page.isConnected) return;
    const own = currentUser()?.id === profile.id;
    if (!card && !own) { content.innerHTML = '<p>このユーザーはまだ名刺を公開していません。</p>'; return; }
    const initial = card || normalizeCard({ name: profile.name });
    content.innerHTML = `<div data-card-preview>${cardMarkup(initial, handle)}</div><div class="card-actions" data-card-sharing ${card ? '' : 'hidden'}><button class="btn btn--primary" data-share-card>名刺を共有</button><button class="btn btn--ghost" data-copy-card>リンクをコピー</button>${!own ? '<button class="btn btn--primary" data-collect-card>コレクションに保存</button>' : ''}</div><p>共有メニューからAirDropなどでリンクを送れます。相手が名刺を保存し、自分の名刺も送り返すと交換できます。</p>${own ? editor(initial, !!card) : ''}`;
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
    const form = content.querySelector('form');
    if (form) {
      const value = () => Object.fromEntries(new FormData(form));
      form.oninput = () => { content.querySelector('[data-card-preview]').innerHTML = cardMarkup(value(), handle); };
      form.onsubmit = async event => {
        event.preventDefault();
        const submitted = value();
        form.querySelectorAll('input, textarea, select, button').forEach(el => { el.disabled = true; });
        try {
          await saveCard(submitted);
          if (!page.isConnected) return;
          content.querySelector('[data-card-sharing]').hidden = false;
          form.querySelector('[data-unpublish-card]').hidden = false;
          message('名刺を保存・公開しました。');
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
    content.innerHTML = '<button class="btn btn--ghost" data-card-retry>再読み込み</button>';
    content.querySelector('button').onclick = () => hydrateBusinessCard(handle, collection);
    message(e.message);
  }
}
function editor(c, published) {
  return `<form class="card-editor"><h2>自分の名刺をデザイン</h2><p>保存するとリンクを知っている人が閲覧できます。掲載する情報だけを入力してください。</p>${[['name','名前（表）',60],['title','肩書き・組織（表）',100],['bio','自己紹介（裏）',280],['contact','連絡先・リンク（裏）',160]].map(([key,label,max]) => `<label>${label}${key === 'bio' ? `<textarea name="${key}" maxlength="${max}" rows="3">${esc(c[key])}</textarea>` : `<input name="${key}" maxlength="${max}" value="${esc(c[key])}" ${key === 'name' ? 'required' : ''}>`}</label>`).join('')}<label>配色<select name="theme">${Object.entries(themes).map(([key,label]) => `<option value="${key}" ${c.theme === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>レイアウト<select name="layout"><option value="classic">左揃え</option><option value="centered" ${c.layout === 'centered' ? 'selected' : ''}>中央揃え</option></select></label><div class="card-actions"><button class="btn btn--primary" type="submit">保存して公開</button><button class="btn btn--ghost" type="button" data-unpublish-card ${published ? '' : 'hidden'}>公開を停止</button></div></form>`;
}
document.addEventListener('click', event => {
  const card = event.target.closest('[data-card-flip]');
  if (!card) return;
  const flipped = card.classList.toggle('is-flipped');
  card.setAttribute('aria-pressed', String(flipped));
  card.setAttribute('aria-label', flipped ? '名刺を表に戻す' : '名刺を裏返す');
  card.querySelectorAll('.business-card__face').forEach((face, i) => face.setAttribute('aria-hidden', String(i === (flipped ? 0 : 1))));
});
