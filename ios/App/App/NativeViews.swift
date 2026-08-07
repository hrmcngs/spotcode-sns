import SwiftUI
import MapKit

private enum SpotcodeTheme {
    static let background = Color(red: 13/255, green: 17/255, blue: 23/255)
    static let surface = Color(red: 22/255, green: 27/255, blue: 34/255)
    static let surface2 = Color(red: 33/255, green: 38/255, blue: 45/255)
    static let border = Color(red: 48/255, green: 54/255, blue: 61/255)
    static let text = Color(red: 230/255, green: 237/255, blue: 243/255)
    static let muted = Color(red: 125/255, green: 133/255, blue: 144/255)
    static let accent = Color(red: 29/255, green: 155/255, blue: 240/255)
    static let warning = Color(red: 254/255, green: 188/255, blue: 46/255)
}

private enum AppSection: String, CaseIterable {
    case home = "Home"
    case repos = "Repos"
    case notifications = "Notifications"
    case profile = "Profile"
    case settings = "Settings"

    var icon: String {
        switch self {
        case .home: return "house"
        case .repos: return "folder"
        case .notifications: return "bell"
        case .profile: return "person"
        case .settings: return "gearshape"
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel
    @State private var section: AppSection = .home
    @State private var drawerOpen = false
    @State private var showLogin = false
    @State private var composing = false

    var body: some View {
        ZStack(alignment: .leading) {
            SpotcodeTheme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                TopBar(drawerOpen: $drawerOpen, section: $section)
                NavigationView { sectionView }
                    .navigationViewStyle(.stack)
            }
            if drawerOpen {
                Color.black.opacity(0.55).ignoresSafeArea().onTapGesture { withAnimation { drawerOpen = false } }
                SideDrawer(section: $section, open: $drawerOpen, composing: $composing)
                    .transition(.move(edge: .leading))
            }
        }
        .preferredColorScheme(.dark)
        .tint(SpotcodeTheme.accent)
        .task { await model.bootstrap(); showLogin = model.session == nil }
        .sheet(isPresented: $showLogin) { LoginView(isPresented: $showLogin) }
        .sheet(isPresented: $composing) { ComposeView(isPresented: $composing) }
        .alert("エラー", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) { Button("OK") {} } message: { Text(model.errorMessage ?? "") }
    }

    @ViewBuilder private var sectionView: some View {
        switch section {
        case .home: TimelineView()
        case .repos: RepositoriesView()
        case .notifications: NotificationsView()
        case .profile: ProfileView(profile: model.me)
        case .settings: SettingsView()
        }
    }
}

private struct TopBar: View {
    @Binding var drawerOpen: Bool
    @Binding var section: AppSection
    @State private var query = ""

