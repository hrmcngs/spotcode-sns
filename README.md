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

`@spotcode_official` を管理者・運営者が共有して投稿できるブランドアカウントとして、`@spotcode_dev` をテスト用ユーザーとして設定する手順。Supabase の `auth.users` は service_role が無いと作れないので、サインアップは UI 経由で行います。

1. 通常のサイト UI（`/signup`）から、以下のメールでアカウントを 2 つ作成する：
   - `dev+official@gmail.com` → handle `spotcode_official` / name `spotcode`（または好きな表示名）
   - `dev+test@gmail.com`     → handle `spotcode_dev`      / name `spotcode dev`
   Gmail の `+` エイリアスで `atsn.ngs@gmail.com` の受信箱に届きます。
2. Supabase SQL Editor で `docs/supabase-schema.sql` の Stage 23 ブロックを実行する。
3. 末尾の bootstrap 行のコメントを外して 1 回だけ実行する：
   ```sql
   update public.profiles set is_official = true where handle = 'spotcode_official';
   ```
4. 管理者 / 運営者でログインすると Composer に `@spotcode_official` トグルが出る。ON にして投稿すると author が公式アカウントに切り替わります（RLS でサーバー側も再チェック）。
