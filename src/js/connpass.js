// connpass URL / event-id helpers.
//
// spotcode-sns では投稿に「イベント」を紐付けられる (`posts.event_url`)。
// connpass はコアなユースケース (日本のテック勉強会) なので専用パーサを
// 用意して、投稿カード + `/event/<id>` ページで一貫した表示にする。
//
// public API (`GET https://connpass.com/api/v1/event/?event_id=X`) で
// タイトル / 日時 / 会場を取れるが、connpass の API は歴史的に CORS を
// 許可していない期間があり、ブラウザ直叩きが 403 になることがある。
// この場合は URL からパースした event id だけを badge に表示する
// フォールバックに落とす — 情報量は減るが投稿は失敗しない。

const CONNPASS_URL_RE = /^https?:\/\/([a-z0-9-]+\.)?connpass\.com\/event\/(\d+)\/?/i;

// URL からイベント ID を抽出する。connpass 以外 / 形が違うなら null。
export function parseConnpassUrl(input) {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(CONNPASS_URL_RE);
  if (!m) return null;
  return { id: m[2], url: 'https://connpass.com/event/' + m[2] + '/' };
}

// connpass の event URL かどうかを軽く判定 (composer で + イベントを
// 追加 ボタンから貼り付けたテキストのバリデーション用途)。
export function isConnpassUrl(input) {
  return !!parseConnpassUrl(input);
}

// キャッシュ: event id → { at, meta }. meta が null なら fetch を試みた
// が取れなかったことを表す (何度も同じ 403 を叩かない)。TTL 1 時間。
const META_KEY = 'spotcode:connpass-meta:v1';
const META_TTL_MS = 60 * 60 * 1000;

function readCache() {
  try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); }
  catch { return {}; }
}
function writeCache(o) {
  try { localStorage.setItem(META_KEY, JSON.stringify(o)); }
  catch {}
}

// Sync accessor — used by render paths that can't await.
export function cachedEventMeta(id) {
  if (!id) return null;
  const all = readCache();
  const e = all[String(id)];
  if (!e) return null;
  if (Date.now() - (e.at || 0) > META_TTL_MS) return null;
  return e.meta || null;
}

// connpass の公開 API を叩いてイベントメタデータを取る。CORS に阻まれた
// 場合は null を返してキャッシュ (fail-cache 5min にしたいが単純化して
// 通常 TTL と同じ 1h にしている — 1h に 1 回だけリトライ)。
export async function fetchEventMeta(id) {
  if (!id) return null;
  const cached = cachedEventMeta(id);
  if (cached) return cached;

  const url = 'https://connpass.com/api/v1/event/?event_id=' + encodeURIComponent(id);
  let meta = null;
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      // No credentials — the API is public and adding cookies would
      // hit CORS harder than plain fetch already does.
      credentials: 'omit',
    });
    if (res.ok) {
      const data = await res.json();
      const ev = (data && data.events && data.events[0]) || null;
      if (ev) {
        meta = {
          id:       String(ev.event_id),
          title:    ev.title || '',
          catch:    ev.catch || '',
          startedAt:ev.started_at || null,
          endedAt:  ev.ended_at || null,
          place:    ev.place || '',
          address:  ev.address || '',
          url:      ev.event_url || url,
          series:   (ev.series && ev.series.title) || null,
          hash:     ev.hash_tag || '',
          accepted: ev.accepted || 0,
          waiting:  ev.waiting || 0,
        };
      }
    }
  } catch { /* CORS / network — fall through to null cache */ }

  const all = readCache();
  all[String(id)] = { at: Date.now(), meta };
  writeCache(all);
  return meta;
}

// 表示用: YYYY-MM-DD (HH:MM) 短縮。connpass の started_at は ISO 8601
// (`2026-08-01T19:00:00+09:00`)。
export function formatEventStart(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + da + ' ' + hh + ':' + mm;
}
