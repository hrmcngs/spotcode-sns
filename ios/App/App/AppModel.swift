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
    @Published var authenticationError: String?
    @Published var requiresMFA = false
    @Published var requiresReauthentication = false
    private var pendingMFASession: AuthSession?
    private var pendingMFAFactorID: String?

    private let sessionAccount = "supabase-session"
    private let savedAccountsKey = "spotcode.native.saved-accounts"
    private let savedSessionPrefix = "supabase-session."
    private let cachedProfileKey = "spotcode.native.cached-profile"
    private let cachedPostsKey = "spotcode.native.cached-posts"
    private let githubTokenPrefix = "github-private-issues."

    @Published private(set) var githubOrganizations: [GitHubOrganization] = []
    @Published private(set) var linkedGithubOrganization: GitHubOrganizationLink?
    private var githubOrganizationOwner: UUID?
    private var githubOrganizationExpiry = Date.distantPast

    func canReadPostAudience(_ post: Post) -> Bool {
        guard post.visibility == "github_org" || post.visibility == "only_me" else { return true }
        if post.authorID == session?.user.id { return true }
        if me?.id == session?.user.id && me?.isAdmin == true && UserDefaults.standard.bool(forKey: "spotcode.native.dev-mode") { return true }
        return post.visibility == "github_org" && githubOrganizationOwner == session?.user.id && githubOrganizationExpiry > Date()
            && githubOrganizations.contains { $0.id == post.githubOrgID }
    }

    @discardableResult
    func syncGithubOrganizations(organizationID: Int64? = nil, includeRepositories: Bool = false) async throws -> GitHubOrganizationResult {
        guard let owner = session?.user.id, let githubToken = await hydrateSharedPrivateIssueToken() else {
            throw NSError(domain: "GitHub", code: 401, userInfo: [NSLocalizedDescriptionKey: "GitHub Organizationを連携してください"])
        }
        let result = try await withRefreshedSession { token in
            try await SupabaseService.shared.githubOrganizations(githubToken: githubToken, token: token, organizationID: organizationID, includeRepositories: includeRepositories)
        }
        guard session?.user.id == owner else { throw CancellationError() }
        githubOrganizations = result.organizations
        linkedGithubOrganization = result.linked
        githubOrganizationOwner = owner
        githubOrganizationExpiry = Date().addingTimeInterval(55 * 60)
        return result
    }

    var displayProfile: Profile? { isPostingAsOfficial ? officialProfile : me }

    var privateIssueToken: String? {
        guard let id = session?.user.id,
              let data = KeychainStore.load(account: githubTokenPrefix + id.uuidString) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func savePrivateIssueToken(_ token: String) {
        guard let id = session?.user.id, let data = token.data(using: .utf8) else { return }
        try? KeychainStore.save(data, account: githubTokenPrefix + id.uuidString)
    }

    func removePrivateIssueToken() {
        guard let id = session?.user.id else { return }
        KeychainStore.delete(account: githubTokenPrefix + id.uuidString)
    }

    func uploadPrivateIssueToken(_ token: String) async throws {
        try await withRefreshedSession { accessToken in
            try await SupabaseService.shared.saveSharedGithubPrivateIssueToken(token, token: accessToken)
        }
    }

    func hydrateSharedPrivateIssueToken() async -> String? {
        guard let owner = session?.user.id else { return nil }
        let local = privateIssueToken
        do {
            let token = try await withRefreshedSession { accessToken in
                try await SupabaseService.shared.sharedGithubPrivateIssueToken(token: accessToken)
            }
            guard session?.user.id == owner else { return nil }
            if let token { savePrivateIssueToken(token); return token }
            return local
        } catch {
            return session?.user.id == owner ? local : nil
        }
    }

    init() {
        if let data = UserDefaults.standard.data(forKey: savedAccountsKey) {
            savedAccounts = (try? JSONDecoder().decode([SavedAccount].self, from: data)) ?? []
        }
        if let data = KeychainStore.load(account: sessionAccount),
           let saved = try? JSONDecoder().decode(AuthSession.self, from: data) {
            session = saved
        }
        if let data = UserDefaults.standard.data(forKey: cachedProfileKey) { me = try? JSONDecoder().decode(Profile.self, from: data) }
        if let data = UserDefaults.standard.data(forKey: cachedPostsKey) {
            let cached = (try? JSONDecoder().decode([Post].self, from: data)) ?? []
            let canInspect = UserDefaults.standard.bool(forKey: "spotcode.native.dev-mode") && me?.isAdmin == true && me?.id == session?.user.id
            posts = cached.filter { !["only_me", "github_org"].contains($0.visibility ?? "public") || $0.authorID == session?.user.id || canInspect }
        }
    }

    func bootstrap() async {
        guard session != nil else { return }
        guard let current = try? await validSession() else {
            requiresReauthentication = true
            return
        }
        if let profile = try? await SupabaseService.shared.profile(id: current.user.id, token: current.accessToken) {
            me = profile
            cacheProfile(profile)
            rememberAccount(session: current, profile: profile)
        }
        await loadTimeline()
    }

    /// Returns a usable session, refreshing the access token when it is close
    /// to expiry. `forceRefresh` is used after an API rejects a token whose
    /// local expiry metadata was missing or stale.
    func validSession(forceRefresh: Bool = false) async throws -> AuthSession {
        guard var current = session else { throw URLError(.userAuthenticationRequired) }
        let expiresSoon = current.expiresAt.map {
            $0 < Int(Date().timeIntervalSince1970) + 60
        } ?? true
        if forceRefresh || expiresSoon {
            do {
                current = try await SupabaseService.shared.refresh(current.refreshToken)
                persist(current)
                if let profile = me { rememberAccount(session: current, profile: profile) }
            } catch {
                requiresReauthentication = true
                throw NSError(
                    domain: "SpotcodeAuth",
                    code: 401,
                    userInfo: [NSLocalizedDescriptionKey: "ログインの有効期限が切れました。もう一度ログインしてください。"]
                )
            }
        }
        return current
    }

    static func isExpiredSessionError(_ error: Error) -> Bool {
        let value = error as NSError
        let message = error.localizedDescription.lowercased()
        return value.code == 401 || message.contains("pgrst303") || message.contains("jwt expired")
            || message.contains("session_not_found") || message.contains("session from session_id")
    }

    func signIn(emailOrAlias: String, password: String) async -> Bool {
        authenticationError = nil
        // Adding another account must never evict the currently active one.
        // Re-save it before exchanging credentials, including sessions that
        // were restored from Keychain but have not completed bootstrap yet.
        if let currentSession = session, let currentProfile = me {
            rememberAccount(session: currentSession, profile: currentProfile)
        }
        do {
            let raw = emailOrAlias.trimmingCharacters(in: .whitespacesAndNewlines)
            let value: AuthSession
            if raw.contains("@") && !raw.hasPrefix("@") {
                value = try await SupabaseService.shared.login(email: raw, password: password)
            } else if raw.lowercased() == "dev.test.account" {
                value = try await SupabaseService.shared.login(email: "dev.test.account@spotcode-sns.local", password: password)
            } else {
                value = try await SupabaseService.shared.usernameLogin(
                    handle: raw.trimmingCharacters(in: CharacterSet(charactersIn: "@")).lowercased(),
                    password: password
                )
            }
            if Self.assuranceLevel(of: value.accessToken) != "aal2" {
                let factors = try await SupabaseService.shared.mfaFactors(token: value.accessToken)
                if let factor = factors.first {
                    pendingMFASession = value
                    pendingMFAFactorID = factor.id
                    requiresMFA = true
                    authenticationError = nil
                    return false
                }
            }
            try await finishSignIn(value)
            return true
        } catch {
            if authenticationError == nil {
                authenticationError = Self.authenticationMessage(for: error)
            }
            return false
        }
    }

    func verifyMFA(code: String) async -> Bool {
        guard let pending = pendingMFASession, let factorID = pendingMFAFactorID else {
            authenticationError = "確認中の2段階認証がありません。"
            return false
        }
        let value = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else {
            authenticationError = "6桁の確認コードを入力してください。"
            return false
        }
        do {
            let verified = try await SupabaseService.shared.verifyMFA(factorID: factorID, code: value, token: pending.accessToken)
            try await finishSignIn(verified)
            pendingMFASession = nil
            pendingMFAFactorID = nil
            requiresMFA = false
            authenticationError = nil
            return true
        } catch {
            authenticationError = "確認コードが違うか、有効期限が切れています。"
            return false
        }
    }

    private static func authenticationMessage(for error: Error) -> String {
        let nsError = error as NSError
        let raw = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        if let data = raw.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for key in ["message", "error_description", "error"] {
                if let message = json[key] as? String, !message.isEmpty {
                    if nsError.code == 400 || nsError.code == 401 {
                        return "メールアドレス／ログイン名、またはパスワードが正しくありません。"
                    }
                    return message
                }
            }
        }
        if nsError.code == 400 || nsError.code == 401 {
            return "メールアドレス／ログイン名、またはパスワードが正しくありません。"
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
                return "サーバーに接続できません。通信状態を確認して、もう一度お試しください。"
            case .timedOut:
                return "ログイン処理がタイムアウトしました。もう一度お試しください。"
            default: break
            }
        }
        if error is DecodingError {
            return "ログイン情報の読み込みに失敗しました。アプリを最新版に更新して、もう一度お試しください。"
        }
        return raw.isEmpty ? "ログインできませんでした。もう一度お試しください。" : raw
    }

    private func finishSignIn(_ value: AuthSession) async throws {
            let profile: Profile
            do {
                guard let loaded = try await SupabaseService.shared.profile(id: value.user.id, token: value.accessToken) else {
                    authenticationError = "このアカウントのプロフィールが見つかりません。"
                    throw URLError(.userAuthenticationRequired)
                }
                profile = loaded
            } catch {
                if authenticationError == nil {
                    authenticationError = "ログインは確認できましたが、プロフィールを読み込めませんでした。"
                }
                throw error
            }
            // Commit the account change only after its profile is usable.
            // Otherwise a transient profile request failure overwrites the
            // previous active session while the UI still shows that account.
            persist(value)
            requiresReauthentication = false
            me = profile
            cacheProfile(profile)
            rememberAccount(session: value, profile: profile)
            isPostingAsOfficial = false
            officialProfile = nil
            Task { await loadTimeline() }
    }

    private static func assuranceLevel(of jwt: String) -> String? {
        let parts = jwt.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var value = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        value += String(repeating: "=", count: (4 - value.count % 4) % 4)
        guard let data = Data(base64Encoded: value),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json["aal"] as? String
    }

    func currentMFAFactor() async throws -> MFAFactor? {
        try await withRefreshedSession { token in
            try await SupabaseService.shared.mfaFactors(token: token).first(where: { $0.status == "verified" })
        }
    }

    func beginMFAEnrollment() async throws -> MFAEnrollment {
        try await withRefreshedSession { token in
            let factors = try await SupabaseService.shared.allMFAFactors(token: token)
            for factor in factors where factor.status != "verified" {
                try? await SupabaseService.shared.disableMFA(factorID: factor.id, token: token)
            }
            return try await SupabaseService.shared.enrollMFA(token: token)
        }
    }

    func confirmMFAEnrollment(_ enrollment: MFAEnrollment, code: String) async throws {
        let verified: AuthSession = try await withRefreshedSession { token in
            try await SupabaseService.shared.verifyMFA(factorID: enrollment.id, code: code, token: token)
        }
        persist(verified)
    }

    func disableMFA(_ factor: MFAFactor) async throws {
        try await withRefreshedSession { token in
            try await SupabaseService.shared.disableMFA(factorID: factor.id, token: token)
        }
    }

    private func withRefreshedSession<T>(_ operation: (String) async throws -> T) async throws -> T {
        var current = try await validSession()
        do {
            return try await operation(current.accessToken)
        } catch where Self.isExpiredSessionError(error) {
            current = try await validSession(forceRefresh: true)
            do {
                return try await operation(current.accessToken)
            } catch where Self.isExpiredSessionError(error) {
                throw NSError(
                    domain: "SpotcodeAuth", code: 401,
                    userInfo: [NSLocalizedDescriptionKey: "ログインセッションが無効になりました。もう一度ログインしてください。"]
                )
            }
        }
    }

    func signOut() {
        if let id = session?.user.id { forgetAccount(id) }
        clearGithubOrganizations()
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
        if me?.githubHandle != nil && (githubOrganizationOwner != session?.user.id || githubOrganizationExpiry <= Date()) {
            try? await syncGithubOrganizations()
        }
        do {
            posts = try await SupabaseService.shared.posts(token: session?.accessToken)
            if let data = try? JSONEncoder().encode(posts) { UserDefaults.standard.set(data, forKey: cachedPostsKey) }
        }
        catch is CancellationError { return }
        catch let error as URLError where error.code == .cancelled { return }
        catch let error as URLError where Self.isTransientNetworkError(error) { return }
        catch { errorMessage = error.localizedDescription }
    }

    func publish(body: String, githubLink: String?, repoFullName: String? = nil, eventURL: String? = nil, spot: Spot? = nil, kind: String? = nil, visibility: String = "public", photos: [String]? = nil, poll: PostPoll? = nil) async -> Bool {
        guard let session, let authorID = displayProfile?.id else { return false }
        do {
            if me?.githubHandle != nil && (githubLink != nil || repoFullName != nil) {
                _ = try await syncGithubOrganizations()
            }
            guard self.session?.user.id == session.user.id else { return false }
            let post = try await SupabaseService.shared.createPost(
                .init(authorID: authorID, body: body, githubLink: githubLink, repoFullName: repoFullName, eventURL: eventURL, spot: spot, kind: kind, visibility: visibility, photos: photos, poll: poll, status: "wip"),
                token: session.accessToken
            )
            posts.insert(post, at: 0)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func editPost(_ post: Post, body: String, githubLink: String?, repoFullName: String?, eventURL: String?, kind: String?, visibility: String) async -> Post? {
        let mayModerate = UserDefaults.standard.bool(forKey: "spotcode.native.dev-mode") && (me?.isAdmin == true || me?.isOperator == true)
        guard let session, post.authorID == displayProfile?.id || mayModerate else { return nil }
        do {
            if me?.githubHandle != nil && (githubLink != post.githubLink || repoFullName != post.repoFullName || visibility == "github_org") {
                _ = try await syncGithubOrganizations()
            }
            guard self.session?.user.id == session.user.id else { return nil }
            let updated = try await SupabaseService.shared.updatePost(
                id: post.id, body: body, githubLink: githubLink, repoFullName: repoFullName, eventURL: eventURL,
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
        let mayModerate = UserDefaults.standard.bool(forKey: "spotcode.native.dev-mode") && (me?.isAdmin == true || me?.isOperator == true)
        guard let session, post.authorID == displayProfile?.id || mayModerate else { return false }
        do {
            try await SupabaseService.shared.deletePost(id: post.id, token: session.accessToken)
            posts.removeAll { $0.id == post.id }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func updateProfile(name: String, bio: String, location: String, website: String, twitter: String, instagram: String, avatarURL: String?, avatarShape: String) async -> Bool {
        guard let session else { return false }
        let editingOfficial = isPostingAsOfficial
        if editingOfficial && me?.isAdmin != true && me?.isOperator != true {
            errorMessage = "公式プロフィールは管理者または運営者のみ編集できます。"
            return false
        }
        guard let id = (editingOfficial ? officialProfile?.id : me?.id) else { return false }
        do {
            let profile = try await SupabaseService.shared.updateProfile(id: id, name: name, bio: bio, location: location, website: website, twitter: twitter, instagram: instagram, avatarURL: avatarURL, avatarShape: avatarShape, token: session.accessToken)
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

    func updateProfilePreferences(isPrivate: Bool, isOrg: Bool, organization: String, closeFriends: [String], orgMembers: [String]) async -> Bool {
        guard let session, let id = me?.id else { return false }
        do {
            let profile = try await SupabaseService.shared.updateProfilePreferences(
                id: id, isPrivate: isPrivate, isOrg: isOrg, organization: organization,
                closeFriends: closeFriends, orgMembers: orgMembers, token: session.accessToken
            )
            me = profile
            cacheProfile(profile)
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    private func clearGithubOrganizations() {
        githubOrganizations = []
        linkedGithubOrganization = nil
        githubOrganizationOwner = nil
        githubOrganizationExpiry = .distantPast
    }

    private func persist(_ value: AuthSession) {
        if session?.user.id != value.user.id { clearGithubOrganizations() }
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
