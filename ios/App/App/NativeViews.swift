import SwiftUI
import MapKit

private enum SpotcodeTheme {
    static let background = Color(red: 13/255, green: 17/255, blue: 23/255)
    static let surface = Color(red: 22/255, green: 27/255, blue: 34/255)
    static let surface2 = Color(red: 33/255, green: 38/255, blue: 45/255)
    static let inputSurface = Color(red: 38/255, green: 44/255, blue: 53/255)
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
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var section: AppSection = .home
    @State private var drawerOpen = false
    @State private var showLogin = false
    @State private var composing = false
    @State private var showAccounts = false

    var body: some View {
        ZStack(alignment: .leading) {
            SpotcodeTheme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                TopBar(drawerOpen: $drawerOpen, section: $section, showAccounts: $showAccounts)
                HStack(spacing: 0) {
                    Spacer(minLength: horizontalSizeClass == .regular ? 24 : 0)
                    NavigationView { sectionView }
                        .navigationViewStyle(.stack)
                        .frame(maxWidth: horizontalSizeClass == .regular ? 720 : .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
                        .padding(8)
                    Spacer(minLength: horizontalSizeClass == .regular ? 24 : 0)
                }
            }
            if drawerOpen {
                Color.black.opacity(0.55).ignoresSafeArea().onTapGesture { withAnimation { drawerOpen = false } }
                SideDrawer(section: $section, open: $drawerOpen, composing: $composing)
                    .transition(.move(edge: .leading))
            }
            if showAccounts {
                Color.black.opacity(0.72).ignoresSafeArea().onTapGesture { showAccounts = false }
                AccountSwitcher(isPresented: $showAccounts, showLogin: $showLogin)
                    .padding(.horizontal, 15)
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
    @EnvironmentObject private var model: AppModel
    @Binding var drawerOpen: Bool
    @Binding var section: AppSection
    @Binding var showAccounts: Bool
    @State private var query = ""

    var body: some View {
        HStack(spacing: 9) {
            Button { withAnimation(.easeOut(duration: 0.2)) { drawerOpen.toggle() } } label: {
                Image(systemName: "line.3.horizontal").frame(width: 34, height: 34)
            }.spotcodeIconButton()
            Button { section = .home } label: {
                HStack(spacing: 7) {
                    Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 25, height: 25)
                    Text("spotcode").fontWeight(.bold)
                }.foregroundColor(SpotcodeTheme.text)
            }
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").foregroundColor(SpotcodeTheme.muted)
                TextField("Search…", text: $query).foregroundColor(SpotcodeTheme.text)
            }
            .padding(.horizontal, 10).frame(height: 34)
            .frame(maxWidth: 520)
            .background(SpotcodeTheme.background)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
            Spacer(minLength: 0)
            Button { section = .settings } label: { Image(systemName: "gearshape") }.spotcodeIconButton()
            Button { showAccounts = true } label: { AvatarView(profile: model.me, size: 34) }
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
        .padding(.horizontal, 24).padding(.top, 32).padding(.bottom, 12)
        .frame(width: 260).frame(maxHeight: .infinity)
        .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
        .overlay(alignment: .trailing) { Rectangle().fill(SpotcodeTheme.border).frame(width: 1) }
    }
}

private struct AccountSwitcher: View {
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @Binding var showLogin: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text("アカウント").font(.title3).fontWeight(.bold); Spacer(); Button { isPresented = false } label: { Image(systemName: "xmark").font(.title3) } }
            if let me = model.me {
                HStack(spacing: 12) {
                    AvatarView(profile: me, size: 44)
                    VStack(alignment: .leading, spacing: 3) { HStack { Text(me.name).fontWeight(.bold); Text("現在").font(.caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent).padding(4).background(SpotcodeTheme.accent.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 5)) }; Text("@\(me.handle)").foregroundColor(SpotcodeTheme.muted) }
                }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color(red: 23/255, green: 40/255, blue: 54/255)).clipShape(RoundedRectangle(cornerRadius: 9))
            }
            HStack(spacing: 12) {
                ZStack { LinearGradient(colors: [SpotcodeTheme.accent, .green], startPoint: .topLeading, endPoint: .bottomTrailing); Text("S").font(.title2).fontWeight(.bold) }.frame(width: 44, height: 44).clipShape(Circle())
                VStack(alignment: .leading) { HStack { Text("spotcode").fontWeight(.bold); Text("公式").font(.caption.weight(.bold)).foregroundColor(.yellow).padding(4).background(Color.yellow.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 5)) }; Text("@spotcode_official").foregroundColor(SpotcodeTheme.muted) }
            }.padding(.horizontal, 12)
            Rectangle().fill(SpotcodeTheme.border).frame(height: 1)
            Button { model.signOut(); isPresented = false; showLogin = true } label: { Label("Log out", systemImage: "arrow.right").foregroundColor(Color(red: 248/255, green: 81/255, blue: 73/255)).font(.title3) }
        }
        .padding(15).background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(SpotcodeTheme.border)).clipShape(RoundedRectangle(cornerRadius: 14))
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
                        InlineComposer()
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

