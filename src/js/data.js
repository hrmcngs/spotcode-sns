// Merges hard-coded seed data with anything the user has saved locally,
// so the timeline shows real new posts on top of the demo seed.

import { KEYS, read, write } from './storage.js';

const seedUsers = {
  hrmcngs: {
    handle: 'hrmcngs', name: 'Hiromichi', avatar: 'H',
    bio: 'スポットに紐づくアイデアを残す SNS を作っています。Tokyo を歩いて書く。',
    location: 'shibuya', joined: '2024-08',
    following: 142, followers: 389,
    role: 'programmer',
    github: { handle: 'hrmcngs', url: 'https://github.com/hrmcngs' },
    seed: true,
  },
  akiba_dev: {
    handle: 'akiba_dev', name: 'Akiba Dev', avatar: 'A',
    bio: '秋葉原で電子工作 + Web。ESP32 と Canvas をくっつけるのが好き。',
    location: 'akihabara', joined: '2023-04',
    following: 88, followers: 1240,
    role: 'programmer',
    github: { handle: 'akiba-dev', url: 'https://github.com/akiba-dev' },
    seed: true,
  },
  shimo_hk: {
    handle: 'shimo_hk', name: 'Shimokita Hacker', avatar: 'S',
    bio: '下北沢の二階のカフェで CSS と Rust。古着とフォントが好き。',
    location: 'shimokita', joined: '2024-02',
    following: 311, followers: 612,
    role: 'programmer',
    github: { handle: 'shimo-hk', url: 'https://github.com/shimo-hk' },
    seed: true,
  },
  octobot: {
    handle: 'octobot', name: 'octobot', avatar: 'G',
    bio: 'bundle size を見張る bot。',
    location: 'shibuya', joined: '2025-01',
    following: 4, followers: 27,
    role: 'general',
    seed: true,
  },
};

const seedPosts = [
  {
    id: 's1', authorHandle: 'hrmcngs', time: '2m', spot: 'shibuya',
    body: 'スクランブル交差点の歩道橋でアイデア降ってきた。地図上の「思いつきポイント」をピン化して、後で `git commit` 風に履歴を辿れる SNS。',
    status: 'wip',
    files: [['main.js', 1843]],
    actions: { replies: 4, forks: 1, stars: 8, likes: 24 },
    createdAt: Date.now() - 1000 * 60 * 2,
  },
  {
    id: 's2', authorHandle: 'akiba_dev', time: '14m', spot: 'akihabara',
    body: '秋月電子で部品見てたら、ESP32 + GPS で「歩いた場所のコードを地図に描く」デバイス作りたくなった。土曜ハンダ付け会やる人〜？',
    status: 'active',
    commit: { sha: 'a13f9c2', repo: 'akiba/walkmap', msg: 'feat: stream gps coords to canvas', add: 132, del: 4 },
    actions: { replies: 12, forks: 6, stars: 41, likes: 89 },
    createdAt: Date.now() - 1000 * 60 * 14,
  },
  {
    id: 's3', authorHandle: 'shimo_hk', time: '1h', spot: 'shimokita',
    body: '古着屋の二階のカフェで CSS を書いている。スポットに紐づくと「どこで書いたか」がコミットメタデータに乗って、後から読み返すと記憶が蘇る。これが spotcode の本体だと思う。',
    status: 'released',
    files: [['style.css', 18450], ['theme.js', 412]],
    actions: { replies: 3, forks: 0, stars: 15, likes: 30 },
    createdAt: Date.now() - 1000 * 60 * 60,
  },
  {
    id: 's4', authorHandle: 'octobot', time: '3h', spot: 'shibuya',
    body: 'huge-bundle.js が 84KB に膨らんでる。bundle analyzer 入れた方がよさそう。',
    status: 'wip',
    files: [['huge-bundle.js', 84100]],
    actions: { replies: 1, forks: 0, stars: 2, likes: 5 },
    createdAt: Date.now() - 1000 * 60 * 60 * 3,
  },
  {
    id: 's5', authorHandle: 'hrmcngs', time: '5h', spot: 'shibuya',
    body: 'タイムラインをぼーっと見るより、地図を眺めて「あ、あの公園で書いたやつ」って思い出せる方が、自分の思考の歴史としてしっくり来る。',
    status: 'active',
    actions: { replies: 7, forks: 0, stars: 12, likes: 38 },
    createdAt: Date.now() - 1000 * 60 * 60 * 5,
  },
  {
    id: 's6', authorHandle: 'hrmcngs', time: '1d', spot: 'shimokita',
    body: 'theme toggle 入れた。ダーク/ライトを localStorage で覚える。地味だけど夜書いてた時のしんどさが減った。',
    status: 'released',
    files: [['theme.js', 412]],
    commit: { sha: 'e780b23', repo: 'hrmcngs/spotcode-sns', msg: 'feat: wire theme toggle into main.js', add: 14, del: 1 },
    actions: { replies: 2, forks: 1, stars: 9, likes: 21 },
    createdAt: Date.now() - 1000 * 60 * 60 * 24,
  },
  {
    id: 's7', authorHandle: 'akiba_dev', time: '2d', spot: 'akihabara',
    body: 'I2C で 4 つセンサ並列に読むやつ、ようやくタイミング安定した。SCL のプルアップが弱かった。',
    status: 'released',
    actions: { replies: 9, forks: 3, stars: 22, likes: 51 },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
  },
  {
    id: 's8', authorHandle: 'shimo_hk', time: '3d', spot: 'shimokita',
    body: '可変フォント `Inter` を本文に入れたら、行間が締まってずっと読みやすくなった。Web フォントは怠惰の天敵。',
    status: 'active',
    actions: { replies: 5, forks: 0, stars: 18, likes: 44 },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
  },
];

export function allUsers() {
  const stored = read(KEYS.users, {});
  return { ...seedUsers, ...stored };
}

export function getUser(handle) {
  return allUsers()[handle] || null;
}

export function allPosts() {
  const stored = read(KEYS.posts, []);
  return [...stored, ...seedPosts];
}

export function postsByHandle(handle) {
  return allPosts().filter(p => p.authorHandle === handle);
}

export function addPost(post) {
  const stored = read(KEYS.posts, []);
  stored.unshift(post);
  write(KEYS.posts, stored);
  return post;
}

// Relative-time formatter for display ("just now", "5m", "3h", "2d").
export function relTime(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60)       return s + 's';
  if (s < 3600)     return Math.floor(s / 60) + 'm';
  if (s < 86400)    return Math.floor(s / 3600) + 'h';
  if (s < 86400*7)  return Math.floor(s / 86400) + 'd';
  const d = new Date(ts);
  return d.getMonth() + 1 + '/' + d.getDate();
}
