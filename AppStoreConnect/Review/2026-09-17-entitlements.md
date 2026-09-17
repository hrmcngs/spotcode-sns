# 2026-09-17 macOS審査への対応

対象: Submission ce153052-039c-4816-9cde-2bcb688ad923、審査ビルド18。

- `com.apple.security.network.server`: 近くの相手との名刺交換で必要。プロフィール → 名刺を共有 → 公開済み名刺 → 近くの相手と交換。Multipeer Connectivityで接続を受け付ける。
- `com.apple.security.device.camera`: ビルド18は画像選択のみだったが、今回、AVFoundationによる撮影機能を実装したため維持する。投稿作成 → 写真ボタン → 写真を撮影 → 撮影 → この写真を添付。撮り直し・キャンセルに対応。音声入力は使わない。

[英語の返信案](2026-09-17-entitlements-reply-en.txt)は、新しい撮影機能を含む修正ビルドをこれから提出する時点の文面。ビルド18に撮影機能があるとは説明しない。

返信・Developer Reject・アップロードは未実施。再提出時は未使用のビルド番号（現在18のため19以上）でRelease Archiveを作り直し、カメラ付き実機で撮影・添付と権限拒否時の動作を確認する。既存のArchiveやPKGは更新されていない。

参照: [App Review Guidelines 2.4.5](https://developer.apple.com/app-store/review/guidelines/#2.4.5)、[AVCapturePhotoOutput](https://developer.apple.com/documentation/avfoundation/avcapturephotooutput)。
