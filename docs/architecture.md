# spotcode-sns 設計メモ

## デュアルターゲット

- **Web** … `src/` を GitHub Pages で配信
- **Electron** … `electron/main.js` から同じ `src/index.html` を読む

両方とも DOM は同じなので追加機能は `src/js/` に書けば両方に効く。
ネイティブが必要な機能（ファイルダイアログ等）は `electron/preload.js` 経由で contextBridge する。

## モジュール

| ファイル | 役割 |
|---|---|
| `file-size-viz.js` | サイズに応じた色バッジ |
| `status-badges.js` | active / WIP / released 等のラベル |
| `grass.js` | 53週分の活動 heatmap |
| `map.js` | 位置マップ placeholder |
| `idea-post.js` | アイデア投稿フォーム |
| `gh-link.js` | GitHub URL → 構造化 |
