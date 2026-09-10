# プロフィール操作・投稿通知

Web / SwiftUI iOS 共通:

- 他ユーザーのプロフィールの **More** からミュート／解除、ブロック／解除。
- プロフィールの **Following** から「親しい友達」「同じ組織」への登録／解除とフォロー解除。
- 自分の **Following一覧** でも同じ公開対象リストを編集。
- 通知設定の **投稿と地区の通知** で `OFF` / `相互フォロー` / `フォロー中` を選択。初期値はOFF。

公開対象リストとミュート・ブロックはアカウントごとにDBへ保存します。登録は承認済みのフォローが対象です。「同じ組織」は既存の投稿公開対象リストで、GitHub Organizationの所属確認とは別です。

投稿通知は閲覧権限がある投稿だけを対象にし、実際の投稿者・組織名義のどちらかがミュート／ブロックされている場合は除外します。地区は投稿の `spot.addressDetails.city` を優先し、既存の日本語住所は市区町村までを抽出します。位置のない投稿は「地区未設定」です。

通知一覧は閲覧時に取得します。新着バナーはOSの通知許可が必要です。Webはタブが表示されている間、iOSはアプリがアクティブな間に60秒間隔で確認します。初回取得では過去の投稿のバナーは出しません。アプリ終了中のAPNs配信は今回の実装には含みません。通知の種類・対象設定は各端末に保存します。

## 反映・検証

`docs/migrations/044-social-controls.sql` を適用し、Webをデプロイ、iOSを再ビルドします。Stage 43（ブロック）と既存のprofiles / follows / postsが前提です。DB更新は再実行できます。

- `node scripts/test-social-controls-client.mjs`
- `PGLITE_MODULE=<PGlite module path> node scripts/test-social-controls.mjs`
- `xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`
