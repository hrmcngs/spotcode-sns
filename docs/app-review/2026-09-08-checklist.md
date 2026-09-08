# 再提出の手順

## コードとDBの反映

- `docs/migrations/043-user-safety.sql` の中身をSupabase SQL Editorで実行する。既存のprofiles/posts/comments/reportsとStage 39のorganization_author_idが前提。再実行可能。
- Webを公開する。support.html / terms.html / privacy.htmlを未ログインで開き、問い合わせ先 `spotcode@littleapps.jp` を確認する。
- Xcodeで更新版をArchive・アップロードし、App Store Connectで更新ビルドを選ぶ。同じバージョンに再提出する場合は、提出済み1.0(9)より新しいビルド番号にする。
- 管理者または運営アカウントで「設定 → 画面表示 → 安全・サポート」の通知一覧を確認する運用を行う。メールやPushでの自動通知ではなく、DBに保存する運営用通知一覧。

## iPhone/iPad実機での録画

実機の画面収録で以下を撮影する。シミュレータの動画はAppleが指定した実機録画の代わりにならない。

1. ログアウト状態でログイン画面を開く。規約本文へのリンク、禁止事項、同意スイッチを映す。同意前はログインできないことを示す。
2. 規約を開いて禁止事項を示し、戻って同意してログインする。パスワードや認証コードは録画に映さない。
3. テスト用の別アカウントの投稿で「… → 投稿を報告」を開き、理由を入力して送信する。
4. 同じアカウントの別の投稿で「… → ユーザーをブロック」を選び、確認後すぐにその人の投稿がフィードから消える様子を撮る。
5. 更新・再起動後も非表示であることと、設定のブロック一覧を確認する。
6. 運営側の通知一覧に通報・ブロックが届いたことを別途確認する。一般ユーザーには運営通知が見えないことも確認する。
7. iOSのアプリ言語設定を日本語／英語にしてそれぞれ起動し、位置情報・写真・カメラの初回権限確認の説明が同じ言語であることを確認する。権限リセットが必要な場合は検証用端末を使う。

## App Store Connect

「App Reviewに返信」はAppleへの回答・添付用の画面。まず `2026-09-08-response-ja.md` の「今すぐ送れる回答」を貼り付けられる。

サポートURLは、アプリのiOSバージョンのメタデータにある「サポートURL」を `https://hrmcngs.github.io/spotcode-sns/support.html` に変更する。日本語・英語のメタデータがある場合は両方確認する。これは審査への返信欄とは別。

実機録画を返信に添付し、App Review情報の「メモ」にもファイル名または審査担当がアクセスできる動画URLと操作手順を書く。未公開リンク、ログイン必須リンク、未撮影の動画を添付済みと記載しない。

参照: [AppleのサポートURL仕様](https://developer.apple.com/jp/help/app-store-connect/reference/app-information/platform-version-information)、[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)。

## この作業で確認したこと

- iPhone/iPad実機向けの署名なしDebugビルド成功。
- iPadシミュレータ向けビルド成功。
- ビルド成果物に日本語・英語のInfoPlist.stringsが含まれることを確認。
- `scripts/test-user-safety.mjs` でブロックによる非表示、解除、通知の一括保存・重複防止、運営以外への通知非公開、通知偽造の拒否、通報通知を検証。
- 本番DB・Web・App Store Connectの変更と、署名付きArchiveのアップロードは未実施。
- 1.0（10）の署名付きRelease ArchiveとApp Store Connect用IPAの書き出しに成功。実機iPhone 11 Pro Maxへの更新インストールと起動も成功。成果物は `ios/App/build/app-review-1.0-10/`（Git管理対象外）に保存。署名検証済み。
- iPhone 11 Pro Max / iOS 26.6.1実機で、Xcode UIテストによる規約同意（ログイン前）・通報送信・ブロック後の投稿即時非表示・解除を実行し、各テストが成功。実機動画3本を結合した `ios/App/build/app-review-1.0-10/Spotcode-1.0-10-AppReview.mp4`（約54秒、約5.8MB）を保存。元動画は同フォルダの `videos/`。
- spotcode_devから開発者のhrmcngs投稿へのテスト通報を「その他」で1件送信。コメントには違反の告発ではなくApp Review用動作確認である旨を明記。テスト用ブロックは解除済み。
- 実機Safariから公開済みの更新版利用規約（2026-09-08）を表示できた。運営アカウントの通知一覧での通報・ブロック到着確認、およびApp Store Connectへの動画添付は未実施。
- iPad Air 11インチ（M3）/ iOS 26.1シミュレータで、英語の規約同意・ログイン画面と英語の通知許可ダイアログが表示されることを確認。確認画像: `/tmp/spotcode-review-ipad-en.png`。位置情報・写真・カメラの実機での許可操作は、上記手順で別途確認する。

## 初期言語の修正（ビルド11）

- アプリ固有の言語選択がない場合、UIKit起動前に英語を初期設定する。iOS設定で明示的に選択した言語は上書きしない。画面とInfoPlistの権限説明は同じアプリ言語を使う。
- 署名付き1.0（11）のArchiveと配布用IPA作成、実機への更新インストールが成功。日本語設定のiPhoneで英語のSearch / Profile表示をUIテストで確認。ログイン状態も維持。成果物: `ios/App/build/app-review-1.0-11/`。
- 先に作成した審査用動画は1.0（10）の日本語表示。ビルド11の英語版動画は次項を参照。App Store Connectへのアップロードは未実施。
- 新規シミュレータを日本語端末設定にして初回起動した際、英語の規約・ログイン画面とアプリ固有の `AppleLanguages = [en]` 保存を確認。その後アプリ固有の言語を日本語へ明示設定し、再起動後も日本語表示が保持されることを確認。

## 英語での実機録画（ビルド11）

- `ios/App/build/app-review-1.0-11/Spotcode-1.0-11-AppReview-English.mp4` に約65秒・約9.4MBの動画を保存。規約同意・通報・ブロック後の即時非表示と解除を英語UIで実行し、3つのUIテストすべてが成功。元動画は `videos-en/` に保存。
- 投稿本文は元の言語、リンク先規約は日英併記。認証情報の入力は提出動画に含まない。通報はテストと明記して1件送信し、一時ブロックは解除済み。
- App Store Connectへの動画添付・ビルドアップロードは未実施。
