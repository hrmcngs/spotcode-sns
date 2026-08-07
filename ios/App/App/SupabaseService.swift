import Foundation

actor SupabaseService {
    static let shared = SupabaseService()
    private let baseURL = URL(string: "https://vkwdthjiyxrhskdlgexq.supabase.co")!
    private let anonKey = "sb_publishable_xdAZG7yOOFKPXmugjhDWdQ_HJ7sGHIq"
    private let decoder: JSONDecoder = {
        let value = JSONDecoder()
        return value
    }()

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
        request.timeoutInterval = 15
        request.httpBody = body
        request.setValue(anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(token ?? anonKey)", forHTTPHeaderField: "Authorization")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if preferRepresentation { request.setValue("return=representation", forHTTPHeaderField: "Prefer") }
        let (data, response) = try await URLSession.shared.data(for: request)
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

    func refresh(_ refreshToken: String) async throws -> AuthSession {
        let payload = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])
        return try await request("auth/v1/token?grant_type=refresh_token", method: "POST", body: payload)
    }

    func profile(id: UUID, token: String) async throws -> Profile? {
        let rows: [Profile] = try await request("rest/v1/profiles?id=eq.\(id.uuidString)&select=id,handle,name,avatar_url,bio,location,github_handle", token: token)
        return rows.first
    }

    func profile(handle: String, token: String?) async throws -> Profile? {
        let escaped = handle.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? handle
        let rows: [Profile] = try await request("rest/v1/profiles?handle=eq.\(escaped)&select=id,handle,name,avatar_url,bio,location,github_handle", token: token)
        return rows.first
    }

    func posts(limit: Int = 40, authorID: UUID? = nil, token: String? = nil) async throws -> [Post] {
        var path = "rest/v1/posts?select=id,author_id,body,github_link,spot,status,created_at,author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle)&order=created_at.desc&limit=\(limit)"
        if let authorID { path += "&author_id=eq.\(authorID.uuidString)" }
        return try await request(path, token: token)
    }

    func spottedPosts(token: String?) async throws -> [Post] {
        try await request("rest/v1/posts?spot=not.is.null&select=id,author_id,body,github_link,spot,status,created_at,author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle)&order=created_at.desc&limit=120", token: token)
    }

    func createPost(_ draft: PostDraft, token: String) async throws -> Post {
        let body = try JSONEncoder().encode(draft)
        let rows: [Post] = try await request(
            "rest/v1/posts?select=id,author_id,body,github_link,spot,status,created_at,author:profiles!posts_author_id_fkey(id,handle,name,avatar_url,bio,location,github_handle)",
            method: "POST", token: token, body: body, preferRepresentation: true
        )
        guard let post = rows.first else { throw NSError(domain: "Supabase", code: -2, userInfo: [NSLocalizedDescriptionKey: "投稿結果が空です"]) }
        return post
    }

    func repositories(handle: String) async throws -> [Repository] {
        var components = URLComponents(string: "https://api.github.com/users/\(handle)/repos")!
        components.queryItems = [.init(name: "sort", value: "pushed"), .init(name: "type", value: "owner"), .init(name: "per_page", value: "30")]
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 12
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try decoder.decode([Repository].self, from: data)
    }

    func followNotifications(userID: UUID, token: String) async throws -> [FollowEvent] {
        try await request(
            "rest/v1/follows?target_id=eq.\(userID.uuidString)&select=status,created_at,follower:profiles!follows_follower_id_fkey(id,handle,name,avatar_url,bio,location,github_handle)&order=created_at.desc&limit=30",
            token: token
        )
    }
}
