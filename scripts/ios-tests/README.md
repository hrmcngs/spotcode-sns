# iOS regression tests

Common Lisp (SBCL) runs the tests using ASDF/UIOP, which ships with SBCL.
Swift assertions exercise the app's actual models and authentication error mapper.
Python and Quicklisp are not required. Run on macOS with SBCL and the Xcode Swift toolchain available.

Run every suite from the repository root:

```sh
sbcl --script scripts/test-ios.lisp all
```

Run one suite:

```sh
sbcl --script scripts/test-ios.lisp signup
sbcl --script scripts/test-ios.lisp post-decoding
sbcl --script scripts/test-ios.lisp localization
```

Optionally validate a saved public posts API response:

```sh
sbcl --script scripts/test-ios.lisp post-decoding /path/to/response.json
```

The runner resolves source paths relative to its own location, so it also works
outside the repository root. Generated Swift runners and module caches are
temporary and removed after each suite. Failed checks produce a nonzero exit code.
These tests make no network requests, create no accounts, and send no email.

- `signup.swift`: validation, normalized metadata, password preservation, and
  immediate-session/email-confirmation responses.
- `post-decoding.swift`: mixed address metadata from web posts, optional values,
  and preservation of boolean flags when encoding again.
- `localization.swift`: translation coverage, duplicate keys, placeholder types,
  and English/Japanese authentication, notification, and deadline messages.
