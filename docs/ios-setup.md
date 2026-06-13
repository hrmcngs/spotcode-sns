# iOS app セットアップ（Capacitor）

spotcode-sns はそのままの PWA を [Capacitor](https://capacitorjs.com) で
iOS ネイティブアプリとして wrap する構成です。**TypeScript / React Native へ
の書き換えは不要** — `src/` の中身がそのまま webview で動きます。

## 前提（一度だけやる）

### 1. Xcode を有効化
Command Line Tools しか入っていない状態だと `xcodebuild` が動かないので
切り替える:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -runFirstLaunch
```

### 2. CocoaPods を入れる
Capacitor が iOS の依存解決に使う:

```sh
# Homebrew がある場合
brew install cocoapods

# 無ければ Ruby gem 経由
sudo gem install cocoapods
```

### 3. JS 依存を入れる
リポジトリのルートで:

```sh
npm install
```

これで `@capacitor/core` / `@capacitor/cli` / `@capacitor/ios` が入る。

## 初回 iOS プロジェクト生成

```sh
npm run cap:add:ios
```

これで `ios/` ディレクトリに Xcode プロジェクトが生成される。
コミットしてリポジトリに入れる:

```sh
git add ios capacitor.config.json
git commit -m "chore: add iOS Capacitor platform"
```

## 開発ループ

`src/` 配下のコードを編集した後:

```sh
npm run cap:sync          # ← src/ → ios/App/App/public/ にコピー
npm run cap:open:ios      # ← Xcode を開く
```

Xcode で実機 / シミュレータを選んで ▶ で実行。

## 携帯 (iPhone) でビルド・起動する

### A. 無料 Apple ID で自分の iPhone に入れる

「App Store には出さないけど自分の iPhone で動かしたい」場合のいちばん安い経路。
無料 Apple ID で OK。**インストール後 7 日で署名が切れる**ので一週間ごとに同じ手順で
入れ直す必要がある。

1. **iPhone を Mac に USB で繋ぐ**
   - 初回は iPhone 側で「このコンピュータを信頼しますか？」→ 信頼
   - パスコード入力を求められたら入れる

2. **Xcode で Signing & Capabilities を設定**
   - `npm run cap:sync && npm run cap:open:ios`
   - Project Navigator で **App** ターゲットを選択 → **Signing & Capabilities**
   - **Team** プルダウンから自分の Apple ID を選ぶ（無ければ「Add an Account…」で
     ログイン）
   - 無料アカウントだと **Personal Team (Free)** と表示される
   - Bundle Identifier を **ユニークなもの** に変更
     （例: `io.github.hrmcngs.spotcode.<あなたの数字>`）
   - 同じ Apple ID で他の人と被ると署名できないため

3. **ビルド先デバイスを iPhone に切替**
   - Xcode 上部のスキーム選択（左から 2 番目のドロップダウン）で、繋いだ iPhone を選ぶ

4. **▶ で実行**
   - 初回は数分かかる
   - 失敗するときは下の **トラブルシューティング** を参照

5. **iPhone 側で「信頼」を 1 回だけやる**
   - 初回起動すると「信頼されていないデベロッパー」と出るので:
   - iPhone の **設定 → 一般 → VPN とデバイス管理** を開く
   - 自分の Apple ID を選んで「信頼」をタップ
   - これで以後アイコンタップで起動できる

### B. シミュレータで試す（実機なしで動作確認したい）

```sh
npm run cap:sync
npm run cap:open:ios
# Xcode の上部のスキーム選択で "iPhone 15 Pro" などのシミュレータを選んで ▶
```

Apple ID 不要、無料、無制限に再起動できる。プッシュ通知・Geolocation の
高精度モードはシミュレータでは正確に動かないので、それは実機が必要。

### C. App Store に出す

[Apple Developer Program](https://developer.apple.com/programs/)（$99/年）が必要。
無料 Apple ID では App Store には出せない。13 歳未満の場合は保護者の
Apple ID で組織契約する必要あり。

その上で TestFlight（社内テスト用）か正規の App Store 配信を選ぶ。

## トラブルシューティング

### `pod install` failed
CocoaPods が古い・破損している。

```sh
brew upgrade cocoapods
cd ios/App && pod install --repo-update
```

### `Failed to register bundle identifier`
他の人が同じ ID を使っている、または自分の Apple ID で既に登録済み。

→ Signing & Capabilities で Bundle Identifier をユニークなものに変える
（例: `io.github.hrmcngs.spotcode.20260613`）。

### `Untrusted Developer` で起動できない
iPhone 側で「設定 → 一般 → VPN とデバイス管理」から自分のアカウントを
信頼。詳しくは上の A-5。

### `Could not launch` / `LSOpenURLsWithRole`
iPhone と Mac の信頼状態が壊れているので、iPhone を Mac から外して
繋ぎ直す → Xcode を再起動。

### コードを更新したのに iPhone に反映されない
\`npm run cap:sync\` を実行してから ▶ し直す。これで src/ → ios/App/App/public/ に
コピーされる。`cap:sync` を忘れると古い JS のままビルドされる。

