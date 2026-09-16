import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-drafts-'));
try {
  const source = fs.readFileSync('ios/App/App/NativeModels.swift', 'utf8');
  const file = path.join(dir, 'main.swift');
  fs.writeFileSync(file, source + `
let suite = "spotcode-draft-test-" + UUID().uuidString
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite) }
let original = NativeComposerDraft(body: "draft", githubLink: "https://github.com/example/repo", repoFullName: "example/repo", eventURL: "https://example.com/event", kind: "idea", visibility: "only_me", photos: ["data:image/png;base64,dGVzdA=="], poll: PostPoll(question: "Q?", options: ["A", "B"]), spot: Spot(lat: 35, lng: 139, label: "Place", address: "Address"))
NativeDraftStore.save(original, account: "alice", slot: "saved", defaults: defaults)
assert(NativeDraftStore.load(account: "alice", slot: "saved", defaults: defaults) == original)
assert(NativeDraftStore.load(account: "bob", slot: "saved", defaults: defaults) == nil)
NativeDraftStore.save(NativeComposerDraft(), account: "alice", slot: "sheet", defaults: defaults)
assert(NativeDraftStore.load(account: "alice", slot: "saved", defaults: defaults) == original)
NativeDraftStore.save(NativeComposerDraft(body: "other editor"), account: "alice", slot: "inline", defaults: defaults)
assert(NativeDraftStore.load(account: "alice", slot: "sheet", defaults: defaults)?.hasContent == false)
NativeDraftStore.clearSaved(matching: NativeComposerDraft(body: "different post"), account: "alice", defaults: defaults)
assert(NativeDraftStore.load(account: "alice", slot: "saved", defaults: defaults) == original)
let generation = NativeDraftStore.generation(account: "alice", slot: "sheet", defaults: defaults)
NativeDraftStore.completePublishing(original, account: "alice", slot: "sheet", defaults: defaults)
assert(NativeDraftStore.generation(account: "alice", slot: "sheet", defaults: defaults) != generation)
assert(NativeDraftStore.load(account: "alice", slot: "sheet", defaults: defaults)?.hasContent == false)
assert(NativeDraftStore.load(account: "alice", slot: "saved", defaults: defaults) == nil)
defaults.set("previous draft", forKey: "spotcode.native.draft")
NativeDraftStore.migrateLegacy(account: "guest", defaults: defaults)
assert(defaults.string(forKey: "spotcode.native.draft") == "previous draft")
NativeDraftStore.migrateLegacy(account: "alice", defaults: defaults)
assert(NativeDraftStore.load(account: "alice", slot: "saved", defaults: defaults)?.body == "previous draft")
NativeDraftStore.migrateLegacy(account: "bob", defaults: defaults)
assert(NativeDraftStore.load(account: "bob", slot: "saved", defaults: defaults) == nil)
let activity = try! JSONDecoder().decode(NativePostActivity.self, from: Data(#"{"created_at":"2026-09-16","user":{"handle":"alice","name":"Alice"}}"#.utf8))
assert(activity.user?.handle == "alice")
print("PASS draft attachments, per-account isolation, independent working copies, publish cleanup, legacy migration, activity decoding")
`);
  const result = spawnSync('swift', ['-module-cache-path', path.join(os.tmpdir(), 'spotcode-swift-cache'), file], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