private struct InlineComposer: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @AppStorage("spotcode.native.draft") private var draft = ""
    @State private var githubLink = ""
    @State private var sending = false
    @State private var showLink = false
    @State private var showDraftNotice = true
    @FocusState private var editorFocused: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(profile: model.me, size: 42)
            VStack(alignment: .leading, spacing: 12) {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $draft).font(.title3).padding(8).frame(minHeight: 108)
                        .background(Color.clear).foregroundColor(SpotcodeTheme.text).focused($editorFocused)
                    if draft.isEmpty {
                        Text("いまどうしてる？")
                            .font(.title3).foregroundColor(SpotcodeTheme.muted)
                            .padding(.horizontal, 14).padding(.vertical, 17)
                            .allowsHitTesting(false)
                    }
                }
                .background(SpotcodeTheme.inputSurface)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(editorFocused ? SpotcodeTheme.accent : Color(red: 74/255, green: 85/255, blue: 104/255), lineWidth: editorFocused ? 3 : 2))
                composerChips
                if showLink {
                    TextField("https://github.com/…", text: $githubLink).textInputAutocapitalization(.never).keyboardType(.URL).spotcodeField()
                }
                if horizontalSizeClass == .regular {
                    HStack { composerTools; Spacer(); composerActions }
                } else {
                    composerTools
                    HStack { Spacer(); composerActions; Spacer() }
                }
                if !draft.isEmpty && showDraftNotice {
                    HStack {
                        Text("下書きを復元しました")
                        Spacer()
                        Button("破棄") { draft = ""; showDraftNotice = false }.foregroundColor(SpotcodeTheme.muted)
                    }.padding(.horizontal, 12).padding(.vertical, 11)
                     .background(Color(red: 18/255, green: 42/255, blue: 58/255))
                     .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.accent.opacity(0.45)))
                }
            }
        }.padding(16)
         .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }

    @ViewBuilder private var composerChips: some View {
        if horizontalSizeClass == .regular {
            HStack(spacing: 8) { locationChip; linkChip; eventChip; ideaChip; audienceChip }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) { locationChip; linkChip }
                HStack(spacing: 8) { eventChip; ideaChip }
                audienceChip
            }
        }
    }

    private var locationChip: some View { ComposerChip(icon: "mappin", title: "場所を追加") }
    private var linkChip: some View { Button { showLink.toggle() } label: { ComposerChip(icon: "link", title: "リンクを追加") } }
    private var eventChip: some View { ComposerChip(icon: "calendar", title: "イベントを追加") }
    private var ideaChip: some View { ComposerChip(icon: "sparkles", title: "アイデア") }
    private var audienceChip: some View { ComposerChip(icon: "globe", title: "全員", strong: true) }

    private var composerTools: some View {
        HStack(spacing: 24) {
            Image(systemName: "photo"); Image(systemName: "chevron.left.forwardslash.chevron.right")
            Image(systemName: "mappin.circle"); Image(systemName: "chart.bar")
        }.font(.title3).foregroundColor(SpotcodeTheme.accent)
    }

    private var composerActions: some View {
        HStack(spacing: 10) {
            Button("下書き保存") { showDraftNotice = true }
                .font(.body.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 10)
                .overlay(Capsule().stroke(SpotcodeTheme.border))
            Button(sending ? "送信中…" : "Push") { publish() }
                .font(.body.weight(.bold)).padding(.horizontal, 28).padding(.vertical, 11)
                .background(SpotcodeTheme.accent).foregroundColor(.white).clipShape(Capsule())
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending || model.session == nil)
        }
    }

    private func publish() {
        sending = true
        Task {
            if await model.publish(body: draft.trimmingCharacters(in: .whitespacesAndNewlines), githubLink: githubLink.isEmpty ? nil : githubLink) {
                draft = ""; githubLink = ""; showLink = false
            }
            sending = false
        }
    }
}

