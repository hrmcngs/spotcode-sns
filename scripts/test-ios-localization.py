#!/usr/bin/env python3
"""Audit native translations and exercise the real authentication error mapper."""
import json
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'ios/App/App'
STRING = r'"(?:[^"\\\n]|\\.)*"'
JAPANESE = re.compile('[ぁ-んァ-ヶ一-龠]')


def dictionary(language):
    entries = re.findall(f'({STRING})\\s*=\\s*({STRING})\\s*;',
                         (APP / f'{language}.lproj/Localizable.strings').read_text())
    result = {}
    for key, value in entries:
        key, value = json.loads(key), json.loads(value)
        assert key not in result, f'Duplicate {language} key: {key}'
        result[key] = value
    return result


en, ja = dictionary('en'), dictionary('ja')
for filename in ['AppModel.swift', 'SupabaseService.swift', 'NativeViews.swift']:
    for line in (APP / filename).read_text().splitlines():
        if line.lstrip().startswith('//'):
            continue
        for token in re.findall(STRING, line):
            if not JAPANESE.search(token):
                continue
            assert r'\(' not in token, f'Use a stable format key: {token}'
            key = json.loads(token)
            assert key in en and key in ja, f'Missing translation: {key}'
            assert not JAPANESE.search(en[key]), f'Japanese in English translation: {key}'
            assert re.findall(r'%(?:\d+\$)?(?:lld|ld|d|@)', key) == re.findall(
                r'%(?:\d+\$)?(?:lld|ld|d|@)', en[key]), f'Format mismatch: {key}'

source = (APP / 'AppModel.swift').read_text()
start = source.index('    private static func authenticationMessage(')
end = source.index('\n    private func finishSignIn', start)
mapper = source[start:end].replace('private static func', 'func', 1)
with tempfile.TemporaryDirectory(prefix='spotcode-localization-test-') as directory:
    runner = Path(directory) / 'main.swift'
    runner.write_text('''import Foundation
let app = CommandLine.arguments[1]
var language = "en"
func NSLocalizedString(_ key: String, comment: String) -> String {
    Bundle(path: app + "/" + language + ".lproj")!.localizedString(forKey: key, value: nil, table: nil)
}
''' + mapper + '''
for lang in ["en", "ja"] {
    language = lang
    let expected = NSLocalizedString("メールアドレス／ログイン名、またはパスワードが正しくありません。", comment: "")
    for code in [400, 401] {
        for message in ["Invalid login credentials", "{\\"message\\":\\"Invalid login credentials\\"}"] {
            let error = NSError(domain: "Supabase", code: code, userInfo: [NSLocalizedDescriptionKey: message])
            precondition(authenticationMessage(for: error) == expected)
        }
    }
    precondition(authenticationMessage(for: URLError(.timedOut)) == NSLocalizedString("ログイン処理がタイムアウトしました。もう一度お試しください。", comment: ""))
    precondition(authenticationMessage(for: URLError(.notConnectedToInternet)) == NSLocalizedString("サーバーに接続できません。通信状態を確認して、もう一度お試しください。", comment: ""))
    let title = String(format: NSLocalizedString("%@さんが%@で投稿しました", comment: ""), "Alice", "Tokyo")
    precondition(title == (lang == "en" ? "Alice posted in Tokyo" : "AliceさんがTokyoで投稿しました"))
    let due = String(format: NSLocalizedString("あと%lld日", comment: ""), Int64(3))
    precondition(due == (lang == "en" ? "3 days left" : "あと3日"))
}
print("Native localization: English/Japanese authentication, notifications, and deadline checks passed.")
''')
    subprocess.run(['swift', '-module-cache-path', directory + '/cache', str(runner), str(APP)], check=True)
print('Native translation coverage and format checks passed.')
