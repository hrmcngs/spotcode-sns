import { currentUser, refreshProfile } from './auth.js';
import { getClient } from './supa.js';

function key() { return 'spotcode.social-controls.' + (currentUser()?.id || 'guest'); }
function saved() {
  try { const value = JSON.parse(localStorage.getItem(key()) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
export function isUserMuted(handle) { return (saved().mutes || []).some(u => u.handle === handle); }
export function isUserBlocked(handle) { return (saved().blocks || []).some(u => u.handle === handle); }
export function isHiddenUser(handle, id) {
  const value = saved();
  return [...(value.mutes || []), ...(value.blocks || [])].some(u => u.handle === handle || (id && u.id === id));
}
export async function hydrateSocialControls() {
  const owner = currentUser()?.id;
  if (!owner) return false;
  const storageKey = key();
  const client = await getClient();
  const results = await Promise.all([
    client.from('user_mutes').select('target:profiles!user_mutes_muted_id_fkey(id,handle)').eq('user_id', owner),
    client.from('user_blocks').select('target:profiles!user_blocks_blocked_id_fkey(id,handle)').eq('blocker_id', owner),
  ]);
  if (currentUser()?.id !== owner) return false;
  const value = saved();
  results.forEach((result, index) => {
    if (!result.error) value[index === 0 ? 'mutes' : 'blocks'] = (result.data || []).map(r => r.target).filter(Boolean);
  });
  const next = JSON.stringify(value);
  const changed = localStorage.getItem(storageKey) !== next;
  localStorage.setItem(storageKey, next);
  return changed;
}
export async function setUserControl(handle, kind, enabled) {
  const owner = currentUser()?.id;
  if (!owner) throw new Error('ログインしてください');
  if (!['mutes', 'blocks'].includes(kind)) throw new Error('無効な操作です');
  const client = await getClient();
  const { data: target, error: lookupError } = await client.from('profiles').select('id,handle').eq('handle', handle).single();
  if (lookupError) throw lookupError;
  if (currentUser()?.id !== owner) throw new Error('アカウントが変更されました');
  if (target.id === owner) throw new Error('自分自身は選択できません');
  const result = kind === 'blocks'
    ? enabled ? await client.rpc('block_user', { p_target: target.id })
      : await client.from('user_blocks').delete().eq('blocker_id', owner).eq('blocked_id', target.id)
    : enabled ? await client.from('user_mutes').upsert({ user_id: owner, muted_id: target.id }, { onConflict: 'user_id,muted_id', ignoreDuplicates: true })
      : await client.from('user_mutes').delete().eq('user_id', owner).eq('muted_id', target.id);
  if (result.error) throw result.error;
  if (currentUser()?.id !== owner) return;
  const value = saved();
  value[kind] = (value[kind] || []).filter(u => u.id !== target.id);
  if (enabled) value[kind].push(target);
  localStorage.setItem(key(), JSON.stringify(value));
}
export async function setAudienceMember(handle, kind, enabled) {
  const owner = currentUser()?.id;
  if (!owner) throw new Error('ログインしてください');
  const client = await getClient();
  const { data, error: lookupError } = await client.from('profiles').select('id').eq('handle', handle).single();
  if (lookupError) throw lookupError;
  if (currentUser()?.id !== owner) throw new Error('アカウントが変更されました');
  const { error } = await client.rpc('set_audience_member', { p_target: data.id, p_kind: kind, p_enabled: enabled });
  if (error) throw error;
  if (currentUser()?.id === owner) await refreshProfile();
}