    var body: some View {
        HStack(spacing: 9) {
            Button { withAnimation(.easeOut(duration: 0.2)) { drawerOpen.toggle() } } label: {
                Image(systemName: "line.3.horizontal").frame(width: 34, height: 34)
            }.spotcodeIconButton()
            Button { section = .home } label: {
                HStack(spacing: 7) {
                    Image(systemName: "chevron.left.forwardslash.chevron.right")
                    Text("spotcode").fontWeight(.bold)
                }.foregroundColor(SpotcodeTheme.text)
            }
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").foregroundColor(SpotcodeTheme.muted)
                TextField("Search…", text: $query).foregroundColor(SpotcodeTheme.text)
            }
            .padding(.horizontal, 10).frame(height: 34)
            .background(SpotcodeTheme.background)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
            Button { section = .settings } label: { Image(systemName: "gearshape") }.spotcodeIconButton()
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(SpotcodeTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }
}

private struct SideDrawer: View {
    @EnvironmentObject private var model: AppModel
    @Binding var section: AppSection
    @Binding var open: Bool
    @Binding var composing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                Text("spotcode").bold(); Text("/").foregroundColor(SpotcodeTheme.muted)
                Text("sns").foregroundColor(SpotcodeTheme.accent)
            }.font(.title3).padding(.bottom, 20)
            ForEach(AppSection.allCases, id: \.self) { item in
                Button {
                    section = item
                    withAnimation { open = false }
                } label: {
                    HStack(spacing: 16) {
                        Image(systemName: item.icon).frame(width: 25)
                        Text(item.rawValue).fontWeight(section == item ? .bold : .medium)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
                }.foregroundColor(SpotcodeTheme.text)
            }
            Button { composing = true; open = false } label: {
                Label("New idea", systemImage: "plus")
                    .font(.body.weight(.bold)).frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(SpotcodeTheme.accent).foregroundColor(.white).clipShape(Capsule())
            }.padding(.top, 10).disabled(model.session == nil)
            Spacer()
            if let me = model.me {
                HStack(spacing: 10) {
                    AvatarView(profile: me, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(me.name).fontWeight(.bold)
                        Text("@\(me.handle)").font(.caption).foregroundColor(SpotcodeTheme.muted)
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.top, 20).padding(.bottom, 12)
        .frame(width: 278).frame(maxHeight: .infinity)
        .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
        .overlay(alignment: .trailing) { Rectangle().fill(SpotcodeTheme.border).frame(width: 1) }
    }
}

struct TimelineView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selectedTab = 0
    @State private var composing = false

    var body: some View {
        VStack(spacing: 0) {
            TimelineTabs(selected: $selectedTab)
            if selectedTab == 2 {
                NativeMapView()
            } else if model.posts.isEmpty && model.isLoading {
                Spacer(); ProgressView("Loading timeline…").foregroundColor(SpotcodeTheme.muted); Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ComposerPrompt { composing = true }
                        ForEach(model.posts) { post in
                            NavigationLink(destination: PostDetailView(post: post)) { PostRow(post: post) }
                                .buttonStyle(.plain)
                        }
                    }
                }.refreshable { await model.loadTimeline() }
            }
        }
        .background(SpotcodeTheme.surface).navigationBarHidden(true)
        .sheet(isPresented: $composing) { ComposeView(isPresented: $composing) }
    }
}

private struct TimelineTabs: View {
    @Binding var selected: Int
    private let labels = ["For you", "Following", "Spots"]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(labels.indices, id: \.self) { index in
                Button { selected = index } label: {
                    VStack(spacing: 11) {
                        Text(labels[index]).fontWeight(.semibold)
                        Capsule().fill(selected == index ? SpotcodeTheme.accent : .clear).frame(width: 56, height: 4)
                    }.frame(maxWidth: .infinity).padding(.top, 13)
                }.foregroundColor(selected == index ? SpotcodeTheme.text : SpotcodeTheme.muted)
            }
        }.background(SpotcodeTheme.surface)
         .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }
}

private struct ComposerPrompt: View {
    @EnvironmentObject private var model: AppModel
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                AvatarView(profile: model.me, size: 42)
                VStack(alignment: .leading, spacing: 12) {
                    Text("Share an idea…").font(.title3).foregroundColor(SpotcodeTheme.muted)
                    HStack { Image(systemName: "link"); Image(systemName: "mappin"); Spacer(); Text("Post").bold().padding(.horizontal, 18).padding(.vertical, 8).background(SpotcodeTheme.accent).foregroundColor(.white).clipShape(Capsule()) }
                        .foregroundColor(SpotcodeTheme.accent)
                }
            }.padding(16)
        }.buttonStyle(.plain).disabled(model.session == nil)
         .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }
}

struct PostRow: View {
    let post: Post
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(profile: post.author, size: 42)
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 5) {
                    Text(post.author?.name ?? "User").fontWeight(.bold).foregroundColor(SpotcodeTheme.text)
                    Text("@\(post.author?.handle ?? "unknown")").foregroundColor(SpotcodeTheme.muted).lineLimit(1)
                }
                Text(post.body).foregroundColor(SpotcodeTheme.text).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                if let label = post.spot?.label {
                    Label(label, systemImage: "mappin").font(.caption).foregroundColor(SpotcodeTheme.warning)
                }
                if let link = post.githubLink, let url = URL(string: link) {
                    Link(destination: url) {
                        HStack { Image(systemName: "link"); Text(link).lineLimit(1) }
                            .font(.caption).padding(9).frame(maxWidth: .infinity, alignment: .leading)
                            .background(SpotcodeTheme.background).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                HStack { Image(systemName: "bubble.left"); Spacer(); Image(systemName: "arrow.2.squarepath"); Spacer(); Image(systemName: "heart"); Spacer(); Image(systemName: "bookmark") }
                    .font(.caption).foregroundColor(SpotcodeTheme.muted).padding(.top, 4).padding(.trailing, 24)
            }
        }
        .padding(16).background(SpotcodeTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }
}

