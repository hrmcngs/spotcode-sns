# iOS app セットアップ（Web画面と端末機能）

iOS版の通常画面はWKWebViewで `https://hrmcngs.github.io/spotcode-sns/` を表示します。公開したWeb画面の変更は、次回起動や画面更新で反映されます。SwiftUI・MapKitによる既存画面はメニューの「端末の機能を開く」から利用できます。Mac Catalyst版は従来のSwiftUI画面を使用します。

この構成への切り替えには一度App Storeでの更新が必要です。以降も端末機能・権限・ネイティブコードの変更にはアプリの更新が必要です。Webサイトを使う画面構成であり、ネイティブコードの差し替えや審査の回避は行いません。

Web画面のログイン情報はWKWebsiteDataStoreに保持します。Safariや従来のネイティブ画面のログインとは別なので、移行後に一度ログインが必要な場合があります。Webとネイティブでrefresh tokenを共有しません。端末固有の通知・近接名刺交換・その他ネイティブ専用操作は従来画面から利用してください。

ネットワークに接続できない初回起動は、再試行・端末機能への切り替え画面になります。WebKitでService Workerが利用できる環境では、一度取得した画面・資産のキャッシュにフォールバックします。オフラインで新しい投稿や未取得の情報を読めることは保証しません。

## Webの更新

`src/`の変更をmainへ公開すると、既存のGitHub Pagesワークフローが配信します。ローカルの編集だけでは携帯に反映されません。HTML・JS・CSS・JSONは通信可能なときに再検証し、通信失敗時には取得済みのキャッシュを利用します。使用中の画面をデプロイ直後に強制再読み込みする処理はありません。メニューから更新する場合は、編集中の入力や添付を確認します。

## 起動

1. Xcodeで `ios/App/App.xcodeproj` を開く
2. AppターゲットのSigning & CapabilitiesでTeamを選ぶ
3. Bundle Identifierが自分のTeamで利用可能か確認する
4. iOS 15以降の実機またはSimulatorを選び、Runする

無料Apple IDで実機へ入れた場合、署名は7日で切れるため再ビルドが必要です。App Store配布にはApple Developer Programへの加入が必要です。

## 構成

- `AppDelegate.swift` — SwiftUIの起動点
- `LiveWebApp.swift` — iPhone/iPadのWeb画面、外部リンク・OAuth遷移、通信エラーと再読み込みの処理
- `NativeModels.swift` — Supabase/GitHubモデル
- `SupabaseService.swift` — Auth・REST・GitHub API
- `KeychainStore.swift` — access/refresh token保存
- `AppModel.swift` — 認証とタイムライン状態
- `NativeViews.swift` — Home、投稿、Repos、Map、通知、Profile、設定

SupabaseはWeb版と同じURL・publishable key・RLSを利用します。`npm run cap:sync`、`pod install`、`src/`からのコピーは不要です。Webの公開先やSupabaseの認証先を変更する場合は、`LiveWebPolicy`の遷移許可先も見直します。

更新・オフライン・遷移先の検証:

```sh
node scripts/test-live-web-updates.mjs
```

`PLAYWRIGHT_MODULE`と`CHROMIUM_PATH`を指定すると、再読み込み時の入力・添付保護もChromeで検証します。

## ビルド確認

```sh
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

Xcodeが「Platform Not Installed」と表示する場合は、Xcode Settings → Componentsから該当iOS Platform/Simulator runtimeを追加してください。
