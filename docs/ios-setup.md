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

## App Store に出すには

- **シミュレータでの動作確認** → 無料、Apple ID 不要
- **自分の実機にインストール** → 無料 Apple ID で OK（7 日ごとに再署名）
- **App Store 配信** → Apple Developer Program（$99/年）が必要
