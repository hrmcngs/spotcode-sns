import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { verifiedOrganizations, authorizedRepositories } from './github.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
  try {
    const authorization = request.headers.get('Authorization') || '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { data: { user }, error: authError } = await caller.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));
    if (authError || !user) return Response.json({ error: 'ログインしてください' }, { status: 401, headers: cors });
    const body = await request.json();
    const identities = (user.identities || []).filter(i => i.provider === 'github');
    const ids = identities.flatMap(i => [i.identity_data?.provider_id, i.identity_data?.sub, i.identity_data?.id]).filter(v => v != null).map(String);
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const { data: profile, error: profileError } = await admin.from('profiles').select('is_org').eq('id', user.id).single();
    if (profileError) throw new Error('アカウントを確認できません');
    const organizationAccount = profile?.is_org === true;
    if (!ids.length && !organizationAccount) throw new Error('先にプロフィールからGitHubを連携してください');
    const stored = body.github_token ? null : await caller.rpc('get_github_private_issue_token');
    const token = body.github_token || stored?.data;
    if (typeof token !== 'string' || !token) throw new Error('GitHub Organizationを再連携してください');
    const verified = await verifiedOrganizations(token, ids, fetch, organizationAccount);
    if (Object.prototype.hasOwnProperty.call(body, 'organization_id')) {
      if (body.organization_id == null) {
        const { error } = await admin.from('github_org_accounts').delete().eq('account_id', user.id);
        if (error) throw new Error('Organizationの連携解除に失敗しました');
      } else {
        const org = verified.organizations.find(org => org.id === body.organization_id && org.role === 'admin');
        if (!org || !profile?.is_org) throw new Error('組織アカウントに切り替え、管理者を務めるOrganizationを選んでください');
        const { error } = await admin.from('github_org_accounts').upsert({ account_id: user.id, org_id: org.id, login: org.login });
        if (error) throw new Error('Organizationの連携に失敗しました');
        const { error: updateError } = await admin.from('profiles').update({ github_handle: org.login, github_verified: true }).eq('id', user.id);
        if (updateError) throw new Error('Organizationのプロフィール更新に失敗しました');
      }
    }
    const { data: linked, error: linkError } = await admin.from('github_org_accounts').select('org_id,login').eq('account_id', user.id).maybeSingle();
    if (linkError) throw new Error('Organizationの設定を取得できません');
    // An organization account receives membership only in its selected org,
    // and only while the supplied GitHub grant belongs to an active owner.
    const memberships = organizationAccount ? verified.organizations.filter(org => org.id === linked?.org_id) : verified.organizations;
    const { error: syncError } = await admin.rpc('replace_github_org_memberships', {
      p_user: user.id, p_github_user: verified.user.id, p_organizations: memberships,
    });
    if (syncError) throw new Error('Organization同期用のDB更新を適用してください');
    const repositories = body.repositories ? await authorizedRepositories(token, organizationAccount ? -1 : verified.user.id, memberships) : undefined;
    return Response.json({ organizations: verified.organizations, linked, repositories }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Organizationの確認に失敗しました' }, { status: 400, headers: cors });
  }
});
