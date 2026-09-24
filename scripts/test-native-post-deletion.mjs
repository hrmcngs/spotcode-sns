import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Extract production code; use dummy principals, memory-only storage and service.
const app = fs.readFileSync('ios/App/App/AppModel.swift', 'utf8');
const between = (start, end) => {
  const first = app.indexOf(start), last = app.indexOf(end, first + start.length);
  assert(first >= 0 && last > first);
  return app.slice(first, last).replaceAll('UserDefaults.standard', 'MemoryDefaults.standard');
};
const cache = between('enum TimelinePreviewCache', '@MainActor');
const deletion = between('    func deletePost(', '    func updateProfile(');
const code = `
import Foundation
${cache}
struct User { let id: UUID }
struct Session { let user: User; let accessToken: String }
struct Profile { let id: UUID; var isAdmin = false; var isOperator = false }
struct Post: Codable { let id: UUID; let authorID: UUID }
final class MemoryDefaults {
    static let standard = MemoryDefaults()
    var values: [String: Data] = [:]
    func bool(forKey: String) -> Bool { false }
    func set(_ value: Data?, forKey key: String) { values[key] = value }
}
@MainActor final class SupabaseService {
    static let shared = SupabaseService()
    var fails = false
    var duringDelete: (() -> Void)?
    func deletePost(id: UUID, token: String) async throws {
        duringDelete?()
        if fails { throw URLError(.notConnectedToInternet) }
    }
}
@MainActor final class Model {
    var session: Session?
    var me: Profile?
    var displayProfile: Profile? { me }
    var posts: [Post] = []
    var lastUpdatedPost: Post?
    var deletedPostIDs: Set<UUID> = []
    var errorMessage: String?
    let cachedPostsKey = "dummy-preview"
${deletion}
}
@main struct Checks {
    @MainActor static func main() async {
        let owner = UUID(), other = UUID()
        let removed = Post(id: UUID(), authorID: owner)
        let retained = Post(id: UUID(), authorID: owner)
        let model = Model()
        model.session = Session(user: User(id: owner), accessToken: "dummy")
        model.me = Profile(id: owner)
        model.posts = [removed, retained]
        model.lastUpdatedPost = removed
        SupabaseService.shared.fails = true
        let failed = await model.deletePost(removed)
        precondition(!failed && model.posts.count == 2 && model.deletedPostIDs.isEmpty)
        SupabaseService.shared.fails = false
        let success = await model.deletePost(removed)
        precondition(success && model.posts.map(\\.id) == [retained.id])
        precondition(model.deletedPostIDs == [removed.id] && model.lastUpdatedPost == nil)
        let cached = TimelinePreviewCache.decode(Post.self, from: MemoryDefaults.standard.values[model.cachedPostsKey]!, owner: owner)
        precondition(cached.map(\\.id) == [retained.id])
        SupabaseService.shared.duringDelete = {
            model.session = Session(user: User(id: other), accessToken: "other-dummy")
            model.posts = []
        }
        _ = await model.deletePost(retained)
        precondition(!model.deletedPostIDs.contains(retained.id))
        print("PASS deletion success/failure, shared invalidation, persisted preview, account-switch completion")
    }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-post-deletion-'));
try {
  const file = path.join(dir, 'Checks.swift');
  fs.writeFileSync(file, code);
  execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
