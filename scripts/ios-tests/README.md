# iOS regression tests

Native image and offline preview cache limits:

```sh
node scripts/test-native-performance.mjs
```

Runs the production ImageIO decoder and preview encoder on macOS. Covers image
downsampling, repeated-image reuse, reload after eviction, malformed images, and
the 24-post / 2 MiB preview limit. Only disposable offline previews are bounded;
online pagination and server posts remain available. Image cache eviction uses
NSCache's 12 MiB cost target (including cache keys), not a process memory limit.

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

Session persistence regression tests:

```sh
node scripts/test-session-persistence.mjs
```

This compiles the current Keychain save and session refresh implementations with
fake keychain and network functions. It never reads real credentials. It verifies
failed writes preserve existing data, refresh requests are shared, transient
network/server failures retain login, invalid refresh tokens request login, and
late responses cannot restore a logged-out or switched account.

Startup restoration coverage also verifies that locked/denied keychain reads are
retryable, old macOS items migrate into the data-protection keychain, the last
active account's backup can restore a missing primary item, and explicit logout
wins even when deletion was temporarily unavailable.

To verify persistence across two actual signed macOS binaries after building the
normal signed preview app:

```sh
sbcl --script scripts/test-signed-keychain-persistence.lisp
```

This uses a random fixture account with three test bytes, the preview build's
signing identity and entitlements, and the production KeychainStore implementation.
It does not read login tokens. It removes its fixture after the rebuild/read check.

Post reading location regression tests:

```sh
node scripts/test-post-location-gate.mjs
```

Runs the production reader gate with a fake location manager and real
CoreLocation distances. Covers moving into/out of 100 m, shared subscriptions,
invalid/stale fixes, GPS failures and retries, permission restoration, and
foreground/background cleanup. No device location or network access is used.

Authenticated request retries (including the Mac recommendations sidebar):

```sh
node scripts/test-native-authenticated-request.mjs
```

Exercises the shared request wrapper with an expired JWT, a successful refresh,
a repeated rejection, an offline failure, and an account switch during a request.
The test uses fake sessions and does not read credentials or contact the network.

Followingタブの取得条件（フォローなし、個人・組織、ページ送り、取得失敗）:

```sh
node scripts/test-native-following.mjs
```
