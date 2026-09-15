import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const app = fs.readFileSync('ios/App/App/AppModel.swift', 'utf8');
const wrapper = app.slice(app.indexOf('    func withRefreshedSession<T>'), app.indexOf('    func signOut()'));
const expired = app.slice(app.indexOf('    static func isExpiredSessionError('), app.indexOf('    // False means email confirmation'));
const views = fs.readFileSync('ios/App/App/NativeViews.swift', 'utf8');
const rail = views.slice(views.indexOf('private struct DesktopCommunity'), views.indexOf('private struct DesktopRailCard'));
assert.ok(rail.includes('model.withRefreshedSession'));
assert.ok(!rail.includes('model.session?.accessToken'), 'Sidebar must not bypass session refresh');
const source = `
import Foundation
struct User { let id: UUID }
struct Session { let user: User; let accessToken: String }
final class Model {
    var session: Session? = Session(user: User(id: UUID()), accessToken: "old")
    var requests = 0
    var refreshes = 0
    func validSession(forceRefresh: Bool = false) async throws -> Session {
        requests += 1
        guard let old = session else { throw CancellationError() }
        if forceRefresh {
            refreshes += 1
            session = Session(user: old.user, accessToken: "new")
        }
        return session!
    }
${expired}
${wrapper}
}
@main struct Checks {
    static func main() async throws {
        let expired = NSError(domain: "Supabase", code: 401, userInfo: [NSLocalizedDescriptionKey: #"{"code":"PGRST303","message":"JWT expired"}"#])
        let model = Model()
        var tokens: [String] = []
        let result = try await model.withRefreshedSession { token in
            tokens.append(token)
            if token == "old" { throw expired }
            return ["Alice"]
        }
        precondition(result == ["Alice"] && tokens == ["old", "new"] && model.refreshes == 1)
        let rejected = Model()
        var attempts = 0
        do {
            let _: Int = try await rejected.withRefreshedSession { _ in attempts += 1; throw expired }
            fatalError("Expected rejection")
        } catch {
            precondition(attempts == 2 && rejected.refreshes == 1)
            precondition(!error.localizedDescription.contains("PGRST303"))
        }
        let offline = Model()
        do {
            let _: Int = try await offline.withRefreshedSession { _ in throw URLError(.notConnectedToInternet) }
            fatalError("Expected offline failure")
        } catch { precondition(offline.refreshes == 0) }
        for fails in [false, true] {
            let switched = Model()
            do {
                let _: Int = try await switched.withRefreshedSession { _ in
                    switched.session = Session(user: User(id: UUID()), accessToken: "other")
                    if fails { throw expired }
                    return 1
                }
                fatalError("Discard the old account's response")
            } catch is CancellationError { precondition(switched.refreshes == 0) }
        }
        print("PASS native authenticated requests: expired JWT refresh, bounded retry, readable error, offline behavior, account isolation")
    }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-auth-request-'));
try {
  const file = path.join(dir, 'Checks.swift'); fs.writeFileSync(file, source);
  execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
