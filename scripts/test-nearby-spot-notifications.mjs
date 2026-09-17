import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Execute the production scheduler with in-memory notification/permission stores.
const production = fs.readFileSync('ios/App/App/NearbySpotNotifications.swift', 'utf8')
  .replace('import UserNotifications', '')
  .replaceAll('CLLocationManagerDelegate', 'TestLocationManagerDelegate')
  .replaceAll('CLLocationManager', 'TestLocationManager')
  .replaceAll('UserDefaults.standard', 'TestDefaults.standard')
  .replaceAll('CLAuthorizationStatus', 'TestAuthorizationStatus');
const fixtures = String.raw`
import Foundation
import CoreLocation
import Combine
enum TestAuthorizationStatus: Int { case notDetermined, authorizedWhenInUse, authorizedAlways, denied, restricted }
protocol TestLocationManagerDelegate: AnyObject {}
class TestLocationManager {
 weak var delegate: TestLocationManagerDelegate?
 var desiredAccuracy: Double = 0; var distanceFilter: Double = 0
 var authorizationStatus: TestAuthorizationStatus = .authorizedWhenInUse
 func requestWhenInUseAuthorization() {}
 func startUpdatingLocation() {}
 func stopUpdatingLocation() {}
}
class TestDefaults {
 static let standard = TestDefaults(); var values: [String: Any] = [:]
 func dictionary(forKey key: String) -> [String: Any]? { values[key] as? [String: Any] }
 func set(_ value: Any, forKey key: String) { values[key] = value }
}
enum TestAuthorization { case authorized, provisional, denied }
struct TestSettings { var authorizationStatus: TestAuthorization = .authorized }
class UNNotificationTrigger {}
class UNTimeIntervalNotificationTrigger: UNNotificationTrigger { init(timeInterval: Double, repeats: Bool) {} }
class UNLocationNotificationTrigger: UNNotificationTrigger {
 let region: CLCircularRegion
 init(region: CLCircularRegion, repeats: Bool) { self.region = region }
}
struct TestSound { static let \`default\` = TestSound() }
class UNMutableNotificationContent {
 var title = ""; var body = ""; var sound: TestSound?; var userInfo: [String: String] = [:]
}
struct UNNotificationRequest {
 let identifier: String; let content: UNMutableNotificationContent; let trigger: UNNotificationTrigger?
}
struct TestDelivered { let request: UNNotificationRequest }
class UNUserNotificationCenter {
 static let shared = UNUserNotificationCenter()
 static func current() -> UNUserNotificationCenter { shared }
 var settings = TestSettings(); var pending: [String: UNNotificationRequest] = [:]
 var delivered: [TestDelivered] = []; var adds = 0; var failNext = false
 var suspendNext = false; var suspended: CheckedContinuation<Void, Never>?
 func notificationSettings() async -> TestSettings { settings }
 func pendingNotificationRequests() async -> [UNNotificationRequest] { Array(pending.values) }
 func deliveredNotifications() async -> [TestDelivered] { delivered }
 func removePendingNotificationRequests(withIdentifiers ids: [String]) { for id in ids { pending.removeValue(forKey: id) } }
 func removeDeliveredNotifications(withIdentifiers ids: [String]) { delivered.removeAll { ids.contains($0.request.identifier) } }
 func add(_ request: UNNotificationRequest) async throws {
  if failNext { failNext = false; throw NSError(domain: "test", code: 1) }
  if suspendNext { suspendNext = false; await withCheckedContinuation { suspended = $0 } }
  adds += 1; pending[request.identifier] = request
 }
}
struct Spot { let lat: Double; let lng: Double; var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) } }
struct Post { let id: UUID; let authorID: UUID; var visibility: String? = "public"; let spot: Spot? }
struct TestUser { let id: UUID }
struct TestSession { let user: TestUser }
@MainActor class AppModel {
 var session: TestSession?; var requiresReauthentication = false
 var blocked: Set<UUID> = []; var muted: Set<UUID> = []
 func isBlocked(_ post: Post) -> Bool { blocked.contains(post.authorID) }
 func isMuted(_ post: Post) -> Bool { muted.contains(post.authorID) }
 func withRefreshedSession<T>(_ operation: (String) async throws -> T) async throws -> T { try await operation("test") }
}
class SupabaseService {
 static let shared = SupabaseService(); var posts: [Post] = []; var fail = false
 func spottedPosts(token: String?) async throws -> [Post] {
  if fail { throw NSError(domain: "network", code: 1) }; return posts
 }
}
` .replaceAll('\\`', '`');
const tests = String.raw`
@main struct Checks {
 @MainActor static func main() async {
  let service = NearbySpotNotifications.shared
  let center = UNUserNotificationCenter.shared
  let model = AppModel(); let owner = UUID(); let author = UUID()
  model.session = TestSession(user: TestUser(id: owner))
  let base = CLLocation(latitude: 35, longitude: 139)
  service.locationManager(TestLocationManager(), didUpdateLocations: [base])
  let posts = (1...25).map { Post(id: UUID(), authorID: author, spot: Spot(lat: 35 + Double($0)*0.002, lng: 139)) }
  SupabaseService.shared.posts = posts.reversed()
  let blocked = UUID(); let muted = UUID(); model.blocked = [blocked]; model.muted = [muted]
  SupabaseService.shared.posts += [
   Post(id: UUID(), authorID: owner, spot: Spot(lat: 35, lng: 139)),
   Post(id: UUID(), authorID: author, visibility: "only_me", spot: Spot(lat: 35, lng: 139)),
   Post(id: UUID(), authorID: blocked, spot: Spot(lat: 35, lng: 139)),
   Post(id: UUID(), authorID: muted, spot: Spot(lat: 35, lng: 139)),
   Post(id: UUID(), authorID: author, spot: Spot(lat: 100, lng: 139))]
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.count == 20)
  let ids = Set(center.pending.values.compactMap { $0.content.userInfo["spotcode_nearby_spot"] })
  precondition(ids == Set(posts.prefix(20).map { $0.id.uuidString }))
  precondition(center.pending.values.allSatisfy { ($0.trigger as? UNLocationNotificationTrigger)?.region.radius == 100 })
  let adds = center.adds
  await service.refresh(model: model, enabled: true)
  precondition(center.adds == adds, "Unchanged refresh must not reset triggers")
  service.locationManager(TestLocationManager(), didUpdateLocations: [CLLocation(latitude: 35.002, longitude: 139)])
  await service.refresh(model: model, enabled: true)
  let near = center.pending.values.first { $0.content.userInfo["spotcode_nearby_spot"] == posts[0].id.uuidString }!
  precondition(near.trigger is UNTimeIntervalNotificationTrigger)
  center.pending.removeValue(forKey: near.identifier)
  center.delivered = [TestDelivered(request: near)]
  let afterArrival = center.adds
  await service.refresh(model: model, enabled: true)
  precondition(center.adds == afterArrival, "Delivered posts must not re-notify")
  let foreign = UNNotificationRequest(identifier: "followed-post:other", content: UNMutableNotificationContent(), trigger: nil)
  center.pending[foreign.identifier] = foreign
  await service.refresh(model: model, enabled: false)
  precondition(center.pending.keys.sorted() == [foreign.identifier])
  precondition(center.delivered.isEmpty)
  await service.refresh(model: model, enabled: true)
  model.session = TestSession(user: TestUser(id: UUID()))
  SupabaseService.shared.fail = true
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.keys.sorted() == [foreign.identifier], "Clear old account even when fetch fails")
  SupabaseService.shared.fail = false
  center.settings.authorizationStatus = .denied
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.count == 1)
  center.settings.authorizationStatus = .authorized
  center.failNext = true
  await service.refresh(model: model, enabled: true)
  let failedCount = center.pending.count
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.count == failedCount + 1, "Failed registration must retry")
  let deniedLocation = TestLocationManager(); deniedLocation.authorizationStatus = .denied
  service.locationManagerDidChangeAuthorization(deniedLocation)
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.count == 1, "Revoking location must clear pending alerts")
  service.locationManagerDidChangeAuthorization(TestLocationManager())
  center.suspendNext = true
  let inFlight = Task { await service.refresh(model: model, enabled: true) }
  while center.suspended == nil { await Task.yield() }
  model.session = nil
  let signOut = Task { await service.refresh(model: model, enabled: true) }
  await Task.yield()
  center.suspended?.resume(); center.suspended = nil
  await inFlight.value; await signOut.value
  precondition(center.pending.count == 1, "Sign-out must clean an in-flight registration")
  model.session = nil
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.count == 1)
  print("PASS nearest 20, radius, audience/owner/block/mute filters, unchanged registration, already-inside arrival, duplicate suppression, opt-out, account change, denied permission, retry, sign-out, unrelated notifications")
 }
}
`;
const macTests = String.raw`
@main struct Checks {
 @MainActor static func main() async {
  let service = NearbySpotNotifications.shared
  let center = UNUserNotificationCenter.shared
  let model = AppModel(); let owner = UUID(); let author = UUID()
  model.session = TestSession(user: TestUser(id: owner))
  let near = Post(id: UUID(), authorID: author, spot: Spot(lat: 35, lng: 139))
  let far = Post(id: UUID(), authorID: author, spot: Spot(lat: 36, lng: 139))
  SupabaseService.shared.posts = [near, far,
    Post(id: UUID(), authorID: owner, spot: Spot(lat: 35, lng: 139)),
    Post(id: UUID(), authorID: author, visibility: "only_me", spot: Spot(lat: 35, lng: 139))]
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.isEmpty, "No fix means no Mac arrival alert")
  service.locationManager(TestLocationManager(), didUpdateLocations: [CLLocation(latitude: 35, longitude: 139)])
  center.failNext = true
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.isEmpty)
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.count == 1, "Only eligible nearby post should notify")
  let request = center.pending.values.first!
  precondition(request.trigger is UNTimeIntervalNotificationTrigger)
  precondition(request.content.userInfo["spotcode_nearby_spot"] == near.id.uuidString)
  center.pending.removeAll(); center.delivered = [TestDelivered(request: request)]
  let count = center.adds
  await service.refresh(model: model, enabled: true)
  precondition(center.adds == count, "Mac must not repeat delivered notifications")
  service.locationManager(TestLocationManager(), didUpdateLocations: [CLLocation(latitude: 36, longitude: 139)])
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.count == 1)
  precondition(center.pending.values.first!.content.userInfo["spotcode_nearby_spot"] == far.id.uuidString)
  let unrelated = UNNotificationRequest(identifier: "other", content: UNMutableNotificationContent(), trigger: nil)
  center.pending[unrelated.identifier] = unrelated
  await service.refresh(model: model, enabled: false)
  precondition(center.pending.keys.sorted() == ["other"] && center.delivered.isEmpty)
  await service.refresh(model: model, enabled: true)
  model.session = TestSession(user: TestUser(id: UUID()))
  SupabaseService.shared.fail = true
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.keys.sorted() == ["other"], "Account change clears alerts even offline")
  SupabaseService.shared.fail = false
  center.settings.authorizationStatus = .denied
  await service.refresh(model: model, enabled: true)
  precondition(center.pending.keys.sorted() == ["other"])
  print("PASS Mac arrival, distance/audience filters, retry, duplicate suppression, opt-out, account change, denied notifications")
 }
}
`;
for (const [platform, checks] of [['ios', tests], ['mac', macTests]]) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-nearby-tests-'));
 try {
  const source = path.join(dir, 'Checks.swift');
  const code = production.replaceAll('targetEnvironment(macCatalyst)', 'TEST_MAC');
  fs.writeFileSync(source, fixtures + '\n' + code + '\n' + checks);
  execFileSync('swiftc', ['-parse-as-library', ...(platform === 'mac' ? ['-D', 'TEST_MAC'] : []), '-module-cache-path', path.join(dir, 'cache'), source, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
 } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
