import UIKit
import SwiftUI

@UIApplicationMain
final class AppDelegate: UIResponder, UIApplicationDelegate {
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

        let model = AppModel()
        let root = RootView().environmentObject(model)
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = UIHostingController(rootView: root)
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
