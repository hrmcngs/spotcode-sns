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

    init() {
        if let data = KeychainStore.load(account: sessionAccount),
           let saved = try? JSONDecoder().decode(AuthSession.self, from: data) {
            session = saved
        }
    }

    func bootstrap() async {
        guard var current = session else { return }
        if let expiry = current.expiresAt, expiry < Int(Date().timeIntervalSince1970) + 60,
           let refreshed = try? await SupabaseService.shared.refresh(current.refreshToken) {
            current = refreshed
            persist(current)
        }
        me = try? await SupabaseService.shared.profile(id: current.user.id, token: current.accessToken)
        await loadTimeline()
    }

    func signIn(emailOrAlias: String, password: String) async {
        isLoading = true
        defer { isLoading = false }
        let email = emailOrAlias.contains("@") ? emailOrAlias : emailOrAlias + "@spotcode-sns.local"
        do {
            let value = try await SupabaseService.shared.login(email: email, password: password)
            persist(value)
            me = try await SupabaseService.shared.profile(id: value.user.id, token: value.accessToken)
            Task { await loadTimeline() }
        } catch { errorMessage = error.localizedDescription }
    }

    func signOut() {
        session = nil
        me = nil
        KeychainStore.delete(account: sessionAccount)
    }

    func loadTimeline() async {
        isLoading = true
        defer { isLoading = false }
        do { posts = try await SupabaseService.shared.posts(token: session?.accessToken) }
        catch is CancellationError { return }
        catch let error as URLError where error.code == .cancelled { return }
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

    private func persist(_ value: AuthSession) {
        session = value
        if let data = try? JSONEncoder().encode(value) { try? KeychainStore.save(data, account: sessionAccount) }
    }
}
