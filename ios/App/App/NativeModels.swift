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

    enum CodingKeys: String, CodingKey {
        case id, handle, name, bio, location
        case avatarURL = "avatar_url"
        case githubHandle = "github_handle"
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
    let spot: Spot?
    let status: String?
    let createdAt: String?
    let author: Profile?

    enum CodingKeys: String, CodingKey {
        case id, body, spot, status, author
        case authorID = "author_id"
        case githubLink = "github_link"
        case createdAt = "created_at"
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

    enum CodingKeys: String, CodingKey {
        case id, name, description, language
        case fullName = "full_name"
        case htmlURL = "html_url"
        case stars = "stargazers_count"
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
    let status: String

    enum CodingKeys: String, CodingKey {
        case body, status
        case authorID = "author_id"
        case githubLink = "github_link"
    }
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
