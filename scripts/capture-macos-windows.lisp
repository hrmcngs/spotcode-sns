#!/usr/bin/env sbcl --script
;;; Capture 2560x1600 real macOS windows, including title bars, on a 2x display.
;;; Requires screen recording and accessibility access to size the window.
(require :asdf)
(defparameter *root* (truename (merge-pathnames "../" (uiop:pathname-directory-pathname *load-truename*))))
(defparameter *app* (merge-pathnames "macos/build-preview/Build/Products/Debug-maccatalyst/App.app" *root*))
(defparameter *output* (merge-pathnames "macos/screenshots/window/" *root*))
(defparameter *screens* '(("Home" . "01-home.png") ("Login" . "02-sign-in.png")
                         ("Repos" . "03-repositories.png") ("Settings" . "04-settings.png")
                         ("Accounts" . "05-accounts.png") ("Notifications" . "06-notifications.png")))
(defparameter *window-query*
"import AppKit
import CoreGraphics
import ApplicationServices
let path = CommandLine.arguments[1]
guard CGPreflightScreenCaptureAccess() else { exit(2) }
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: \"computer.ngs.hrmc.Spotcode\")
guard let app = apps.filter({ $0.bundleURL?.path == path }).max(by: { ($0.launchDate ?? .distantPast) < ($1.launchDate ?? .distantPast) }) else { exit(3) }
app.activate(options: [.activateAllWindows])
RunLoop.current.run(until: Date().addingTimeInterval(2))
guard AXIsProcessTrusted() else { exit(5) }
let axApp = AXUIElementCreateApplication(app.processIdentifier)
var axValue: CFTypeRef?
guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &axValue) == .success,
      let axWindows = axValue as? [AXUIElement] else { exit(6) }
guard let axWindow = axWindows.first(where: { window in
 var title: CFTypeRef?
 AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &title)
 return title as? String == \"spotcode\"
}) else { exit(7) }
var fullScreen: CFTypeRef?
if AXUIElementCopyAttributeValue(axWindow, \"AXFullScreen\" as CFString, &fullScreen) == .success,
   (fullScreen as? Bool) == true {
 AXUIElementSetAttributeValue(axWindow, \"AXFullScreen\" as CFString, kCFBooleanFalse)
 RunLoop.current.run(until: Date().addingTimeInterval(2))
}
var position = CGPoint(x: 100, y: 80)
var size = CGSize(width: 1280, height: 800)
guard AXUIElementSetAttributeValue(axWindow, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &position)!) == .success,
      AXUIElementSetAttributeValue(axWindow, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &size)!) == .success else { exit(8) }
RunLoop.current.run(until: Date().addingTimeInterval(2))
let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
func area(_ w: [String: Any]) -> Double {
 let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
 return (b[\"Width\"] ?? 0) * (b[\"Height\"] ?? 0)
}
guard let window = windows.filter({ ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier && ($0[kCGWindowName as String] as? String) == \"spotcode\" }).max(by: { area($0) < area($1) }), let id = window[kCGWindowNumber as String] else { exit(4) }
let bounds = window[kCGWindowBounds as String] as? [String: Double] ?? [:]
guard bounds[\"Width\"] == 1280, bounds[\"Height\"] == 800 else { exit(9) }
print(\"(\\(app.processIdentifier) \\(id))\")
")
(handler-case
    (progn
      (ensure-directories-exist *output*)
      (dolist (name (or (uiop:command-line-arguments) '("Home" "Login" "Repos" "Settings" "Accounts")))
        (let ((screen (or (assoc name *screens* :test #'string-equal) (error "Unknown screen ~A" name))))
          (uiop:run-program
           (append (list "/usr/bin/open" "-n" (namestring *app*) "--args"
                         "-SpotcodeScreenshotMode" "-SkipNotificationPermissionPrompt"
                         "-AppleLanguages" (format nil "(~A)" (or (uiop:getenv "SPOTCODE_SCREENSHOT_LANGUAGE") "ja"))
                         "-ApplePersistenceIgnoreState" "YES"
                         "-spotcode.mac.textSize" "1")
                   (cond ((string-equal name "Login") '("-SpotcodeScreenshotShowLogin"))
                         ((string-equal name "Accounts") '("-SpotcodeScreenshotShowAccounts"))
                         (t (list "-SpotcodeScreenshotSection" name)))))
          (sleep 18)
          (let* ((info (loop repeat 8
                            for result = (multiple-value-list
                                          (uiop:run-program (list "/usr/bin/swift" "-e" *window-query* (namestring *app*)) :output :string :ignore-error-status t))
                            when (zerop (third result)) return (read-from-string (first result))
                            do (sleep 3)
                            finally (error "App window did not become ready: ~A" name)))
                 (target (merge-pathnames (cdr screen) *output*)))
            (uiop:run-program (list "/usr/sbin/screencapture" "-x" "-o" "-l" (write-to-string (second info)) (namestring target)))
            (format t "~A~%" (enough-namestring target *root*))
            (finish-output)
            ;; Only stop the exact preview process used for this capture.
            (uiop:run-program (list "/bin/kill" "-TERM" (write-to-string (first info))))))))
  (error (condition) (format *error-output* "~A~%" condition) (uiop:quit 1)))
