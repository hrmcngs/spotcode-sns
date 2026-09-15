# テーマカラー

Web・iOS・Macの「設定 → 画面表示 → 外観 → テーマカラー」から、標準配色と75種類のプリセットを選べます。選択は端末ごとに保存されます。

各テーマにライト／ダーク両方の配色があり、外観設定（システムに合わせる・ライト・ダーク）と組み合わせて使えます。上部の外観切り替えボタンでもテーマの選択は保持します。テーマ変更でデフォルトアイコンの単色グレーは変わりません。

## 配色の出典と調整

出典: [GitHub Readme Stats themes](https://github.com/anuraghazra/github-readme-stats/blob/master/themes/index.js)

2026-09-16に取得した配色定義を `src/data/readme-themes.json` に同梱しています。実行時の外部API呼び出しはありません。MITライセンスと著作権表記は `docs/licenses/github-readme-stats.txt`、Web配布ファイル、ネイティブ設定内のLicense欄に含めています。

カード用の配色をアプリに適用するため、次の調整をしています。

- 背景・本文・タイトル色を背景・本文・アクセントに対応。元テーマの明暗側は元の背景色を保ち、反対側はその色味を残した明るい／暗い背景を生成。
- 本文・補助文字・アクセントのコントラストが不足する場合は補正。
- ボタンの文字は背景に応じて黒か白を選択。
- 境界線とホバー色は背景・本文から生成。
- 透明背景は白と合成、グラデーションは最初の色を使用。陰影は付けません。

生成と検証:

```sh
node scripts/generate-color-themes.mjs
node scripts/test-color-themes.mjs
```

生成物はWeb用JavaScript/CSSと `ios/App/App/NativeColorThemes.swift` です。共通の定義から作ることで、プラットフォーム間の色ずれを防ぎます。
