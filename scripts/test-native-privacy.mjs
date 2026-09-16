import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const source = fs.readFileSync('ios/App/App/NativeModels.swift', 'utf8');
const profile = source.slice(source.indexOf('struct Profile:'), source.indexOf('// Web posts'));
const privacy = source.slice(source.indexOf('// Presentation-only anonymity:'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-privacy-'));
try {
  const file = path.join(directory, 'main.swift');
  fs.writeFileSync(file, 'import Foundation\n' + profile + privacy + `
func profile(_ handle: String, admin: Bool = false) -> Profile {
    let data = try! JSONSerialization.data(withJSONObject: ["handle": handle, "name": "Real name", "avatar_url": "https://example.com/avatar.png", "is_admin": admin])
    return try! JSONDecoder().decode(Profile.self, from: data)
}
let other = profile("alice")
UserDefaults.standard.setVolatileDomain([NativePrivacy.preferenceKey: true], forName: UserDefaults.argumentDomain)
NativePrivacy.currentProfile = profile("spotcode_dev")
assert(NativePrivacy.enabled)
assert(other.visibleHandle == "user_13e7")
assert(other.visibleName == "User 13e7")
assert(other.visibleAvatarURL == nil && other.visibleInitial == "U")
assert(other.handle == "alice" && other.name == "Real name")
assert(NativePrivacy.currentProfile!.visibleHandle == "spotcode_dev")
assert(NativePrivacy.currentProfile!.visibleAvatarURL != nil)
assert(NativePrivacy.text("Hi @alice and @spotcode_dev, email@alice.example") == "Hi @user_13e7 and @spotcode_dev, email@alice.example")
NativePrivacy.currentProfile = profile("regular")
assert(!NativePrivacy.enabled && other.visibleHandle == "alice")
NativePrivacy.currentProfile = profile("admin", admin: true)
assert(NativePrivacy.enabled)
UserDefaults.standard.setVolatileDomain([NativePrivacy.preferenceKey: false], forName: UserDefaults.argumentDomain)
assert(!NativePrivacy.enabled && other.visibleAvatarURL != nil)
NativePrivacy.currentProfile = nil
assert(!NativePrivacy.canUse)
print("PASS privacy gating, own identity, stable Web-compatible aliases, avatars, mentions, raw data preservation")
`);
  const result = spawnSync('swift', [file], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
