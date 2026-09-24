# セキュリティ監査後の修正（Stage 53）

Cloudflare `security-audit` の監査で得たソース上の問題に対する修正です。
コードと回帰テストを追加しましたが、DB マイグレーション、本番デプロイ、実機確認は未実施です。
「修正済み」は実装の状態であり、実環境で安全性を実証したという意味ではありません。

## 変更内容

| 対象 | 変更 |
| --- | --- |
| 管理権限 | クライアントからの `is_admin` / `is_operator` / `is_official` の INSERT・UPDATE を拒否。SQL 管理者による設定は維持。 |
| MFA | verified factor があるユーザーには `aal2` を要求。公開テーブルの restrictive RLS と、公開された SECURITY DEFINER RPC 内のチェックで実施。未登録ユーザーの通常ログインは維持。 |
| 非公開アカウントのフォロー | クライアントの新規フォローは承認待ちに固定。既存フォローのユーザー ID の差し替えを拒否。 |
| 公開範囲のメンバー | `close_friend_ids` / `org_member_ids` で判定。ハンドル名の変更・再利用で権限が移らないようにする。 |
| リポスト・ブックマーク | 残存する広すぎる SELECT ポリシーを置換。ブックマーク情報は登録者または投稿者に限定。 |
| コメント・いいね・リポスト | INSERT 時に親投稿を閲覧できることを要求。 |
| ブロック | 任意の投稿 ID の存在を応答から判別できないよう、投稿コンテキストを一律に無視。アカウントのブロックと運営向け記録は維持。 |
| 投票 | 投稿の閲覧権限、選択肢の範囲、期限、投票行の不変 ID を検証。期限内の選び直しは維持。 |
| Web 表示 | プロフィールの文字列と属性をエスケープ。アバター URL は CSS と HTML 属性の両方の文脈で処理。 |
| Web・ネイティブのキャッシュ | 投稿プレビューに所有アカウントを記録。所有者不明の旧形式を破棄し、切替前に開始した通信の結果を拒否。 |

MFA の設計は [Supabase の MFA / RLS ガイド](https://supabase.com/docs/guides/auth/auth-mfa#enforce-rules-for-mfa-logins)の opt-in enforcement に対応します。
ネイティブの保存済みセッション復帰・アカウント切替にも二次認証の判定を追加しています。Web のパスワード確認は一時クライアントで行い、現在の二次認証済みセッションを置き換えません。
近距離表示の位置制限は既存の表示機能として維持しています。

## 適用

1. 分離した検証環境で下記の回帰テストと、通常のログイン・投稿・フォロー・公開範囲編集を確認する。
2. 既存 DB が Stage 52 まで適用済みなら [053-security-boundaries.sql](migrations/053-security-boundaries.sql) を SQL 管理者として適用する。新規設定・通常の統合更新は従来どおり [supabase-schema.sql](supabase-schema.sql) の全文を使用する。両方を順番に実行する必要はない。
3. 更新した Web / Electron とネイティブアプリを配布する。UUID 列がない旧 DB では新しい公開範囲編集は使用できない。Stage 53 適用後、旧クライアントのハンドル名だけによるメンバー変更は拒否される。
4. MFA 登録済みアカウントの一次認証だけのセッションで DB / RPC が拒否され、二次認証後は通常操作が成功することを確認する。未登録・未検証 factor のアカウントも確認する。

移行前から存在する管理者権限と承認済みフォローは自動解除しません。正当な付与との区別ができないため、運営側で既存の管理権限・非公開アカウントの承認済みフォローを点検してください。
メンバーの UUID 化は初回適用時のハンドル名から一度だけ解決します。過去に再利用されたハンドル名の元所有者は復元できないため、既存の親しい友達・組織メンバーも確認してください。再適用時には UUID を再解決しません。

ブロックによる運営記録には投稿 ID が入らなくなります。投稿自体の報告は既存の通報機能を使用します。
将来 RLS テーブルや SECURITY DEFINER RPC を追加する際も、MFA 条件を追加してください。

## 検証状況

実施済み: 変更した JavaScript と回帰テストの構文確認、変更した Swift 4 ファイルの `swiftc -frontend -parse` による構文確認、差分の空白チェック、SQL の統合版と個別移行の一致確認、独立したソースレビュー。

未実施: 回帰テストの実行、SQL 実行、Swift の型チェック・ビルド、ブラウザー・実機テスト。
監査スキルは対象コードの実行に、外部通信の禁止、環境変数の明示的許可リスト、対象とツールチェーンの読み取り専用化、作業領域以外への書き込み禁止、CPU・メモリ・プロセス数・ファイルサイズ・ディスク・実行時間の上限を OS で強制することを求めています。この端末では全条件を満たす環境を用意できなかったため、対象コードは実行していません。

以下を条件を満たすオフライン環境で実行します。依存関係は事前配置し、実ユーザー・認証情報・本番接続を使わないでください。SQL テストはローカル PGlite のダミー Auth / Vault を使用します。

```sh
node scripts/test-supabase-schema.mjs
node scripts/test-security-boundaries.mjs
node scripts/test-profile-rendering-security.mjs
node scripts/test-timeline-cache-isolation.mjs
node scripts/test-audience-identity-settings.mjs
node scripts/test-password-verification-security.mjs
node scripts/test-native-timeline-account-cache.mjs
node scripts/test-native-audience-identities.mjs
node scripts/test-native-mfa-session-gate.mjs
node scripts/test-session-persistence.mjs
```

追加の公開範囲編集テストと実機検証では、選択した相手の改名と旧ハンドルの別人による取得を挟み、保存・再送しても選択した UUID が変わらないことを確認します。キャッシュは同一アカウントでの再読込、A → B、A → ログアウト、A → B → A、切替前の通信が遅れて完了する場合を確認します。
