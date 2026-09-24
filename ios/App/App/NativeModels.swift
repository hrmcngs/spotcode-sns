import Foundation

struct EmptyResponse: Codable {}
import CoreLocation

struct Profile: Codable, Identifiable, Hashable {
    let id: UUID?
    let handle: String
    let name: String
    let avatarURL: String?
    let bio: String?
    let location: String?
    var githubHandle: String?
    var githubVerified: Bool?
    let website: String?
    let twitter: String?
    let instagram: String?
    let isPrivate: Bool?
    let isOrg: Bool?
    let organization: String?
    let closeFriends: [String]?
    let orgMembers: [String]?
    let createdAt: String?
    let avatarShape: String?
    let isAdmin: Bool?
    let isOperator: Bool?
    var closeFriendIDs: [UUID]? = nil
    var orgMemberIDs: [UUID]? = nil

    enum CodingKeys: String, CodingKey {
        case id, handle, name, bio, location, website, twitter, instagram
        case organization
        case avatarURL = "avatar_url"
        case githubHandle = "github_handle"
        case githubVerified = "github_verified"
        case isPrivate = "is_private"
        case isOrg = "is_org"
        case closeFriends = "close_friends"
        case orgMembers = "org_members"
        case closeFriendIDs = "close_friend_ids"
        case orgMemberIDs = "org_member_ids"
        case createdAt = "created_at"
        case avatarShape = "avatar_shape"
        case isAdmin = "is_admin"
        case isOperator = "is_operator"
    }
}

// An editor keeps the identity captured for each displayed handle, including
// after a failed save. A renamed/recycled handle never silently changes grants.
struct AudienceIdentityBindings {
    private var identities: [String: UUID] = [:]
    private var existingHandles: Set<String> = []
    private var conflictingHandles: Set<String> = []

    static func normalized(_ handle: String) -> String {
        handle.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "^@", with: "", options: .regularExpression)
    }

    mutating func capture(handles: [String], ids: [UUID]?) {
        existingHandles.formUnion(handles.map(Self.normalized))
        guard let ids, ids.count == handles.count else { return }
        for (handle, id) in zip(handles, ids) {
            let key = Self.normalized(handle)
            if let previous = identities[key], previous != id {
                identities.removeValue(forKey: key)
                conflictingHandles.insert(key)
            } else if !conflictingHandles.contains(key) { identities[key] = id }
        }
    }

    func identity(for handle: String) throws -> UUID? {
        let key = Self.normalized(handle)
        if let id = identities[key] { return id }
        guard !existingHandles.contains(key) else {
            throw NSError(domain: "AudienceIdentity", code: 1, userInfo: [NSLocalizedDescriptionKey:
                NSLocalizedString("公開対象リストを再読み込みしてください。", comment: "")])
        }
        return nil
    }

    mutating func remember(_ id: UUID, for handle: String) {
        identities[Self.normalized(handle)] = id
    }
}

// Web posts store address text alongside a boolean geocoding flag.
// Keep their JSON types intact when reading and re-saving a post.
struct SpotAddressDetails: Codable, Hashable {
    var city: String? = nil
    var full: String? = nil
    var road: String? = nil
    var ward: String? = nil
    var chome: String? = nil
    var postcode: String? = nil
    var prefecture: String? = nil
    var houseNumber: String? = nil
    var missingHouseNumber: Bool? = nil

    var canonicalCity: String {
        let name = (city ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        // MapKit can return either the English or Japanese ward name.
        // Keep the original address in storage; normalize only grouping.
        switch name.lowercased().replacingOccurrences(of: "-", with: " ") {
        case "setagaya", "setagaya ku", "setagaya city", "setagaya ward", "世田谷", "世田谷区":
            return "世田谷区"
        default: return name
        }
    }
}

struct Spot: Codable, Hashable {
    let lat: Double
    let lng: Double
    let label: String?
    let address: String?
    var addressDetails: SpotAddressDetails? = nil

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

struct Post: Codable, Identifiable, Hashable {
    let id: UUID
    let authorID: UUID
    let body: String
    let githubLink: String?
    let repoFullName: String?
    let eventURL: String?
    var eventDays: [PostEventDay]? = nil
    let kind: String?
    let visibility: String?
    var githubOrgID: Int64? = nil
    var organizationAuthorID: UUID? = nil
    var organizationAuthor: Profile? = nil
    var displayAuthor: Profile? { organizationAuthor ?? author }
    let spot: Spot?
    let status: String?
    let createdAt: String?
    let author: Profile?
    let commentsCount: Int?
    let repostsCount: Int?
    let bookmarksCount: Int?
    let photos: [String]?
    let poll: PostPoll?

