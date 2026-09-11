# macOS版

ビルドは `bash macos/build.sh` で実行できます。用途別のコマンドは次のとおりです。

```bash
bash macos/build.sh          # Release Archive
bash macos/build.sh preview  # 動作確認用アプリ
bash macos/build.sh export   # Archiveから提出用PKGを書き出す
bash macos/run.sh            # アプリを起動（未ビルドなら自動ビルド）
bash macos/run.sh --build    # 最新ソースでビルドして起動
```

スクリプトはどの作業ディレクトリからでも実行できます。追加のビルド設定はモードの後ろに指定します。既存の `scripts/build-macos.sh` もArchive作成用として使用できます。

現在のコンパクトUIは `build-preview/Build/Products/Debug-maccatalyst/App.app` と `Spotcode.xcarchive` に反映済みです。
PKGの再書き出しはXcodeの `No Accounts` エラーで未完了のため、`export/spotcode.pkg` は前回のUIです。
XcodeのAppleアカウントを復旧後、提出手順のexportコマンドで更新してください。

Mac App Store提出用のファイルは、このフォルダにまとめています。

| 場所 | 内容 |
| --- | --- |
| `export/spotcode.pkg` | Transporterでアップロードする署名済みパッケージ |
| `screenshots/` | App Store ConnectへドラッグするPNG画像（基本4画面とアカウントパネル） |
| `Spotcode.xcarchive` | Xcode Organizerで開くArchive |
| `ExportOptions.plist` | App Store提出用の書き出し設定 |
| `build/` | Releaseビルドの中間ファイル |
| `build-preview/` | 撮影用Debugビルド |

再作成・提出方法は [Mac App Storeへの提出手順](../docs/macos-app-store.md) を参照してください。
共通のSwiftUIソースとXcodeプロジェクトは `ios/App/` を使用し、macOSの成果物はこのフォルダへ出力します。

Mac向けのバー・ボタン・入力欄・カードの寸法は、共通ソースの `SpotcodeLayout` で調整します。アカウントパネルは右上に幅400ptで表示します。

Mac版はWeb版と同じ常設の左ナビゲーションを使い、ハンバーガーメニューは表示しません。ホーム・リポジトリ・通知・プロフィール・設定へ直接移動でき、アカウント欄から切り替えられます。広いウィンドウでは右側にGitHubアクティビティとフォロー候補を表示します。狭いウィンドウでは右欄を省略し、さらに狭くすると左メニューをアイコン表示にします。`/` で検索欄に移動、`⌘N` で新規投稿を開きます。

文字サイズは「設定 → 画面表示 → 文字サイズ」で、小さい・標準・大きい・特大・最大の5段階から選べます。変更は即時反映され、再起動後も保存されます。「標準に戻す」で初期サイズに戻せます。DebugアプリとArchiveに反映済みです。

標準の本文・上部バー・操作アイコンは、Web版の16px・約54px・34pxに見た目を合わせ、Mac Catalystの表示倍率を補正しています。投稿一覧は最大800pt幅です。文字サイズの5段階設定も引き続き利用できます。

タイトルバーと左右の余白を含む実際のウィンドウ全体は `sbcl --script scripts/capture-macos-windows.lisp` で撮影し、`screenshots/window/` に保存します。ウィンドウを1280×800ptに調整し、2倍解像度のディスプレイで2560×1600pxのPNGを撮影します。macOSの画面収録・アクセシビリティ権限が必要です。撮影時は標準の文字サイズを使い、ユーザーの保存済み設定は変更しません。
