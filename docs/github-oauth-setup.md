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
- `spotcode://github-oauth` (iOS の非公開 Issue 認証)
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
   redirectTo: window.location.href, scopes: 'read:user' }})` を呼ぶ
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
