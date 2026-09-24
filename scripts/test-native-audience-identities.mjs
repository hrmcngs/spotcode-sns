import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const models = fs.readFileSync('ios/App/App/NativeModels.swift', 'utf8');
const views = fs.readFileSync('ios/App/App/NativeViews.swift', 'utf8');
const service = fs.readFileSync('ios/App/App/SupabaseService.swift', 'utf8');
const preferenceWrite = service.slice(service.indexOf('    func updateProfilePreferences('), service.indexOf('    func posts('));
assert.ok(preferenceWrite.includes('"close_friend_ids": closeFriendIDs.map(\\.uuidString)'));
assert.ok(preferenceWrite.includes('"org_member_ids": orgMemberIDs.map(\\.uuidString)'));
assert.ok(!preferenceWrite.includes('"close_friends":') && !preferenceWrite.includes('"org_members":'));
const profile = models.slice(models.indexOf('struct Profile:'), models.indexOf('// Web posts store'));
const menu = views.slice(views.indexOf('private struct FollowAudienceMenu:'), views.indexOf('private enum FollowListKind'));
const membership = menu.slice(menu.indexOf('    private var friends:'), menu.indexOf('    private func change(')).replaceAll('private var', 'var');
assert.ok(views.includes('closeFriendIDs: profile.closeFriendIDs, orgMemberIDs: profile.orgMemberIDs'), 'Edit preview preserves audience identities');
const source = `
import Foundation
${profile}
final class Model { var me: Profile? }
struct Menu {
    let model: Model
    let profile: Profile
${membership}
}
let original = UUID(), replacement = UUID()
func decode(_ id: UUID, _ handle: String, _ extra: [String: Any] = [:]) throws -> Profile {
    var object: [String: Any] = ["id": id.uuidString, "handle": handle, "name": "Fixture"]
    object.merge(extra) { _, next in next }
    return try JSONDecoder().decode(Profile.self, from: JSONSerialization.data(withJSONObject: object))
}
let model = Model()
model.me = try decode(UUID(), "owner", [
    "close_friends": ["old-handle"], "org_members": ["old-handle"],
    "close_friend_ids": [original.uuidString], "org_member_ids": [original.uuidString]
])
let renamed = Menu(model: model, profile: try decode(original, "renamed"))
precondition(renamed.friends && renamed.organization)
let reclaimed = Menu(model: model, profile: try decode(replacement, "old-handle"))
precondition(!reclaimed.friends && !reclaimed.organization)
let roundTrip = try JSONDecoder().decode(Profile.self, from: JSONEncoder().encode(model.me!))
precondition(roundTrip.closeFriendIDs == [original] && roundTrip.orgMemberIDs == [original])
model.me = try decode(UUID(), "legacy", ["close_friends": ["old-handle"], "org_members": ["old-handle"]])
precondition(model.me?.closeFriendIDs == nil && !reclaimed.friends && !reclaimed.organization)
var bindings = AudienceIdentityBindings()
bindings.capture(handles: ["old-handle"], ids: [original])
let retained = try bindings.identity(for: " @old-handle ")
precondition(retained == original) // Rename/reassignment never triggers another lookup.
let unresolved = try bindings.identity(for: "new-handle")
precondition(unresolved == nil)
bindings.remember(replacement, for: "new-handle")
let retried = try bindings.identity(for: "new-handle")
precondition(retried == replacement) // A failed PATCH retries with the captured UUID.
var legacy = AudienceIdentityBindings()
legacy.capture(handles: ["old-handle"], ids: nil)
do {
    _ = try legacy.identity(for: "old-handle")
    fatalError("Legacy retained handles must not be rebound")
} catch { }
var mismatched = AudienceIdentityBindings()
mismatched.capture(handles: ["old-handle", "another"], ids: [original])
do {
    _ = try mismatched.identity(for: "another")
    fatalError("Unpaired snapshots must fail closed")
} catch { }
var conflicting = AudienceIdentityBindings()
conflicting.capture(handles: ["old-handle"], ids: [original])
conflicting.capture(handles: ["old-handle"], ids: [replacement])
do {
    _ = try conflicting.identity(for: "old-handle")
    fatalError("Conflicting historical labels must not change the grant")
} catch { }
print("PASS native audience UUID decoding/writes, rename/reclaimed-handle isolation, retry bindings, legacy rejection, cache round trip")
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-native-audience-'));
try {
  const file = path.join(dir, 'Checks.swift');
  fs.writeFileSync(file, source);
  execFileSync('swiftc', ['-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
