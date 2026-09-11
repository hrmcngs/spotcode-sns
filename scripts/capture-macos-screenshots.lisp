#!/usr/bin/env sbcl --script
;;; Capture the app's UIKit screens without desktop recording permission.
;;; Uses SBCL and its bundled ASDF/UIOP; no Quicklisp dependencies.
(require :asdf)

(defparameter *root*
  (truename (merge-pathnames "../" (uiop:pathname-directory-pathname *load-truename*))))
(defparameter *app*
  (merge-pathnames "macos/build-preview/Build/Products/Debug-maccatalyst/App.app/" *root*))
(defparameter *capture-directory*
  (merge-pathnames "Library/Containers/computer.ngs.hrmc.Spotcode/Data/tmp/"
                   (user-homedir-pathname)))
(defparameter *full-page* (equal (uiop:getenv "SPOTCODE_SCREENSHOT_FULL_PAGE") "1"))
(defparameter *output* (merge-pathnames (if *full-page* "macos/screenshots/full-page/" "macos/screenshots/") *root*))
;;; Optional per-launch preview; does not change the user's saved preference.
(defparameter *text-size* (uiop:getenv "SPOTCODE_SCREENSHOT_TEXT_SIZE"))
(defparameter *screens*
  '(("Home" . "01-home.png") ("Login" . "02-sign-in.png")
    ("Repos" . "03-repositories.png") ("Settings" . "04-settings.png")
    ("Accounts" . "05-accounts.png")))

(defun capture-screen (screen)
  (let* ((name (car screen))
         (capture-id (string-trim '(#\Space #\Tab #\Newline #\Return)
                                  (uiop:run-program '("/usr/bin/uuidgen") :output :string)))
         (source (merge-pathnames (format nil "spotcode-screenshot-~A.png" capture-id)
                                 *capture-directory*))
         (target (merge-pathnames (cdr screen) *output*)))
    ;; Argument lists avoid shell interpolation of paths and application flags.
    (uiop:run-program
     (append (list "/usr/bin/open" "-n" (namestring *app*) "--args"
                   "-SpotcodeScreenshotMode" "-SkipNotificationPermissionPrompt"
                   "-SpotcodeCaptureScreenshot" "-AppleLanguages"
                   (format nil "(~A)" (or (uiop:getenv "SPOTCODE_SCREENSHOT_LANGUAGE") "ja"))
                   "-ApplePersistenceIgnoreState" "YES" "-SpotcodeCaptureID" capture-id)
             (when *text-size* (list "-spotcode.mac.textSize" *text-size*))
             (when *full-page* '("-SpotcodeCaptureFullPage"))
             (cond ((string= name "Login") '("-SpotcodeScreenshotShowLogin"))
                   ((string= name "Accounts")
                    '("-SpotcodeScreenshotSection" "Home" "-SpotcodeScreenshotShowAccounts"))
                   (t (list "-SpotcodeScreenshotSection" name))))
     :output :interactive :error-output :interactive)
    (let ((deadline (+ (get-internal-real-time) (* 90 internal-time-units-per-second))))
      (loop
        (when (probe-file source)
          ;; The Debug app writes the PNG atomically, so it is complete here.
          (uiop:copy-file source target)
          (format t "~A~%" (enough-namestring target *root*))
          (finish-output)
          (return))
        (when (>= (get-internal-real-time) deadline)
          (error "~A: capture timed out; check the app's launch and signing." name))
        (sleep 1)))))

(handler-case
    (let* ((args (or (uiop:command-line-arguments) '("Home" "Login" "Repos" "Settings")))
           (screens (mapcar (lambda (name)
                              (or (assoc name *screens* :test #'string-equal)
                                  (error "Sections: Home Login Repos Settings Accounts")))
                            args)))
      (when (and *text-size* (not (member *text-size* '("0" "1" "2" "3" "4") :test #'string=)))
        (error "SPOTCODE_SCREENSHOT_TEXT_SIZE must be 0, 1, 2, 3 or 4."))
      (unless (probe-file *app*)
        (error "Build the Debug Mac Catalyst app first; see docs/macos-app-store.md."))
      (ensure-directories-exist *output*)
      (dolist (screen screens) (capture-screen screen)))
  (error (condition)
    (format *error-output* "~&Screenshot capture failed: ~A~%" condition)
    (uiop:quit 1)))