private struct ComposerChip: View {
    let icon: String; let title: String
    var strong = false
    var body: some View {
        Label(title, systemImage: icon).font(.caption.weight(.semibold)).foregroundColor(strong ? SpotcodeTheme.text : SpotcodeTheme.muted)
            .padding(.horizontal, 10).padding(.vertical, 7).overlay(Capsule().stroke(SpotcodeTheme.border, style: StrokeStyle(lineWidth: 1, dash: [5])))
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
                    Text("· \(relativeTime(post.createdAt))").foregroundColor(SpotcodeTheme.muted).lineLimit(1)
                    Spacer(minLength: 2)
                    Text((post.status ?? "wip").uppercased()).font(.caption.weight(.bold))
                        .foregroundColor((post.status ?? "wip") == "active" ? .black : SpotcodeTheme.text)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background((post.status ?? "wip") == "active" ? Color.cyan : SpotcodeTheme.warning).clipShape(Capsule())
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
                HStack {
                    Label("\(post.commentsCount ?? 0)", systemImage: "bubble.left"); Spacer()
                    Label("\(post.repostsCount ?? 0)", systemImage: "arrow.2.squarepath"); Spacer()
                    Label("\(post.bookmarksCount ?? 0)", systemImage: "star"); Spacer()
                    Label("0", systemImage: "heart"); Spacer(); Image(systemName: "square.and.arrow.up")
                }
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
                        .background(SpotcodeTheme.inputSurface).overlay(RoundedRectangle(cornerRadius: 10).stroke(SpotcodeTheme.border, lineWidth: 2))
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
    @EnvironmentObject private var model: AppModel
    let profile: Profile?
    @State private var profilePosts: [Post] = []
    @State private var counts = (following: 0, followers: 0, posts: 0)
    @State private var selectedTab = 0
    @State private var repositories: [Repository] = []
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                if let profile {
                    VStack(spacing: 0) {
                        ProfileHero(profile: profile, counts: counts, repositories: repositories)
                        HStack(spacing: 0) {
                            ForEach(["Posts", "Spots", "Likes"].indices, id: \.self) { index in
                                Button { selectedTab = index } label: {
                                    VStack(spacing: 13) {
                                        Text(["Posts", "Spots", "Likes"][index]).font(.title3)
                                        Capsule().fill(selectedTab == index ? SpotcodeTheme.accent : .clear).frame(width: 58, height: 4)
                                    }.frame(maxWidth: .infinity).padding(.top, 15)
                                }.foregroundColor(selectedTab == index ? SpotcodeTheme.text : SpotcodeTheme.muted)
                            }
                        }.overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
                        if selectedTab == 0 {
                            LazyVStack(spacing: 0) { ForEach(profilePosts) { post in PostRow(post: post) } }
                        } else if selectedTab == 1 {
                            LazyVStack(spacing: 0) { ForEach(profilePosts.filter { $0.spot != nil }) { post in PostRow(post: post) } }
                        } else {
                            ContentUnavailableViewCompat(title: "いいねした投稿はありません", icon: "heart")
                        }
                    }
                } else { ContentUnavailableViewCompat(title: "ログインしてください", icon: "person.crop.circle") }
            }
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true)
         .task { await loadProfile() }
    }

    private func loadProfile() async {
        guard let id = profile?.id else { return }
        async let posts = try? SupabaseService.shared.posts(limit: 80, authorID: id, token: model.session?.accessToken)
        async let stats = try? SupabaseService.shared.profileCounts(userID: id, token: model.session?.accessToken)
        profilePosts = await posts ?? []
        if let value = await stats { counts = value }
        if let handle = profile?.githubHandle {
            repositories = (try? await SupabaseService.shared.repositories(handle: handle)) ?? []
        }
    }
}

