# 名刺

Web / Electron / iOS / Mac Catalyst のプロフィールから「名刺を共有」を開く。
配色3種、表の名前・肩書き、裏の自己紹介・連絡先を編集できる。
詳細設定では表裏の背景色、文字色、見出し色、書体3種、装飾3種、表裏別の左／中央／右揃え、名前の大きさ18〜36px、角丸0〜28px、表裏の見出し（各40文字）を変更できる。
配色プリセット変更時は4色だけを変更する。空の見出しは非表示。旧名刺は元のテーマのデフォルト値で表示する。
名刺をタップすると表裏が回転する。動きを減らす設定にも対応。

## 導入

1. Supabase SQL Editorで `docs/migrations/045-business-cards.sql`、`046-business-card-design.sql`、`047-business-card-media.sql` の順に適用する。
2. Webをデプロイし、iOS / Mac Catalystアプリをビルド・配布する。
3. アカウントAで名刺を公開し、アカウントBで共有リンクを開いて保存する。
4. Bのコレクションに1枚追加されたこと、再保存で増えないことを確認する。
5. 別アカウント／未ログインではBのコレクションを読めず、Aの名刺を変更できないことを確認する。
6. iPhoneの「名刺を共有」からAirDropで別端末に送信し、リンクが開けることを確認する。

公開先は既存のGitHub Pagesサイト。共有URLは `https://hrmcngs.github.io/spotcode-sns/#/<handle>/card`。
名刺リンクはWebで開く。ネイティブアプリへのUniversal Links転送は含まない。
名刺は明示的に保存・公開したものだけが閲覧可能。公開名刺は認証なしでも読める。
コレクションは保存した本人だけが読める。相手の保存・フォローを自動で行わず、各自が保存・共有する。
コレクションには現在の名刺を表示するため、所有者の編集が反映される。
所有者が公開停止すると、外部キーの連鎖削除で各コレクションからも消える。

AirDropはOSの共有メニューを使う。NameDropのような端末接近による自動交換は実装していない。
Web Share非対応時はリンクコピーへ案内する。キャンセルを送信成功として扱わない。
保存障害時はエラーを表示し、ローカル保存だけで成功したように見せない。

## 検証

- `node scripts/test-business-cards.mjs`: 入力処理、本人IDでの保存、重複防止オプション、本人に限定した削除、失敗処理、HTMLエスケープ。
- Xcode App scheme / Debug / generic iOS device / signing disabled: ビルド確認。
- 実DBのRLSとAirDrop実機交換は上記の導入後手順で確認する。

## 画像とリンク

名刺1枚に画像1点をファイル／写真ライブラリ（ネイティブ）／画像URLから追加できる。
ローカル画像は長辺512pxのJPEGへ縮小して名刺と一緒に保存する。ファイル入力は8MBまで。
表／裏、丸／角丸、48〜100pxのサイズを編集でき、画像を押したときのリンクも設定可能。
表面には表示名（40文字）とhttp(s) URL（2048文字）のリンクを3件まで直接配置できる。
画像・リンクは初期状態で表に表示し、それぞれ裏に移動することもできる。
リンクを押しても名刺は裏返らない。Webの裏面の操作要素は裏返すまでキーボードフォーカスから除外する。
共有リンク・コレクションも同じ画像とリンクを表示する。

ベースカラーは12色のカラーチップ、またはカラーピッカーから選べる。
表の色に合わせて裏を少し暗くし、両面で読みやすい黒／白の文字色を選ぶ。
書体・配置・画像・リンクは保持し、配色だけを変更する。選択色は既存のdesign設定に保存する。

### 外部デザイン・実物の名刺画像

「デザイン用テンプレートをダウンロード（SVG）」から、現在の向き・基調色で編集用ファイルを書き出せます。外部エディターでデザインしたらPNG/JPEGで書き出し、画像として取り込みます。「画像の使い方」で「名刺の1面として使う」を選び、表または裏を指定します。実物を撮影・スキャンした画像も利用できます。周囲の切り抜きや傾き補正は取り込み前に行ってください。

画像は1枚（表または裏の1面）で、反対面は通常の編集が可能です。OCRによる文字抽出は行いません。アップロード上限は8MB、最大辺1650pxに縮小し、保存データは既存の1MB制限を使います。SVGは編集用の書き出し形式で、取り込みにはPNG/JPEGを推奨します。

### 近くの端末との交換（ネイティブアプリ）

双方がログインして自分の公開済み名刺を開くと、画面下の「近くの相手と交換」から相手を選べます。受信側が確認すると、暗号化されたMultipeer Connectivityセッションで公開名刺の所有者IDだけを交換し、サーバーで公開を確認して各自のコレクションに保存します。互いの保存結果は受領通知で確認します。ローカルネットワークへのアクセス許可と、保存用のインターネット接続が必要です。

この機能は近くの端末の発見であり、数cmの接近判定やNameDropの起動ではありません。表示名は相手の端末が申告する名前です。名刺画面を離れる、編集を始める、バックグラウンドに移ると探索・接続を停止します。Web版は従来の共有リンクを使います。

`sbcl --script scripts/test-nearby-card-exchange.lisp` は通信を模擬して、本番の交換処理の同意・相手制限・サイズとバージョン検証・終了後の受信無視を検証します。実機2台での探索、初回の許可、相互保存は別途確認が必要です。

### Web版とアプリ版の同期

同じSupabaseプロジェクト・同じログインアカウントの名刺は、共通の `business_cards.owner_id` に保存されます。内容・画像・リンク・デザインを別端末へ転送する操作は不要です。「保存して公開」後、もう片方で名刺を開き直すか、名刺を表示したままアプリ／ブラウザへ戻ると読み直します。編集パネルが開いている場合や未保存の変更がある場合は上書きしません。両方で編集して保存した場合は最後の保存内容が反映されます。

### 実寸を基準にした表示

名刺は通常表示・全画面・コレクションで共通の91×55mm基準（縦向きは55×91mm）に固定し、画面に合わせた拡大はしません。全画面下の「実寸調整」で定規に合わせて補正できます。補正は名刺デザインと分けて、そのアプリ／ブラウザ内に保存します。画面の物理密度や表示倍率は自動確定できないため、モニターや表示倍率を変えた場合は再調整が必要です。

## Collection-only access

Apply `docs/migrations/048-business-card-collection-read.sql` before releasing
this client version. It replaces public SELECT access with owner-or-collector
row-level security and removes anonymous SELECT access. The existing collection
INSERT policy still requires the authenticated collector's own ID; saving an
existing card grants that collector read access, and removing it revokes access.

Web and native direct links show a collection prompt without fetching card data
until the viewer has saved the card. Owners can always read/edit their own card.
Nearby exchange saves the received owner ID first; the foreign key rejects cards
that no longer exist. No public card read is needed for exchange.

Run `node scripts/test-business-card-access.mjs` for client access regression
checks. The SQL policy checks in that script are static; verify the migration
against the target database before deployment.
