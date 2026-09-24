# spotcode-sns

スポット（位置情報）に紐付くアイデアと、それを実装した GitHub リポを残せる開発者 SNS。
**Web + Electron** デュアルターゲット。

## Supabase の設定・更新

Supabase SQL Editorで **[docs/supabase-schema.sql](docs/supabase-schema.sql) の全文を1回実行**してください。新規設定・既存DBの更新ともに同じファイルを使います。名刺・レイヤー編集・インターネット交換・6文字コードまで含み、既存データを保持して再実行できます。

`docs/migrations/` と `docs/repairs/` は履歴・個別修復用に残しています。通常は順番に実行する必要はありません。SQLは1トランザクションで適用され、最後にAPIのスキーマキャッシュを更新します。任意のQAアカウントは自動作成せず、設定画面から作成します。OAuth・Storageの設定、Edge Functionのデプロイ、アプリの更新は別途必要です。

Stage 53 の権限制御・MFA・公開範囲・キャッシュ対策と、移行時の確認事項は [セキュリティ修正の適用・検証手順](docs/security-remediation.md) を参照してください。

## 機能（実装中）

-  **ファイルサイズで色が変化** — 一目で編集量
-  **ステータスバッジ** — active / WIP / released …
-  **活動の草** — 53週分の heatmap
-  **スポット紐付け** — 位置でアイデアを残す
-  **アイデア投稿** — その場で思いついた事を書き込み
-  **GitHub リンク** — 実装方法を共有

## 表示言語 / Display language

名刺の編集・共有・コレクション・近距離交換を含め、操作画面は日本語と英語に対応しています。初期言語は英語です。明示的に選択した日本語は維持します。投稿本文、プロフィール、名刺に入力した内容は自動翻訳しません。

- Web / Electron: 設定の言語選択で「日本語」または「English」を選びます。選択は端末に保存され、画面を再読み込みします。
- iOS / Mac: アプリの設定にある言語案内から、システム設定でアプリの言語を変更します。

Controls and messages, including business card editing, sharing, collections, and nearby exchange, support Japanese and English. English is the default; an explicit Japanese preference is preserved. User-authored content stays unchanged. Select a language in Web/Electron Settings, or change the app language in iOS/macOS system settings.

翻訳の回帰テスト:

```sh
node scripts/test-localization.mjs
sbcl --script scripts/test-ios.lisp localization
```

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

## macOS アプリ

Mac App Store用のネイティブ版は [提出手順](docs/macos-app-store.md) を参照してください。
`bash scripts/build-macos.sh` でMac CatalystのArchiveを作成できます。
提出用PKG・Archive・スクリーンショットは、プロジェクト直下の [`macos/`](macos/) にまとめています。

### Electron版（ローカル利用）

Web版と共通の画面をElectronアプリとして利用できます。macOS上で次を実行します。

```bash
npm ci
npm run start:electron                                  # 開発用に起動
npm run build:electron:mac -- --publish never            # Apple Silicon / Intel用を生成
```

生成先は `dist/` です。Apple Silicon（Mシリーズ）は `spotcode-sns-<version>-arm64.dmg`、
Intel Macは `spotcode-sns-<version>.dmg` を開き、アプリをApplicationsフォルダへドラッグします。
各アーキテクチャのZIPも生成されます。

現在の設定は署名・公証なしのローカル検証用です。一般配布にはApple Developerの署名・公証設定が必要です。
GitHubへの公開は上記コマンドでは行われません。

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

1. **公式アカウント** — `docs/supabase-schema.sql` の全文を Supabase SQL Editor で実行します。Stage 25 の `do $$ … end $$` ブロックが
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

## Supabase の自動稼働確認

`.github/workflows/supabase-keep-alive.yml` は3日ごと（日本時間 12:23）に
`@spotcode_dev` で稼働確認投稿を作成します。新しい投稿が正常に作成された後、
専用の接頭辞が付いた過去の自動投稿だけを削除するため、自動投稿は常に1件だけ残ります。
devアカウントから手動で作成した通常の投稿は削除しません。

利用前に、GitHub リポジトリの **Settings → Secrets and variables → Actions** で
Repository secret `DEV_ACCOUNT_PASSWORD` にdevテストアカウントのパスワードを登録してください。
登録後は **Actions → Supabase keep alive → Run workflow** で手動実行し、初回の動作を確認できます。