private struct ProfileHero: View {
    let profile: Profile
    let counts: (following: Int, followers: Int, posts: Int)
    let repositories: [Repository]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            LinearGradient(colors: [Color(red: 8/255, green: 70/255, blue: 111/255), Color(red: 30/255, green: 116/255, blue: 77/255)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .frame(height: 176)
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    AvatarView(profile: profile, size: 104).padding(5).background(SpotcodeTheme.surface).clipShape(Circle()).offset(y: -63)
                    Spacer()
                    Button("Edit profile") { }.font(.body.weight(.bold)).foregroundColor(SpotcodeTheme.background)
                        .padding(.horizontal, 20).padding(.vertical, 11).background(SpotcodeTheme.text).clipShape(Capsule()).padding(.top, 14)
                }.frame(height: 63)
                HStack(spacing: 8) {
                    Text(profile.name).font(.title).fontWeight(.bold)
                    Text("{ }").font(.caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent)
                        .padding(.horizontal, 8).padding(.vertical, 3).overlay(Capsule().stroke(SpotcodeTheme.accent))
                }
                Text("@\(profile.handle)").font(.title3).foregroundColor(SpotcodeTheme.muted)
                if let bio = profile.bio, !bio.isEmpty { Text(bio) }
                HStack(spacing: 14) {
                    if let location = profile.location, !location.isEmpty { Label(location, systemImage: "mappin") }
                    if let joined = profile.createdAt { Label("Joined \(String(joined.prefix(7)))", systemImage: "calendar") }
                }.foregroundColor(SpotcodeTheme.muted)
                HStack(spacing: 22) {
                    ProfileCount(value: counts.following, label: "Following")
                    ProfileCount(value: counts.followers, label: "Followers")
                    ProfileCount(value: counts.posts, label: "Posts")
                }.padding(.top, 5)
                if profile.githubHandle != nil {
                    GitHubActivity(repositories: repositories)
                    OpenIssuesCard(repositories: repositories)
                }
            }.padding(.horizontal, 18).padding(.bottom, 20)
        }.overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
    }
}

private struct GitHubActivity: View {
    let repositories: [Repository]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) { Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13); Text("GitHub activity"); Text("last 12 months").foregroundColor(SpotcodeTheme.muted) }.font(.caption)
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(0..<26, id: \.self) { column in
                    VStack(spacing: 3) {
                        ForEach(0..<7, id: \.self) { row in
                            let level = (column * 7 + row + repositories.count * 3) % 6
                            RoundedRectangle(cornerRadius: 2).fill(level < 2 ? SpotcodeTheme.surface2 : Color.green.opacity(0.3 + Double(level) * 0.12)).frame(width: 9, height: 9)
                        }
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).clipped()
        }.padding(.top, 8)
    }
}

private struct OpenIssuesCard: View {
    let repositories: [Repository]
    private var total: Int { repositories.reduce(0) { $0 + $1.openIssues } }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13).foregroundColor(SpotcodeTheme.muted); Text("Open issues"); Text("\(total)").fontWeight(.bold); Text("公開リポの未クローズ issue (task)").font(.caption).foregroundColor(SpotcodeTheme.muted); Spacer() }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack { Text("All \(total)").issuePill(); ForEach(repositories.prefix(5)) { repo in Text("\(repo.name) \(repo.openIssues)").issuePill() } }
            }
        }.padding(12).overlay(RoundedRectangle(cornerRadius: 10).stroke(SpotcodeTheme.border)).padding(.top, 8)
    }
}

private extension Text {
    func issuePill() -> some View { self.font(.caption).padding(.horizontal, 9).padding(.vertical, 5).overlay(Capsule().stroke(SpotcodeTheme.border)) }
}

private struct ProfileCount: View {
    let value: Int; let label: String
    var body: some View { HStack(spacing: 5) { Text("\(value)").fontWeight(.bold).foregroundColor(SpotcodeTheme.text); Text(label).foregroundColor(SpotcodeTheme.muted) } }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var tab = 0
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Settings").font(.title2).fontWeight(.bold)
                HStack(spacing: 0) {
                    SettingsTab(title: "アカウント", icon: "person", selected: tab == 0) { tab = 0 }
                    SettingsTab(title: "プライバシー", icon: "lock", selected: tab == 1) { tab = 1 }
                    SettingsTab(title: "表示", icon: "gearshape", selected: tab == 2) { tab = 2 }
                }
                if tab == 0 { AccountSettings() }
                else if tab == 1 { PrivacySettings() }
                else { DisplaySettings() }
            }.padding(16)
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true)
    }
}

