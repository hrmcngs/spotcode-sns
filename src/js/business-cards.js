import { t } from './i18n.js';
import { getClient } from './supa.js';
import { currentUser } from './auth.js';

export const themes = { midnight: t("ミッドナイト"), paper: t("ペーパー"), aurora: t("オーロラ"), mono: t("Mono"), ghost: t("Ghost"), spring: t("春"), summer: t("夏"), autumn: t("秋"), winter: t("冬") };
export const baseColors = [['#18181b',t("チャコール")],['#1d4ed8',t("ブルー")],['#4f46e5',t("インディゴ")],['#7c3aed',t("パープル")],['#be185d',t("ピンク")],['#b91c1c',t("レッド")],['#c2410c',t("オレンジ")],['#0f766e',t("ティール")],['#15803d',t("グリーン")],['#f4e8d0',t("アイボリー")],['#e5e7eb',t("グレー")],['#ffffff',t("ホワイト")]];
export function paletteFromBase(value, pattern = 'gradient', theme = 'midnight') {
  const frontColor = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#18181b';
  const rgb = frontColor.slice(1).match(/../g).map(v => parseInt(v,16));
  let back = pattern === 'solid' ? rgb : rgb.map(v => Math.round(v * 0.45));
  if (theme === 'aurora' && pattern !== 'solid') {
    const [r,g,b] = rgb.map(v => v / 255), max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max-min;
    let hue = delta === 0 ? 0 : max === r ? ((g-b)/delta+6)%6 : max === g ? (b-r)/delta+2 : (r-g)/delta+4;
    hue = (hue + 1.67) % 6;
    const saturation = Math.max(0.6, max === 0 ? 0 : delta/max), brightness = Math.max(0.55,max*0.85);
    const c = brightness*saturation, x = c*(1-Math.abs(hue%2-1)), m = brightness-c;
    const channels = hue<1?[c,x,0]:hue<2?[x,c,0]:hue<3?[0,c,x]:hue<4?[0,x,c]:hue<5?[x,0,c]:[c,0,x];
    back = channels.map(v => Math.round((v+m)*255));
  }
  const luminance = values => values.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum,v,i) => sum + v * [0.2126,0.7152,0.0722][i],0);
  const textColor = 1.05 / (luminance(rgb) + 0.05) >= (luminance(back) + 0.05) / 0.05 ? '#ffffff' : '#000000';
  return { frontColor, backColor: '#' + back.map(v => v.toString(16).padStart(2,'0')).join(''), textColor, accentColor: textColor };
}
export function defaultDesign(theme = 'midnight', layout = 'classic') {
  const extras = { mono:['#18181b','#3f3f46','#fafafa','#d4d4d8'], ghost:['#e8edf5','#b8c5dc','#172033','#566887'], spring:['#ffe4ed','#d9efde','#482c3c','#9b4766'], summer:['#cffafe','#38bdf8','#083344','#075985'], autumn:['#ffedd5','#d97706','#431407','#7c2d12'], winter:['#eff6ff','#a5c7e7','#172554','#36588a'] };
  const palette = extras[theme] ?? (theme === 'paper' ? ['#fffdf4','#e7dfca','#29251f','#876c37']
    : theme === 'aurora' ? ['#34265b','#187e80','#f8fafc','#91efdf'] : ['#222e49','#0b1020','#f8fafc','#9fb5ef']);
  return { frontColor: palette[0], backColor: palette[1], textColor: palette[2], accentColor: palette[3],
    font: theme === 'mono' ? 'mono' : 'sans', nameSize: 26, radius: 18, pattern: 'gradient', frontAlign: layout, backAlign: layout,
    frontLabel: 'SPOTCODE / BUSINESS CARD', backLabel: 'LET’S CONNECT', orientation: 'landscape', cornerStyle: 'rounded', imagePlacement: 'inline' };
}
export function normalizeDesign(value, theme, layout) {
  const defaults = defaultDesign(theme, layout);
  const d = value && typeof value === 'object' ? value : {};
  const result = { ...defaults };
  if (Object.hasOwn(themes, d.themeVariant)) result.themeVariant = d.themeVariant;
  for (const key of ['frontColor','backColor','textColor','accentColor']) {
    if (/^#[0-9a-f]{6}$/i.test(d[key])) result[key] = d[key];
  }
  for (const [key, allowed] of Object.entries({imagePlacement:['inline','artwork'],orientation:['landscape','portrait'],cornerStyle:['rounded','square','diagonal','diagonalReverse'],font:['sans','serif','mono'],pattern:['solid','gradient','stripe'],frontAlign:['classic','centered','right'],backAlign:['classic','centered','right']})) {
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
  const theme = Object.hasOwn(themes, design.themeVariant) ? design.themeVariant : value.theme;
  for (const key of Object.keys(defaultDesign())) if (Object.hasOwn(value, 'design_' + key)) design[key] = value['design_' + key];
  const links = inputLinks(value).map(link => ({ label: String(link?.label ?? '').trim().slice(0,40), url: cardWebURL(link?.url) })).filter(link => link.url);
  return { image_url: cardImageURL(value.image_url), image_link: cardWebURL(value.image_link),
    image_side: value.image_side === 'back' ? 'back' : 'front', image_shape: value.image_shape === 'round' ? 'round' : 'square',
    image_size: Number.isFinite(Number(value.image_size)) && value.image_size !== '' && value.image_size != null ? Math.round(Math.max(48, Math.min(100, Number(value.image_size)))) : 64,
    links_side: value.links_side === 'back' ? 'back' : 'front', links, design: normalizeDesign(design, theme, value.layout), name: text('name', 60), title: text('title', 100), bio: text('bio', 280), contact: text('contact', 160),
    theme: Object.hasOwn(themes, theme) ? theme : 'midnight',
    layout: value.layout === 'centered' ? 'centered' : 'classic' };
}
export function cardLink(handle) {
  return 'https://hrmcngs.github.io/spotcode-sns/#/' + encodeURIComponent(handle) + '/card';
}
function check(result) {
  if (result.error) throw new Error(t("名刺を読み込み・保存できませんでした。接続を確認して再試行してください。"));
  return result.data;
}
function actor() {
  const me = currentUser();
  if (!me?.id) throw new Error(t("ログインしてください。"));
  return me.id;
}
export async function loadCard(handle) {
  const db = await getClient();
  const profile = check(await db.from('profiles').select('id,handle,name').eq('handle', handle).maybeSingle());
  if (!profile) throw new Error(t("ユーザーが見つかりません。"));
  const card = check(await db.from('business_cards').select('*').eq('owner_id', profile.id).maybeSingle());
  return { profile, card };
}
export async function saveCard(value) {
  const owner_id = actor();
  for (const link of [...inputLinks(value), { url: value.image_link }]) {
    if (String(link?.url ?? '').trim() && !cardWebURL(link.url)) throw new Error(t("リンクは http:// または https:// から始まるURLを入力してください。"));
  }
  if (String(value.image_url ?? '').trim() && !cardImageURL(value.image_url)) throw new Error(t("画像を選び直すか、http(s)形式の画像URLを入力してください。"));
  const card = normalizeCard(value);
  if (!['midnight','paper','aurora'].includes(card.theme)) {
    card.design.themeVariant = card.theme;
    card.theme = 'midnight';
  }
  if (!card.name) throw new Error(t("名刺に表示する名前を入力してください。"));
  const db = await getClient();
  return check(await db.from('business_cards').upsert({ ...card, owner_id }).select().single());
}
export async function collectCard(owner_id) {
  const collector_id = actor();
  if (collector_id === owner_id) throw new Error(t("自分の名刺はコレクションに追加できません。"));
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
