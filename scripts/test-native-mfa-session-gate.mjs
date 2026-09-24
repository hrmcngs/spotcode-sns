import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const app = fs.readFileSync('ios/App/App/AppModel.swift', 'utf8');
const gate = app.slice(app.indexOf('    private func prepareMFAIfNeeded('), app.indexOf('    func currentMFAFactor('))
  .replaceAll('UserDefaults.standard', 'MemoryDefaults.standard');
for (const [start, end] of [
  ['    func bootstrap()', '    /// Returns a usable session'],
  ['    func switchAccount(', '    func switchToOfficial()'],
]) {
  const method = app.slice(app.indexOf(start), app.indexOf(end));
  assert.ok(method.indexOf('prepareMFAIfNeeded(') >= 0);
  assert.ok(method.indexOf('prepareMFAIfNeeded(') < method.indexOf('SupabaseService.shared.profile('));
}
const source = `
import Foundation
struct User { let id: UUID }
struct AuthSession { let user: User; let accessToken: String; let refreshToken: String }
struct Factor { let id: String; let status: String }
final class MemoryDefaults {
    static let standard = MemoryDefaults()
    var values: [String: String] = [:]
    func removeObject(forKey key: String) { values.removeValue(forKey: key) }
}
@MainActor final class SupabaseService {
    static let shared = SupabaseService()
    var factors: [Factor] = []
    var beforeReturn: (() -> Void)?
    var requests = 0
    func mfaFactors(token: String) async throws -> [Factor] {
        requests += 1; beforeReturn?(); return factors
    }
}
@MainActor final class Model {
    var session: AuthSession?, pendingMFASession: AuthSession?
    var pendingMFAFactorID: String?, authenticationError: String?
    var me: String? = "cached", officialProfile: String? = "official"
    var posts = ["private"], isPostingAsOfficial = true, requiresMFA = false
    var sessionRefresh: (task: Task<AuthSession, Error>, id: UUID)?
    let cachedProfileKey = "profile"
    var invalidations = 0
    func clearGithubOrganizations() { invalidations += 1; posts = [] }
    func prepare(_ value: AuthSession) async throws -> Bool { try await prepareMFAIfNeeded(value) }
${gate}
}
@main struct Checks {
    @MainActor static func main() async throws {
        func token(_ aal: String) -> String {
            let data = try! JSONSerialization.data(withJSONObject: ["aal": aal])
            return "header." + data.base64EncodedString() + ".signature"
        }
        let owner = UUID()
        let first = AuthSession(user: User(id: owner), accessToken: token("aal1"), refreshToken: "first")
        let second = AuthSession(user: User(id: owner), accessToken: token("aal2"), refreshToken: "second")
        let service = SupabaseService.shared
        service.factors = [Factor(id: "verified-factor", status: "verified")]
        let restored = Model(); restored.session = first
        MemoryDefaults.standard.values["profile"] = "private profile"
        let challenged = try await restored.prepare(first)
        precondition(challenged && restored.requiresMFA && restored.pendingMFAFactorID == "verified-factor")
        precondition(restored.session == nil && restored.me == nil && restored.posts.isEmpty)
        precondition(restored.officialProfile == nil && !restored.isPostingAsOfficial)
        precondition(MemoryDefaults.standard.values["profile"] == nil)
        let switched = Model()
        switched.session = AuthSession(user: User(id: UUID()), accessToken: token("aal2"), refreshToken: "other")
        let switchChallenge = try await switched.prepare(first)
        precondition(switchChallenge && switched.posts.isEmpty && switched.pendingMFASession?.user.id == owner)
        let authenticated = Model(); authenticated.session = second
        let requests = service.requests
        let needsChallenge = try await authenticated.prepare(second)
        precondition(!needsChallenge && service.requests == requests && authenticated.posts == ["private"])
        service.factors = [Factor(id: "unverified", status: "unverified")]
        let unenrolled = Model(); unenrolled.session = first
        let enrollChallenge = try await unenrolled.prepare(first)
        precondition(!enrollChallenge && unenrolled.session != nil && unenrolled.invalidations == 0)
        service.factors = [Factor(id: "verified-factor", status: "verified")]
        let stale = Model(); stale.session = first
        service.beforeReturn = { stale.session = second }
        do {
            _ = try await stale.prepare(first)
            fatalError("A stale factor lookup must not replace a newer session")
        } catch is CancellationError { precondition(stale.invalidations == 0 && !stale.requiresMFA) }
        print("PASS native restored/switched MFA gate, preview clearing, aal2 continuity, unenrolled account, stale lookup")
    }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-native-mfa-gate-'));
try {
  const file = path.join(dir, 'Checks.swift');
  fs.writeFileSync(file, source);
  execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
