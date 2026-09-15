import fs from 'node:fs';
import vm from 'node:vm';

// Load the real dictionaries in an isolated language context, without browser IO.
export function createTestI18n(language = 'ja') {
  const context = vm.createContext({
    KEYS: { lang: 'language' }, read: () => language, write() {},
    document: { documentElement: { setAttribute() {} }, querySelectorAll: () => [] },
    location: { reload() {} },
  });
  for (const file of ['ui-messages.js', 'i18n.js']) {
    const source = fs.readFileSync(new URL('../../src/js/' + file, import.meta.url), 'utf8')
      .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
  }
  return context;
}
