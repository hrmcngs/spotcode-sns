import SwiftUI
import MapKit

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @State private var showLogin = false

    var body: some View {
        TabView {
            NavigationView { TimelineView() }
                .tabItem { Label("Home", systemImage: "house") }
            NavigationView { RepositoriesView() }
                .tabItem { Label("Repos", systemImage: "folder") }
            NavigationView { NativeMapView() }
                .tabItem { Label("Map", systemImage: "map") }
            NavigationView { NotificationsView() }
                .tabItem { Label("通知", systemImage: "bell") }
            NavigationView { ProfileView(profile: model.me) }
                .tabItem { Label("Profile", systemImage: "person") }
        }
        .tint(.cyan)
        .task { await model.bootstrap(); showLogin = model.session == nil }
        .sheet(isPresented: $showLogin) { LoginView(isPresented: $showLogin) }
        .alert("エラー", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) { Button("OK") {} } message: { Text(model.errorMessage ?? "") }
    }
}

struct TimelineView: View {
    @EnvironmentObject private var model: AppModel
    @State private var composing = false

    var body: some View {
        Group {
            if model.posts.isEmpty && model.isLoading {
                ProgressView("投稿を読み込み中…")
            } else {
                List(model.posts) { post in
                    NavigationLink(destination: PostDetailView(post: post)) { PostRow(post: post) }
                }
                .listStyle(.plain)
                .refreshable { await model.loadTimeline() }
            }
        }
        .navigationTitle("spotcode")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { composing = true } label: { Image(systemName: "square.and.pencil") }
                    .disabled(model.session == nil)
            }
        }
        .sheet(isPresented: $composing) { ComposeView(isPresented: $composing) }
    }
}

struct PostRow: View {
    let post: Post
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(profile: post.author)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(post.author?.name ?? "User").bold()
                    Text("@\(post.author?.handle ?? "unknown")").foregroundStyle(.secondary)
                }
                Text(post.body).fixedSize(horizontal: false, vertical: true)
                if let link = post.githubLink, let url = URL(string: link) {
                    Link(destination: url) { Label("GitHub", systemImage: "link") }.font(.caption)
                }
                if let label = post.spot?.label { Label(label, systemImage: "mappin").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(.vertical, 6)
    }
}

struct AvatarView: View {
    let profile: Profile?
    var body: some View {
        AsyncImage(url: profile?.avatarURL.flatMap(URL.init(string:))) { phase in
            if let image = phase.image { image.resizable().scaledToFill() }
            else { ZStack { Circle().fill(.gray.opacity(0.25)); Text(String(profile?.name.first ?? "?")) } }
        }
        .frame(width: 42, height: 42).clipShape(Circle())
    }
}

struct PostDetailView: View {
    let post: Post
    var body: some View {
        ScrollView { PostRow(post: post).padding() }
            .navigationTitle("投稿")
            .navigationBarTitleDisplayMode(.inline)
    }
}

struct ComposeView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @State private var bodyText = ""
    @State private var githubLink = ""
    @State private var sending = false

    var body: some View {
        NavigationView {
            Form {
                Section("アイデア") { TextEditor(text: $bodyText).frame(minHeight: 150) }
                Section("GitHub URL（任意）") { TextField("https://github.com/…", text: $githubLink).textInputAutocapitalization(.never).keyboardType(.URL) }
            }
            .navigationTitle("New idea")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { isPresented = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "送信中…" : "投稿") {
                        sending = true
                        Task {
                            if await model.publish(body: bodyText.trimmingCharacters(in: .whitespacesAndNewlines),
                                                   githubLink: githubLink.isEmpty ? nil : githubLink) { isPresented = false }
                            sending = false
                        }
                    }.disabled(bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                }
            }
        }
    }
}

struct NativeMapView: View {
    @EnvironmentObject private var model: AppModel
    @State private var posts: [Post] = []
    @State private var region = MKCoordinateRegion(center: .init(latitude: 35.681236, longitude: 139.767125), span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12))

    var body: some View {
        Map(coordinateRegion: $region, annotationItems: posts.filter { $0.spot != nil }) { post in
            MapAnnotation(coordinate: post.spot!.coordinate) {
                NavigationLink(destination: PostDetailView(post: post)) {
                    Image(systemName: "mappin.circle.fill").font(.title).foregroundStyle(.pink)
                }
            }
        }
        .ignoresSafeArea(edges: .bottom)
        .navigationTitle("Spots")
        .task {
            posts = (try? await SupabaseService.shared.spottedPosts(token: model.session?.accessToken)) ?? []
            if let coordinate = posts.first?.spot?.coordinate { region.center = coordinate }
        }
    }
}

