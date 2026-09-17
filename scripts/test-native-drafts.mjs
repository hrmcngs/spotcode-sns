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
let original = NativeComposerDraft(body: "draft", githubLink: "https://github.com/example/repo", repoFullName: "example/repo", eventURL: "https://example.com/event", eventDays: [PostEventDay(date: "2026-09-17", url: "https://example.com/day1"), PostEventDay(date: "2026-09-18", url: "https://example.com/day2")], kind: "idea", visibility: "only_me", photos: ["data:image/png;base64,dGVzdA=="], poll: PostPoll(question: "Q?", options: ["A", "B"]), spot: Spot(lat: 35, lng: 139, label: "Place", address: "Address"))
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
let oldDraft = Data(#"{"body":"old","githubLink":"","repoFullName":"","eventURL":"","visibility":"public","photos":[]}"#.utf8)
assert(try! JSONDecoder().decode(NativeComposerDraft.self, from: oldDraft).eventDays == nil)
assert(NativeComposerDraft(eventDays: original.eventDays).hasContent)
try! PostEventDay.validate(original.eventDays!)
for day in [PostEventDay(date: "2026-02-30", url: "https://example.com"), PostEventDay(date: "2026-09-17", url: "javascript:alert(1)"), PostEventDay(date: "2026-09-17", url: "")] {
    do { try PostEventDay.validate([day]); fatalError("Invalid day accepted") } catch {}
}
let encoded = try! JSONEncoder().encode(PostDraft(authorID: UUID(), body: "event", githubLink: nil, repoFullName: nil, eventURL: nil, eventDays: original.eventDays, spot: nil, kind: nil, visibility: "public", photos: nil, poll: nil, status: "wip"))
let payload = try! JSONSerialization.jsonObject(with: encoded) as! [String: Any]
assert((payload["event_days"] as? [[String: Any]])?.count == 2)
let oldPost = try! JSONSerialization.data(withJSONObject: ["id": UUID().uuidString, "author_id": UUID().uuidString, "body": "old"])
assert(try! JSONDecoder().decode(Post.self, from: oldPost).eventDays == nil)
print("PASS event-day validation, payload encoding, old drafts/posts, draft attachments, per-account isolation, independent working copies, publish cleanup, legacy migration, activity decoding")
`);
  const result = spawnSync('swift', ['-module-cache-path', path.join(os.tmpdir(), 'spotcode-swift-cache'), file], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
