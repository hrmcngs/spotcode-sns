import Foundation
import CoreLocation
import UserNotifications
import Combine

#if !targetEnvironment(macCatalyst)
/// Location notifications are monitored by iOS, including while the app is closed.
@MainActor
final class NearbySpotNotifications: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    static let shared = NearbySpotNotifications()
    static let preferenceKey = "spotcode.notifications.nearbySpots"
    private static let prefix = "nearby-spot:"
    private let manager = CLLocationManager()
    private let center = UNUserNotificationCenter.current()
    private var scheduling: Task<Void, Never>?
    @Published private(set) var location: CLLocation?
    @Published private(set) var status = ""
    @Published private(set) var authorization: CLAuthorizationStatus = .notDetermined

    override private init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 100
        authorization = manager.authorizationStatus
    }

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    func pause() { manager.stopUpdatingLocation() }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let value = locations.last(where: { $0.horizontalAccuracy >= 0 && abs($0.timestamp.timeIntervalSinceNow) < 120 }) {
            location = value
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        status = NSLocalizedString("接近通知の位置情報を取得できません。位置情報の設定を確認してください。", comment: "")
    }

    func refresh(model: AppModel, enabled: Bool) async {
        guard enabled, let owner = model.session?.user.id, !model.requiresReauthentication else {
            pause()
            await replace(posts: [], owner: nil)
            status = ""
            return
        }
        let settings = await center.notificationSettings()
        guard !Task.isCancelled else { return }
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            pause()
            await replace(posts: [], owner: nil)
            status = NSLocalizedString("接近通知には、端末の通知を許可してください。", comment: "")
            return
        }
        guard authorization == .authorizedAlways || authorization == .authorizedWhenInUse else {
            pause()
            await replace(posts: [], owner: nil)
            status = NSLocalizedString("接近通知には、位置情報の利用を許可してください。", comment: "")
            return
        }
        let registered = UserDefaults.standard.dictionary(forKey: "spotcode.nearbySpots.registered") ?? [:]
        if registered.keys.contains(where: { !$0.hasPrefix(Self.prefix + owner.uuidString + ":") }) {
            await replace(posts: [], owner: nil)
        }
        guard !Task.isCancelled else { return }
        manager.startUpdatingLocation()
        do {
            let posts = try await model.withRefreshedSession { token in
                try await SupabaseService.shared.spottedPosts(token: token)
            }
            guard !Task.isCancelled, model.session?.user.id == owner else { return }
            // Private post existence/content must not be exposed on the lock screen.
            let eligible = posts.filter {
                ($0.visibility ?? "public") == "public" && $0.authorID != owner &&
                !model.isBlocked($0) && !model.isMuted($0) && $0.spot.map { CLLocationCoordinate2DIsValid($0.coordinate) } == true
            }
            await replace(posts: eligible, owner: owner)
        } catch {
            guard !Task.isCancelled else { return }
            status = NSLocalizedString("接近通知のスポットを更新できません。通信状態を確認してください。", comment: "")
        }
    }

    private func replace(posts: [Post], owner: UUID?) async {
        let previous = scheduling
        previous?.cancel()
        let task = Task { @MainActor in
            await previous?.value
            guard !Task.isCancelled else { return }
            await self.apply(posts: posts, owner: owner)
        }
        scheduling = task
        await withTaskCancellationHandler(operation: { await task.value }, onCancel: { task.cancel() })
    }

    private func apply(posts: [Post], owner: UUID?) async {
        let pending = await center.pendingNotificationRequests()
        guard !Task.isCancelled else { return }
        let existing = pending.filter { $0.identifier.hasPrefix(Self.prefix) }
        let origin = location
        let selected = posts.sorted { lhs, rhs in
            guard let origin, let a = lhs.spot, let b = rhs.spot else { return lhs.id.uuidString < rhs.id.uuidString }
            return origin.distance(from: CLLocation(latitude: a.lat, longitude: a.lng)) < origin.distance(from: CLLocation(latitude: b.lat, longitude: b.lng))
        }.prefix(20)
        let desired = Set(selected.map { Self.prefix + (owner?.uuidString ?? "") + ":" + $0.id.uuidString })
        let removed = existing.map(\.identifier).filter { !desired.contains($0) }
        center.removePendingNotificationRequests(withIdentifiers: removed)
        let delivered = await center.deliveredNotifications()
        guard !Task.isCancelled else { return }
        center.removeDeliveredNotifications(withIdentifiers: delivered.map { $0.request.identifier }.filter { $0.hasPrefix(Self.prefix) && !desired.contains($0) })
        let historyKey = "spotcode.nearbySpots.registered"
        var registered = UserDefaults.standard.dictionary(forKey: historyKey) as? [String: String] ?? [:]
        registered = registered.filter { desired.contains($0.key) }
        var failed = false
        for post in selected {
            guard !Task.isCancelled, let spot = post.spot, let owner else { break }
            let id = Self.prefix + owner.uuidString + ":" + post.id.uuidString
            let fingerprint = "\(spot.lat),\(spot.lng)"
            let content = UNMutableNotificationContent()
            content.title = NSLocalizedString("近くにスポット投稿があります", comment: "")
            content.body = NSLocalizedString("アプリを開いて、近くのスポット投稿を確認しましょう。", comment: "")
            content.sound = .default
            content.userInfo = ["spotcode_nearby_spot": post.id.uuidString]
            let region = CLCircularRegion(center: spot.coordinate, radius: 100, identifier: id)
            region.notifyOnEntry = true
            region.notifyOnExit = false
            let inside = origin.map { abs($0.timestamp.timeIntervalSinceNow) < 120 && $0.horizontalAccuracy <= 100 && $0.distance(from: CLLocation(latitude: spot.lat, longitude: spot.lng)) <= 100 } ?? false
            // Convert an untriggered region notification when a fresh fix says
            // we are already inside. Do not re-notify posts that already fired.
            let awaitingEntry = existing.contains { $0.identifier == id && $0.trigger is UNLocationNotificationTrigger }
            if registered[id] == fingerprint && !(inside && awaitingEntry) { continue }
            let trigger: UNNotificationTrigger = inside
                ? UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
                : UNLocationNotificationTrigger(region: region, repeats: false)
            do {
                try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
                registered[id] = fingerprint
                UserDefaults.standard.set(registered, forKey: historyKey)
            } catch { failed = true }
        }
        UserDefaults.standard.set(registered, forKey: historyKey)
        if !Task.isCancelled {
            status = failed ? NSLocalizedString("接近通知を登録できません。端末の通知と位置情報の設定を確認してください。", comment: "")
                : String(format: NSLocalizedString("接近通知の対象: %d件", comment: ""), selected.count)
        }
    }
}
#endif
