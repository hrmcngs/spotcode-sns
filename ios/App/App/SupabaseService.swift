import Foundation

actor SupabaseService {
    static let shared = SupabaseService()
    private let baseURL = URL(string: "https://vkwdthjiyxrhskdlgexq.supabase.co")!
    private let anonKey = "sb_publishable_xdAZG7yOOFKPXmugjhDWdQ_HJ7sGHIq"
    private var supportedPostMetadata = ["repo_full_name", "kind", "visibility", "event_url", "poll"]
    private let decoder: JSONDecoder = {
        let value = JSONDecoder()
        return value
    }()
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.allowsCellularAccess = true
        configuration.allowsExpensiveNetworkAccess = true
        configuration.allowsConstrainedNetworkAccess = true
        configuration.waitsForConnectivity = false
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 35
        configuration.requestCachePolicy = .reloadRevalidatingCacheData
        return URLSession(configuration: configuration)
    }()

    private func data(for request: URLRequest, retryable: Bool) async throws -> (Data, URLResponse) {
        var lastError: Error?
        let attempts = retryable ? 3 : 1
        for attempt in 0..<attempts {
            do { return try await session.data(for: request) }
            catch let error as URLError where Self.transientErrors.contains(error.code) {
                lastError = error
                guard attempt + 1 < attempts else { break }
                try await Task.sleep(nanoseconds: UInt64(400_000_000 * (attempt + 1)))
            }
        }
        throw lastError ?? URLError(.unknown)
    }

    private static let transientErrors: Set<URLError.Code> = [
        .timedOut, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed,
        .networkConnectionLost, .notConnectedToInternet, .internationalRoamingOff,
        .dataNotAllowed
    ]

    private func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        token: String? = nil,
        body: Data? = nil,
        preferRepresentation: Bool = false
    ) async throws -> T {
        guard let endpoint = URL(string: path, relativeTo: baseURL) else { throw URLError(.badURL) }
        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.httpBody = body
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token ?? anonKey)", forHTTPHeaderField: "Authorization")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if preferRepresentation { request.setValue("return=representation", forHTTPHeaderField: "Prefer") }
        let isAuthRequest = path.hasPrefix("auth/v1/")
        let (data, response) = try await data(for: request, retryable: method == "GET" || method == "HEAD" || isAuthRequest)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "通信エラー"
            throw NSError(domain: "Supabase", code: (response as? HTTPURLResponse)?.statusCode ?? -1,
                          userInfo: [NSLocalizedDescriptionKey: message])
        }
        return try decoder.decode(T.self, from: data)
    }

    func login(email: String, password: String) async throws -> AuthSession {
        let payload = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        return try await request("auth/v1/token?grant_type=password", method: "POST", body: payload)
    }

    func usernameLogin(handle: String, password: String) async throws -> AuthSession {
        let payload = try JSONSerialization.data(withJSONObject: ["username": handle, "password": password])
        return try await request("functions/v1/username-login", method: "POST", body: payload)
    }

    func refresh(_ refreshToken: String) async throws -> AuthSession {
        let payload = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])
        return try await request("auth/v1/token?grant_type=refresh_token", method: "POST", body: payload)
    }

    func mfaFactors(token: String) async throws -> [MFAFactor] {
        let result: MFAFactorsResponse = try await request("auth/v1/factors", token: token)
        return result.totp ?? []
    }

    func allMFAFactors(token: String) async throws -> [MFAFactor] {
        let result: MFAFactorsResponse = try await request("auth/v1/factors", token: token)
        return result.all ?? result.totp ?? []
    }

    func enrollMFA(token: String) async throws -> MFAEnrollment {
        let body = try JSONSerialization.data(withJSONObject: ["factor_type": "totp", "friendly_name": "Spotcode"])
        return try await request("auth/v1/factors", method: "POST", token: token, body: body)
    }

    func verifyMFA(factorID: String, code: String, token: String) async throws -> AuthSession {
        let challengeBody = try JSONSerialization.data(withJSONObject: ["factor_id": factorID])
        let challenge: MFAChallenge = try await request(
            "auth/v1/factors/\(factorID)/challenge", method: "POST", token: token, body: challengeBody
        )
        let verifyBody = try JSONSerialization.data(withJSONObject: [
            "factor_id": factorID, "challenge_id": challenge.id, "code": code
        ])
        return try await request("auth/v1/factors/\(factorID)/verify", method: "POST", token: token, body: verifyBody)
    }

    func disableMFA(factorID: String, token: String) async throws {
        let _: EmptyResponse = try await request("auth/v1/factors/\(factorID)", method: "DELETE", token: token)
    }

    func profile(id: UUID, token: String) async throws -> Profile? {
        do {
            let rows: [Profile] = try await request("rest/v1/profiles?id=eq.\(id.uuidString)&select=id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape,is_admin,is_operator", token: token)
            return rows.first
        } catch where error.localizedDescription.lowercased().contains("is_admin") || error.localizedDescription.lowercased().contains("is_operator") {
            let rows: [Profile] = try await request("rest/v1/profiles?id=eq.\(id.uuidString)&select=id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape", token: token)
            return rows.first
        }
    }

    func profile(handle: String, token: String?) async throws -> Profile? {
        let escaped = handle.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? handle
        do {
            let rows: [Profile] = try await request("rest/v1/profiles?handle=eq.\(escaped)&select=id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape,is_admin,is_operator", token: token)
            return rows.first
        } catch where error.localizedDescription.lowercased().contains("is_admin") || error.localizedDescription.lowercased().contains("is_operator") {
            let rows: [Profile] = try await request("rest/v1/profiles?handle=eq.\(escaped)&select=id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape", token: token)
            return rows.first
        }
    }

    func searchProfiles(query: String, token: String?) async throws -> [Profile] {
        let escaped = query.trimmingCharacters(in: .whitespacesAndNewlines).addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try await request("rest/v1/profiles?or=(handle.ilike.*\(escaped)*,name.ilike.*\(escaped)*)&select=id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape&limit=12", token: token)
    }

    func updateProfile(id: UUID, name: String, bio: String, location: String, avatarURL: String?, avatarShape: String, token: String) async throws -> Profile {
        let payload: [String: Any] = [
            "name": name, "bio": bio, "location": location,
            "avatar_url": (avatarURL as Any?) ?? NSNull(), "avatar_shape": avatarShape
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let rows: [Profile] = try await request(
            "rest/v1/profiles?id=eq.\(id.uuidString)&select=id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape",
            method: "PATCH", token: token, body: body, preferRepresentation: true
        )
        guard let profile = rows.first else { throw URLError(.badServerResponse) }
        return profile
    }

    func posts(limit: Int = 24, authorID: UUID? = nil, token: String? = nil, includePhotos: Bool = false) async throws -> [Post] {
        let photoColumn = includePhotos ? ",photos" : ""
        let common = "id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count\(photoColumn),author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)"
        while true {
            let extras = supportedPostMetadata.isEmpty ? "" : "," + supportedPostMetadata.joined(separator: ",")
            var path = "rest/v1/posts?select=\(common)\(extras)&order=created_at.desc&limit=\(limit)"
            if let authorID { path += "&author_id=eq.\(authorID.uuidString)" }
            do { return try await request(path, token: token) }
            catch {
                let message = error.localizedDescription.lowercased()
                guard let missing = supportedPostMetadata.first(where: { message.contains($0) }) else { throw error }
                supportedPostMetadata.removeAll { $0 == missing }
            }
        }
    }

    func spottedPosts(token: String?) async throws -> [Post] {
        try await request("rest/v1/posts?spot=not.is.null&select=id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count,author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc&limit=60", token: token)
    }

    func createPost(_ draft: PostDraft, token: String) async throws -> Post {
        let encoded = try JSONEncoder().encode(draft)
        var payload = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] ?? [:]
        for column in ["repo_full_name", "kind", "visibility", "event_url", "poll"] where !supportedPostMetadata.contains(column) {
            payload.removeValue(forKey: column)
        }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let extras = supportedPostMetadata.isEmpty ? "" : "," + supportedPostMetadata.joined(separator: ",")
        let rows: [Post] = try await request(
            "rest/v1/posts?select=id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count,photos\(extras),author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)",
            method: "POST", token: token, body: body, preferRepresentation: true
        )
        guard let post = rows.first else { throw NSError(domain: "Supabase", code: -2, userInfo: [NSLocalizedDescriptionKey: "投稿結果が空です"]) }
        return post
    }

    func updatePost(id: UUID, body text: String, githubLink: String?, eventURL: String?, kind: String?, visibility: String, token: String) async throws -> Post {
        let payload: [String: Any] = [
            "body": text,
            "github_link": (githubLink as Any?) ?? NSNull(),
            "event_url": (eventURL as Any?) ?? NSNull(),
            "kind": (kind as Any?) ?? NSNull(),
            "visibility": visibility
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let extras = supportedPostMetadata.isEmpty ? "" : "," + supportedPostMetadata.joined(separator: ",")
        let rows: [Post] = try await request(
            "rest/v1/posts?id=eq.\(id.uuidString)&select=id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count,photos\(extras),author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)",
            method: "PATCH", token: token, body: body, preferRepresentation: true
        )
        guard let post = rows.first else { throw NSError(domain: "Supabase", code: 403, userInfo: [NSLocalizedDescriptionKey: "この投稿を編集できません"]) }
        return post
    }

    func deletePost(id: UUID, token: String) async throws {
        let rows: [Post] = try await request(
            "rest/v1/posts?id=eq.\(id.uuidString)&select=id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count,author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)",
            method: "DELETE", token: token, preferRepresentation: true
        )
        guard !rows.isEmpty else { throw NSError(domain: "Supabase", code: 403, userInfo: [NSLocalizedDescriptionKey: "この投稿を削除できません"]) }
    }

    func repositories(handle: String) async throws -> [Repository] {
        var components = URLComponents(string: "https://api.github.com/users/\(handle)/repos")!
        components.queryItems = [.init(name: "sort", value: "pushed"), .init(name: "type", value: "owner"), .init(name: "per_page", value: "30")]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 35
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, response) = try await data(for: request, retryable: true)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try decoder.decode([Repository].self, from: data)
    }

    func githubContributions(handle: String) async throws -> [GitHubContribution] {
        let escaped = handle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? handle
        var components = URLComponents(string: "https://github-contributions-api.jogruber.de/v4/\(escaped)")!
        components.queryItems = [.init(name: "y", value: "last")]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 35
        let (data, response) = try await data(for: request, retryable: true)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try decoder.decode(GitHubContributionsResponse.self, from: data).contributions
    }

    func githubOpenIssues(handle: String) async throws -> GitHubIssueSearchResponse {
        var components = URLComponents(string: "https://api.github.com/search/issues")!
        components.queryItems = [
            .init(name: "q", value: "author:\(handle) type:issue state:open is:public"),
            .init(name: "sort", value: "created"), .init(name: "order", value: "desc"),
            .init(name: "per_page", value: "30")
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 35
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, response) = try await data(for: request, retryable: true)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try decoder.decode(GitHubIssueSearchResponse.self, from: data)
    }

    func followingProfiles(userID: UUID, token: String) async throws -> [Profile] {
        let rows: [FollowingProfile] = try await request(
            "rest/v1/follows?follower_id=eq.\(userID.uuidString)&status=eq.accepted&select=target:profiles!follows_target_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)",
            token: token
        )
        return rows.map(\.target)
    }

    func followers(userID: UUID, token: String?) async throws -> [Profile] {
        let rows: [FollowerProfile] = try await request(
            "rest/v1/follows?target_id=eq.\(userID.uuidString)&status=eq.accepted&select=follower:profiles!follows_follower_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc",
            token: token
        )
        return rows.map(\.follower)
    }

    func following(userID: UUID, token: String?) async throws -> [Profile] {
        let rows: [FollowingProfile] = try await request(
            "rest/v1/follows?follower_id=eq.\(userID.uuidString)&status=eq.accepted&select=target:profiles!follows_target_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc",
            token: token
        )
        return rows.map(\.target)
    }

    func followNotifications(userID: UUID, token: String) async throws -> [FollowEvent] {
        try await request(
            "rest/v1/follows?target_id=eq.\(userID.uuidString)&select=status,created_at,follower:profiles!follows_follower_id_fkey(id,handle,name,avatar_url,bio,location,github_handle)&order=created_at.desc&limit=30",
            token: token
        )
    }

    func followStatus(followerID: UUID, targetID: UUID, token: String) async throws -> Bool {
        let rows: [FollowRecord] = try await request(
            "rest/v1/follows?follower_id=eq.\(followerID.uuidString)&target_id=eq.\(targetID.uuidString)&status=eq.accepted&select=follower_id,target_id,status&limit=1",
            token: token
        )
        return !rows.isEmpty
    }

    func follow(followerID: UUID, targetID: UUID, token: String) async throws {
        let payload = try JSONSerialization.data(withJSONObject: [
            "follower_id": followerID.uuidString,
            "target_id": targetID.uuidString,
            "status": "accepted"
        ])
        let _: [FollowRecord] = try await request(
            "rest/v1/follows?on_conflict=follower_id,target_id&select=follower_id,target_id,status",
            method: "POST", token: token, body: payload, preferRepresentation: true
        )
    }

    func unfollow(followerID: UUID, targetID: UUID, token: String) async throws {
        let _: [FollowRecord] = try await request(
            "rest/v1/follows?follower_id=eq.\(followerID.uuidString)&target_id=eq.\(targetID.uuidString)&select=follower_id,target_id,status",
            method: "DELETE", token: token, preferRepresentation: true
        )
    }

    func profileCounts(userID: UUID, token: String?) async -> (following: Int, followers: Int, posts: Int) {
        async let followingRows = try? following(userID: userID, token: token)
        async let followerRows = try? followers(userID: userID, token: token)
        async let postCount = try? count("rest/v1/posts?author_id=eq.\(userID.uuidString)&select=id", token: token)
        return await (followingRows?.count ?? 0, followerRows?.count ?? 0, postCount ?? 0)
    }

    private func count(_ path: String, token: String?) async throws -> Int {
        guard let endpoint = URL(string: path, relativeTo: baseURL) else { throw URLError(.badURL) }
        var value = URLRequest(url: endpoint)
        value.httpMethod = "GET"
        value.timeoutInterval = 35
        value.setValue(anonKey, forHTTPHeaderField: "apikey")
        value.setValue("Bearer \(token ?? anonKey)", forHTTPHeaderField: "Authorization")
        value.setValue("count=exact", forHTTPHeaderField: "Prefer")
        value.setValue("0-0", forHTTPHeaderField: "Range")
        let (_, response) = try await data(for: value, retryable: true)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        let range = http.value(forHTTPHeaderField: "Content-Range") ?? "*/0"
        return Int(range.split(separator: "/").last ?? "0") ?? 0
    }
}
