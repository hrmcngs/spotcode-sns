import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var session: AuthSession?
    @Published var me: Profile?
    @Published var posts: [Post] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let sessionAccount = "supabase-session"
    private let cachedProfileKey = "spotcode.native.cached-profile"
    private let cachedPostsKey = "spotcode.native.cached-posts"

    init() {
        if let data = KeychainStore.load(account: sessionAccount),
           let saved = try? JSONDecoder().decode(AuthSession.self, from: data) {
            session = saved
        }
        if let data = UserDefaults.standard.data(forKey: cachedProfileKey) { me = try? JSONDecoder().decode(Profile.self, from: data) }
        if let data = UserDefaults.standard.data(forKey: cachedPostsKey) { posts = (try? JSONDecoder().decode([Post].self, from: data)) ?? [] }
    }

    func bootstrap() async {
        guard var current = session else { return }
        if let expiry = current.expiresAt, expiry < Int(Date().timeIntervalSince1970) + 60,
           let refreshed = try? await SupabaseService.shared.refresh(current.refreshToken) {
            current = refreshed
            persist(current)
        }
        if let profile = try? await SupabaseService.shared.profile(id: current.user.id, token: current.accessToken) { me = profile; cacheProfile(profile) }
        await loadTimeline()
    }

    func signIn(emailOrAlias: String, password: String) async -> Bool {
        let email = emailOrAlias.contains("@") ? emailOrAlias : emailOrAlias + "@spotcode-sns.local"
        do {
            let value = try await SupabaseService.shared.login(email: email, password: password)
            persist(value)
            if let profile = try? await SupabaseService.shared.profile(id: value.user.id, token: value.accessToken) { me = profile; cacheProfile(profile) }
            Task { await loadTimeline() }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func signOut() {
        session = nil
        me = nil
        posts = []
        KeychainStore.delete(account: sessionAccount)
        UserDefaults.standard.removeObject(forKey: cachedProfileKey)
        UserDefaults.standard.removeObject(forKey: cachedPostsKey)
    }

    func loadTimeline() async {
        isLoading = true
        defer { isLoading = false }
        do {
            posts = try await SupabaseService.shared.posts(token: session?.accessToken)
            if let data = try? JSONEncoder().encode(posts) { UserDefaults.standard.set(data, forKey: cachedPostsKey) }
        }
        catch is CancellationError { return }
        catch let error as URLError where error.code == .cancelled { return }
        catch let error as URLError where Self.isTransientNetworkError(error) { return }
        catch { errorMessage = error.localizedDescription }
    }

    func publish(body: String, githubLink: String?, eventURL: String? = nil, spot: Spot? = nil, kind: String? = nil, visibility: String = "public", photos: [String]? = nil, poll: PostPoll? = nil) async -> Bool {
        guard let session, let meID = me?.id else { return false }
        do {
            let post = try await SupabaseService.shared.createPost(
                .init(authorID: meID, body: body, githubLink: githubLink, eventURL: eventURL, spot: spot, kind: kind, visibility: visibility, photos: photos, poll: poll, status: "wip"),
                token: session.accessToken
            )
            posts.insert(post, at: 0)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func updateProfile(name: String, bio: String, location: String, avatarURL: String?, avatarShape: String) async -> Bool {
        guard let session, let id = me?.id else { return false }
        do {
            let profile = try await SupabaseService.shared.updateProfile(id: id, name: name, bio: bio, location: location, avatarURL: avatarURL, avatarShape: avatarShape, token: session.accessToken)
            me = profile
            cacheProfile(profile)
            return true
        } catch { errorMessage = error.localizedDescription; return false }
    }

    private func persist(_ value: AuthSession) {
        session = value
        if let data = try? JSONEncoder().encode(value) { try? KeychainStore.save(data, account: sessionAccount) }
    }

    private func cacheProfile(_ profile: Profile) {
        if let data = try? JSONEncoder().encode(profile) { UserDefaults.standard.set(data, forKey: cachedProfileKey) }
    }

    private static func isTransientNetworkError(_ error: URLError) -> Bool {
        [.cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .networkConnectionLost, .notConnectedToInternet, .timedOut, .dataNotAllowed].contains(error.code)
    }
}
