import { getClient } from './supa.js';
import { currentUser } from './auth.js';

export const themes = { midnight: 'ミッドナイト', paper: 'ペーパー', aurora: 'オーロラ' };
export function defaultDesign(theme = 'midnight', layout = 'classic') {
  const palette = theme === 'paper' ? ['#fffdf4','#e7dfca','#29251f','#876c37']
    : theme === 'aurora' ? ['#34265b','#187e80','#f8fafc','#91efdf'] : ['#222e49','#0b1020','#f8fafc','#9fb5ef'];
  return { frontColor: palette[0], backColor: palette[1], textColor: palette[2], accentColor: palette[3],
    font: 'sans', nameSize: 26, radius: 18, pattern: 'gradient', frontAlign: layout, backAlign: layout,
    frontLabel: 'SPOTCODE / BUSINESS CARD', backLabel: 'LET’S CONNECT' };
}
export function normalizeDesign(value, theme, layout) {
  const defaults = defaultDesign(theme, layout);
  const d = value && typeof value === 'object' ? value : {};
  const result = { ...defaults };
  for (const key of ['frontColor','backColor','textColor','accentColor']) {
    if (/^#[0-9a-f]{6}$/i.test(d[key])) result[key] = d[key];
  }
  for (const [key, allowed] of Object.entries({font:['sans','serif','mono'],pattern:['solid','gradient','stripe'],frontAlign:['classic','centered','right'],backAlign:['classic','centered','right']})) {
    if (allowed.includes(d[key])) result[key] = d[key];
  }
  for (const [key,min,max] of [['nameSize',18,36],['radius',0,28]]) {
    if (d[key] !== '' && d[key] != null && Number.isFinite(Number(d[key]))) result[key] = Math.round(Math.min(max,Math.max(min,Number(d[key]))));
  }
  for (const key of ['frontLabel','backLabel']) if (typeof d[key] === 'string') result[key] = d[key].slice(0,40);
  return result;
}
export function cardWebURL(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2048) return '';
  try {
    const u = new URL(raw);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}
export function cardImageURL(value) {
  const raw = String(value ?? '').trim();
  if (raw.length > 1000000) return '';
  return /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(raw) ? raw : cardWebURL(raw);
}
function inputLinks(value) {
  if (Object.hasOwn(value, 'link_0_url')) return [0,1,2].map(i => ({ label: value['link_' + i + '_label'], url: value['link_' + i + '_url'] }));
  return Array.isArray(value.links) ? value.links.slice(0,3) : [];
}
export function normalizeCard(value = {}) {
  const text = (key, max) => String(value[key] ?? '').trim().slice(0, max);
  const design = { ...(value.design || {}) };
  for (const key of Object.keys(defaultDesign())) if (Object.hasOwn(value, 'design_' + key)) design[key] = value['design_' + key];
  const links = inputLinks(value).map(link => ({ label: String(link?.label ?? '').trim().slice(0,40), url: cardWebURL(link?.url) })).filter(link => link.url);
  return { image_url: cardImageURL(value.image_url), image_link: cardWebURL(value.image_link),
    image_side: value.image_side === 'back' ? 'back' : 'front', image_shape: value.image_shape === 'round' ? 'round' : 'square',
    image_size: Number.isFinite(Number(value.image_size)) && value.image_size !== '' && value.image_size != null ? Math.round(Math.max(48, Math.min(100, Number(value.image_size)))) : 64,
    links_side: value.links_side === 'back' ? 'back' : 'front', links, design: normalizeDesign(design, value.theme, value.layout), name: text('name', 60), title: text('title', 100), bio: text('bio', 280), contact: text('contact', 160),
    theme: Object.hasOwn(themes, value.theme) ? value.theme : 'midnight',
    layout: value.layout === 'centered' ? 'centered' : 'classic' };
}
export function cardLink(handle) {
  return 'https://hrmcngs.github.io/spotcode-sns/#/' + encodeURIComponent(handle) + '/card';
}
function check(result) {
  if (result.error) throw new Error('名刺を読み込み・保存できませんでした。接続を確認して再試行してください。');
  return result.data;
}
function actor() {
  const me = currentUser();
  if (!me?.id) throw new Error('ログインしてください。');
  return me.id;
}
export async function loadCard(handle) {
  const db = await getClient();
  const profile = check(await db.from('profiles').select('id,handle,name').eq('handle', handle).maybeSingle());
  if (!profile) throw new Error('ユーザーが見つかりません。');
  const card = check(await db.from('business_cards').select('*').eq('owner_id', profile.id).maybeSingle());
  return { profile, card };
}
export async function saveCard(value) {
  const owner_id = actor();
  for (const link of [...inputLinks(value), { url: value.image_link }]) {
    if (String(link?.url ?? '').trim() && !cardWebURL(link.url)) throw new Error('リンクは http:// または https:// から始まるURLを入力してください。');
  }
  if (String(value.image_url ?? '').trim() && !cardImageURL(value.image_url)) throw new Error('画像を選び直すか、http(s)形式の画像URLを入力してください。');
  const card = normalizeCard(value);
  if (!card.name) throw new Error('名刺に表示する名前を入力してください。');
  const db = await getClient();
  return check(await db.from('business_cards').upsert({ ...card, owner_id }).select().single());
}
export async function collectCard(owner_id) {
  const collector_id = actor();
  if (collector_id === owner_id) throw new Error('自分の名刺はコレクションに追加できません。');
  const db = await getClient();
  check(await db.from('business_card_collection').upsert({ collector_id, card_owner_id: owner_id },
    { onConflict: 'collector_id,card_owner_id', ignoreDuplicates: true }));
}
export async function removeCard(owner_id) {
  const collector_id = actor();
  const db = await getClient();
  check(await db.from('business_card_collection').delete().eq('collector_id', collector_id).eq('card_owner_id', owner_id));
}
export async function unpublishCard() {
  const owner_id = actor();
  const db = await getClient();
  check(await db.from('business_cards').delete().eq('owner_id', owner_id));
}
export async function loadCollection() {
  const collector_id = actor();
  const db = await getClient();
  return check(await db.from('business_card_collection')
    .select('card_owner_id,collected_at,card:business_cards(*,profile:profiles(handle))')
    .eq('collector_id', collector_id).order('collected_at', { ascending: false }));
}
