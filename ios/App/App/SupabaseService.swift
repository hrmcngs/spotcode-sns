import Foundation

actor SupabaseService {
    static let shared = SupabaseService()
    static let defaultProjectURL = "https://vkwdthjiyxrhskdlgexq.supabase.co"
    static let defaultPublishableKey = "sb_publishable_xdAZG7yOOFKPXmugjhDWdQ_HJ7sGHIq"
    static let projectURLKey = "spotcode.native.supabase-url"
    static let publishableKeyKey = "spotcode.native.supabase-key"
    private var baseURL: URL {
        URL(string: UserDefaults.standard.string(forKey: Self.projectURLKey) ?? Self.defaultProjectURL)!
    }
    private var anonKey: String {
        UserDefaults.standard.string(forKey: Self.publishableKeyKey) ?? Self.defaultPublishableKey
    }
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
        preferRepresentation: Bool = false,
        prefer: String? = nil
    ) async throws -> T {
        guard let endpoint = URL(string: path, relativeTo: baseURL) else { throw URLError(.badURL) }
        var request = URLRequest(url: endpoint)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.httpBody = body
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token ?? anonKey)", forHTTPHeaderField: "Authorization")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let prefer { request.setValue(prefer, forHTTPHeaderField: "Prefer") }
        else if preferRepresentation { request.setValue("return=representation", forHTTPHeaderField: "Prefer") }
        let isAuthRequest = path.hasPrefix("auth/v1/")
        let (data, response) = try await data(for: request, retryable: method == "GET" || method == "HEAD" || isAuthRequest)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "通信エラー"
            throw NSError(domain: "Supabase", code: (response as? HTTPURLResponse)?.statusCode ?? -1,
                          userInfo: [NSLocalizedDescriptionKey: message])
        }
        if T.self == EmptyResponse.self, data.isEmpty || String(data: data, encoding: .utf8) == "null" {
            return EmptyResponse() as! T
        }
        return try decoder.decode(T.self, from: data)
    }

    func ensureDevAccount(password: String, token: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["new_pass": password])
        let _: EmptyResponse = try await request("rest/v1/rpc/ensure_dev_account", method: "POST", token: token, body: body)
    }

    func testConnection(projectURL: String? = nil, publishableKey: String? = nil) async throws {
        let urlText = projectURL ?? baseURL.absoluteString
        let key = publishableKey ?? anonKey
        guard let root = URL(string: urlText), let endpoint = URL(string: "auth/v1/settings", relativeTo: root) else {
            throw URLError(.badURL)
        }
        var probe = URLRequest(url: endpoint)
        probe.timeoutInterval = 15
        probe.setValue(key, forHTTPHeaderField: "apikey")
        let (data, response) = try await data(for: probe, retryable: true)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "接続できませんでした。"
            throw NSError(domain: "Supabase", code: (response as? HTTPURLResponse)?.statusCode ?? -1,
                          userInfo: [NSLocalizedDescriptionKey: message])
        }
    }

    func saveConnection(projectURL: String, publishableKey: String) {
        UserDefaults.standard.set(projectURL, forKey: Self.projectURLKey)
        UserDefaults.standard.set(publishableKey, forKey: Self.publishableKeyKey)
    }

    func restoreDefaultConnection() {
        UserDefaults.standard.removeObject(forKey: Self.projectURLKey)
        UserDefaults.standard.removeObject(forKey: Self.publishableKeyKey)
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
        let user: AuthUser = try await request("auth/v1/user", token: token)
        return (user.factors ?? []).filter { $0.status == "verified" }
    }

    func allMFAFactors(token: String) async throws -> [MFAFactor] {
        let user: AuthUser = try await request("auth/v1/user", token: token)
        return user.factors ?? []
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
            let rows: [Profile] = try await request("rest/v1/profiles?id=eq.\(id.uuidString)&select=id,handle,name,avatar_url,bio,location,github_handle,github_verified,website,twitter,instagram,is_private,is_org,organization,close_friends,org_members,created_at,avatar_shape,is_admin,is_operator", token: token)
            return rows.first
        } catch where error.localizedDescription.lowercased().contains("is_admin") || error.localizedDescription.lowercased().contains("is_operator") {
            let rows: [Profile] = try await request("rest/v1/profiles?id=eq.\(id.uuidString)&select=id,handle,name,avatar_url,bio,location,github_handle,github_verified,website,twitter,instagram,is_private,is_org,organization,close_friends,org_members,created_at,avatar_shape", token: token)
            return rows.first
        }
    }

    func profile(handle: String, token: String?) async throws -> Profile? {
        let escaped = handle.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? handle
        do {
            let rows: [Profile] = try await request("rest/v1/profiles?handle=eq.\(escaped)&select=id,handle,name,avatar_url,bio,location,github_handle,github_verified,website,twitter,instagram,is_private,is_org,organization,close_friends,org_members,created_at,avatar_shape,is_admin,is_operator", token: token)
            return rows.first
        } catch where error.localizedDescription.lowercased().contains("is_admin") || error.localizedDescription.lowercased().contains("is_operator") {
            let rows: [Profile] = try await request("rest/v1/profiles?handle=eq.\(escaped)&select=id,handle,name,avatar_url,bio,location,github_handle,github_verified,website,twitter,instagram,is_private,is_org,organization,close_friends,org_members,created_at,avatar_shape", token: token)
            return rows.first
        }
    }

    func searchProfiles(query: String, token: String?) async throws -> [Profile] {
        let escaped = query.trimmingCharacters(in: .whitespacesAndNewlines).addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        return try await request("rest/v1/profiles?or=(handle.ilike.*\(escaped)*,name.ilike.*\(escaped)*)&select=id,handle,name,avatar_url,bio,location,github_handle,github_verified,website,twitter,instagram,created_at,avatar_shape&limit=12", token: token)
    }

    func updateProfile(id: UUID, name: String, bio: String, location: String, website: String, twitter: String, instagram: String, avatarURL: String?, avatarShape: String, token: String) async throws -> Profile {
        let payload: [String: Any] = [
            "name": name, "bio": bio, "location": location, "website": website.isEmpty ? NSNull() : website,
            "twitter": twitter.isEmpty ? NSNull() : twitter, "instagram": instagram.isEmpty ? NSNull() : instagram,
            "avatar_url": (avatarURL as Any?) ?? NSNull(), "avatar_shape": avatarShape
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let rows: [Profile] = try await request(
            "rest/v1/profiles?id=eq.\(id.uuidString)&select=id,handle,name,avatar_url,bio,location,github_handle,github_verified,website,twitter,instagram,is_private,is_org,organization,close_friends,org_members,created_at,avatar_shape",
            method: "PATCH", token: token, body: body, preferRepresentation: true
        )
        guard let profile = rows.first else { throw URLError(.badServerResponse) }
        return profile
    }

    func updateProfilePreferences(id: UUID, isPrivate: Bool, isOrg: Bool, organization: String, closeFriends: [String], orgMembers: [String], token: String) async throws -> Profile {
        let payload: [String: Any] = [
            "is_private": isPrivate,
            "is_org": isOrg,
            "organization": organization.isEmpty ? NSNull() : organization,
            "close_friends": closeFriends,
            "org_members": orgMembers
        ]
        let body = try JSONSerialization.data(withJSONObject: payload)
        let rows: [Profile] = try await request(
            "rest/v1/profiles?id=eq.\(id.uuidString)&select=*",
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

    func postInteractionState(table: String, postID: UUID, userID: UUID, token: String) async throws -> (mine: Bool, count: Int) {
        guard ["likes", "reposts", "bookmarks"].contains(table) else { throw URLError(.badURL) }
        let rows: [PostInteractionRow] = try await request(
            "rest/v1/\(table)?post_id=eq.\(postID.uuidString)&select=user_id",
            token: token
        )
        return (rows.contains { $0.userID == userID }, rows.count)
    }

    func togglePostInteraction(table: String, postID: UUID, userID: UUID, active: Bool, token: String) async throws -> Bool {
        guard ["likes", "reposts", "bookmarks"].contains(table) else { throw URLError(.badURL) }
        if active {
            let _: EmptyResponse = try await request(
                "rest/v1/\(table)?post_id=eq.\(postID.uuidString)&user_id=eq.\(userID.uuidString)",
                method: "DELETE", token: token
            )
            return false
        }
        let body = try JSONSerialization.data(withJSONObject: [
            "post_id": postID.uuidString,
            "user_id": userID.uuidString
        ])
        let _: EmptyResponse = try await request(
            "rest/v1/\(table)", method: "POST", token: token, body: body,
            prefer: "resolution=ignore-duplicates,return=minimal"
        )
        return true
    }

    func spottedPosts(token: String?) async throws -> [Post] {
        try await request("rest/v1/posts?spot=not.is.null&select=id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count,author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc&limit=60", token: token)
    }

    func createPost(_ draft: PostDraft, token: String) async throws -> Post {
        let encoded = try JSONEncoder().encode(draft)
        let original = try JSONSerialization.jsonObject(with: encoded) as? [String: Any] ?? [:]
        while true {
            var payload = original
            for column in ["repo_full_name", "kind", "visibility", "event_url", "poll"] where !supportedPostMetadata.contains(column) {
                payload.removeValue(forKey: column)
            }
            let body = try JSONSerialization.data(withJSONObject: payload)
            let extras = supportedPostMetadata.isEmpty ? "" : "," + supportedPostMetadata.joined(separator: ",")
            do {
                let rows: [Post] = try await request(
                    "rest/v1/posts?select=id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count,photos\(extras),author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)",
                    method: "POST", token: token, body: body, preferRepresentation: true
                )
                guard let post = rows.first else { throw NSError(domain: "Supabase", code: -2, userInfo: [NSLocalizedDescriptionKey: "投稿結果が空です"]) }
                return post
            } catch {
                guard removeMissingPostMetadata(from: error) else { throw error }
            }
        }
    }

    func updatePost(id: UUID, body text: String, githubLink: String?, repoFullName: String?, eventURL: String?, kind: String?, visibility: String, token: String) async throws -> Post {
        let original: [String: Any] = [
            "body": text,
            "github_link": (githubLink as Any?) ?? NSNull(),
            "repo_full_name": (repoFullName as Any?) ?? NSNull(),
            "event_url": (eventURL as Any?) ?? NSNull(),
            "kind": (kind as Any?) ?? NSNull(),
            "visibility": visibility
        ]
        while true {
            var payload = original
            for column in ["repo_full_name", "kind", "visibility", "event_url", "poll"] where !supportedPostMetadata.contains(column) {
                payload.removeValue(forKey: column)
            }
            let body = try JSONSerialization.data(withJSONObject: payload)
            let extras = supportedPostMetadata.isEmpty ? "" : "," + supportedPostMetadata.joined(separator: ",")
            do {
                let rows: [Post] = try await request(
                    "rest/v1/posts?id=eq.\(id.uuidString)&select=id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count,photos\(extras),author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)",
                    method: "PATCH", token: token, body: body, preferRepresentation: true
                )
                guard let post = rows.first else { throw NSError(domain: "Supabase", code: 403, userInfo: [NSLocalizedDescriptionKey: "この投稿を編集できません"]) }
                return post
            } catch {
                guard removeMissingPostMetadata(from: error) else { throw error }
            }
        }
    }

    private func removeMissingPostMetadata(from error: Error) -> Bool {
        let message = error.localizedDescription.lowercased()
        guard let missing = supportedPostMetadata.first(where: { message.contains($0) }) else { return false }
        supportedPostMetadata.removeAll { $0 == missing }
        return true
    }

    func deletePost(id: UUID, token: String) async throws {
        let rows: [Post] = try await request(
            "rest/v1/posts?id=eq.\(id.uuidString)&select=id,author_id,body,github_link,spot,status,created_at,comments_count,reposts_count,bookmarks_count,author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)",
            method: "DELETE", token: token, preferRepresentation: true
        )
        guard !rows.isEmpty else { throw NSError(domain: "Supabase", code: 403, userInfo: [NSLocalizedDescriptionKey: "この投稿を削除できません"]) }
    }

    func reportPost(postID: UUID, reporterID: UUID, reason: String, comment: String?, token: String) async throws {
        let existing: [ReportIdentifier] = try await request(
            "rest/v1/reports?post_id=eq.\(postID.uuidString)&reporter_id=eq.\(reporterID.uuidString)&select=id&limit=1",
            token: token
        )
        if !existing.isEmpty { return }
        var row: [String: Any] = [
            "post_id": postID.uuidString,
            "reporter_id": reporterID.uuidString,
            "reason": reason
        ]
        let trimmed = comment?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        row["comment"] = trimmed.isEmpty ? NSNull() : String(trimmed.prefix(400))
        let body = try JSONSerialization.data(withJSONObject: row)
        let _: EmptyResponse = try await request(
            "rest/v1/reports",
            method: "POST",
            token: token,
            body: body,
            prefer: "return=minimal"
        )
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

    func githubLanguageStats(handle: String) async throws -> [GitHubLanguageStat] {
        let repos = try await repositories(handle: handle)
        var byteTotals: [String: Int] = [:]
        var repositoryCounts: [String: Int] = [:]
        await withTaskGroup(of: [String: Int]?.self) { group in
            for repo in repos.prefix(30) {
                group.addTask {
                    let encoded = repo.fullName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? repo.fullName
                    guard let url = URL(string: "https://api.github.com/repos/\(encoded)/languages") else { return nil }
                    var request = URLRequest(url: url)
                    request.timeoutInterval = 20
                    request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
                    guard let (data, response) = try? await URLSession.shared.data(for: request),
                          (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
                    return try? JSONDecoder().decode([String: Int].self, from: data)
                }
            }
            for await languages in group {
                guard let languages else { continue }
                for (name, bytes) in languages {
                    byteTotals[name, default: 0] += bytes
                    repositoryCounts[name, default: 0] += 1
                }
            }
        }
        return byteTotals.map {
            GitHubLanguageStat(name: $0.key, bytes: $0.value, repositoryCount: repositoryCounts[$0.key, default: 0])
        }.sorted { $0.bytes > $1.bytes }
    }

    func githubOpenIssues(handle: String, githubToken: String? = nil, includePrivate: Bool = false) async throws -> GitHubIssueSearchResponse {
        var components = URLComponents(string: "https://api.github.com/search/issues")!
        components.queryItems = [
            .init(name: "q", value: "author:\(handle) type:issue state:open\(includePrivate ? "" : " is:public")"),
            .init(name: "sort", value: "created"), .init(name: "order", value: "desc"),
            .init(name: "per_page", value: "30")
        ]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 35
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        if let githubToken, !githubToken.isEmpty {
            request.setValue("Bearer \(githubToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await data(for: request, retryable: true)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try decoder.decode(GitHubIssueSearchResponse.self, from: data)
    }

    func privateIssueAuthorizationURL() -> URL? {
        var components = URLComponents(url: baseURL.appendingPathComponent("auth/v1/authorize"), resolvingAgainstBaseURL: false)
        components?.queryItems = [
            .init(name: "provider", value: "github"),
            // Supabase already allows the production web origin. It bridges
            // the OAuth fragment back to the custom app scheme, avoiding a
            // fallback to the project's localhost Site URL when custom
            // schemes are rejected by hosted Auth configuration.
            .init(name: "redirect_to", value: "https://hrmcngs.github.io/spotcode-sns/?spotcode_ios_private_issues=1"),
            .init(name: "scopes", value: "read:user repo"),
            .init(name: "prompt", value: "consent")
        ]
        return components?.url
    }

    func issueDisplayPreferences(userID: UUID, token: String) async throws -> IssueDisplayPreferences? {
        let rows: [IssueDisplayPreferences] = try await request(
            "rest/v1/issue_display_preferences?user_id=eq.\(userID.uuidString)&select=user_id,hidden_repos,include_private",
            token: token
        )
        return rows.first
    }

    func saveIssueDisplayPreferences(userID: UUID, hiddenRepos: [String], includePrivate: Bool, token: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "user_id": userID.uuidString,
            "hidden_repos": hiddenRepos,
            "include_private": includePrivate
        ])
        let _: [IssueDisplayPreferences] = try await request(
            "rest/v1/issue_display_preferences?on_conflict=user_id&select=user_id,hidden_repos,include_private",
            method: "POST", token: token, body: body,
            prefer: "resolution=merge-duplicates,return=representation"
        )
    }

    func sharedGithubPrivateIssueToken(token: String) async throws -> String? {
        let body = try JSONSerialization.data(withJSONObject: [:])
        let value: String? = try await request(
            "rest/v1/rpc/get_github_private_issue_token", method: "POST", token: token, body: body
        )
        return value
    }

    func saveSharedGithubPrivateIssueToken(_ githubToken: String, token: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["p_token": githubToken])
        let _: Bool = try await request(
            "rest/v1/rpc/save_github_private_issue_token", method: "POST", token: token, body: body
        )
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

    func notifications(userID: UUID, handle: String, token: String) async throws -> [AppNotification] {
        async let ownPostsResult = posts(limit: 60, authorID: userID, token: token)
        async let followsResult: [FollowEvent] = request(
            "rest/v1/follows?target_id=eq.\(userID.uuidString)&select=status,created_at,follower:profiles!follows_follower_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc&limit=30",
            token: token
        )
        async let postMentionsResult = notificationPostMentions(handle: handle, excluding: userID, token: token)
        async let commentMentionsResult = notificationCommentMentions(handle: handle, excluding: userID, token: token)

        let ownPosts = try await ownPostsResult
        let postIDs = ownPosts.map(\.id)
        let postMap = Dictionary(uniqueKeysWithValues: ownPosts.map { ($0.id, $0) })
        async let likesResult = notificationLikes(postIDs: postIDs, excluding: userID, token: token)
        async let commentsResult = notificationComments(postIDs: postIDs, excluding: userID, token: token)

        var result = try await followsResult.map { event in
            AppNotification(
                id: "follow:\(event.follower.id?.uuidString ?? event.follower.handle):\(event.createdAt ?? "")",
                kind: event.status == "pending" ? .followRequest : .follow,
                actor: event.follower, createdAt: event.createdAt, post: nil, context: nil, followStatus: event.status
            )
        }
        result += try await likesResult.map { row in
            AppNotification(id: "like:\(row.user.id?.uuidString ?? row.user.handle):\(row.postID.uuidString):\(row.createdAt ?? "")",
                            kind: .like, actor: row.user, createdAt: row.createdAt,
                            post: postMap[row.postID], context: nil, followStatus: nil)
        }
        result += try await commentsResult.map { row in
            AppNotification(id: "comment:\(row.id.uuidString)", kind: .comment, actor: row.author,
                            createdAt: row.createdAt, post: postMap[row.postID], context: row.body, followStatus: nil)
        }
        result += try await postMentionsResult.map { row in
            AppNotification(id: "mention-post:\(row.id.uuidString)", kind: .mention, actor: row.author,
                            createdAt: row.createdAt, post: nil, context: row.body, followStatus: nil)
        }
        result += try await commentMentionsResult.map { row in
            AppNotification(id: "mention-comment:\(row.id.uuidString)", kind: .mention, actor: row.author,
                            createdAt: row.createdAt, post: postMap[row.postID], context: row.body, followStatus: nil)
        }
        return Array(result.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }.prefix(30))
    }

    private func notificationLikes(postIDs: [UUID], excluding userID: UUID, token: String) async throws -> [NotificationLikeRow] {
        guard !postIDs.isEmpty else { return [] }
        let ids = postIDs.map(\.uuidString).joined(separator: ",")
        return try await request("rest/v1/likes?post_id=in.(\(ids))&user_id=neq.\(userID.uuidString)&select=post_id,created_at,user:profiles!likes_user_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc&limit=30", token: token)
    }

    private func notificationComments(postIDs: [UUID], excluding userID: UUID, token: String) async throws -> [NotificationCommentRow] {
        guard !postIDs.isEmpty else { return [] }
        let ids = postIDs.map(\.uuidString).joined(separator: ",")
        return try await request("rest/v1/comments?post_id=in.(\(ids))&author_id=neq.\(userID.uuidString)&select=id,body,post_id,created_at,author:profiles!comments_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc&limit=30", token: token)
    }

    private func notificationPostMentions(handle: String, excluding userID: UUID, token: String) async throws -> [NotificationMentionPostRow] {
        let term = "%@\(handle)%".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "%@\(handle)%"
        return try await request("rest/v1/posts?body=ilike.\(term)&author_id=neq.\(userID.uuidString)&select=id,body,created_at,author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc&limit=30", token: token)
    }

    private func notificationCommentMentions(handle: String, excluding userID: UUID, token: String) async throws -> [NotificationCommentRow] {
        let term = "%@\(handle)%".addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "%@\(handle)%"
        return try await request("rest/v1/comments?body=ilike.\(term)&author_id=neq.\(userID.uuidString)&select=id,body,post_id,created_at,author:profiles!comments_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle,created_at,avatar_shape)&order=created_at.desc&limit=30", token: token)
    }

    func respondToFollowRequest(followerID: UUID, targetID: UUID, accept: Bool, token: String) async throws {
        let path = "rest/v1/follows?follower_id=eq.\(followerID.uuidString)&target_id=eq.\(targetID.uuidString)"
        if accept {
            let body = try JSONSerialization.data(withJSONObject: ["status": "accepted"])
            let _: EmptyResponse = try await request(path, method: "PATCH", token: token, body: body)
        } else {
            let _: EmptyResponse = try await request(path, method: "DELETE", token: token)
        }
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
