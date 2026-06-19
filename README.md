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

`@spotcode_official` は **誰もログインできない仮想アカウント** — auth.users にはランダムパスワード（誰も知らない）の行が 1 つあるだけで、admin / operator は自分のセッションのまま **「公式として投稿」モードに切り替え** て発信します。Stage 25 RLS が `author_id = official AND auth.uid() が admin/op` を検証するので、許可された人だけが公式として投稿できます。

`@spotcode_dev` は完全に別の通常テストアカウントです。

### セットアップ手順

1. **公式アカウント** — `docs/supabase-schema.sql` の **Stage 25** ブロックを Supabase SQL Editor で実行するだけ。末尾の `do $$ … end $$` ブロックが
   - `auth.users` にランダムパスワード（不可逆ハッシュ）の sentinel ユーザー (`official@spotcode-sns.local`) を作成
   - `profiles` に handle `spotcode_official` / 表示名 `spotcode` / `is_official = true` の行を upsert
     を冪等に行います。サインアップ画面で何もする必要はありません。誰もこの auth.users にログインできません（パスワードは生成時にしか存在せず、保存もされない）。
2. **dev テストアカウント** — サイトの `/signup` で email フィールドに **`dev.test.account`** とだけ入力（`src/js/login-aliases.js` が `dev.test.account@spotcode-sns.local` に展開、配信なし）→ handle `spotcode_dev` / 表示名 `spotcode dev`。パスワードはパスワードマネージャー保存。
3. dev テストアカウントは **管理者・運営者の権限を一切持たない** 普通のユーザー — `src/js/dev-mode.js` の `ADMIN_HANDLES` / `OPERATOR_HANDLES` リストに入れないこと。
4. 管理者 / 運営者でログインすると、アバター → アカウント切り替えメニューに **「公式」** 行が出ます。クリックすると…
   - トップバー / コンポーザーのアバターが公式に切り替わる
   - コンポーザーに「@spotcode_official として投稿します — 自分に戻る」バナーが出る
   - 次の投稿は `@spotcode_official` の author で保存される（RLS が再確認）
   - 自分の行 or バナーの「自分に戻る」で解除
