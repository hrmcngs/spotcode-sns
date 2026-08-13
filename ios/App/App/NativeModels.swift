import Foundation
import CoreLocation

struct Profile: Codable, Identifiable, Hashable {
    let id: UUID?
    let handle: String
    let name: String
    let avatarURL: String?
    let bio: String?
    let location: String?
    let githubHandle: String?
    let createdAt: String?
    let avatarShape: String?
    let isAdmin: Bool?
    let isOperator: Bool?

    enum CodingKeys: String, CodingKey {
        case id, handle, name, bio, location
        case avatarURL = "avatar_url"
        case githubHandle = "github_handle"
        case createdAt = "created_at"
        case avatarShape = "avatar_shape"
        case isAdmin = "is_admin"
        case isOperator = "is_operator"
    }
}

struct Spot: Codable, Hashable {
    let lat: Double
    let lng: Double
    let label: String?
    let address: String?

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

struct Post: Codable, Identifiable, Hashable {
    let id: UUID
    let authorID: UUID
    let body: String
    let githubLink: String?
    let repoFullName: String?
    let eventURL: String?
    let kind: String?
    let visibility: String?
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
        case authorID = "author_id"
        case githubLink = "github_link"
        case repoFullName = "repo_full_name"
        case eventURL = "event_url"
        case createdAt = "created_at"
        case commentsCount = "comments_count"
        case repostsCount = "reposts_count"
        case bookmarksCount = "bookmarks_count"
    }
}

struct Repository: Codable, Identifiable, Hashable {
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
        case id, name, description, language
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

struct AuthUser: Codable { let id: UUID; let email: String? }

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
    let eventURL: String?
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
        case eventURL = "event_url"
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
