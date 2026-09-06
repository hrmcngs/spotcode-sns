# GitHub OAuth 連携のセットアップ

spotcode-sns のプロフィール画面「GitHub と連携」ボタンは、Supabase の
GitHub Auth Provider を経由して GitHub OAuth 認可を得ます。

静的サイト単体では `client_secret` を安全に扱えないので、Supabase 側に
secret を保持させ、client は `supa.auth.linkIdentity({ provider: 'github' })`
を呼ぶだけにしています。設定は 3 ステップ:

## 1. GitHub OAuth App を作る

<https://github.com/settings/developers> → **New OAuth App**

| 項目 | 値 |
| --- | --- |
| Application name | `spotcode-sns` (お好みで) |
| Homepage URL | `https://hrmcngs.github.io/spotcode-sns/` (本番) |
| Authorization callback URL | `https://<PROJECT_REF>.supabase.co/auth/v1/callback` |

`<PROJECT_REF>` は Supabase プロジェクトの ref (URL の
`https://<ref>.supabase.co` の部分)。**GitHub OAuth App (Homepage URL 側)
ではなく、Supabase のコールバック URL を書く**のがポイントです。GitHub は
コールバック URL の完全一致でしか受け付けないので、typo に注意。

作成後の画面で:

- **Client ID** をコピー
- **Generate a new client secret** をクリックして **Client Secret** をコピー

## 2. Supabase に貼り付ける

<https://supabase.com/dashboard/project/_/auth/providers> → **GitHub**

- **Enable Sign in with GitHub** を ON
- **Client ID** に GitHub のを貼る
- **Client Secret** に GitHub のを貼る
- **Save**

**Redirect URLs** (同じ Auth 設定画面の下の方) に本番 + ローカルを追加:

- `https://hrmcngs.github.io/spotcode-sns/**`
- `http://localhost:8080/**` (dev server)
- 必要なら Electron / iOS 用のカスタムスキーム
  (`capacitor://localhost/**`, `file://**`) — このリストにないと
  リダイレクトが弾かれる

## 3. profiles テーブルに必要なカラム

`github_handle` (text) と `github_verified` (bool) は Stage 3 以降で
用意済み。旧 bio/repo-token 方式の名残の `github_verify_token` は
使わなくなりましたが、column があっても問題なし
(`syncGithubIdentity` が null で上書きします)。

## 動作フロー (実装側)

1. ユーザーが `/settings` → プロフィール編集 → 「GitHub で連携する」
2. `src/js/github-oauth.js:linkGithub()` が
   `supa.auth.linkIdentity({ provider: 'github', options: {
   redirectTo: window.location.href, scopes: 'read:user read:org' }})` を呼ぶ
3. ブラウザが `https://github.com/login/oauth/authorize?...` にリダイレクト
4. ユーザーが Authorize すると GitHub が
   `https://<PROJECT_REF>.supabase.co/auth/v1/callback?code=...` に飛ばす
5. Supabase が token 交換をやって identity を auth ユーザーに紐付け、
   `redirectTo` (元の spotcode-sns URL) に戻す
6. ページがブート → `initAuth()` → `syncGithubIdentity()` が
   `auth.user.identities[]` から github identity を取り出し、
   `profiles.github_handle` と `github_verified=true` を書き込む
7. 次のレンダーからプロフィールに GitHub アイコン + 本人確認済み ✓

## トラブルシューティング

**「redirect_uri_mismatch」エラー** → GitHub OAuth App の callback URL
が `https://<PROJECT_REF>.supabase.co/auth/v1/callback` になっているか
確認。末尾スラッシュや https/http の食い違いで落ちます。

**「redirect not allowed」エラー** → Supabase Dashboard の Auth →
Redirect URLs に spotcode-sns のホストが登録されているか確認。ワイルドカード
(`/**`) は必須。

**リンクは完了したがプロフィールに反映されない** → ブラウザ Console で
`syncGithubIdentity` の警告を確認。`identity_data.user_name` が入って
いない場合は GitHub OAuth App のスコープに `read:user` が付いているか
確認 (デフォルトの `user` でも username は取れます)。

## Organization のリポジトリ・メンバー限定共有（Stage 38）

反映は次の順で行います。

1. `docs/migrations/038-github-organizations.sql` を Supabase SQL Editor で全文実行します。
2. Edge Function をデプロイします。

   ```sh
   supabase functions deploy github-organizations --no-verify-jwt
   ```

   この関数は冒頭で Supabase Auth の `getUser(jwt)` を使って呼び出し元を認証します。
   サービスロールキーは関数内だけで使用し、クライアントには渡しません。