struct AvatarView: View {
    let profile: Profile?
    var size: CGFloat = 42
    var body: some View {
        AsyncImage(url: profile?.avatarURL.flatMap(URL.init(string:))) { phase in
            if let image = phase.image { image.resizable().scaledToFill() }
            else {
                ZStack {
                    LinearGradient(colors: [SpotcodeTheme.accent, Color(red: 46/255, green: 160/255, blue: 67/255)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    Text(String(profile?.name.first ?? "?")).foregroundColor(.white).fontWeight(.bold)
                }
            }
        }.frame(width: size, height: size).clipShape(Circle())
    }
}

struct PostDetailView: View {
    let post: Post
    var body: some View {
        ScrollView { PostRow(post: post) }
            .background(SpotcodeTheme.surface).navigationTitle("Post").navigationBarTitleDisplayMode(.inline)
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
            VStack(spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    AvatarView(profile: model.me, size: 42)
                    TextEditor(text: $bodyText).font(.title3).padding(8).frame(minHeight: 160)
                        .background(SpotcodeTheme.surface2).overlay(RoundedRectangle(cornerRadius: 10).stroke(SpotcodeTheme.border, lineWidth: 2))
                }
                HStack { Image(systemName: "link"); TextField("https://github.com/…", text: $githubLink).textInputAutocapitalization(.never).keyboardType(.URL) }
                    .padding(11).background(SpotcodeTheme.background).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
                Spacer()
            }.padding().background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
             .navigationTitle("New idea").navigationBarTitleDisplayMode(.inline)
             .toolbar {
                 ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } }
                 ToolbarItem(placement: .confirmationAction) {
                     Button(sending ? "Posting…" : "Post") {
                         sending = true
                         Task {
                             if await model.publish(body: bodyText.trimmingCharacters(in: .whitespacesAndNewlines), githubLink: githubLink.isEmpty ? nil : githubLink) { isPresented = false }
                             sending = false
                         }
                     }.disabled(bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                 }
             }
        }.preferredColorScheme(.dark)
    }
}

struct NativeMapView: View {
    @EnvironmentObject private var model: AppModel
    @State private var posts: [Post] = []
    @State private var region = MKCoordinateRegion(center: .init(latitude: 35.681236, longitude: 139.767125), span: .init(latitudeDelta: 0.12, longitudeDelta: 0.12))
    var body: some View {
        Map(coordinateRegion: $region, annotationItems: posts.filter { $0.spot != nil }) { post in
            MapAnnotation(coordinate: post.spot!.coordinate) {
                NavigationLink(destination: PostDetailView(post: post)) { Image(systemName: "mappin.circle.fill").font(.title).foregroundColor(SpotcodeTheme.accent) }
            }
        }.task {
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
        VStack(spacing: 0) {
            PageHeader(title: "Repositories")
            if loading && repositories.isEmpty { Spacer(); ProgressView("Repositories…"); Spacer() }
            else if model.me?.githubHandle == nil { Spacer(); ContentUnavailableViewCompat(title: "GitHubをプロフィールに連携してください", icon: "link"); Spacer() }
            else {
                ScrollView { LazyVStack(spacing: 0) {
                    ForEach(repositories) { repo in
                        Link(destination: repo.htmlURL) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(repo.fullName).fontWeight(.bold).foregroundColor(SpotcodeTheme.accent)
                                if let description = repo.description { Text(description).foregroundColor(SpotcodeTheme.text) }
                                HStack { if let language = repo.language { Text(language) }; Label("\(repo.stars)", systemImage: "star") }.font(.caption).foregroundColor(SpotcodeTheme.muted)
                            }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
                             .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
                        }
                    }
                }}.refreshable { await load() }
            }
        }.background(SpotcodeTheme.surface).navigationBarHidden(true).task { await load() }
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
        VStack(spacing: 0) {
            PageHeader(title: "Notifications")
            if loading && events.isEmpty { Spacer(); ProgressView("通知を読み込み中…"); Spacer() }
            else if events.isEmpty { Spacer(); ContentUnavailableViewCompat(title: "通知はありません", icon: "bell"); Spacer() }
            else { ScrollView { LazyVStack(spacing: 0) { ForEach(events) { event in
                HStack(spacing: 12) {
                    AvatarView(profile: event.follower, size: 42)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(event.follower.name).fontWeight(.bold)
                        Text(event.status == "pending" ? "@\(event.follower.handle) からフォローリクエスト" : "@\(event.follower.handle) にフォローされました").font(.subheadline).foregroundColor(SpotcodeTheme.muted)
                    }; Spacer()
                }.padding(16).overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
            }}}.refreshable { await load() } }
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true).task { await load() }
    }
    private func load() async {
        guard let session = model.session, let id = model.me?.id else { return }
        loading = true; defer { loading = false }
        do { events = try await SupabaseService.shared.followNotifications(userID: id, token: session.accessToken) }
        catch { model.errorMessage = error.localizedDescription }
    }
}

