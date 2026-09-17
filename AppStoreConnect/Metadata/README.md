# App Store Connect掲載文言

1.0.3向け。変更点は1.0.2からの差分です。日本語・英語ともiOS／macOS共通で使用できます。

| 項目 | 日本語 | 英語 |
| --- | --- | --- |
| プロモーションテキスト | [ja/promotional-text.txt](ja/promotional-text.txt) | [en/promotional-text.txt](en/promotional-text.txt) |
| このバージョンの最新情報 | [ja/whats-new-1.0.3.txt](ja/whats-new-1.0.3.txt) | [en/whats-new-1.0.3.txt](en/whats-new-1.0.3.txt) |

## リリース時の確認事項

イベント日程の保存には、[052-event-days.sql](../../docs/migrations/052-event-days.sql)を本番DBへ適用する必要があります。掲載文言は日程機能を有効にしたリリース向けです。今回の作業ではSQLのローカル検証まで完了しており、本番適用とApp Store Connectへの文言登録は行っていません。

接近通知は実機での移動による到着確認が未完了です。macOSではアプリ終了中・スリープ中の通知に対応していないため、その条件を変更点に明記しています。