    enum CodingKeys: String, CodingKey {
        case id, body, spot, status, author, photos, poll, kind, visibility
        case githubOrgID = "github_org_id"
        case organizationAuthorID = "organization_author_id"
        case organizationAuthor = "organization_author"
        case authorID = "author_id"
        case githubLink = "github_link"
        case repoFullName = "repo_full_name"
        case eventURL = "event_url"
        case eventDays = "event_days"
        case createdAt = "created_at"
        case commentsCount = "comments_count"
        case repostsCount = "reposts_count"
        case bookmarksCount = "bookmarks_count"
    }
}

struct PostInteractionRow: Codable {
    let userID: UUID
    enum CodingKeys: String, CodingKey { case userID = "user_id" }
}

struct ReportIdentifier: Codable {
    let id: UUID
}

struct GitHubRepositoryOwner: Codable, Hashable {
    let id: Int64
    let login: String
    let type: String?
}

struct Repository: Codable, Identifiable, Hashable {
    var owner: GitHubRepositoryOwner? = nil
    let id: Int
    let name: String
    let fullName: String
    let description: String?
    let htmlURL: URL
    let language: String?
    let stars: Int
    let openIssues: Int
    let pushedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, description, language, owner
        case fullName = "full_name"
        case htmlURL = "html_url"
        case stars = "stargazers_count"
        case openIssues = "open_issues_count"
        case pushedAt = "pushed_at"
    }
}

struct GitHubContribution: Codable, Hashable {
    let date: String
    let count: Int
}

struct GitHubContributionsResponse: Codable {
    let contributions: [GitHubContribution]
}

struct GitHubLanguageStat: Identifiable, Hashable {
    let name: String
    let bytes: Int
    let repositoryCount: Int
    var id: String { name }
}

struct GitHubIssue: Codable, Identifiable, Hashable {
    struct Label: Codable, Hashable { let name: String }
    let id: Int
    let number: Int
    let title: String
    let body: String?
    let htmlURL: URL
    let repositoryURL: URL
    let createdAt: String?
    let comments: Int
    let labels: [Label]

    enum CodingKeys: String, CodingKey {
        case id, number, title, body, comments, labels
        case htmlURL = "html_url"
        case repositoryURL = "repository_url"
        case createdAt = "created_at"
    }

    var repositoryName: String { repositoryURL.pathComponents.suffix(2).joined(separator: "/") }

    var dueDate: Date? {
        guard let body else { return nil }
        let keywords = "(?:due|deadline|by|期限|提出期限|提出日|締切|締め切り|しめきり|しめ切り)"
        let pattern = "(?:\\*\\*)?\\s*\(keywords)\\s*[:：]?\\s*(?:\\*\\*)?\\s*[:：]?\\s*(?:(\\d{4})[-/年]\\s*)?(\\d{1,2})[-/月]\\s*(\\d{1,2})日?(?:\\s*\\([^)]*\\))?(?:[T\\s]+(\\d{1,2}):(\\d{2}))?"
        guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let match = regex.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)) else { return nil }
        func value(_ index: Int) -> Int? {
            let range = match.range(at: index)
            guard range.location != NSNotFound, let swiftRange = Range(range, in: body) else { return nil }
            return Int(body[swiftRange])
        }
        guard let month = value(2), let day = value(3) else { return nil }
        let year = value(1) ?? Calendar.current.component(.year, from: Date())
        var parts = DateComponents(); parts.year = year; parts.month = month; parts.day = day
        parts.hour = value(4) ?? 23; parts.minute = value(5) ?? 59
        return Calendar.current.date(from: parts)
    }

    var isTemplateTask: Bool {
        dueDate != nil || labels.contains { $0.name.caseInsensitiveCompare("task") == .orderedSame }
    }

    var isHiddenFromSpotcode: Bool {
        if labels.contains(where: { ["spotcode非表示", "spotcode-hidden"].contains($0.name.lowercased()) }) { return true }
        guard let body else { return false }
        let pattern = "(?:\\*\\*)?\\s*spotcode\\s*表示\\s*[:：]?\\s*(?:\\*\\*)?\\s*[:：]?\\s*(?:しない|非表示|off|false|no)(?:\\s|$)"
        return body.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

struct GitHubIssueSearchResponse: Codable {
    let totalCount: Int
    let items: [GitHubIssue]
    enum CodingKeys: String, CodingKey { case items; case totalCount = "total_count" }
}

struct AuthUser: Codable {
    let id: UUID
    let email: String?
    let factors: [MFAFactor]?
}

struct AuthSession: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Int?
    let user: AuthUser

    enum CodingKeys: String, CodingKey {
        case user
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
    }
}

