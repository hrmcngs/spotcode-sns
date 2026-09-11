#!/usr/bin/env sbcl --script
;;; Run the iOS regression suites without Python or Quicklisp dependencies.
(require :asdf)

(defparameter *script-directory* (uiop:pathname-directory-pathname *load-truename*))
(defparameter *app-directory* (truename (merge-pathnames "../ios/App/App/" *script-directory*)))

(defun app-source (name)
  (uiop:read-file-string (merge-pathnames name *app-directory*) :external-format :utf-8))

(defun section (source start &optional end)
  (let* ((from (or (search start source) (error "Missing source marker: ~A" start)))
         (to (if end
                 (or (search end source :start2 from) (error "Missing source marker: ~A" end))
                 (length source))))
    (subseq source from to)))

(defun write-source (stream text)
  (write-string text stream)
  (terpri stream))

(defun run-suite (name &optional response-file)
  (let ((models (app-source "NativeModels.swift")))
    (uiop:with-temporary-file (:stream stream :pathname runner :type "swift" :external-format :utf-8)
      (write-source stream "import Foundation")
      (cond
        ((string= name "signup")
         (write-source stream (section models "struct AuthUser:" "struct MFAFactorsResponse:"))
         (write-source stream (section models "struct SignupResponse:")))
        ((string= name "post-decoding")
         (write-source stream "struct CLLocationCoordinate2D { let latitude: Double; let longitude: Double }")
         (write-source stream (section models "struct Profile:" "struct PostInteractionRow:"))
         (write-source stream (section models "struct PostPoll:" "struct FollowEvent:")))
        ((string= name "localization")
         ;; Expose the original private static method as a standalone function.
         (write-source stream
                       (concatenate 'string "func authenticationMessage("
                                    (section (app-source "AppModel.swift")
                                             "for error: Error) -> String {"
                                             "    private func finishSignIn"))))
        (t (error "Unknown suite: ~A" name)))
      (write-source stream (uiop:read-file-string
                            (merge-pathnames (format nil "ios-tests/~A.swift" name) *script-directory*)
                            :external-format :utf-8))
      (finish-output stream)
      (let ((cache (uiop:ensure-directory-pathname (concatenate 'string (namestring runner) ".cache"))))
        (unwind-protect
             (uiop:run-program
              (append (list "swift" "-module-cache-path" (namestring cache) (namestring runner))
                      (when (string= name "localization") (list (namestring *app-directory*)))
                      (when response-file (list (namestring (truename response-file)))))
              :output :interactive :error-output :interactive)
          (when (probe-file cache)
            (uiop:delete-directory-tree cache :validate t)))))))

(handler-case
    (let* ((args (uiop:command-line-arguments)) (suite (or (first args) "all")))
      (unless (and (member suite '("all" "signup" "post-decoding" "localization") :test #'string=)
                   (<= (length args) (if (string= suite "post-decoding") 2 1)))
        (error "Usage: sbcl --script scripts/test-ios.lisp [all|signup|localization|post-decoding [response.json]]"))
      (if (string= suite "all")
          (dolist (name '("signup" "post-decoding" "localization")) (run-suite name))
          (run-suite suite (second args))))
  (error (condition)
    (format *error-output* "~&iOS tests failed: ~A~%" condition)
    (uiop:quit 1)))
