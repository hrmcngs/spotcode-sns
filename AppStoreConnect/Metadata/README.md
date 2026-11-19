# App Store Connect掲載文言

## 1.0.5（ビルド26）

iOS・iPadOS・macOS共通のRepo検索、ラベル複数選択付きIssue作成、Spotcode表示設定を追加しました。

iPhone/iPadの通常画面をWeb配信へ切り替えました。従来画面はメニューから利用できます。Webの公開後、次回起動・画面更新で変更が反映されます。この構成への移行には一度アプリ更新が必要です。ネイティブ機能の変更は引き続きApp Storeで配布します。

- 日本語の更新説明: [ja/whats-new-1.0.5.txt](ja/whats-new-1.0.5.txt)
- 英語の更新説明: [en/whats-new-1.0.5.txt](en/whats-new-1.0.5.txt)
- 審査向け操作説明: [en/review-notes-1.0.5.txt](en/review-notes-1.0.5.txt)

審査用アカウント情報は既存のApp Store Connect設定を使用します。上記ファイルには認証情報を含めていません。

## 過去の掲載文言（1.0.3）

1.0.3向け。変更点は1.0.2からの差分です。日本語・英語ともiOS／macOS共通で使用できます。

| 項目 | 日本語 | 英語 |
| --- | --- | --- |
| プロモーションテキスト | [ja/promotional-text.txt](ja/promotional-text.txt) | [en/promotional-text.txt](en/promotional-text.txt) |
| このバージョンの最新情報 | [ja/whats-new-1.0.3.txt](ja/whats-new-1.0.3.txt) | [en/whats-new-1.0.3.txt](en/whats-new-1.0.3.txt) |

## リリース時の確認事項

イベント日程の保存には、[052-event-days.sql](../../docs/migrations/052-event-days.sql)を本番DBへ適用する必要があります。掲載文言は日程機能を有効にしたリリース向けです。今回の作業ではSQLのローカル検証まで完了しており、本番適用とApp Store Connectへの文言登録は行っていません。

接近通知は実機での移動による到着確認が未完了です。macOSではアプリ終了中・スリープ中の通知に対応していないため、その条件を変更点に明記しています。

