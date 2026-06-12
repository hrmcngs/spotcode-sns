// スポットでアイデアを書き残すフォーム。
export function renderIdeaForm(spotId) {
  return '<form class="idea-form" data-spot="' + spotId + '">' +
    '<textarea name="text" placeholder="このスポットで思いついたアイデア…" rows="3"></textarea>' +
    '<input name="github" placeholder="関連 GitHub URL（任意）">' +
    '<button type="submit">投稿</button>' +
    '</form>';
}
