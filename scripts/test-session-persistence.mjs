import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const app = fs.readFileSync('ios/App/App/AppModel.swift', 'utf8');
const keychain = fs.readFileSync('ios/App/App/KeychainStore.swift', 'utf8')
  .replaceAll('SecItemUpdate(', 'fakeUpdate(').replaceAll('SecItemAdd(', 'fakeAdd(').replaceAll('SecItemDelete(', 'fakeDelete(');
const methods = app.slice(app.indexOf('    func validSession('), app.indexOf('    static func isExpiredSessionError'));
const models = fs.readFileSync('ios/App/App/NativeModels.swift', 'utf8');
const types = models.slice(models.indexOf('struct AuthUser:'), models.indexOf('struct MFAFactorsResponse:'));
const source = `
import Foundation
import Security
var updateResults: [OSStatus] = []
var addResult = errSecSuccess
var writes = 0
var deletes = 0
var stored = Data([1])
func fakeUpdate(_ query: CFDictionary, _ attributes: CFDictionary) -> OSStatus {
    writes += 1
    let status = updateResults.isEmpty ? errSecSuccess : updateResults.removeFirst()
    if status == errSecSuccess { stored = (attributes as NSDictionary)[kSecValueData] as! Data }
    return status
}
func fakeAdd(_ item: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus {
    writes += 1
    if addResult == errSecSuccess { stored = (item as NSDictionary)[kSecValueData] as! Data }
    return addResult
}
func fakeDelete(_ query: CFDictionary) -> OSStatus { deletes += 1; stored = Data(); return errSecSuccess }
${keychain}
${types}
@MainActor final class SupabaseService {
    static let shared = SupabaseService()
    var calls = 0
    var response: Result<AuthSession, Error>?
    var continuation: CheckedContinuation<AuthSession, Error>?
    func refresh(_ token: String) async throws -> AuthSession {
        calls += 1
        if let response { return try response.get() }
        return try await withCheckedThrowingContinuation { continuation = $0 }
    }
}
struct Profile {}
@MainActor final class Harness {
    var session: AuthSession?
    var me: Profile?
    var requiresReauthentication = false
    var persists = 0
    private var sessionRefresh: (id: UUID, token: String, task: Task<AuthSession, Error>)?
    func persist(_ value: AuthSession) { session = value; persists += 1; requiresReauthentication = false }
    func rememberAccount(session: AuthSession, profile: Profile) {}
${methods}
}
@main struct Regression {
    @MainActor static func main() async throws {
        // Existing item survives write failure, with no delete/recreate window.
        updateResults = [errSecInteractionNotAllowed]
        do { try KeychainStore.save(Data([2]), account: "fixture"); fatalError("expected failure") } catch {}
        assert(stored == Data([1]) && deletes == 0 && writes == 1)
        updateResults = [errSecSuccess]; try KeychainStore.save(Data([3]), account: "fixture")
        assert(stored == Data([3]) && deletes == 0)
        updateResults = [errSecItemNotFound]; addResult = errSecSuccess
        try KeychainStore.save(Data([4]), account: "fixture"); assert(stored == Data([4]))
        updateResults = [errSecItemNotFound, errSecSuccess]; addResult = errSecDuplicateItem
        try KeychainStore.save(Data([5]), account: "fixture"); assert(stored == Data([5]) && deletes == 0)

        let id = UUID()
        func session(_ token: String, owner: UUID = id) -> AuthSession {
            AuthSession(accessToken: "fixture-access", refreshToken: token, expiresAt: 1, user: AuthUser(id: owner, email: nil, factors: nil))
        }
        func api(_ status: Int, _ code: String) -> NSError {
            NSError(domain: "Supabase", code: status, userInfo: [NSLocalizedDescriptionKey: "{\\"code\\":\\"\\(code)\\"}"])
        }
        let service = SupabaseService.shared
        for error in [URLError(.notConnectedToInternet) as Error, URLError(.timedOut), api(503,"unexpected_failure"), api(429,"over_request_rate_limit"), api(401,"unexpected_failure")] {
            let model = Harness(); model.session = session("old")
            service.response = .failure(error)
            do { _ = try await model.validSession(); fatalError("expected failure") } catch {}
            assert(!model.requiresReauthentication && model.session?.refreshToken == "old" && model.persists == 0)
        }
        for code in ["refresh_token_not_found", "refresh_token_already_used", "session_not_found", "session_expired"] {
            let model = Harness(); model.session = session("old")
            service.response = .failure(api(400,code))
            do { _ = try await model.validSession(); fatalError("expected rejection") } catch {}
            assert(model.requiresReauthentication && model.session != nil)
        }
        // Multiple callers share one refresh and commit the rotated token once.
        service.response = nil; service.calls = 0; service.continuation = nil
        let model = Harness(); model.session = session("old")
        let first = Task { try await model.validSession() }
        let second = Task { try await model.validSession() }
        while service.continuation == nil { await Task.yield() }
        for _ in 0..<10 { await Task.yield() }
        assert(service.calls == 1)
        service.continuation?.resume(returning: session("new")); service.continuation = nil
        let a = try await first.value, b = try await second.value
        assert(a.refreshToken == "new" && b.refreshToken == "new" && model.persists == 1)

        // Completion after logout or account switch cannot restore the old user.
        for replacement in [nil, session("other", owner: UUID())] as [AuthSession?] {
            service.continuation = nil
            let model = Harness(); model.session = session("old")
            let task = Task { try await model.validSession() }
            while service.continuation == nil { await Task.yield() }
            model.session = replacement
            service.continuation?.resume(returning: session("new")); service.continuation = nil
            do { _ = try await task.value; fatalError("expected cancellation") } catch is CancellationError {} catch { fatalError("wrong error") }
            assert(model.session?.user.id == replacement?.user.id && model.persists == 0)
        }
        print("PASS keychain update without delete, failed writes preserved, duplicate race, offline/429/5xx retention, rejected refresh, single refresh, logout/account-switch protection")
    }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-session-test-'));
try {
  fs.writeFileSync(path.join(dir, 'Regression.swift'), source);
  execFileSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), path.join(dir, 'Regression.swift'), '-o', path.join(dir, 'test')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'test'), { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
