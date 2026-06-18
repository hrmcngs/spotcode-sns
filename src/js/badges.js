// Skill badges catalogue.
//
// Previous incarnation auto-detected badges by scanning the user's
// GitHub repos via the unauthenticated REST API. That hit GitHub's
// 60 req/h rate limit too easily — a handful of profile views
// burned the budget and the loader either hung or cached empty for
// 24 hours. We switched to self-selection: users pick which language
// badges they want from /settings, the choice persists to
// profiles.skills (text[], Stage 22), and the profile page renders
// straight from that array. Zero network calls in the badge path.
//
// Each entry:
//   id        — unique slug, also the value stored in profiles.skills
//   name      — displayed text
//   tooltip   — explanation copy used in the detail modal
//   abbr      — 2-char fallback shown when the Simple Icons CDN fails
//   colour    — solid hex used for the medal pastel gradient
//   iconSlug  — Simple Icons (CC0) slug for the language logo image

export const BADGES = [
  { id: 'lisper',       name: '始めたて Lisper',        abbr: 'Lp', colour: '#8a4cc4',
    iconSlug: 'commonlisp',
    tooltip: 'Lisp / Common Lisp を使えます' },
  { id: 'typescripter', name: '始めたて TypeScripter',  abbr: 'Ts', colour: '#3178c6',
    iconSlug: 'typescript',
    tooltip: 'TypeScript を使えます' },
  { id: 'jser',         name: '始めたて JavaScripter',  abbr: 'Js', colour: '#f1e05a',
    iconSlug: 'javascript',
    tooltip: 'JavaScript を使えます' },
  { id: 'pythoneer',    name: '始めたて Pythoneer',     abbr: 'Py', colour: '#3776ab',
    iconSlug: 'python',
    tooltip: 'Python を使えます' },
  { id: 'rustacean',    name: '始めたて Rustacean',     abbr: 'Rs', colour: '#dea584',
    iconSlug: 'rust',
    tooltip: 'Rust を使えます' },
  { id: 'gopher',       name: '始めたて Gopher',        abbr: 'Go', colour: '#00add8',
    iconSlug: 'go',
    tooltip: 'Go を使えます' },
  { id: 'javaer',       name: '始めたて Java/Kotlin',   abbr: 'Jv', colour: '#b07219',
    iconSlug: 'openjdk',
    tooltip: 'Java または Kotlin を使えます' },
  { id: 'cppr',         name: '始めたて C/C++',         abbr: 'C+', colour: '#5e6cb0',
    iconSlug: 'cplusplus',
    tooltip: 'C または C++ を使えます' },
  { id: 'webmaker',     name: '始めたて Web Maker',     abbr: 'Wb', colour: '#e34c26',
    iconSlug: 'html5',
    tooltip: 'HTML / CSS を使えます' },
  { id: 'gamedev',      name: '始めたて Game Dev',      abbr: 'Gd', colour: '#c84d96',
    iconSlug: 'godotengine',
    tooltip: 'ゲーム開発系 (Godot / Lua / C# / Processing) を使えます' },
  { id: 'shellr',       name: '始めたて Shell Hacker',  abbr: 'Sh', colour: '#4eaa25',
    iconSlug: 'gnubash',
    tooltip: 'Bash / Zsh などのシェルスクリプトを書けます' },
];

const BADGES_BY_ID = Object.create(null);
for (const b of BADGES) BADGES_BY_ID[b.id] = b;

// Sync lookup used by the profile renderer + detail modal to turn
// a skill id (from profiles.skills) into the full badge object.
export function getBadgeById(id) {
  return BADGES_BY_ID[id] || null;
}
