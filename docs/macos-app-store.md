# Mac App Storeへの提出

ストア用macOS版は `ios/App/App.xcodeproj` のMac Catalystビルドです。
iOS版と同じSwiftUI画面・Bundle ID `computer.ngs.hrmc.Spotcode` を使います。
ElectronのDMGはApp Store Connectへの提出には使いません。

## Archiveを作成する

```bash
bash scripts/build-macos.sh
open macos/Spotcode.xcarchive
```

Xcodeに既存チームのApple Developerアカウントでサインインしておきます。
ArchiveはApple Silicon・Intel両対応です。バージョンとビルド番号はiOSプロジェクトと共通です。
App Store Connectに既に同じmacOSビルド番号をアップロード済みの場合は、
XcodeのBuild番号を上げてから作成します。

Organizerで **Distribute App → App Store Connect** を選択し、検証してアップロードします。
配布証明書・プロビジョニングはXcodeの自動署名で管理します。
開発用署名付きArchiveの作成と、ストア配布用の署名・アップロードは別工程です。

Transporter用の署名付きPKGをローカルに書き出す場合は次を実行します。

```bash
xcodebuild -exportArchive \
  -archivePath macos/Spotcode.xcarchive \
  -exportPath macos/export \
  -exportOptionsPlist macos/ExportOptions.plist \
  -allowProvisioningUpdates
```

生成した `macos/export/spotcode.pkg` をTransporterに追加して配信します。
書き出しだけではApp Store Connectへのアップロードや審査提出は行われません。

## App Store Connect

1. [既存のSpotcode](https://appstoreconnect.apple.com/apps/6783312894/distribution)にmacOSプラットフォームを追加します。
2. macOSのバージョンをArchiveと一致させ、処理完了したビルドを選択します。
3. macOS用スクリーンショットをドラッグして登録します。
4. 説明・サポートURL・プライバシー・審査用ログイン情報などを確認し、審査へ提出します。

Mac用スクリーンショットは16:10のPNG/JPEGを使用します。
Appleの指定サイズは1280×800、1440×900、2560×1600、2880×1800です。
iPhone/iPad用スクリーンショットをmacOS欄に流用しないでください。

### スクリーンショットの再作成

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -destination 'platform=macOS,variant=Mac Catalyst' \
  -derivedDataPath macos/build-preview build
sbcl --script scripts/capture-macos-screenshots.lisp
```

`macos/screenshots/` に日本語のPNG（2560×1600）を保存します。
ホーム・ログイン・リポジトリ・設定画面を撮影します。ログイン状態は端末の保存済みセッションに従います。
撮影時のログイン状態に応じた実データを表示します。サンプル投稿や架空の実績は挿入していません。
OSの画面収録ではなく、撮影用Debugアプリ自身のUIKit画面を保存します。
`-SpotcodeCaptureScreenshot` の処理はReleaseビルドには含まれません。
撮影スクリプトはCommon Lisp（SBCL付属のASDF/UIOP）で動作します。Quicklispは不要です。
アカウントパネルを撮影する場合は `sbcl --script scripts/capture-macos-screenshots.lisp Accounts` を実行します。

文字サイズの表示確認には `SPOTCODE_SCREENSHOT_TEXT_SIZE=4 sbcl --script scripts/capture-macos-screenshots.lisp Settings Home` を使用できます。0〜4が小さい〜最大に対応し、1が標準です。この指定は撮影時だけ適用され、保存済みの設定は変更しません。

Macアプリの「設定 → 画面表示 → 文字サイズ」から5段階で変更できます。選択は即時反映され、再起動後も保持されます。投稿入力欄も同じ設定に連動します。

スクロール先まで含むページ全体は `SPOTCODE_SCREENSHOT_FULL_PAGE=1 sbcl --script scripts/capture-macos-screenshots.lisp Home Settings Login Repos Accounts` で撮影します。`macos/screenshots/full-page/` に幅1280px・ページ内容に合わせた高さのPNGを保存します。ホームは読み込み済みの投稿までを対象とし、撮影による追加ページの自動読み込みは停止します。この縦長画像は確認用で、ストア提出用の16:10画像とは別です。

## コンパクトUIへの更新状況

DebugアプリとArchiveは更新済みです。バー・ボタン・入力欄・カードのサイズをMac向けに調整し、アカウントパネルを幅400ptで右上に配置しました。5画面の画像で表示を確認しています。

PKGの再書き出しは `No Accounts` および配布証明書の取得エラーで未完了です。`macos/export/spotcode.pkg` はコンパクトUIを含まない前回のファイルです。XcodeのAppleアカウントが利用可能になってから再書き出ししてください。

## 2026-09-11の初回準備状況

- バージョン1.0.1、ビルド15のMac Catalyst Archiveを作成済み。
- Apple Silicon・Intelの両アーキテクチャを確認済み。
- App Store配布用署名付き `spotcode.pkg` の書き出しに成功。
- 起動時のログイン画面で共有モデルが見つからず落ちる問題を修正。
- App Store Connectへのアップロード・審査提出は未実施。
- ログイン後の投稿、位置情報、GitHub認証の実機確認は別途必要。

## 参照

- [Mac Catalystアプリの作成](https://help.apple.com/xcode/mac/current/en.lproj/dev8e94ce3c8.html)
- [プラットフォームの追加](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms)
- [スクリーンショット仕様](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
