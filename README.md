# spotcode-sns

スポット（位置情報）に紐付くアイデアと、それを実装した GitHub リポを残せる開発者 SNS。
**Web + Electron** デュアルターゲット。

## 機能（実装中）

- 📊 **ファイルサイズで色が変化** — 一目で編集量
- 🟢 **ステータスバッジ** — active / WIP / released …
- 🌱 **活動の草** — 53週分の heatmap
- 📍 **スポット紐付け** — 位置でアイデアを残す
- 💡 **アイデア投稿** — その場で思いついた事を書き込み
- 🔗 **GitHub リンク** — 実装方法を共有

## 起動

```bash
# Web
npm run start:web         # http://localhost:8080

# Electron (要: npm install で electron をインストール)
npm install
npm run start:electron
```

## 構成

```
src/        ← Web/Electron 共通のフロントエンド
electron/   ← Electron ラッパ（main.js / preload.js）
data/       ← モックデータ
docs/       ← 設計メモ
.github/    ← Pages デプロイ workflow
```
