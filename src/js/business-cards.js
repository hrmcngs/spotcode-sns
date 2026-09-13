import { getClient } from './supa.js';
import { currentUser } from './auth.js';

export const themes = { midnight: 'ミッドナイト', paper: 'ペーパー', aurora: 'オーロラ' };
export function normalizeCard(value = {}) {
  const text = (key, max) => String(value[key] ?? '').trim().slice(0, max);
  return { name: text('name', 60), title: text('title', 100), bio: text('bio', 280), contact: text('contact', 160),
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
