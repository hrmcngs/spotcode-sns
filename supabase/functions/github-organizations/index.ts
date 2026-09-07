import { organizationForVerification, verifyOrganizationFile, publicGithub, verificationPath } from './file-verification.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { verifiedOrganizations, authorizedRepositories, githubPages } from './github.ts';

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
    if (organizationAccount) {
      if (body.action === 'issue_file') {
        const org = await organizationForVerification(String(body.organization_login || '').trim());
        const token = 'spotcode-org-verification:' + user.id + ':' + crypto.randomUUID() + crypto.randomUUID();
        const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const { error } = await admin.from('github_org_file_challenges').upsert({ account_id: user.id, org_id: org.id, login: org.login, token, expires_at });
        if (error) throw new Error('確認コードを発行できません。Organizationファイル確認用SQLを適用してください。');
        return Response.json({ login: org.login, path: '.github/' + verificationPath, content: token, expires_at,
          create_url: 'https://github.com/' + org.login + '/.github/new/HEAD?filename=' + verificationPath }, { headers: cors });
      }
      if (body.action === 'confirm_file') {
        const { data: challenge, error } = await admin.from('github_org_file_challenges').select('*').eq('account_id', user.id).maybeSingle();
        if (error || !challenge || Date.parse(challenge.expires_at) <= Date.now()) throw new Error('確認コードを発行し直してください。');
        await verifyOrganizationFile(challenge.org_id, challenge.login, challenge.token);
        const { error: confirmed } = await admin.rpc('confirm_github_org_file', { p_account: user.id, p_token: challenge.token });
        if (confirmed) throw new Error('承認を保存できません。確認コードを発行し直してください。');
      }
      if (Object.prototype.hasOwnProperty.call(body, 'organization_id')) throw new Error('Organizationは確認ファイルを追加して承認してください。');
      const { data: link, error } = await admin.from('github_org_accounts').select('*').eq('account_id', user.id).maybeSingle();
      if (error) throw new Error('Organizationの設定を取得できません。');
      if (!link || link.verification_method !== 'file') return Response.json({ organizations: [], linked: null, repositories: [] }, { headers: cors });
      try { await verifyOrganizationFile(link.org_id, link.login, link.verification_token); }
      catch (error) {
        await admin.rpc('replace_github_org_memberships', { p_user: user.id, p_github_user: 0, p_organizations: [] });
        throw error;
      }
      const memberships = [{ id: link.org_id, login: link.login, role: 'organization_file' }];
      const { error: syncError } = await admin.rpc('replace_github_org_memberships', { p_user: user.id, p_github_user: 0, p_organizations: memberships });
      if (syncError) throw new Error('Organizationの所属確認を保存できません。');
      const repositories: unknown[] = [];
      if (body.repositories) {
        const { data: savedToken } = await caller.rpc('get_github_private_issue_token');
        const repositoryToken = typeof body.github_token === 'string' && body.github_token ? body.github_token : savedToken;
        if (typeof repositoryToken === 'string' && repositoryToken) {
          const rows = await githubPages('/orgs/' + encodeURIComponent(link.login) + '/repos?type=all', repositoryToken);
          repositories.push(...rows.filter(repo => repo.owner?.id === link.org_id));
        } else {
          for (let page = 1; page <= 100; page++) {
            const batch = await publicGithub('/orgs/' + encodeURIComponent(link.login) + '/repos?type=public&per_page=100&page=' + page);
            if (!Array.isArray(batch)) throw new Error('リポジトリを取得できません。');
            repositories.push(...batch.filter(repo => repo.owner?.id === link.org_id && !repo.private));
            if (batch.length < 100) break;
            if (page === 100) throw new Error('リポジトリ取得件数の上限を超えました。');
          }
        }
      }
      return Response.json({ organizations: memberships, linked: { org_id: link.org_id, login: link.login }, repositories }, { headers: cors });
    }
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