struct ProfileView: View {
    let profile: Profile?
    var body: some View {
        VStack(spacing: 0) {
            PageHeader(title: "Profile")
            ScrollView {
                if let profile {
                    VStack(alignment: .leading, spacing: 12) {
                        AvatarView(profile: profile, size: 78)
                        Text(profile.name).font(.title2).fontWeight(.bold)
                        Text("@\(profile.handle)").foregroundColor(SpotcodeTheme.muted)
                        if let bio = profile.bio { Text(bio) }
                        if let location = profile.location { Label(location, systemImage: "mappin").foregroundColor(SpotcodeTheme.muted) }
                    }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                } else { ContentUnavailableViewCompat(title: "ログインしてください", icon: "person.crop.circle") }
            }
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true)
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        VStack(spacing: 0) {
            PageHeader(title: "Settings")
            VStack(spacing: 0) {
                if let me = model.me { SettingRow(label: "Handle", value: "@\(me.handle)") }
                SettingRow(label: "UI", value: "SwiftUI Native")
                Button("ログアウト", role: .destructive) { model.signOut() }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            }; Spacer()
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true)
    }
}

private struct SettingRow: View {
    let label: String; let value: String
    var body: some View { HStack { Text(label); Spacer(); Text(value).foregroundColor(SpotcodeTheme.muted) }.padding(16).overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) } }
}

private struct PageHeader: View {
    let title: String
    var body: some View { Text(title).font(.headline).frame(maxWidth: .infinity, alignment: .leading).padding(16).background(SpotcodeTheme.surface).overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) } }
}

struct LoginView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @State private var email = ""
    @State private var password = ""
    var body: some View {
        NavigationView {
            VStack(spacing: 14) {
                Image(systemName: "chevron.left.forwardslash.chevron.right").font(.largeTitle)
                TextField("メールまたはログイン名", text: $email).textInputAutocapitalization(.never).keyboardType(.emailAddress).spotcodeField()
                SecureField("パスワード", text: $password).spotcodeField()
                Button(model.isLoading ? "ログイン中…" : "ログイン") {
                    Task { await model.signIn(emailOrAlias: email, password: password); if model.session != nil { isPresented = false } }
                }.font(.body.weight(.bold)).frame(maxWidth: .infinity).padding(13).background(SpotcodeTheme.accent).foregroundColor(.white).clipShape(Capsule())
                 .disabled(email.isEmpty || password.isEmpty || model.isLoading)
                Spacer()
            }.padding().background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationTitle("spotcodeへログイン")
        }.preferredColorScheme(.dark)
    }
}

struct ContentUnavailableViewCompat: View {
    let title: String; let icon: String
    var body: some View { VStack(spacing: 12) { Image(systemName: icon).font(.largeTitle); Text(title).multilineTextAlignment(.center) }.foregroundColor(SpotcodeTheme.muted).padding() }
}

private extension View {
    func spotcodeIconButton() -> some View {
        self.foregroundColor(SpotcodeTheme.text).frame(width: 34, height: 34).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }
    func spotcodeField() -> some View {
        self.padding(12).background(SpotcodeTheme.background).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }
}