struct MFAFactor: Codable, Identifiable {
    let id: String
    let status: String
    let friendlyName: String?
    enum CodingKeys: String, CodingKey { case id, status; case friendlyName = "friendly_name" }
}

struct MFAFactorsResponse: Codable {
    let all: [MFAFactor]?
    let totp: [MFAFactor]?
}

struct MFATOTPEnrollment: Codable {
    let qrCode: String?
    let secret: String
    let uri: String?
    enum CodingKeys: String, CodingKey { case secret, uri; case qrCode = "qr_code" }
}

struct MFAEnrollment: Codable, Identifiable {
    let id: String
    let totp: MFATOTPEnrollment
}

struct MFAChallenge: Codable { let id: String }

struct IssueDisplayPreferences: Codable {
    let userID: UUID
    let hiddenRepos: [String]
    var selectedRepos: [String]? = nil
    let includePrivate: Bool
    enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case hiddenRepos = "hidden_repos"
        case selectedRepos = "selected_repos"
        case includePrivate = "include_private"
    }
}

/// Public account-switcher metadata. Authentication tokens are stored
/// separately in Keychain, never in this UserDefaults-backed value.
struct SavedAccount: Codable, Identifiable, Hashable {
    let id: UUID
    let profile: Profile
    var lastUsed: Date
}

struct PostDraft: Encodable {
    let authorID: UUID
    let body: String
    let githubLink: String?
    let repoFullName: String?
    let eventURL: String?
    var eventDays: [PostEventDay]? = nil
    let spot: Spot?
    let kind: String?
    let visibility: String
    let photos: [String]?
    let poll: PostPoll?
    let status: String

    enum CodingKeys: String, CodingKey {
        case body, status, spot, kind, visibility, photos, poll
        case authorID = "author_id"
        case githubLink = "github_link"
        case repoFullName = "repo_full_name"
        case eventURL = "event_url"
        case eventDays = "event_days"
    }
}

struct PostPoll: Codable, Hashable {
    let question: String
    let options: [String]
}

struct FollowEvent: Codable, Identifiable {
    let status: String
    let createdAt: String?
    let follower: Profile
    var id: String { follower.handle + (createdAt ?? "") }

    enum CodingKeys: String, CodingKey {
        case status, follower
        case createdAt = "created_at"
    }
}

enum NotificationKind: String, Hashable {
    case like, comment, mention, follow, followRequest, followedPost
}

struct AppNotification: Identifiable, Hashable {
    let id: String
    let kind: NotificationKind
    let actor: Profile
    let createdAt: String?
    let post: Post?
    let context: String?
    let followStatus: String?
}

struct NotificationLikeRow: Codable {
    let postID: UUID
    let createdAt: String?
    let user: Profile
    enum CodingKeys: String, CodingKey { case user; case postID = "post_id"; case createdAt = "created_at" }
}

struct NotificationCommentRow: Codable {
    let id: UUID
    let postID: UUID
    let body: String
    let createdAt: String?
    let author: Profile
    enum CodingKeys: String, CodingKey {
        case id, body, author
        case postID = "post_id"
        case createdAt = "created_at"
    }
}

struct NotificationMentionPostRow: Codable {
    let id: UUID
    let body: String
    let createdAt: String?
    let author: Profile
    enum CodingKeys: String, CodingKey { case id, body, author; case createdAt = "created_at" }
}

