import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const app = fs.readFileSync('ios/App/App/AppDelegate.swift', 'utf8');
let implementation = app.slice(app.indexOf('enum AppLocalization {'), app.indexOf('final class AppDelegate:'));
// Test the production lookup against the actual catalogues, with isolated preferences.
implementation = implementation.replaceAll('UserDefaults.standard', 'testDefaults').replaceAll('Bundle.main', 'resources').replaceAll('= .main', '= resources').replaceAll('== .main', '== resources');
const views = fs.readFileSync('ios/App/App/NativeViews.swift', 'utf8');
assert(views.includes('AppLocalization.select($0)'));
assert(views.includes('.id(appLanguage)'));
assert(views.includes('.environment(\\.locale, Locale(identifier: appLanguage))'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-language-'));
const bundle = path.join(dir, 'Resources.bundle'); fs.mkdirSync(bundle);
for (const language of ['en', 'ja']) fs.cpSync(`ios/App/App/${language}.lproj`, path.join(bundle, `${language}.lproj`), { recursive: true });
fs.writeFileSync(path.join(bundle, 'Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>test.language</string><key>CFBundleDevelopmentRegion</key><string>en</string></dict></plist>`);
const swift = `
import Foundation
let resources = Bundle(path: CommandLine.arguments[1])!
let suite = "spotcode-language-test-" + UUID().uuidString
let testDefaults = UserDefaults(suiteName: suite)!
defer { testDefaults.removePersistentDomain(forName: suite) }
${implementation}
for language in ["en", "ja", "en", "ja"] {
 AppLocalization.select(language)
 precondition(AppLocalization.language == language)
 precondition(testDefaults.stringArray(forKey: "AppleLanguages")?.first == language)
 precondition(NSLocalizedString("名刺を共有", comment: "") == (language == "en" ? "Share business card" : "名刺を共有"))
 precondition(NSLocalizedString("Language", comment: "") == (language == "en" ? "Language" : "言語"))
 precondition(UserDefaults(suiteName: suite)!.string(forKey: AppLocalization.preferenceKey) == language)
}
AppLocalization.select("unsupported")
precondition(AppLocalization.language == "ja")
precondition(NSLocalizedString("missing-key", comment: "") == "missing-key")
print("PASS live English/Japanese switching, actual catalogues, persistence, invalid preference, missing-key fallback")
`;
try {
 const file = path.join(dir, 'Checks.swift'); fs.writeFileSync(file, swift);
 execFileSync('swift', ['-module-cache-path', path.join(dir, 'cache'), file, bundle], { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
