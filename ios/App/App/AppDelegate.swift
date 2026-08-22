import UIKit
import SwiftUI
import UserNotifications

@UIApplicationMain
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // SwiftUI's TextEditor wraps UITextView. On iOS 15 its own opaque
        // dark-mode background covers the composer surface and turns the
        // input into a pitch-black rectangle. Let the SwiftUI #21262d
        // surface show through, matching the mobile web composer.
        UITextView.appearance().backgroundColor = .clear
        UNUserNotificationCenter.current().delegate = self
        registerNotificationPermissionIfNeeded(application)

        let model = AppModel()
        let root = RootView().environmentObject(model)
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = UIHostingController(rootView: root)
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    private func registerNotificationPermissionIfNeeded(_ application: UIApplication) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { settings in
            switch settings.authorizationStatus {
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                    guard granted else { return }
                    DispatchQueue.main.async { application.registerForRemoteNotifications() }
                }
            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async { application.registerForRemoteNotifications() }
            case .denied:
                break
            @unknown default:
                break
            }
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge, .sound])
    }
}