struct FollowRecord: Codable {
    let followerID: UUID
    let targetID: UUID
    let status: String

    enum CodingKeys: String, CodingKey {
        case status
        case followerID = "follower_id"
        case targetID = "target_id"
    }
}

struct FollowingProfile: Codable {
    let target: Profile
}

struct FollowerProfile: Codable { let follower: Profile }

struct GitHubOrganization: Codable, Identifiable {
    let id: Int64
    let login: String
    let role: String
}
struct GitHubOrganizationLink: Codable {
    let orgID: Int64
    let login: String
    enum CodingKeys: String, CodingKey { case orgID = "org_id", login }
}
struct GitHubOrganizationResult: Codable {
    let organizations: [GitHubOrganization]
    let linked: GitHubOrganizationLink?
    let repositories: [Repository]?
}

// The signup endpoint returns a session immediately, or a user awaiting email confirmation.
struct SignupResponse: Decodable {
    let access_token: String?
    let refresh_token: String?
    let expires_at: Int?
    let user: AuthUser?
    let id: UUID?

    var session: AuthSession? {
        guard let access_token, !access_token.isEmpty,
              let refresh_token, !refresh_token.isEmpty, let user else { return nil }
        return AuthSession(accessToken: access_token, refreshToken: refresh_token, expiresAt: expires_at, user: user)
    }
}

struct SignupInput: Encodable {
    struct Metadata: Encodable { let handle: String; let name: String }
    let email: String
    let password: String
    let data: Metadata

    init(email: String, password: String, handle: String, name: String) throws {
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let handle = handle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard email.range(of: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", options: .regularExpression) != nil,
              !email.hasSuffix("@spotcode-sns.local") else {
            throw Self.failure("signup.invalid_email")
        }
        guard password.count >= 8 else { throw Self.failure("signup.short_password") }
        guard handle.range(of: "^[a-z0-9_][a-z0-9_-]{1,19}$", options: .regularExpression) != nil else {
            throw Self.failure("signup.invalid_handle")
        }
        guard !name.isEmpty, name.count <= 40 else { throw Self.failure("signup.invalid_name") }
        self.email = email; self.password = password
        self.data = Metadata(handle: handle, name: name)
    }

    private static func failure(_ key: String) -> NSError {
        NSError(domain: "Signup", code: 0, userInfo: [NSLocalizedDescriptionKey: NSLocalizedString(key, comment: "")])
    }
}

// A saved draft is separate from each editor's working copy, so opening or
// dismissing an empty sheet cannot overwrite another editor's saved content.
struct NativeComposerDraft: Codable, Equatable {
    var body = ""
    var githubLink = ""
    var repoFullName = ""
    var eventURL = ""
    var eventDays: [PostEventDay]? = nil
    var kind: String?
    var visibility = "public"
    var photos: [String] = []
    var poll: PostPoll?
    var spot: Spot?
    var hasContent: Bool {
        !(eventDays ?? []).isEmpty || !body.isEmpty || !githubLink.isEmpty || !eventURL.isEmpty || !repoFullName.isEmpty || !photos.isEmpty || poll != nil || spot != nil
    }
}

enum NativeDraftStore {
    static func generation(account: String, slot: String, defaults: UserDefaults = .standard) -> Int {
        defaults.integer(forKey: key(account: account, slot: slot) + ".generation")
    }
    static func completePublishing(_ draft: NativeComposerDraft, account: String, slot: String, defaults: UserDefaults = .standard) {
        clearSaved(matching: draft, account: account, defaults: defaults)
        save(NativeComposerDraft(), account: account, slot: slot, defaults: defaults)
        defaults.set(generation(account: account, slot: slot, defaults: defaults) + 1, forKey: key(account: account, slot: slot) + ".generation")
    }

