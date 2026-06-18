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

1. 通常のサイト UI（`/signup`）から、以下の **完全に別の** 2 メールでアカウントを 2 つ作成する：
   - **公式**: `hrmc.ngs+official@gmail.com` → handle `spotcode_official` / 表示名 `spotcode`
     → 通知・確認メールは `hrmc.ngs@gmail.com`（メイン受信箱）に届く。
   - **dev テスト**: `hrmcngs.dev@gmail.com` → handle `spotcode_dev` / 表示名 `spotcode dev`
     → 通知・確認メールは **別の受信箱**（`hrmcngs.dev@gmail.com`、ドット無し = 別 Gmail アカウント）に届く。
     これで公式と dev の通知が完全に分離されます。
2. パスワードは別々に強いものを設定。公式の方は管理者 + 運営者（hrmcngs / aya526dev）で安全な経路で共有する。
3. 公式として投稿したいときは、画面右上のアバター → アカウント切り替えメニューで `@spotcode_official` を選択してから投稿。終わったら自分のアカウントに戻す。
4. dev アカウントは QA 用 — 公式アカウントを操作する admin/op に渡す必要はない。
5. （オプション）公式アカウントを目立たせたい場合は、`docs/supabase-schema.sql` の Stage 15 の `is_admin` と同じ要領で、Supabase SQL Editor から `update profiles set role = 'programmer' where handle = 'spotcode_official';` のような単純なフラグ更新を実行する。