private struct SettingsTab: View {
    let title: String; let icon: String; let selected: Bool; let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Label(title, systemImage: icon).font(.caption.weight(.semibold))
                Rectangle().fill(selected ? SpotcodeTheme.accent : SpotcodeTheme.muted).frame(height: selected ? 3 : 1)
            }.frame(maxWidth: .infinity)
        }.foregroundColor(selected ? SpotcodeTheme.accent : SpotcodeTheme.muted)
    }
}

private struct SettingsCard<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) { Text(title).font(.headline); content }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
    }
}

private struct AccountSettings: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        VStack(spacing: 18) {
            SettingsCard("アカウント") {
                Text("この端末にログイン済みのアカウントを切り替えられます。アカウント自体は削除されません。").foregroundColor(SpotcodeTheme.muted)
                if let me = model.me {
                    HStack { AvatarView(profile: me, size: 42); VStack(alignment: .leading) { Text(me.name).fontWeight(.bold); Text("@\(me.handle) · 現在").font(.caption).foregroundColor(SpotcodeTheme.muted) }; Spacer(); Image(systemName: "xmark").foregroundColor(SpotcodeTheme.muted) }
                        .padding(12).background(Color(red: 23/255, green: 40/255, blue: 54/255)).clipShape(RoundedRectangle(cornerRadius: 9))
                }
                Button("＋ 別のアカウントを追加") { }.buttonStyle(OutlineButtonStyle())
            }
            SettingsCard("役割") {
                Label("管理者", systemImage: "sparkles").foregroundColor(SpotcodeTheme.accent)
                Text("すべての権限を持ちます。運営者の追加・解除、投稿削除、通報対応、ピンの自由配置、Supabase設定。").foregroundColor(SpotcodeTheme.muted)
            }
            SettingsCard("アカウントの種類") {
                Text("個人アカウント").fontWeight(.semibold)
                Text("プロフィール表示が変わるだけで、投稿の公開範囲やフォローの挙動は変わりません。").foregroundColor(SpotcodeTheme.muted)
                Button("▦ 組織アカウントに切り替え") { }.buttonStyle(OutlineButtonStyle(filled: true))
            }
        }
    }
}

private struct PrivacySettings: View {
    @State private var privateAccount = false
    @State private var locationEnabled = true
    var body: some View { VStack(spacing: 18) {
        SettingsCard("アカウントの公開範囲") { Toggle("非公開アカウント", isOn: $privateAccount); Text("承認したフォロワーだけが投稿を表示できます。").foregroundColor(SpotcodeTheme.muted) }
        SettingsCard("位置情報") { Toggle("スポット機能を使用", isOn: $locationEnabled); Text("投稿への場所追加と近くのスポット表示に利用します。").foregroundColor(SpotcodeTheme.muted) }
    }}
}

private struct DisplaySettings: View {
    @State private var compact = false
    var body: some View { VStack(spacing: 18) {
        SettingsCard("テーマ") { Label("ダーク", systemImage: "moon.fill"); Text("Webモバイル版と同じGitHubダークテーマです。").foregroundColor(SpotcodeTheme.muted) }
        SettingsCard("タイムライン") { Toggle("コンパクト表示", isOn: $compact) }
    }}
}

private struct OutlineButtonStyle: ButtonStyle {
    var filled = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.body.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, 9)
            .foregroundColor(filled ? SpotcodeTheme.background : SpotcodeTheme.text)
            .background(filled ? SpotcodeTheme.text : Color.clear).clipShape(Capsule())
            .overlay(Capsule().stroke(SpotcodeTheme.border)).opacity(configuration.isPressed ? 0.7 : 1)
    }
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

private func relativeTime(_ value: String?) -> String {
    guard let value else { return "" }
    let parser = ISO8601DateFormatter()
    parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = parser.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    guard let date else { return "" }
    let seconds = max(0, Int(Date().timeIntervalSince(date)))
    if seconds < 60 { return "\(seconds)s" }
    if seconds < 3_600 { return "\(seconds / 60)m" }
    if seconds < 86_400 { return "\(seconds / 3_600)h" }
    return "\(seconds / 86_400)d"
}
