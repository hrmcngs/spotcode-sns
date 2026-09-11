# Spotcode 1.0.1 の更新手順

今回の更新版は **1.0.1（15）** です。英語表示、新規登録、タイムライン読み込み、投稿者名の改行を修正しています。

## 1. Xcodeで更新版を開く

Finderで次のファイルをダブルクリックします。

`ios/App/build/app-review-1.0.1-15/Spotcode-1.0.1-15.xcarchive`

XcodeのOrganizer（Archives）が開きます。開いていなければ、Xcodeのメニューから **Window → Organizer** を選びます。バージョン **1.0.1（15）** を選択してください。

## 2. Appleへアップロードする

**Distribute App → App Store Connect → Upload** と進みます。署名方法を聞かれたら **Automatically manage signing** を選びます。画面構成はXcodeのバージョンで異なる場合があります。

「Manage version and build numbers」が表示された場合はオフにすると、作成済みのビルド番号15を維持できます。最後の確認画面で **Upload** を押し、完了を待ちます。

## 3. App Store Connectで1.0.1を準備する

[App Store Connect](https://appstoreconnect.apple.com/apps/6783312894/distribution)を開き、Spotcodeの配信画面へ進みます。

- 1.0.1がなければ、バージョン追加から **1.0.1** を作成します。すでにあれば、その画面を開きます。
- 「ビルド」でアップロードした **15** を選びます。アップロード直後はApple側で処理中のため、表示されるまで待つ必要があります。
- 「このバージョンの最新情報」に以下を入力できます。

日本語:

> アプリ内で新規登録できるようになりました。英語表示、タイムラインの読み込み、投稿者名の表示に関する不具合を修正しました。

英語:

> Added account registration in the app. Fixed issues with English translations, timeline loading, and author name display.

- 必須項目に不足があれば、表示された案内に従って入力します。
- 公開方法を選びます。「自動的にリリース」なら審査承認後に公開されます。「手動でリリース」なら承認後に公開操作が必要です。

## 4. 審査へ提出する

保存後、**審査用に追加（Add for Review）** を押し、提出内容を確認して **審査へ提出（Submit for Review）** を押します。

アップロードだけではApp Storeのアプリは更新されません。審査承認・公開後、iPhoneのApp StoreでSpotcodeを開いて「アップデート」を押すと更新できます。

Apple公式: [アップロード](https://help.apple.com/xcode/mac/current/en.lproj/dev442d7f2ca.html)、[新規バージョン作成](https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version)、[審査への提出](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app)
