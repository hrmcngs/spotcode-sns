# テーマカラー

Web・iOS・Macの「設定 → 画面表示 → 外観 → テーマカラー」で、標準配色・独自の8色・GitHub Readme Statsの全75テーマを選べます。

- ブルー
- ティール
- グリーン
- アンバー
- オレンジ
- ローズ
- パープル
- スレート

各色にライト／ダーク両方の配色があり、「システムに合わせる」とも組み合わせられます。色と外観の選択は端末に保存されます。廃止されたプリセットが保存されている場合は標準配色へ戻します。デフォルトアイコンは単色グレーのままです。

## 配色の管理

独自の背景・本文・アクセント色を `src/data/color-palettes.json` に定義しています。追加の75テーマは `src/data/readme-themes.json` に保存しています。実行時の外部API呼び出しはありません。

[GitHub Readme Statsのテーマ](https://github.com/anuraghazra/github-readme-stats/blob/master/themes/index.js)の背景・本文・タイトル色をもとに、対応する外観では元の背景色を保持し、反対の外観の背景は同じ色を混ぜて生成します。透明色は不透明にし、グラデーションは最初の色を使います。

MITの著作権・許諾文は `docs/licenses/github-readme-stats.txt` と生成したJS・CSS・Swift内に保持します。ネイティブアプリには `Theme-LICENSE.txt` をリソースとして同梱します。テーマ設定画面への説明や出典表示の追加はありません。

- ライト／ダークの背景色をそれぞれ定義。
- 文字のコントラストが不足する場合は補正。
- ボタンの文字は背景に応じて黒か白を選択。
- 境界線とホバー色は背景・本文から生成。
- 背景は単色。グラデーションや陰影は付けません。

生成と検証:

```sh
node scripts/generate-color-themes.mjs
node scripts/test-color-themes.mjs
```

同じ定義からWeb用JavaScript/CSSと `ios/App/App/NativeColorThemes.swift` を生成し、プラットフォーム間の色ずれを防ぎます。