struct RepositoriesView: View {
    @EnvironmentObject private var model: AppModel
    @State private var repositories: [Repository] = []
    @State private var loading = false

    var body: some View {
        Group {
            if loading && repositories.isEmpty { ProgressView("Repositories…") }
            else if model.me?.githubHandle == nil { ContentUnavailableViewCompat(title: "GitHubをプロフィールに連携してください", icon: "link") }
            else {
                List(repositories) { repo in
                    Link(destination: repo.htmlURL) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(repo.fullName).bold()
                            if let description = repo.description { Text(description).font(.subheadline).foregroundStyle(.secondary) }
                            HStack { if let language = repo.language { Text(language) }; Label("\(repo.stars)", systemImage: "star") }.font(.caption)
                        }
                    }
                }
            }
        }
        .navigationTitle("Repos")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let handle = model.me?.githubHandle else { return }
        loading = true; defer { loading = false }
        repositories = (try? await SupabaseService.shared.repositories(handle: handle)) ?? []
    }
}

struct NotificationsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var events: [FollowEvent] = []
    @State private var loading = false

    var body: some View {
        Group {
            if loading && events.isEmpty { ProgressView("通知を読み込み中…") }
            else if events.isEmpty { ContentUnavailableViewCompat(title: "通知はありません", icon: "bell") }
            else {
                List(events) { event in
                    HStack(spacing: 12) {
                        AvatarView(profile: event.follower)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.follower.name).bold()
                            Text(event.status == "pending" ? "@\(event.follower.handle) からフォローリクエスト" : "@\(event.follower.handle) にフォローされました")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 4)
                }.listStyle(.plain)
            }
        }
        .navigationTitle("通知")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let session = model.session, let id = model.me?.id else { return }
        loading = true; defer { loading = false }
        do { events = try await SupabaseService.shared.followNotifications(userID: id, token: session.accessToken) }
        catch { model.errorMessage = error.localizedDescription }
    }
}

struct ProfileView: View {
    @EnvironmentObject private var model: AppModel
    let profile: Profile?
    var body: some View {
        ScrollView {
            if let profile {
                VStack(spacing: 14) {
                    AvatarView(profile: profile).scaleEffect(2).padding(28)
                    Text(profile.name).font(.title2).bold()
                    Text("@\(profile.handle)").foregroundStyle(.secondary)
                    if let bio = profile.bio { Text(bio).multilineTextAlignment(.center) }
                    if let location = profile.location { Label(location, systemImage: "mappin") }
                    NavigationLink("設定", destination: SettingsView()).buttonStyle(.bordered)
                }.padding()
            } else { ContentUnavailableViewCompat(title: "ログインしてください", icon: "person.crop.circle") }
        }.navigationTitle("Profile")
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        Form {
            Section("Account") {
                if let me = model.me { HStack { Text("Handle"); Spacer(); Text("@\(me.handle)").foregroundStyle(.secondary) } }
                Button("ログアウト", role: .destructive) { model.signOut() }
            }
            Section("App") { HStack { Text("UI"); Spacer(); Text("SwiftUI Native").foregroundStyle(.secondary) } }
        }.navigationTitle("設定")
    }
}

struct LoginView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @State private var email = ""
    @State private var password = ""
    var body: some View {
        NavigationView {
            Form {
                TextField("メールまたはログイン名", text: $email).textInputAutocapitalization(.never).keyboardType(.emailAddress)
                SecureField("パスワード", text: $password)
                Button(model.isLoading ? "ログイン中…" : "ログイン") {
                    Task { await model.signIn(emailOrAlias: email, password: password); if model.session != nil { isPresented = false } }
                }.disabled(email.isEmpty || password.isEmpty || model.isLoading)
            }.navigationTitle("spotcodeへログイン")
        }
    }
}

// iOS 15-compatible replacement for ContentUnavailableView (iOS 17).
struct ContentUnavailableViewCompat: View {
    let title: String
    let icon: String
    var body: some View { VStack(spacing: 12) { Image(systemName: icon).font(.largeTitle); Text(title).multilineTextAlignment(.center) }.foregroundStyle(.secondary).padding() }
}
