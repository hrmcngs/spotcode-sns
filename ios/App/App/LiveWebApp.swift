import SwiftUI
import WebKit
import UIKit

// The store binary supplies device capabilities; ordinary screens are served
// from the same deployment as the browser app. No downloaded native bundles.
enum LiveWebPolicy {
    static let home = URL(string: "https://hrmcngs.github.io/spotcode-sns/")!

    static func isApp(_ url: URL) -> Bool {
        !url.path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." })
            && url.scheme == "https" && url.host == home.host && (url.port == nil || url.port == 443)
            && (url.path == "/spotcode-sns" || url.path.hasPrefix("/spotcode-sns/"))
    }

    static func isAuthentication(_ url: URL) -> Bool {
        guard url.scheme == "https", url.port == nil || url.port == 443 else { return false }
        // OAuth redirects must remain in the same browser store as the session
        // and PKCE verifier. Ordinary external links open in the system browser.
        if url.host == "github.com" {
            return url.path == "/login" || url.path.hasPrefix("/login/")
                || url.path == "/session" || url.path.hasPrefix("/sessions/")
        }
        return url.host == URL(string: SupabaseService.defaultProjectURL)?.host && url.path.hasPrefix("/auth/v1/")
    }
}

@MainActor
final class LiveWebController: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    @Published var loading = true
    @Published var failed = false
    @Published var canGoBack = false
    @Published var confirmReload = false
    private var recoveredProcess = false
    private var backObservation: NSKeyValueObservation?

    lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        // Persistent cookies, localStorage and IndexedDB survive app relaunches.
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.isOpaque = false
        view.backgroundColor = .systemBackground
        backObservation = view.observe(\.canGoBack, options: [.initial, .new]) { [weak self] view, _ in
            DispatchQueue.main.async { self?.canGoBack = view.canGoBack }
        }
        return view
    }()

    func start() {
        guard webView.url == nil else { return }
        loadHome()
    }

    func loadHome() {
        failed = false
        loading = true
        // Revalidate HTML on each cold launch. The service worker revalidates
        // scripts/styles as well, while retaining offline copies.
        webView.load(URLRequest(url: LiveWebPolicy.home, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
    }

    func requestReload() {
        // Never silently replace an editor, attachment or comment in progress.
        let script = """
        (() => !!window.__spotcodeHasUnsavedAttachments?.() ||
          !!document.querySelector('.compose-photo, #compose-poll-chip') ||
          !!document.querySelector('.post__edit-input, .post-camera, input[type=file]') &&
          (!!document.querySelector('.post__edit-input, .post-camera') ||
           [...document.querySelectorAll('input[type=file]')].some(e => e.files.length)) ||
          [...document.querySelectorAll('textarea, input:not([type=hidden]):not([type=file]), select')]
            .some(e => e.value !== (e.tagName === 'SELECT' ? [...e.options].find(o => o.defaultSelected)?.value ?? e.options[0]?.value : e.defaultValue)))()
        """
        webView.evaluateJavaScript(script) { [weak self] value, error in
            guard let self else { return }
            if error != nil || (value as? Bool) == true { self.confirmReload = true }
            else { self.reload() }
        }
    }

    func reload() {
        failed = false
        loading = true
        if webView.url.map(LiveWebPolicy.isApp) == true { webView.reloadFromOrigin() }
        else { loadHome() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if LiveWebPolicy.isApp(url) || LiveWebPolicy.isAuthentication(url) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            if action.navigationType == .linkActivated,
               ["https", "http", "mailto", "tel"].contains(url.scheme ?? "") {
                UIApplication.shared.open(url)
            }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if LiveWebPolicy.isApp(url) || LiveWebPolicy.isAuthentication(url) { webView.load(action.request) }
        else if ["https", "http", "mailto", "tel"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        loading = true
        failed = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        failed = false
        canGoBack = webView.canGoBack
        recoveredProcess = false
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse, http.statusCode >= 400 {
            loading = false
            failed = true
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showFailure(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { showFailure(error) }

    private func showFailure(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        loading = false
        failed = true
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard !recoveredProcess else { loading = false; failed = true; return }
        recoveredProcess = true
        reload()
    }

    // Keep the web app's existing confirmation/alert interactions functional.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("OK", comment: ""), style: .default) { _ in completionHandler() })
        present(alert, cancelled: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: NSLocalizedString("Cancel", comment: ""), style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: NSLocalizedString("OK", comment: ""), style: .default) { _ in completionHandler(true) })
        present(alert) { completionHandler(false) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: NSLocalizedString("Cancel", comment: ""), style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: NSLocalizedString("OK", comment: ""), style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert) { completionHandler(nil) }
    }

    private func present(_ alert: UIAlertController, cancelled: () -> Void) {
        guard var controller = webView.window?.rootViewController else { cancelled(); return }
        while let presented = controller.presentedViewController { controller = presented }
        guard !controller.isBeingDismissed else { cancelled(); return }
        controller.present(alert, animated: true)
    }
}

private struct LiveWebContent: UIViewRepresentable {
    let controller: LiveWebController
    func makeUIView(context: Context) -> WKWebView { controller.start(); return controller.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

struct LiveWebAppView: View {
    @EnvironmentObject private var model: AppModel
    @StateObject private var controller = LiveWebController()
    @State private var showingDeviceFeatures = false

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                LiveWebContent(controller: controller)
                if controller.failed {
                    VStack(spacing: 16) {
                        Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                        Text(NSLocalizedString("接続できませんでした", comment: ""))
                        Button(NSLocalizedString("再試行", comment: "")) { controller.reload() }
                        Button(NSLocalizedString("端末の機能を開く", comment: "")) { showingDeviceFeatures = true }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(UIColor.systemBackground))
                }
                if controller.loading { ProgressView().padding(12).background(.regularMaterial).cornerRadius(10) }
            }
            Divider()
            HStack {
                Button { controller.webView.goBack() } label: { Image(systemName: "chevron.backward") }
                    .disabled(!controller.canGoBack).accessibilityLabel(NSLocalizedString("戻る", comment: ""))
                Spacer()
                Menu {
                    Button { controller.requestReload() } label: { Label(NSLocalizedString("更新する", comment: ""), systemImage: "arrow.clockwise") }
                    Button { showingDeviceFeatures = true } label: { Label(NSLocalizedString("端末の機能を開く", comment: ""), systemImage: "iphone") }
                    Link(NSLocalizedString("Safariで開く", comment: ""), destination: LiveWebPolicy.home)
                } label: { Label(NSLocalizedString("メニュー", comment: ""), systemImage: "ellipsis.circle") }
            }
            .padding(.horizontal, 20).frame(height: 44)
        }
        .background(Color(UIColor.systemBackground))
        .alert(NSLocalizedString("画面を更新しますか？", comment: ""), isPresented: $controller.confirmReload) {
            Button(NSLocalizedString("Cancel", comment: ""), role: .cancel) {}
            Button(NSLocalizedString("更新する", comment: ""), role: .destructive) { controller.reload() }
        } message: { Text(NSLocalizedString("編集中の内容を保存してから更新してください。", comment: "")) }
        .fullScreenCover(isPresented: $showingDeviceFeatures) {
            RootView().environmentObject(model)
                .safeAreaInset(edge: .top) {
                    HStack {
                        Spacer()
                        Button(NSLocalizedString("閉じる", comment: "")) { showingDeviceFeatures = false }.padding()
                    }.background(Color(UIColor.systemBackground))
                }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("spotcode.openNotifications"))) { _ in showingDeviceFeatures = true }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("spotcode.openNearbySpot"))) { _ in showingDeviceFeatures = true }
    }
}
