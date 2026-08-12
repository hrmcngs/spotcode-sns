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

struct FollowingProfile: Codable {
    let target: Profile
}

struct FollowerProfile: Codable { let follower: Profile }
