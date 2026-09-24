import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Run only within the project's approved isolated test environment. The extracted
// production methods use in-memory defaults/keychain and a fake network service.
const app = fs.readFileSync('ios/App/App/AppModel.swift', 'utf8');
const between = (start, end) => {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing extraction boundary: ${start}`);
  return app.slice(from, to).replaceAll('UserDefaults.standard', 'MemoryDefaults.standard');
};
const cache = between('enum TimelinePreviewCache', '@MainActor');
const methods = [
  between('    private func finishSignIn(', '    private func prepareMFAIfNeeded('),
  between('    func signOut()', '    func switchToOfficial()'),
  between('    func loadTimeline()', '    func publish('),
  between('    private func clearGithubOrganizations()', '    private func rememberAccount('),
].join('\n');
assert.match(app, /TimelinePreviewCache\.decode\(Post\.self, from: data, owner: session\?\.user\.id\)/);

const source = `
import Foundation
${cache}
struct User: Codable { let id: UUID }
struct AuthSession: Codable { let user: User; let accessToken: String; let refreshToken: String; let expiresAt: Int? }
struct Profile { let id: UUID; var githubHandle: String? = nil }
struct Post: Codable, Equatable { let id: UUID; let createdAt: String?; let visibility: String }
final class MemoryDefaults {
    static let standard = MemoryDefaults()
    var values: [String: Any] = [:]
    func set(_ value: Any?, forKey key: String) { values[key] = value }
    func removeObject(forKey key: String) { values.removeValue(forKey: key) }
    func data(forKey key: String) -> Data? { values[key] as? Data }
}
enum KeychainStore {
    static var values: [String: Data] = [:]
    static func load(account: String) -> Data? { values[account] }
    static func save(_ data: Data, account: String) throws { values[account] = data }
    static func delete(account: String) { values.removeValue(forKey: account) }
}
@MainActor final class SupabaseService {
    static let shared = SupabaseService()
    var postRequest: (() async throws -> [Post])?
    var requests = 0
    func posts(limit: Int = 24, token: String?, before: Post? = nil) async throws -> [Post] {
        requests += 1
        if let postRequest { return try await postRequest() }
        throw URLError(.notConnectedToInternet)
    }
    func profile(id: UUID, token: String) async throws -> Profile? { Profile(id: id) }
    func refresh(_ token: String) async throws -> AuthSession { throw URLError(.notConnectedToInternet) }
}
@MainActor final class Model {
    var session: AuthSession?
    var me: Profile?
    var posts: [Post] = []
    var lastUpdatedPost: Post?
    var deletedPostIDs: Set<UUID> = []
    var timelineGeneration = UUID()
    var timelineCursor: Post?
    var isLoading = false, isLoadingMoreTimeline = false, hasMoreTimelinePosts = false
    var timelinePageError: String?, errorMessage: String?, authenticationError: String?
    var requiresReauthentication = false, sessionRestorePending = false
    var sessionRefresh: (task: Task<AuthSession, Error>, id: UUID)?
    var officialProfile: Profile?
    var pendingMFASession: AuthSession?, pendingMFAFactorID: String?
    var requiresMFA = false
    var isPostingAsOfficial = false
    var blockedOwner: UUID?, mutedOwner: UUID?, githubOrganizationOwner: UUID?
    var blockedAccountIDs: Set<UUID> = [], mutedAccountIDs: Set<UUID> = []
    var githubOrganizations: [String] = []
    var linkedGithubOrganization: String?
    var githubOrganizationExpiry = Date.distantPast
    let cachedPostsKey = "preview", cachedProfileKey = "profile", sessionAccount = "session"
    let signedOutKey = "signed-out", activeAccountKey = "active", savedSessionPrefix = "saved."
    var blockRequest: (() async -> Void)?
    func loadBlocks() async { if let blockRequest { await blockRequest() }; blockedOwner = session?.user.id }
    func loadMutes() async { mutedOwner = session?.user.id }
    func syncGithubOrganizations() async throws {}
    func prepareMFAIfNeeded(_ value: AuthSession) async throws -> Bool { false }
    static func isTransientNetworkError(_ error: URLError) -> Bool { error.code == .notConnectedToInternet }
    func rememberAccount(session: AuthSession, profile: Profile) {}
    func cacheProfile(_ profile: Profile) {}
    func forgetAccount(_ id: UUID) {}
    func switchToPersonalAccount() {}
    func commit(_ value: AuthSession) { persist(value) }
    func login(_ value: AuthSession) async throws { try await finishSignIn(value) }
    func seed(_ rows: [Post]) {
        posts = rows; lastUpdatedPost = rows.first; timelineCursor = rows.last
        hasMoreTimelinePosts = true
        MemoryDefaults.standard.set(TimelinePreviewCache.encode(rows, owner: session?.user.id), forKey: cachedPostsKey)
    }
${methods}
}
@main struct Checks {
    @MainActor static func main() async throws {
        let a = AuthSession(user: User(id: UUID()), accessToken: "a", refreshToken: "a", expiresAt: Int.max)
        let b = AuthSession(user: User(id: UUID()), accessToken: "b", refreshToken: "b", expiresAt: Int.max)
        let rows = ["only_me", "github_org", "following", "mutuals", "public"].map {
            Post(id: UUID(), createdAt: "2026-01-01", visibility: $0)
        }
        let disk = TimelinePreviewCache.encode(rows, owner: a.user.id)!
        precondition(TimelinePreviewCache.decode(Post.self, from: disk, owner: a.user.id) == rows)
        precondition(TimelinePreviewCache.decode(Post.self, from: disk, owner: b.user.id).isEmpty)
        precondition(TimelinePreviewCache.decode(Post.self, from: disk, owner: nil).isEmpty)
        precondition(TimelinePreviewCache.decode(Post.self, from: TimelinePreviewCache.encode(rows), owner: a.user.id).isEmpty)
        precondition(TimelinePreviewCache.encode(rows, owner: nil) == nil)
        let huge = [String(repeating: "x", count: TimelinePreviewCache.maxBytes)]
        precondition(TimelinePreviewCache.encode(huge, owner: a.user.id)!.count <= TimelinePreviewCache.maxBytes)

        let model = Model()
        model.commit(a); model.seed(rows)
        let generation = model.timelineGeneration
        model.commit(a) // Ordinary token persistence must retain the same account's preview.
        precondition(model.posts == rows && model.timelineGeneration == generation)
        precondition(MemoryDefaults.standard.data(forKey: "preview") == disk)
        let loginRequests = SupabaseService.shared.requests
        try await model.login(b)
        precondition(model.posts.isEmpty && model.lastUpdatedPost == nil)
        precondition(!model.hasMoreTimelinePosts && model.timelineCursor == nil)
        precondition(MemoryDefaults.standard.data(forKey: "preview") == nil)
        while SupabaseService.shared.requests == loginRequests { await Task.yield() }

        try KeychainStore.save(JSONEncoder().encode(a), account: "saved." + a.user.id.uuidString)
        model.seed(rows)
        let switched = await model.switchAccount(to: a.user.id)
        precondition(switched && model.posts.isEmpty)
        precondition(MemoryDefaults.standard.data(forKey: "preview") == nil)

        // A pending response must not repopulate either memory or disk after logout,
        // switching, or switching away and back to the original account.
        for transition in 0..<3 {
            model.commit(a); model.seed(rows)
            SupabaseService.shared.postRequest = {
                if transition == 0 { model.signOut() }
                else { model.commit(b); if transition == 2 { model.commit(a) } }
                return rows
            }
            await model.loadTimeline()
            precondition(model.posts.isEmpty && model.lastUpdatedPost == nil)
            precondition(MemoryDefaults.standard.data(forKey: "preview") == nil)
        }
        model.commit(a); model.seed(rows)
        SupabaseService.shared.postRequest = { model.commit(b); return rows }
        await model.loadMoreTimeline()
        precondition(model.posts.isEmpty && !model.hasMoreTimelinePosts)

        // Invalidation must begin before the first await, including block preflight.
        model.commit(a); model.seed(rows)
        model.blockRequest = { model.commit(b) }
        let requests = SupabaseService.shared.requests
        await model.loadTimeline()
        precondition(SupabaseService.shared.requests == requests && model.posts.isEmpty)
        precondition(MemoryDefaults.standard.data(forKey: "preview") == nil)
        // A response captured before a successful deletion cannot revive its row.
        model.blockRequest = nil
        model.commit(a)
        model.deletedPostIDs = [rows[0].id]
        SupabaseService.shared.postRequest = { rows }
        await model.loadTimeline()
        precondition(!model.posts.contains { $0.id == rows[0].id })
        let afterDelete = TimelinePreviewCache.decode(Post.self, from: MemoryDefaults.standard.data(forKey: "preview")!, owner: a.user.id)
        precondition(!afterDelete.contains { $0.id == rows[0].id })
        model.hasMoreTimelinePosts = true
        model.timelineCursor = rows.last
        await model.loadMoreTimeline()
        precondition(!model.posts.contains { $0.id == rows[0].id })
        print("PASS owner-bound restart cache, legacy rejection, login/switch/logout invalidation, same-account persistence, stale page/preflight/deletion responses")
    }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-timeline-account-cache-'));
try {
  const file = path.join(dir, 'Checks.swift');
  fs.writeFileSync(file, source);
  execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
