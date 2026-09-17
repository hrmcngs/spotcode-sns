# Xcode Cloud Archiveタイムアウトの調査

2026-09-17、Cloudビルド160・161はArchive内で30分間出力がなく、終了コード75で停止した。161ではXcode 26.5 (17F42)、macOS 26.5.1を使用。依存解決とワークフロー検証は成功している。任意のci_pre_xcodebuild.shがない表示はエラーではない。

ローカルはXcode 27.0のみ。既存設定で署名を除いたiOS Release Archiveは約113秒で成功したが、Xcode 26.5のCloudで成功する証拠にはならない。Cloudのアドホック署名引数をそのままローカルに渡すと証明書要件で即時失敗したため、これもCloudのタイムアウトの再現ではない。

今回の変更は診断・設定の明示であり、タイムアウト原因の修正を確認したものではない。

- 共有Appスキームを追加し、ArchiveでRelease構成を使うことと対象ターゲットを明示。
- ci_pre_xcodebuild.shで選択されたXcode・Swift・macOSのバージョンを出力。環境変数全体は出力しない。
- ci_post_xcodebuild.shでCI_RESULT_BUNDLE_PATHの結果概要とビルドログ末尾を出力。解析に失敗しても元のビルド結果を変えない。

変更を含むコミットをCloudでビルドし、post-xcodebuildの診断を確認する。タイムアウトで後処理が実行されない／結果ファイルが未完成の場合は、Archiveアクションの「成果物」からログ・xcresultを取得する。最後に実行していたタスクを確認してから、コンパイラ・署名・Cloudサービスのどこを調べるか決める。現時点で最適化設定やタイムアウト値は変更していない。

参考: [Apple: Writing custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts)、[Environment variable reference](https://developer.apple.com/documentation/xcode/environment-variable-reference)。
