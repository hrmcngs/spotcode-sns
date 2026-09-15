import UIKit
import SwiftUI
import UserNotifications

// One startup policy for both localized bundles. Never replace a user's
// explicit Japanese selection with the default.
enum AppLanguageDefaults {
    static func preferredLanguages(saved: [String]?) -> [String] {
        guard let saved, !saved.isEmpty else { return ["en", "ja"] }
        return saved == ["en"] ? ["en", "ja"] : saved
    }
}

@main
enum SpotcodeApplication {
    static func main() {
        // Set the initial app language before UIKit or SwiftUI resolves strings.
        // Read only this app's domain: the global AppleLanguages value describes
        // the device, while an app-domain value is an explicit per-app choice.
        if let identifier = Bundle.main.bundleIdentifier {
            let defaults = UserDefaults.standard
            let languages = defaults.persistentDomain(forName: identifier)?["AppleLanguages"] as? [String]
            // Keep English UI by default, but retain Japanese as the CJK font
            // fallback. Migrate the English-only value written by older builds.
            // Explicit language choices made in system settings stay intact.
            let preferred = AppLanguageDefaults.preferredLanguages(saved: languages)
            if languages != preferred {
                defaults.set(preferred, forKey: "AppleLanguages")
            }
        }
        UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
    }
}

// Both explicit NSLocalizedString calls and SwiftUI's locale use this choice.
enum AppLocalization {
    static let preferenceKey = "spotcode.language"
    static var language: String {
        let defaults = UserDefaults.standard
        if let saved = defaults.string(forKey: preferenceKey), ["en", "ja"].contains(saved) { return saved }
        return Bundle.main.preferredLocalizations.first == "ja" ? "ja" : "en"
    }
    static func select(_ language: String) {
        guard ["en", "ja"].contains(language) else { return }
        let defaults = UserDefaults.standard
        defaults.set(language == "ja" ? ["ja", "en"] : ["en", "ja"], forKey: "AppleLanguages")
        defaults.set(language, forKey: preferenceKey)
    }
    static let bundles: [String: Bundle] = {
        var result: [String: Bundle] = [:]
        for language in ["en", "ja"] {
            if let path = Bundle.main.path(forResource: language, ofType: "lproj"), let bundle = Bundle(path: path) {
                result[language] = bundle
            }
        }
        return result
    }()
}

// Module-local lookup keeps existing keys/call sites while allowing a language
// change without waiting for Bundle.main's startup localization cache to reset.
func NSLocalizedString(_ key: String, tableName: String? = nil, bundle: Bundle = .main, value: String = "", comment: String) -> String {
    let selected = bundle == .main ? (AppLocalization.bundles[AppLocalization.language] ?? bundle) : bundle
    return selected.localizedString(forKey: key, value: value, table: tableName)
}

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
        // UI automation can skip the system sheet so screenshots and smoke
        // tests can reach the app itself. Normal builds never pass this flag.
        if !ProcessInfo.processInfo.arguments.contains("-SkipNotificationPermissionPrompt") {
            registerNotificationPermissionIfNeeded(application)
        }

        let model = AppModel()
        let root = RootView().environmentObject(model)
        let window = UIWindow(frame: UIScreen.main.bounds)
        #if DEBUG && targetEnvironment(macCatalyst)
        // Verify both appearances without changing the user's macOS settings.
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-SpotcodeScreenshotMode"),
           let index = arguments.firstIndex(of: "-SpotcodeScreenshotAppearance"),
           arguments.indices.contains(index + 1) {
            switch arguments[index + 1] {
            case "light": window.overrideUserInterfaceStyle = .light
            case "dark": window.overrideUserInterfaceStyle = .dark
            default: break
            }
        }
        #endif
        window.rootViewController = UIHostingController(rootView: root)
        window.makeKeyAndVisible()
        self.window = window
        #if DEBUG && targetEnvironment(macCatalyst)
        // Capture only our own UIKit view, without requiring screen-recording
        // access to the user's desktop. This is excluded from store builds.
        if ProcessInfo.processInfo.arguments.contains("-SpotcodeCaptureScreenshot") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
                guard var controller = window.rootViewController else { return }
                while let presented = controller.presentedViewController { controller = presented }
                guard let view = controller.view else { return }
                var size = CGSize(width: 1280, height: 800)
                let fullPage = ProcessInfo.processInfo.arguments.contains("-SpotcodeCaptureFullPage")
                view.bounds = CGRect(origin: .zero, size: size)
                view.setNeedsLayout()
                view.layoutIfNeeded()
                func capture() {
                    let format = UIGraphicsImageRendererFormat()
                    format.scale = fullPage ? 1 : 2
                    format.opaque = true
                    let renderer = UIGraphicsImageRenderer(size: size, format: format)
                    let data = renderer.pngData { _ in
                        view.drawHierarchy(in: CGRect(origin: .zero, size: size), afterScreenUpdates: true)
                    }
                    let arguments = ProcessInfo.processInfo.arguments
                    let captureID = arguments.firstIndex(of: "-SpotcodeCaptureID")
                        .flatMap { $0 + 1 < arguments.count ? UUID(uuidString: arguments[$0 + 1]) : nil }
                    let filename = captureID.map { "spotcode-screenshot-\($0.uuidString).png" } ?? "spotcode-screenshot.png"
                    let file = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
                    do {
                        try data.write(to: file, options: .atomic)
                        NSLog("Spotcode screenshot: %@", file.path)
                        exit(0)
                    }
                    catch { NSLog("Spotcode screenshot failed: %@", error.localizedDescription) }
                }
                func expandPage(_ remaining: Int) {
                    view.layoutIfNeeded()
                    func overflow(_ node: UIView) -> CGFloat {
                        var extra: CGFloat = 0
                        if let scroll = node as? UIScrollView, !(scroll is UITextView),
                           scroll.bounds.width > 400, scroll.bounds.height > 200 {
                            extra = max(0, scroll.contentSize.height + scroll.adjustedContentInset.top
                                        + scroll.adjustedContentInset.bottom - scroll.bounds.height)
                        }
                        return max(extra, node.subviews.map { overflow($0) }.max() ?? 0)
                    }
                    let extra = overflow(view)
                    if extra > 1 {
                        guard remaining > 0, size.height + extra <= 20000 else {
                            NSLog("Full-page capture exceeds supported size or did not settle")
                            exit(1)
                        }
                        size.height += ceil(extra)
                        view.bounds = CGRect(origin: .zero, size: size)
                        view.setNeedsLayout()
                        view.layoutIfNeeded()
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { expandPage(remaining - 1) }
                    } else { capture() }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                    if fullPage { expandPage(12) } else { capture() }
                }
            }
        }
        #endif
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
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.notification.request.content.userInfo["spotcode_post"] != nil {
            NotificationCenter.default.post(name: Notification.Name("spotcode.openNotifications"), object: nil)
        }
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge, .sound])
    }
}
