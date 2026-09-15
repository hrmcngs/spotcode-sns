import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const views = fs.readFileSync('ios/App/App/NativeViews.swift', 'utf8');
const start = views.indexOf('    private func load() async {', views.indexOf('struct RepositoriesView: View'));
const method = views.slice(start, views.indexOf('    private func repositoryName', start)).replace('private func', 'func');
const source = `
import Foundation
struct Repository { var pushedAt: String? = "today" }
struct Post {}
struct User { let id = UUID() }
struct Session { let user = User(); let accessToken = "fixture" }
struct Profile { let githubHandle: String? = "fixture"; let isOrg = false }
struct Result { var repositories: [Repository]? = [] }
@MainActor final class Model {
 var me: Profile? = Profile()
 var session: Session? = Session()
 var errorMessage: String?
 var token: String? = "fixture"
 func hydrateSharedPrivateIssueToken() async -> String? { token }
 func syncGithubOrganizations(includeRepositories: Bool) async throws -> Result { Result() }
}
@MainActor final class SupabaseService {
 static let shared = SupabaseService()
 var authorizedError: Error?
 var publicError: Error?
 var hook: (() -> Void)?
 var publicCalls = 0
 var postCalls = 0
 func authorizedGithubRepositories(handle: String, githubToken: String) async throws -> [Repository] {
  hook?()
  if let authorizedError { throw authorizedError }
  return [Repository()]
 }
 func repositories(handle: String) async throws -> [Repository] {
  publicCalls += 1
  if let publicError { throw publicError }
  return [Repository()]
 }
 func posts(limit: Int, token: String) async throws -> [Post] { postCalls += 1; return [Post()] }
 func reset() { authorizedError = nil; publicError = nil; hook = nil; publicCalls = 0; postCalls = 0 }
}
@MainActor final class Loader {
 let model = Model()
 var repositories: [Repository] = []
 var relatedPosts: [Post] = []
 var repositoryOwner: UUID?
 var repositoryNotice = ""
 var loading = false
 var loadGeneration = UUID()
 ${method}
}
@main struct Checks {
 @MainActor static func main() async {
  let service = SupabaseService.shared
  for error in [CancellationError(), URLError(.cancelled)] as [Error] {
   service.reset(); service.authorizedError = error
   let loader = Loader(); await loader.load()
   precondition(loader.model.errorMessage == nil && loader.repositoryNotice.isEmpty)
   precondition(service.publicCalls == 0 && !loader.loading)
   service.reset(); service.publicError = error
   let publicLoader = Loader(); publicLoader.model.token = nil; await publicLoader.load()
   precondition(publicLoader.model.errorMessage == nil && !publicLoader.loading)
  }
  let signedOut = Loader(); signedOut.loading = true; signedOut.model.session = nil
  await signedOut.load(); precondition(!signedOut.loading)
  service.reset(); service.authorizedError = URLError(.userAuthenticationRequired)
  let fallback = Loader(); await fallback.load()
  precondition(service.publicCalls == 1 && fallback.repositories.count == 1 && !fallback.repositoryNotice.isEmpty)
  service.reset(); service.publicError = URLError(.notConnectedToInternet)
  let offline = Loader(); offline.model.token = nil; await offline.load()
  precondition(offline.model.errorMessage != nil && !offline.loading)
  service.reset()
  let cancelled = Loader()
  service.hook = { withUnsafeCurrentTask { $0?.cancel() } }
  await Task { @MainActor in await cancelled.load() }.value
  precondition(cancelled.repositories.isEmpty && service.postCalls == 0 && cancelled.model.errorMessage == nil)
  service.reset()
  let switched = Loader(); service.authorizedError = URLError(.badServerResponse)
  service.hook = { switched.model.session = Session() }
  await switched.load()
  precondition(service.publicCalls == 0 && switched.model.errorMessage == nil)
  service.reset()
  let stale = Loader(); service.hook = { stale.loadGeneration = UUID() }
  await stale.load()
  precondition(stale.repositories.isEmpty && service.postCalls == 0)
  precondition(stale.loading, "Old completion must not clear newer loading state")
  print("PASS cancellation without alert/fallback, real errors, fallback success, late success, account switch, stale generation")
 }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-repo-cancel-'));
try {
 const file = path.join(dir, 'Checks.swift'); fs.writeFileSync(file, source);
 execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
 execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
