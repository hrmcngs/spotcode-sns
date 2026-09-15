import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const service = fs.readFileSync('ios/App/App/SupabaseService.swift', 'utf8');
const method = service.slice(service.indexOf('    func posts('), service.indexOf('    func postInteractionState('));
const views = fs.readFileSync('ios/App/App/NativeViews.swift', 'utf8');
assert.match(views, /selectedTab == 1\s*\{\s*FollowingTimelineView\(\)/);
const source = `
import Foundation
struct Post { let id: UUID; let createdAt: String? }
struct Profile { let id: UUID? }
final class Service {
 var supportedPostMetadata = ["visibility"]
 var targets: [Profile] = []
 var paths: [String] = []
 var failFollows = false
 func following(userID: UUID, token: String?) async throws -> [Profile] {
  if failFollows { throw URLError(.notConnectedToInternet) }
  return targets
 }
 func request(_ path: String, token: String?) async throws -> [Post] { paths.append(path); return [] }
 ${method}
}
@main struct Checks {
 static func main() async throws {
  let service = Service(), owner = UUID(), followed = UUID()
  _ = try await service.posts(followingUserID: owner)
  precondition(service.paths.isEmpty, "No follows must never request the public feed")
  service.targets = [Profile(id: followed)]
  let cursor = Post(id: UUID(), createdAt: "2026-09-15T10:00:00Z")
  _ = try await service.posts(before: cursor, followingUserID: owner)
  let query = service.paths.last!
  precondition(query.contains("author_id.in.(" + followed.uuidString + ")"))
  precondition(query.contains("organization_author_id.in.(" + followed.uuidString + ")"))
  precondition(query.contains("&and=(or("))
  precondition(query.contains("id.lt." + cursor.id.uuidString))
  precondition(query.contains("order=created_at.desc,id.desc"))
  _ = try await service.posts()
  precondition(!service.paths.last!.contains("author_id.in."), "For you stays independent")
  service.failFollows = true
  let count = service.paths.count
  do { _ = try await service.posts(followingUserID: owner); fatalError("Must surface errors") }
  catch { precondition(service.paths.count == count) }
  print("PASS Following routing, empty follows, personal/organization filter, pagination, independent For you, fetch failure")
 }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-following-'));
try {
 const file = path.join(dir, 'Checks.swift'); fs.writeFileSync(file, source);
 execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
 execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