    static func migrateLegacy(account: String, defaults: UserDefaults = .standard) {
        guard account != "guest", load(account: account, slot: "saved", defaults: defaults) == nil,
              let body = defaults.string(forKey: "spotcode.native.draft"), !body.isEmpty else { return }
        save(NativeComposerDraft(body: body), account: account, slot: "saved", defaults: defaults)
        defaults.removeObject(forKey: "spotcode.native.draft")
    }
    static func key(account: String, slot: String) -> String { "spotcode.native.composer.\(account).\(slot)" }
    static func load(account: String, slot: String, defaults: UserDefaults = .standard) -> NativeComposerDraft? {
        guard let data = defaults.data(forKey: key(account: account, slot: slot)) else { return nil }
        return try? JSONDecoder().decode(NativeComposerDraft.self, from: data)
    }
    static func save(_ draft: NativeComposerDraft, account: String, slot: String, defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(draft) else { return }
        defaults.set(data, forKey: key(account: account, slot: slot))
        if slot == "saved" { defaults.set(defaults.integer(forKey: "spotcode.native.draft.revision") + 1, forKey: "spotcode.native.draft.revision") }
    }
    static func clearSaved(matching draft: NativeComposerDraft, account: String, defaults: UserDefaults = .standard) {
        if load(account: account, slot: "saved", defaults: defaults) == draft {
            defaults.removeObject(forKey: key(account: account, slot: "saved"))
            defaults.set(defaults.integer(forKey: "spotcode.native.draft.revision") + 1, forKey: "spotcode.native.draft.revision")
        }
    }
}

struct NativePostActivity: Decodable, Identifiable {
    let createdAt: String?
    let user: Profile?
    var id: String { (user?.id?.uuidString ?? user?.handle ?? "unknown") + (createdAt ?? "") }
    enum CodingKeys: String, CodingKey { case createdAt = "created_at", user }
}

// Presentation-only anonymity: raw identities remain intact for navigation,
// API requests and storage. Match the Web privacy mode's stable FNV-1a aliases.
enum NativePrivacy {
    static var currentProfile: Profile?
    static let preferenceKey = "spotcode.native.privacy-mode"
    static var canUse: Bool {
        currentProfile?.isAdmin == true || currentProfile?.isOperator == true || currentProfile?.handle == "spotcode_dev"
    }
    static var enabled: Bool { canUse && UserDefaults.standard.bool(forKey: preferenceKey) }
    static func masks(_ handle: String) -> Bool {
        enabled && !handle.isEmpty && handle != currentProfile?.handle
    }
    static func alias(_ handle: String) -> String {
        var hash: UInt32 = 0x811c9dc5
        for value in handle.lowercased().utf16 { hash = (hash ^ UInt32(value)) &* 16777619 }
        return String(format: "%04x", hash & 0xffff)
    }
    static func text(_ text: String) -> String {
        guard enabled else { return text }
        let pattern = "(^|[^A-Za-z0-9_@-])@([A-Za-z0-9_][A-Za-z0-9_-]*)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        let result = NSMutableString(string: text)
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            let handle = (text as NSString).substring(with: match.range(at: 2))
            if masks(handle) { result.replaceCharacters(in: match.range(at: 2), with: "user_" + alias(handle)) }
        }
        return result as String
    }
}

extension Profile {
    var visibleName: String { NativePrivacy.masks(handle) ? "User " + NativePrivacy.alias(handle) : name }
    var visibleHandle: String { NativePrivacy.masks(handle) ? "user_" + NativePrivacy.alias(handle) : handle }
    var visibleAvatarURL: String? { NativePrivacy.masks(handle) ? nil : avatarURL }
    var visibleInitial: String { NativePrivacy.masks(handle) ? "U" : String(name.first ?? "?") }
}

/// Calendar dates are stored without a timezone so travel cannot move an event day.
struct PostEventDay: Codable, Hashable, Identifiable {
    var id = UUID()
    var date: String
    var url: String

    static var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter
    }
    var calendarDate: Date {
        get { Self.dateFormatter.date(from: date) ?? Date() }
        set { date = Self.dateFormatter.string(from: newValue) }
    }
    var link: URL? {
        guard let value = URL(string: url.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["https", "http"].contains(value.scheme?.lowercased() ?? ""),
              let host = value.host, !host.isEmpty else { return nil }
        return value
    }
    static func validate(_ days: [PostEventDay]) throws {
        guard days.allSatisfy({ day in day.link != nil && dateFormatter.date(from: day.date).map { dateFormatter.string(from: $0) == day.date } == true }) else {
            throw NSError(domain: "EventDays", code: 1, userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("各Dayの日付と有効なリンク（https://…）を入力してください。", comment: "")])
        }
    }
}