3. Web・iOSを更新します。
4. プロフィールにGitHubを連携済みのアカウントで、設定 → アカウント → GitHub Organization →「Organizationを許可」を実行します。
5. GitHub側で対象Organizationへのアクセスを許可し、「所属を確認・更新」を押します。
6. 組織アカウントでは、自分がGitHub上で管理者を務めるOrganizationの「共有先に設定」を押します。
7. 投稿の表示先で「GitHub Organizationのみ」を選びます。閲覧するメンバー側も同じGitHub連携と所属確認が必要です。

通常のOrganization連携は `read:user read:org` を要求します。非公開リポジトリも使う場合は、既存の非公開Issue連携から追加の `repo` 権限を許可してください。リポジトリ一覧は本人所有と許可済みOrganization所有に限定し、他の個人の共同開発リポジトリは含めません。認証済みリポジトリ一覧は公開リポジトリ用のlocalStorageキャッシュに保存しません。

GitHubのOrganizationポリシーやSSOにより、別途Organization管理者の承認が必要な場合があります。OAuthのスコープだけではOrganization側の制限は解除されません。
[GitHub公式のリソース取得ガイド](https://docs.github.com/en/rest/guides/discovering-resources-for-a-user)

所属確認はサーバー側でGitHubのユーザーIDとSupabaseの連携済みidentityを照合し、アクティブかつOAuthで許可されたOrganizationだけを同期します。確認は1時間有効で、Webの投稿取得時・iOSのタイムライン取得時に再確認します。GitHubを解除したアカウントや有効期限切れの所属には閲覧権限を付与しません。GitHub側での脱退・権限取消は、次の成功した所属確認または有効期限切れまでに反映されます。

「同じ組織」は従来の手動メンバーリスト、「GitHub Organizationのみ」はGitHub確認済みメンバーです。各投稿は作成時のOrganization IDを保持し、アカウントの連携先を変更しても過去の投稿の共有先は変わりません。通常ユーザーから所属テーブル・組織アカウントの連携テーブルへの書き込みはできません。

検証用のGitHub APIテストは `node scripts/test-github-organizations.mjs` で実行できます（TypeScriptの型除去に対応したNode.jsを使用）。DBのRLSは、作成者・所属メンバー・非メンバー・管理者の通常/開発者モード、所属期限切れ、GitHub解除、所属偽装、連携先変更の各ケースで確認しています。

### Stage 39: メンバーによる組織リポジトリの投稿

Stage 38 の後に `docs/migrations/039-organization-post-attribution.sql` 全文を SQL Editor で実行し、Web / iOS を更新します。
GitHub のメンバー確認が有効なユーザーが、連携先 Organization の `owner/repository` または `https://github.com/owner/repository` を付けて新規投稿すると、組織アカウントの名前・アイコンで表示され、組織プロフィールにも掲載されます。リンク先リポジトリの実在確認はせず、Organization の所有者名と確認済みメンバー情報で判定します。
実際の投稿者は `author_id`、表示先の組織は `organization_author_id` に記録します。編集・削除権限と公開範囲は実際の投稿者を基準に維持し、「自分のみ」は組織の他のメンバーには公開しません。メンバーも対象リポジトリを指定して「GitHub Organizationのみ」を選べます。
同じ Organization に複数の組織アカウントが連携している場合は、誤ったアカウントに掲載しないよう投稿を止めます。設定で連携先を一つにしてください。既存投稿の一括変更は行わず、本文だけの編集や脱退・連携解除では過去の表示名義を変更しません。

#### 投稿一覧に relationship / schema cache エラーが出る場合

Stage 38 の実行後、更新版 `docs/migrations/039-organization-post-attribution.sql` の全文を再実行してください。既存列の外部キーが欠けている場合も補完し、最後に `NOTIFY pgrst, 'reload schema';` で API のスキーマキャッシュを更新します。その後ページを再読み込みします。キャッシュのみ更新する場合はこの NOTIFY 文だけを SQL Editor で実行できます（列や外部キーが未作成の場合には Stage 39 が必要です）。
Web / iOS の更新版は、新しい組織関連付けが未認識の場合に従来の投稿者情報で取得を再試行します。公開範囲と写真の取得は維持します。組織名義の表示を有効にするには SQL の反映が必要です。
参考: https://postgrest.org/en/stable/references/schema_cache.html
