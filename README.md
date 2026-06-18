# spotcode-sns

スポット（位置情報）に紐付くアイデアと、それを実装した GitHub リポを残せる開発者 SNS。
**Web + Electron** デュアルターゲット。

## 機能（実装中）

- 📊 **ファイルサイズで色が変化** — 一目で編集量
- 🟢 **ステータスバッジ** — active / WIP / released …
- 🌱 **活動の草** — 53週分の heatmap
- 📍 **スポット紐付け** — 位置でアイデアを残す
- 💡 **アイデア投稿** — その場で思いついた事を書き込み
- 🔗 **GitHub リンク** — 実装方法を共有

## 起動

```bash
# Web
npm run start:web         # http://localhost:8080

# Electron (要: npm install で electron をインストール)
npm install
npm run start:electron

# App
npm run cap:open:ios   
```

## 構成

```
src/        ← Web/Electron 共通のフロントエンド
electron/   ← Electron ラッパ（main.js / preload.js）
data/       ← モックデータ
docs/       ← 設計メモ
.github/    ← Pages デプロイ workflow
```

## 公式アカウント + dev テストアカウントのセットアップ（一度だけ）

`@spotcode_official` を管理者・運営者が共有して投稿できるブランドアカウント、`@spotcode_dev` を完全に別のテスト用アカウントとして設定する手順。Supabase の `auth.users` は service_role が無いと作れないので、サインアップは UI 経由で行います。**特別な RLS / トグルは不要** — 普通のアカウント 2 つです。

1. 通常のサイト UI（`/signup`）から、以下の 2 メールでアカウントを 2 つ作成する：
   - **公式**: `hrmc.ngs+official@gmail.com` → handle `spotcode_official` / 表示名 `spotcode`
     → 通知・確認メールは Gmail の `+` エイリアスでまとめて `hrmc.ngs@gmail.com`（メイン受信箱）に届く。
   - **dev テスト**: `dev.test.account@gmail.com` → handle `spotcode_dev` / 表示名 `spotcode dev`
     → Gmail はドットを無視するので実体は `devtestaccount@gmail.com`（=メインとは **別の Gmail アカウント**）。**通知をまとめたい場合は** その別アカウント側で Gmail 設定 → 転送先 = `hrmc.ngs@gmail.com` を有効にすると、ログイン通知やパスワードリセットメールがメイン受信箱に流れます。
2. パスワードはそれぞれ別に強いものを設定（パスワードマネージャー推奨、チャットや README には絶対に書かない）。公式の方は管理者 + 運営者（hrmcngs / aya526dev）と安全な経路で共有する。dev テストは hrmcngs 個人用。
3. dev テストアカウントは **管理者・運営者の権限を一切持たない** 普通のユーザー — `src/js/dev-mode.js` の `ADMIN_HANDLES` / `OPERATOR_HANDLES` リストに入れないこと。QA で「一般ユーザー視点で何が見えるか」を確認するのが目的。
4. 公式として投稿したいときは、画面右上のアバター → アカウント切り替えメニューで `@spotcode_official` を選択してから投稿。終わったら自分のアカウントに戻す（管理者・運営者にはメニューに 「公式」 行が出ます）。
5. （オプション）公式アカウントを目立たせたい場合は、`docs/supabase-schema.sql` の Stage 15 の `is_admin` と同じ要領で、Supabase SQL Editor から `update profiles set role = 'programmer' where handle = 'spotcode_official';` のような単純なフラグ更新を実行する。
