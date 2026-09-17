import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const models = fs.readFileSync('ios/App/App/NativeModels.swift', 'utf8');
const source = fs.readFileSync('ios/App/App/SupabaseService.swift', 'utf8');
const methods = source.slice(source.indexOf('    func createPost('), source.indexOf('    func deletePost('));
const swift = models + `
final class TestService {
 var supportedPostMetadata = ["repo_full_name", "kind", "visibility", "github_org_id", "event_url", "event_days", "poll"]
 var missingDays = false
 var requests = 0
 var payload: [String: Any] = [:]
 func request<T>(_ path: String, method: String, token: String, body: Data, preferRepresentation: Bool) async throws -> T {
  requests += 1
  payload = try JSONSerialization.jsonObject(with: body) as! [String: Any]
  if missingDays && (path.contains("event_days") || payload["event_days"] != nil) {
   throw NSError(domain: "Server", code: 400, userInfo: [NSLocalizedDescriptionKey: "Could not find the 'event_days' column in the schema cache"])
  }
  var row = payload
  row["id"] = UUID().uuidString
  row["author_id"] = UUID().uuidString
  return [try JSONDecoder().decode(Post.self, from: JSONSerialization.data(withJSONObject: row))] as! T
 }
` + methods + `
}
@main struct Checks {
 static func main() async throws {
  let days = [PostEventDay(date: "2026-09-17", url: "https://example.com/1"), PostEventDay(date: "2026-09-18", url: "https://example.com/2")]
  let draft = PostDraft(authorID: UUID(), body: "event", githubLink: nil, repoFullName: nil, eventURL: nil, eventDays: days, spot: nil, kind: nil, visibility: "public", photos: nil, poll: nil, status: "wip")
  let service = TestService()
  let created = try await service.createPost(draft, token: "test")
  precondition(created.eventDays == days)
  let updated = try await service.updatePost(id: created.id, body: "edit", githubLink: nil, repoFullName: nil, eventURL: nil, eventDays: [days[1]], kind: nil, visibility: "public", token: "test")
  precondition(updated.eventDays == [days[1]])
  let cleared = try await service.updatePost(id: created.id, body: "edit", githubLink: nil, repoFullName: nil, eventURL: nil, eventDays: [], kind: nil, visibility: "public", token: "test")
  precondition(cleared.eventDays == [])
  let legacy = TestService(); legacy.missingDays = true
  do { _ = try await legacy.createPost(draft, token: "test"); fatalError("Must not discard event days") } catch { precondition((error as NSError).domain == "EventDays") }
  precondition(legacy.requests == 1)
  do { _ = try await legacy.updatePost(id: created.id, body: "edit", githubLink: nil, repoFullName: nil, eventURL: nil, eventDays: days, kind: nil, visibility: "public", token: "test"); fatalError("Must not discard edited days") } catch { precondition((error as NSError).domain == "EventDays") }
  var normal = draft; normal.eventDays = nil
  let old = try await legacy.createPost(normal, token: "test")
  precondition(old.eventDays == nil)
  let before = legacy.requests
  do { _ = try await legacy.createPost(draft, token: "test"); fatalError("Cached missing schema must not discard days") } catch { precondition((error as NSError).domain == "EventDays") }
  precondition(legacy.requests == before)
  var invalid = draft; invalid.eventDays = [PostEventDay(date: "2026-09-17", url: "javascript:alert(1)")]
  let beforeInvalid = service.requests
  do { _ = try await service.createPost(invalid, token: "test"); fatalError("Invalid link accepted") } catch {}
  precondition(service.requests == beforeInvalid)
  print("PASS multiple-day create/edit/delete, missing-schema data-loss prevention, legacy writes, validation before write")
 }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-event-tests-'));
try {
 const file = path.join(dir, 'Checks.swift'); fs.writeFileSync(file, swift);
 execFileSync('swiftc', ['-parse-as-library', '-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
 execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
