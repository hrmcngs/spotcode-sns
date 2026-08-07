# iOS app セットアップ（SwiftUIネイティブ）

iOS版はSwiftUI・MapKit・URLSessionで動作します。Capacitor、WKWebView、`src/`のJavaScriptはiOSターゲットでは使用しません。Web版は従来どおり独立して動作します。

## 起動

1. Xcodeで `ios/App/App.xcodeproj` を開く
2. AppターゲットのSigning & CapabilitiesでTeamを選ぶ
3. Bundle Identifierが自分のTeamで利用可能か確認する
4. iOS 15以降の実機またはSimulatorを選び、Runする

無料Apple IDで実機へ入れた場合、署名は7日で切れるため再ビルドが必要です。App Store配布にはApple Developer Programへの加入が必要です。

## 構成

- `AppDelegate.swift` — SwiftUIの起動点
- `NativeModels.swift` — Supabase/GitHubモデル
- `SupabaseService.swift` — Auth・REST・GitHub API
- `KeychainStore.swift` — access/refresh token保存
- `AppModel.swift` — 認証とタイムライン状態
- `NativeViews.swift` — Home、投稿、Repos、Map、通知、Profile、設定

SupabaseはWeb版と同じURL・publishable key・RLSを利用します。`npm run cap:sync`、`pod install`、`src/`からのコピーはSwiftUI版には不要です。

## ビルド確認

```sh
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -destination 'generic/platform=iOS' \
  CODE_SIGNING_ALLOWED=NO build
```

Xcodeが「Platform Not Installed」と表示する場合は、Xcode Settings → Componentsから該当iOS Platform/Simulator runtimeを追加してください。
