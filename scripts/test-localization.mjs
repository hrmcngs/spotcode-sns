import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createTestI18n } from './helpers/i18n.mjs';

const source = file => fs.readFileSync(new URL('../src/js/' + file, import.meta.url), 'utf8');
const strip = file => source(file).replace(/^import [\s\S]*?;\n/gm, '').replace(/^export /gm, '')
  .replaceAll('import.meta.url', JSON.stringify(new URL('../src/js/' + file, import.meta.url).href));
assert.equal(createTestI18n(null).getLang(), 'en', 'Unset language defaults to English');
assert.equal(createTestI18n('unsupported').getLang(), 'en');
const tables = createTestI18n();
const dictionaries = vm.runInContext('({ DICT, UI_EN, UI_JA })', tables);
const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
assert.deepEqual(Object.keys(dictionaries.DICT.ja).sort(), Object.keys(dictionaries.DICT.en).sort());
for (const [key, japanese] of Object.entries(dictionaries.DICT.ja)) {
  assert.deepEqual(slots(japanese), slots(dictionaries.DICT.en[key]), `Placeholder mismatch: ${key}`);
}
for (const [key, english] of Object.entries(dictionaries.UI_EN)) {
  assert.deepEqual(slots(key), slots(english), `Placeholder mismatch: ${key}`);
  assert.ok(!/[ぁ-んァ-ヶ一-龠]/.test(english), `Japanese in English UI: ${key}`);
}
// Check actual call sites so newly added feature messages cannot silently fall
// back to a Japanese key when English is selected.
for (const file of fs.readdirSync(new URL('../src/js/', import.meta.url), { recursive: true }).filter(f => f.endsWith('.js'))) {
  if (['ui-messages.js', 'i18n.js'].includes(file)) continue;
  for (const match of source(file).matchAll(/\bt\(\s*((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*'))\s*[,)]/g)) {
    const key = vm.runInNewContext(match[1]);
    assert.ok(Object.hasOwn(dictionaries.DICT.en, key) || Object.hasOwn(dictionaries.UI_EN, key) || Object.hasOwn(dictionaries.UI_JA, key), `${file}: missing ${key}`);
  }
}
for (const language of ['ja', 'en']) {
  const i18n = createTestI18n(language);
  const ctx = vm.createContext({ ...i18n, URL, console,
    currentUser: () => ({ id: 'me', handle: 'me', name: 'Alice' }),
    icon: () => '', url: path => '#'+path,
    document: { addEventListener() {}, visibilityState: 'visible' },
    window: { __BASE__: '/', addEventListener() {} },
  });
  vm.runInContext(strip('business-cards.js'), ctx);
  vm.runInContext(strip('views/business-card.js'), ctx);
  const editor = vm.runInContext('editor(normalizeCard({name:"Alice"}), true)', ctx);
  assert.ok(editor.includes(language === 'ja' ? '保存して公開' : 'Save and publish'));
  assert.ok(editor.includes(language === 'ja' ? 'リンク1の表示名' : 'Link 1 label'));
  assert.ok(editor.includes(language === 'ja' ? '画像を差し込む' : 'Insert an image'));
  assert.ok(editor.includes('value="front"') && editor.includes('value="classic"'), 'Stored values must not be translated');
  if (language === 'en') assert.ok(!/[ぁ-んァ-ヶ一-龠]/.test(editor), 'Card editor must be fully English');
  const body = vm.runInContext('cardMarkup({ name:"山田", title:"Original title", bio:"入力した自己紹介", design:{frontLabel:"MY LABEL"}}, "me")', ctx);
  assert.ok(body.includes('山田') && body.includes('入力した自己紹介') && body.includes('MY LABEL'), 'User-authored content must stay unchanged');
  assert.ok(body.includes(language === 'ja' ? '名刺を裏返す' : 'Flip business card'));
  assert.equal(i18n.t('保存した名刺 {n} 枚', { n: 3 }), language === 'ja' ? '保存した名刺 3 枚' : 'Saved cards: 3');
  assert.equal(i18n.t('{date} に保存', { date: 'DATE' }), language === 'ja' ? 'DATE に保存' : 'Saved on DATE');
  assert.equal(i18n.getLocale(), language === 'ja' ? 'ja-JP' : 'en-US');
  vm.runInContext(strip('views/auth-modal.js'), ctx);
  const auth = ctx.template();
  assert.ok(auth.includes(language === 'ja' ? 'メールアドレス / ユーザー名' : 'Email / Username'));
  assert.ok(auth.includes(language === 'ja' ? 'アカウントを作成' : 'Create account'));
  assert.ok(auth.includes('value="programmer"') && auth.includes('value="org"'), 'Account roles must remain protocol values');
  if (language === 'en') assert.ok(!/[ぁ-んァ-ヶ一-龠]/.test(auth), 'Authentication controls must be fully English');
  ctx.renderAvatar = () => '';
  ctx.isPostingAsOfficial = () => false;
  vm.runInContext(strip('idea-post.js'), ctx);
  const composer = ctx.renderIdeaForm({user:{handle:'me',name:'Alice'}});
  assert.ok(composer.includes('data-compose-kind="idea"'));
  assert.ok(composer.includes('data-compose-tool="poll"') && composer.includes('data-compose-tool="code"'));
  assert.ok(composer.includes(language === 'ja' ? '投票を作成' : 'Create poll'));
  vm.runInContext(strip('views/timeline-tabs.js'), ctx);
  assert.ok(ctx.timelineTabs('foryou').includes(language === 'ja' ? 'すべて' : 'All'));
  vm.runInContext(source('notif-poller.js').slice(source('notif-poller.js').indexOf('function formatNotif('), source('notif-poller.js').indexOf('\nasync function', source('notif-poller.js').indexOf('function formatNotif('))), ctx);
  ctx.routeUrl = path => path;
  const notification = ctx.formatNotif({type:'followed_post',actor:{name:'Alice'},district:'Tokyo',post:{id:'1',body:'Original post'}});
  assert.equal(notification.title, language === 'ja' ? 'AliceさんがTokyoで投稿しました' : 'Alice posted in Tokyo');
  assert.equal(notification.body, 'Original post');
  // Draft IDs must survive localization; these values are used by the API.
  const storage = new Map();
  ctx.localStorage = {getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  vm.runInContext(strip('drafts.js'), ctx);
  ctx.saveDraft('me', {body:'Text',kind:'idea'});
  assert.equal(ctx.loadDraft('me').kind, 'idea');
}
const switching = createTestI18n('en');
let saved, reloads = 0;
switching.write = (_, value) => { saved = value; };
switching.location.reload = () => { reloads++; };
assert.equal(switching.setLang('ja'), true);
assert.equal(saved, 'ja');
assert.equal(switching.t('nav.home'), 'ホーム');
assert.equal(switching.setLang('invalid'), false);
assert.equal(reloads, 1);
console.log('PASS bilingual dictionaries, coverage, placeholders, business cards, auth, notifications, locale switching, user content and stable data IDs');
