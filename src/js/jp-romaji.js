// Small bidirectional map between common Japanese place names and their
// Hepburn romaji slug. Lets users who can't type Japanese still find
// posts about a 区 / 市 by typing "shibuya" / "setagaya" / "shinjuku".
//
// Only the 47 prefectures + the Tokyo 23 wards + a handful of large
// cities — exhaustive coverage would need a real dictionary. Anything
// missing falls back to literal JP matching, so adding a new entry is
// purely additive.

const TABLE = [
  // Tokyo 23 wards
  ['chiyoda',   '千代田区'],
  ['chuo',      '中央区'],
  ['minato',    '港区'],
  ['shinjuku',  '新宿区'],
  ['bunkyo',    '文京区'],
  ['taito',     '台東区'],
  ['sumida',    '墨田区'],
  ['koto',      '江東区'],
  ['shinagawa', '品川区'],
  ['meguro',    '目黒区'],
  ['ota',       '大田区'],
  ['setagaya',  '世田谷区'],
  ['shibuya',   '渋谷区'],
  ['nakano',    '中野区'],
  ['suginami',  '杉並区'],
  ['toshima',   '豊島区'],
  ['kita',      '北区'],
  ['arakawa',   '荒川区'],
  ['itabashi',  '板橋区'],
  ['nerima',    '練馬区'],
  ['adachi',    '足立区'],
  ['katsushika','葛飾区'],
  ['edogawa',   '江戸川区'],

  // A few large cities outside Tokyo most non-JP visitors recognise.
  ['yokohama',  '横浜市'],
  ['kawasaki',  '川崎市'],
  ['saitama',   'さいたま市'],
  ['chiba',     '千葉市'],
  ['osaka',     '大阪市'],
  ['kyoto',     '京都市'],
  ['kobe',      '神戸市'],
  ['nagoya',    '名古屋市'],
  ['fukuoka',   '福岡市'],
  ['sapporo',   '札幌市'],
  ['sendai',    '仙台市'],
  ['hiroshima', '広島市'],
  ['naha',      '那覇市'],

  // Prefectures (just a couple — extend as needed).
  ['tokyo',     '東京都'],
  ['kanagawa',  '神奈川県'],
  ['hokkaido',  '北海道'],
  ['okinawa',   '沖縄県'],
];

const ROMAJI_TO_JP = new Map(TABLE.map(([r, j]) => [r, j]));
const JP_TO_ROMAJI = new Map(TABLE.map(([r, j]) => [j, r]));

// Look up the JP form of an ASCII slug (case-insensitive). Returns null
// if the slug is not in the table.
export function romajiToJp(slug) {
  if (!slug) return null;
  return ROMAJI_TO_JP.get(String(slug).toLowerCase()) || null;
}

// Look up the romaji slug of a JP place name. Returns null when no entry.
export function jpToRomaji(jp) {
  if (!jp) return null;
  return JP_TO_ROMAJI.get(String(jp)) || null;
}

// Given any query string, return every form to also try in an ilike
// search: the original, plus the JP form when the query is romaji that
// matches the table, plus the romaji form when the query is JP.
export function expandQuery(q) {
  if (!q) return [];
  const out = new Set([q]);
  const lower = String(q).toLowerCase();
  // Romaji → JP
  if (/^[a-z\-]+$/.test(lower)) {
    const jp = ROMAJI_TO_JP.get(lower);
    if (jp) out.add(jp);
    // Also try every entry whose slug starts with the query — covers
    // partial typing like "shi" → 渋谷区 / 品川区.
    for (const [slug, jp2] of ROMAJI_TO_JP) {
      if (slug.startsWith(lower)) out.add(jp2);
    }
  }
  // JP → romaji (useful when searching from a system that lacks the
  // JP keyboard but the user pasted the JP somehow).
  for (const [jp, romaji] of JP_TO_ROMAJI) {
    if (jp === q) out.add(romaji);
  }
  return [...out];
}
