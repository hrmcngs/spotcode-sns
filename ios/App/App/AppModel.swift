import Foundation
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    @Published var session: AuthSession?
    @Published var me: Profile?
    @Published var posts: [Post] = []
    @Published var lastUpdatedPost: Post?
    @Published private(set) var savedAccounts: [SavedAccount] = []
    @Published private(set) var officialProfile: Profile?
    @Published private(set) var isPostingAsOfficial = false
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let sessionAccount = "supabase-session"
    private let savedAccountsKey = "spotcode.native.saved-accounts"
    private let savedSessionPrefix = "supabase-session."
    private let cachedProfileKey = "spotcode.native.cached-profile"
    private let cachedPostsKey = "spotcode.native.cached-posts"

    var displayProfile: Profile? { isPostingAsOfficial ? officialProfile : me }

    init() {
        if let data = UserDefaults.standard.data(forKey: savedAccountsKey) {
            savedAccounts = (try? JSONDecoder().decode([SavedAccount].self, from: data)) ?? []
        }
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
        if let profile = try? await SupabaseService.shared.profile(id: current.user.id, token: current.accessToken) {
            me = profile
            cacheProfile(profile)
            rememberAccount(session: current, profile: profile)
        }
        await loadTimeline()
    }

    func signIn(emailOrAlias: String, password: String) async -> Bool {
        // Adding another account must never evict the currently active one.
        // Re-save it before exchanging credentials, including sessions that
        // were restored from Keychain but have not completed bootstrap yet.
        if let currentSession = session, let currentProfile = me {
            rememberAccount(session: currentSession, profile: currentProfile)
        }
        let email = emailOrAlias.contains("@") ? emailOrAlias : emailOrAlias + "@spotcode-sns.local"
        do {
            let value = try await SupabaseService.shared.login(email: email, password: password)
            guard let profile = try await SupabaseService.shared.profile(id: value.user.id, token: value.accessToken) else {
                throw URLError(.userAuthenticationRequired)
            }
            // Commit the account change only after its profile is usable.
            // Otherwise a transient profile request failure overwrites the
            // previous active session while the UI still shows that account.
            persist(value)
            me = profile
            cacheProfile(profile)
            rememberAccount(session: value, profile: profile)
            isPostingAsOfficial = false
            officialProfile = nil
            Task { await loadTimeline() }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func signOut() {
        if let id = session?.user.id { forgetAccount(id) }
        session = nil
        me = nil
        officialProfile = nil
        isPostingAsOfficial = false
        posts = []
        KeychainStore.delete(account: sessionAccount)
        UserDefaults.standard.removeObject(forKey: cachedProfileKey)
        UserDefaults.standard.removeObject(forKey: cachedPostsKey)
    }

    func switchAccount(to id: UUID) async -> Bool {
        if id == session?.user.id {
            switchToPersonalAccount()
            return true
        }
        guard let data = KeychainStore.load(account: savedSessionPrefix + id.uuidString),
              var next = try? JSONDecoder().decode(AuthSession.self, from: data) else {
            forgetAccount(id)
            errorMessage = "保存済みのログイン情報が見つかりません。もう一度ログインしてください。"
            return false
        }
        do {
            if next.expiresAt.map({ $0 < Int(Date().timeIntervalSince1970) + 60 }) ?? true {
                next = try await SupabaseService.shared.refresh(next.refreshToken)
            }
            guard let profile = try await SupabaseService.shared.profile(
                id: next.user.id,
                token: next.accessToken
            ) else {
                throw URLError(.userAuthenticationRequired)
            }
            persist(next)
            me = profile
            cacheProfile(profile)
            rememberAccount(session: next, profile: profile)
            officialProfile = nil
            isPostingAsOfficial = false
            posts = []
            await loadTimeline()
            return true
        } catch {
            errorMessage = "アカウントを切り替えられませんでした。もう一度ログインしてください。\n\(error.localizedDescription)"
            return false
        }
    }

    func switchToOfficial() async -> Bool {
        guard me?.isAdmin == true || me?.isOperator == true, let token = session?.accessToken else {
            errorMessage = "公式アカウントは管理者または運営者のみ利用できます。"
            return false
        }
        do {
            guard let profile = try await SupabaseService.shared.profile(handle: "spotcode_official", token: token) else {
                throw URLError(.resourceUnavailable)
            }
            officialProfile = profile
            isPostingAsOfficial = true
            return true
        } catch {
            errorMessage = "公式アカウントへ切り替えられませんでした。\n\(error.localizedDescription)"
            return false
        }
    }

    func switchToPersonalAccount() {
        isPostingAsOfficial = false
        officialProfile = nil
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
        guard let session, let authorID = displayProfile?.id else { return false }
        do {
            let post = try await SupabaseService.shared.createPost(
                .init(authorID: authorID, body: body, githubLink: githubLink, eventURL: eventURL, spot: spot, kind: kind, visibility: visibility, photos: photos, poll: poll, status: "wip"),
                token: session.accessToken
            )
            posts.insert(post, at: 0)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func editPost(_ post: Post, body: String, githubLink: String?, eventURL: String?, kind: String?, visibility: String) async -> Post? {
        guard let session, post.authorID == displayProfile?.id else { return nil }
        do {
            let updated = try await SupabaseService.shared.updatePost(
                id: post.id, body: body, githubLink: githubLink, eventURL: eventURL,
                kind: kind, visibility: visibility, token: session.accessToken
            )
            if let index = posts.firstIndex(where: { $0.id == post.id }) { posts[index] = updated }
            lastUpdatedPost = updated
            return updated
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }

    func deletePost(_ post: Post) async -> Bool {
        guard let session, post.authorID == displayProfile?.id else { return false }
        do {
            try await SupabaseService.shared.deletePost(id: post.id, token: session.accessToken)
            posts.removeAll { $0.id == post.id }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func updateProfile(name: String, bio: String, location: String, avatarURL: String?, avatarShape: String) async -> Bool {
        guard let session else { return false }
        let editingOfficial = isPostingAsOfficial
        if editingOfficial && me?.isAdmin != true && me?.isOperator != true {
            errorMessage = "公式プロフィールは管理者または運営者のみ編集できます。"
            return false
        }
        guard let id = (editingOfficial ? officialProfile?.id : me?.id) else { return false }
        do {
            let profile = try await SupabaseService.shared.updateProfile(id: id, name: name, bio: bio, location: location, avatarURL: avatarURL, avatarShape: avatarShape, token: session.accessToken)
            if editingOfficial {
                officialProfile = profile
            } else {
                me = profile
                cacheProfile(profile)
                rememberAccount(session: session, profile: profile)
            }
            return true
        } catch {
            if editingOfficial {
                errorMessage = "公式プロフィールを保存できませんでした。Supabase SQL Editorで docs/supabase-schema.sql の Stage 32 を実行してください。\n\(error.localizedDescription)"
            } else {
                errorMessage = error.localizedDescription
            }
            return false
        }
    }

    private func persist(_ value: AuthSession) {
        session = value
        if let data = try? JSONEncoder().encode(value) {
            try? KeychainStore.save(data, account: sessionAccount)
            try? KeychainStore.save(data, account: savedSessionPrefix + value.user.id.uuidString)
        }
    }

    private func rememberAccount(session: AuthSession, profile: Profile) {
        guard let id = profile.id, id == session.user.id else { return }
        if let data = try? JSONEncoder().encode(session) {
            try? KeychainStore.save(data, account: savedSessionPrefix + id.uuidString)
        }
        savedAccounts.removeAll { $0.id == id }
        savedAccounts.insert(SavedAccount(id: id, profile: profile, lastUsed: Date()), at: 0)
        saveAccountIndex()
    }

    private func forgetAccount(_ id: UUID) {
        savedAccounts.removeAll { $0.id == id }
        KeychainStore.delete(account: savedSessionPrefix + id.uuidString)
        saveAccountIndex()
    }

    private func saveAccountIndex() {
        if let data = try? JSONEncoder().encode(savedAccounts) {
            UserDefaults.standard.set(data, forKey: savedAccountsKey)
        }
    }

    private func cacheProfile(_ profile: Profile) {
        if let data = try? JSONEncoder().encode(profile) { UserDefaults.standard.set(data, forKey: cachedProfileKey) }
    }

    private static func isTransientNetworkError(_ error: URLError) -> Bool {
        [.cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .networkConnectionLost, .notConnectedToInternet, .timedOut, .dataNotAllowed].contains(error.code)
    }
}
