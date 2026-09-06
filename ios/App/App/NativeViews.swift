import SwiftUI
import MapKit
import CoreLocation
import PhotosUI
import UIKit
import CoreImage
import AuthenticationServices
import UserNotifications

private enum SpotcodeTheme {
    static let background = Color(red: 13/255, green: 17/255, blue: 23/255)
    static let surface = Color(red: 22/255, green: 27/255, blue: 34/255)
    static let surface2 = Color(red: 33/255, green: 38/255, blue: 45/255)
    static let inputSurface = Color(red: 33/255, green: 38/255, blue: 45/255)
    static let border = Color(red: 48/255, green: 54/255, blue: 61/255)
    static let text = Color(red: 230/255, green: 237/255, blue: 243/255)
    static let muted = Color(red: 125/255, green: 133/255, blue: 144/255)
    static let accent = Color(red: 29/255, green: 155/255, blue: 240/255)
    static let warning = Color(red: 254/255, green: 188/255, blue: 46/255)
}

// Code-native marks shared with the web SVG icon set. Keeping the same 24×24
// paths avoids platform-specific SF Symbols changing the visual language.
private struct SpotcodePinMark: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 24, sy = rect.height / 24
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * sx, y: y * sy) }
        var path = Path()
        path.move(to: point(12, 22))
        path.addCurve(to: point(19, 10), control1: point(12, 22), control2: point(19, 15))
        path.addCurve(to: point(12, 3), control1: point(19, 6.1), control2: point(15.9, 3))
        path.addCurve(to: point(5, 10), control1: point(8.1, 3), control2: point(5, 6.1))
        path.addCurve(to: point(12, 22), control1: point(5, 15), control2: point(12, 22))
        path.addEllipse(in: CGRect(x: 9 * sx, y: 7 * sy, width: 6 * sx, height: 6 * sy))
        return path
    }
}

private struct RepoMark: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 24, sy = rect.height / 24
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * sx, y: y * sy) }
        var path = Path()
        path.move(to: point(6, 3))
        path.addLine(to: point(6, 18))
        path.addCurve(to: point(9, 21), control1: point(6, 19.7), control2: point(7.3, 21))
        path.addLine(to: point(20, 21))
        path.addLine(to: point(20, 6))
        path.addLine(to: point(9, 6))
        path.addCurve(to: point(6, 3), control1: point(7.3, 6), control2: point(6, 4.7))
        path.move(to: point(6, 18))
        path.addCurve(to: point(9, 15), control1: point(6, 16.3), control2: point(7.3, 15))
        path.addLine(to: point(20, 15))
        return path
    }
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
    @State private var repositoryComposeURL: String?
    @State private var navigationReset = UUID()
    @AppStorage("spotcode.native.language") private var appLanguage = "en"

    private var screenshotMode: Bool {
        ProcessInfo.processInfo.arguments.contains("-SpotcodeScreenshotMode")
    }

    private var screenshotShowsLogin: Bool {
        ProcessInfo.processInfo.arguments.contains("-SpotcodeScreenshotShowLogin")
    }

    private var screenshotSection: AppSection? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let flag = arguments.firstIndex(of: "-SpotcodeScreenshotSection"),
              arguments.indices.contains(flag + 1) else { return nil }
        let requested = arguments[flag + 1]
        return AppSection.allCases.first { $0.rawValue.caseInsensitiveCompare(requested) == .orderedSame }
    }

    var body: some View {
        ZStack(alignment: .leading) {
            SpotcodeTheme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                TopBar(drawerOpen: $drawerOpen, section: $section, showAccounts: $showAccounts, showLogin: $showLogin, navigationReset: $navigationReset)
                HStack(spacing: 0) {
                    Spacer(minLength: horizontalSizeClass == .regular ? 24 : 0)
                    NavigationView { sectionView }
                        .id(navigationReset)
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
                SideDrawer(section: $section, open: $drawerOpen, composing: $composing, navigationReset: $navigationReset)
                    .transition(.move(edge: .leading))
            }
            if showAccounts {
                Color.black.opacity(0.72).ignoresSafeArea().onTapGesture { showAccounts = false }
                AccountSwitcher(isPresented: $showAccounts, showLogin: $showLogin)
                    .padding(.horizontal, 15)
            }
        }
        .preferredColorScheme(.dark)
        .environment(\.locale, Locale(identifier: appLanguage))
        .tint(SpotcodeTheme.accent)
        .task {
            if let screenshotSection { section = screenshotSection }
            if screenshotShowsLogin {
                showLogin = true
            } else if model.session == nil && !screenshotMode {
                showLogin = true
            }
            await model.bootstrap()
        }
        .sheet(isPresented: $showLogin) { LoginView(isPresented: $showLogin) }
        .sheet(isPresented: $composing) { ComposeView(isPresented: $composing) }
        .alert("エラー", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) { Button("OK") {} } message: { Text(LocalizedStringKey(model.errorMessage ?? "")) }
        .onChange(of: model.requiresReauthentication) { required in
            if required && !screenshotMode {
                showAccounts = false
                showLogin = true
            }
        }
    }

    @ViewBuilder private var sectionView: some View {
        switch section {
        case .home: TimelineView(repositoryComposeURL: $repositoryComposeURL, drawerOpen: $drawerOpen)
        case .repos: RepositoriesView { url in
            repositoryComposeURL = url.absoluteString
            section = .home
            navigationReset = UUID()
        }
        case .notifications: NotificationsView()
        // Profile follows the identity selected in the account switcher.
        // Settings and authorization still use model.me (the real signed-in
        // administrator), while official mode opens @spotcode_official here.
        case .profile: ProfileView(profile: model.displayProfile)
            .id(model.displayProfile?.id)
        case .settings: SettingsView()
        }
    }
}

private struct TopBar: View {
    @EnvironmentObject private var model: AppModel
    @Binding var drawerOpen: Bool
    @Binding var section: AppSection
    @Binding var showAccounts: Bool
    @Binding var showLogin: Bool
    @Binding var navigationReset: UUID
    @State private var query = ""
    @State private var showSearch = false

    var body: some View {
        HStack(spacing: 9) {
            Button { withAnimation(.easeOut(duration: 0.2)) { drawerOpen.toggle() } } label: {
                Image(systemName: "line.3.horizontal").frame(width: 34, height: 34)
            }.spotcodeIconButton()
            Button { section = .home; navigationReset = UUID() } label: {
                HStack(spacing: 7) {
                    SpotcodePinMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: 25, height: 25)
                    Text("spotcode").fontWeight(.bold)
                }.foregroundColor(SpotcodeTheme.text)
            }
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").foregroundColor(SpotcodeTheme.muted)
                TextField("Search…", text: $query).foregroundColor(SpotcodeTheme.text)
                    .onSubmit { if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { showSearch = true } }
            }
            .padding(.horizontal, 10).frame(height: 34)
            .frame(maxWidth: 520)
            .background(SpotcodeTheme.background)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
            Spacer(minLength: 0)
            Button { section = .settings; navigationReset = UUID() } label: { Image(systemName: "gearshape") }.spotcodeIconButton()
            Button {
                if model.session == nil { showLogin = true } else { showAccounts = true }
            } label: { AvatarView(profile: model.displayProfile, size: 34) }
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(SpotcodeTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
        .sheet(isPresented: $showSearch) { ProfileSearchView(initialQuery: query) }
    }
}

private struct SideDrawer: View {
    @EnvironmentObject private var model: AppModel
    @Binding var section: AppSection
    @Binding var open: Bool
    @Binding var composing: Bool
    @Binding var navigationReset: UUID

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(AppSection.allCases, id: \.self) { item in
                Button {
                    section = item
                    navigationReset = UUID()
                    withAnimation { open = false }
                } label: {
                    HStack(spacing: 16) {
                        Image(systemName: item.icon).frame(width: 25)
                        Text(LocalizedStringKey(item.rawValue)).fontWeight(section == item ? .bold : .medium)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 12)
                }.foregroundColor(SpotcodeTheme.text)
            }
            Button { composing = true; open = false } label: {
                Label("New idea", systemImage: "plus")
                    .font(.body.weight(.bold)).frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(SpotcodeTheme.accent).foregroundColor(.white).clipShape(Capsule())
            }.padding(.top, 10).disabled(model.session == nil)
            Spacer()
            if let me = model.displayProfile {
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
    @State private var switchingID: UUID?
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text("アカウント").font(.title3).fontWeight(.bold); Spacer(); Button { isPresented = false } label: { Image(systemName: "xmark").font(.title3) } }
            ForEach(model.savedAccounts) { account in
                let active = account.id == model.session?.user.id && !model.isPostingAsOfficial
                Button {
                    guard !active, switchingID == nil else { return }
                    switchingID = account.id
                    Task {
                        if await model.switchAccount(to: account.id) { isPresented = false }
                        switchingID = nil
                    }
                } label: {
                    HStack(spacing: 12) {
                        AvatarView(profile: account.profile, size: 44)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(account.profile.name).fontWeight(.bold)
                                if active { Text("現在").font(.caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent).padding(4).background(SpotcodeTheme.accent.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 5)) }
                            }
                            Text("@\(account.profile.handle)").foregroundColor(SpotcodeTheme.muted)
                        }
                        Spacer()
                        if switchingID == account.id { ProgressView() }
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(active ? Color(red: 23/255, green: 40/255, blue: 54/255) : SpotcodeTheme.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                }
                .buttonStyle(.plain)
                .disabled(switchingID != nil)
            }
            if model.session != nil && (model.me?.isAdmin == true || model.me?.isOperator == true) {
                Button {
                    guard switchingID == nil else { return }
                    if model.isPostingAsOfficial {
                        model.switchToPersonalAccount()
                        isPresented = false
                    } else {
                        Task {
                            if await model.switchToOfficial() { isPresented = false }
                        }
                    }
                } label: {
                    HStack(spacing: 12) {
                        ZStack { LinearGradient(colors: [SpotcodeTheme.accent, .green], startPoint: .topLeading, endPoint: .bottomTrailing); Text("S").font(.title2).fontWeight(.bold) }.frame(width: 44, height: 44).clipShape(Circle())
                        VStack(alignment: .leading) {
                            HStack {
                                Text("spotcode").fontWeight(.bold)
                                Text("公式").font(.caption.weight(.bold)).foregroundColor(.yellow).padding(4).background(Color.yellow.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 5))
                                if model.isPostingAsOfficial { Text("現在").font(.caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent) }
                            }
                            Text("@spotcode_official").foregroundColor(SpotcodeTheme.muted)
                        }
                        Spacer()
                    }.padding(12).background(model.isPostingAsOfficial ? Color(red: 23/255, green: 40/255, blue: 54/255) : SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 9))
                }.buttonStyle(.plain)
            }
            Rectangle().fill(SpotcodeTheme.border).frame(height: 1)
            Button {
                isPresented = false
                // Presenting a sheet in the same update that removes this
                // overlay is occasionally ignored by SwiftUI. Wait for the
                // account panel to leave the hierarchy first.
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 180_000_000)
                    showLogin = true
                }
            } label: {
                Label("別のアカウントを追加", systemImage: "plus").font(.body.weight(.semibold))
            }
            .disabled(switchingID != nil)
            Button { model.signOut(); isPresented = false; showLogin = true } label: { Label("Log out", systemImage: "arrow.right").foregroundColor(Color(red: 248/255, green: 81/255, blue: 73/255)).font(.title3) }
        }
        .padding(15).background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(SpotcodeTheme.border)).clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct TimelineView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var repositoryComposeURL: String?
    @Binding var drawerOpen: Bool
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
                        InlineComposer(repositoryComposeURL: $repositoryComposeURL)
                        ForEach(model.posts) { post in
                            PostRow(post: post)
                        }
                    }
                }.refreshable { await model.loadTimeline() }
            }
        }
        .simultaneousGesture(
            DragGesture(minimumDistance: 18, coordinateSpace: .local)
                .onEnded { value in
                    let horizontal = value.translation.width
                    let vertical = abs(value.translation.height)
                    // Reserve the system-style leading edge for the drawer.
                    // Starting farther inside remains available to maps,
                    // horizontal chips and other Home content.
                    guard value.startLocation.x <= 28,
                          horizontal >= 70,
                          vertical < horizontal * 0.65 else { return }
                    withAnimation(.easeOut(duration: 0.2)) { drawerOpen = true }
                }
        )
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
    @Binding var repositoryComposeURL: String?
    // Do not bind the editor directly to @AppStorage. That performs a
    // synchronous UserDefaults write for every keystroke and made typing
    // visibly stall on real devices. Keep editing in memory and persist
    // only after the user pauses.
    @State private var draft = UserDefaults.standard.string(forKey: "spotcode.native.draft") ?? ""
    @State private var draftSaveTask: Task<Void, Never>?
    @State private var githubLink = ""
    @State private var repoFullName = ""
    @State private var eventURL = ""
    @State private var sending = false
    @State private var showLink = false
    @State private var showEvent = false
    @State private var postKind: String? = nil
    @State private var visibility = "public"
    @State private var photos: [String] = []
    @State private var poll: PostPoll?
    @State private var showPhotoPicker = false
    @State private var showPollEditor = false
    @State private var selectedSpot: Spot?
    @State private var showLocationPicker = false
    @State private var showDraftNotice = true
    @State private var editorFocused = false
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            AvatarView(profile: model.displayProfile, size: 42)
            VStack(alignment: .leading, spacing: 12) {
                ZStack(alignment: .topLeading) {
                    ComposerTextView(text: $draft, isFocused: $editorFocused)
                        .frame(minHeight: 108)
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
                    TextField("https://github.com/…", text: $githubLink).textInputAutocapitalization(.never).keyboardType(.URL).spotcodeURLField()
                    TextField("owner/repository（任意）", text: $repoFullName).textInputAutocapitalization(.never).autocorrectionDisabled(true).spotcodeURLField()
                }
                if showEvent {
                    TextField("https://connpass.com/event/…", text: $eventURL).textInputAutocapitalization(.never).keyboardType(.URL).spotcodeURLField()
                }
                if !photos.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack { ForEach(Array(photos.enumerated()), id: \.offset) { index, value in
                            ZStack(alignment: .topTrailing) {
                                DataURLImage(value: value).frame(width: 82, height: 82).clipShape(RoundedRectangle(cornerRadius: 9))
                                Button { photos.remove(at: index) } label: { Image(systemName: "xmark.circle.fill").foregroundColor(.white).background(Color.black.clipShape(Circle())) }
                            }
                        }}
                    }
                }
                if let poll { Label("投票: \(poll.question)", systemImage: "chart.bar").font(.caption).foregroundColor(SpotcodeTheme.accent) }
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
         .onAppear { applyRepositoryRequest(repositoryComposeURL) }
         .onDisappear { persistDraftImmediately() }
         .onChange(of: draft) { scheduleDraftSave($0) }
         .onChange(of: repositoryComposeURL) { applyRepositoryRequest($0) }
         .sheet(isPresented: $showLocationPicker) {
             LocationPickerSheet(spot: $selectedSpot, isPresented: $showLocationPicker)
         }
         .sheet(isPresented: $showPhotoPicker) { PhotoLibraryPicker(images: $photos) }
         .sheet(isPresented: $showPollEditor) { PollEditorSheet(poll: $poll, isPresented: $showPollEditor) }
    }

    @ViewBuilder private var composerChips: some View {
        if horizontalSizeClass == .regular {
            HStack(spacing: 8) { locationChip; linkChip; eventChip; kindChip; audienceChip }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) { locationChip; linkChip }
                HStack(spacing: 8) { eventChip; kindChip }
                audienceChip
            }
        }
    }

    private var locationChip: some View {
        Button { showLocationPicker = true } label: {
            ComposerChip(icon: "mappin", title: selectedSpot?.label ?? "場所を追加", active: selectedSpot != nil)
        }
    }
    private var linkChip: some View { Button { showLink.toggle() } label: { ComposerChip(icon: "link", title: "リンクを追加", active: showLink) } }
    private var eventChip: some View { Button { showEvent.toggle() } label: { ComposerChip(icon: "calendar", title: "イベントを追加", active: showEvent) } }
    private var kindChip: some View { PostKindPicker(kind: $postKind) }
    private var audienceChip: some View {
        Menu {
            audienceButton("全員", value: "public")
            audienceButton("相互フォロー", value: "mutuals")
            audienceButton("フォロー中", value: "following")
            audienceButton("親しい友達", value: "friends")
            audienceButton("同じ組織", value: "org")
        } label: { ComposerChip(icon: visibilityIcon, title: visibilityLabel, strong: true, active: visibility != "public") }
    }

    private var composerTools: some View {
        HStack(spacing: 24) {
            Button { showPhotoPicker = true } label: { Image(systemName: "photo") }
            Button { insertCodeBlock() } label: { Image(systemName: "chevron.left.forwardslash.chevron.right") }
            Button { showLocationPicker = true } label: { Image(systemName: "mappin.circle") }
            Button { showPollEditor = true } label: { Image(systemName: "chart.bar") }
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
            if await model.publish(body: draft.trimmingCharacters(in: .whitespacesAndNewlines), githubLink: githubLink.isEmpty ? nil : githubLink, repoFullName: repoFullName.isEmpty ? nil : repoFullName, eventURL: eventURL.isEmpty ? nil : eventURL, spot: selectedSpot, kind: postKind, visibility: visibility, photos: photos.isEmpty ? nil : photos, poll: poll) {
                draft = ""; githubLink = ""; repoFullName = ""; eventURL = ""; showLink = false; showEvent = false
                postKind = nil; visibility = "public"; selectedSpot = nil
                photos = []; poll = nil
            }
            sending = false
        }
    }
    private func insertCodeBlock() {
        if !draft.isEmpty && !draft.hasSuffix("\n") { draft += "\n" }
        draft += "```\nコードを入力\n```\n"
        editorFocused = true
    }

    private func audienceButton(_ title: String, value: String) -> some View {
        Button { visibility = value } label: {
            if visibility == value {
                Label { Text(LocalizedStringKey(title)) } icon: { Image(systemName: "checkmark") }
            } else {
                Text(LocalizedStringKey(title))
            }
        }
    }
    private var visibilityLabel: String {
        ["public":"全員", "mutuals":"相互フォロー", "following":"フォロー中", "friends":"親しい友達", "org":"同じ組織"][visibility] ?? "全員"
    }
    private var visibilityIcon: String {
        ["public":"globe", "mutuals":"arrow.2.squarepath", "following":"person.badge.plus", "friends":"heart", "org":"building.2"][visibility] ?? "globe"
    }

    private func applyRepositoryRequest(_ value: String?) {
        guard let value, !value.isEmpty else { return }
        githubLink = value
        repoFullName = githubRepositoryName(from: value) ?? ""
        showLink = true
        editorFocused = true
        repositoryComposeURL = nil
    }

    private func scheduleDraftSave(_ value: String) {
        draftSaveTask?.cancel()
        draftSaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            UserDefaults.standard.set(value, forKey: "spotcode.native.draft")
        }
    }

    private func persistDraftImmediately() {
        draftSaveTask?.cancel()
        UserDefaults.standard.set(draft, forKey: "spotcode.native.draft")
    }
}

private struct PostKindPicker: View {
    @Binding var kind: String?

    var body: some View {
        Menu {
            Picker("投稿タグ", selection: $kind) {
                Text("タグなし").tag(String?.none)
                Label("アイデア", systemImage: "sparkles").tag(String?.some("idea"))
                Label("バグ", systemImage: "ladybug").tag(String?.some("bug"))
            }
        } label: {
            ComposerChip(icon: kind == "bug" ? "ladybug" : "sparkles",
                         title: kind == "bug" ? "バグ" : kind == "idea" ? "アイデア" : "投稿タグ",
                         active: kind != nil)
        }
    }
}

private struct ComposerChip: View {
    let icon: String; let title: String
    var strong = false
    var active = false
    var body: some View {
        Label { Text(LocalizedStringKey(title)) } icon: { Image(systemName: icon) }
            .font(.caption.weight(.semibold)).foregroundColor(active ? SpotcodeTheme.accent : (strong ? SpotcodeTheme.text : SpotcodeTheme.muted))
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(active ? SpotcodeTheme.accent.opacity(0.12) : Color.clear).clipShape(Capsule())
            .overlay(Capsule().stroke(active ? SpotcodeTheme.accent : SpotcodeTheme.border, style: StrokeStyle(lineWidth: 1, dash: active ? [] : [5])))
    }
}

private final class ComposerLocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var spot: Spot?
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }
    func request() {
        manager.requestWhenInUseAuthorization()
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }
    func clear() { spot = nil }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        spot = Spot(lat: coordinate.latitude, lng: coordinate.longitude, label: "現在地", address: nil)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }
}

// Shared reader-location gate for every timeline row. One CLLocationManager
// serves For you, Following, profile and detail views, so dozens of visible
// rows never create competing permission/location requests. Following an
// author does not affect this check: a spot post unlocks only for its author
// or when this device is physically within 100 metres of the pin.
private final class PostLocationGate: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = PostLocationGate()
    @Published private(set) var location: CLLocation?
    private let manager = CLLocationManager()
    private var requested = false
    private let radius: CLLocationDistance = 100

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func request() {
        guard !requested else { return }
        requested = true
        manager.requestWhenInUseAuthorization()
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }

    func isNear(_ spot: Spot) -> Bool {
        guard let location else { return false }
        let destination = CLLocation(latitude: spot.lat, longitude: spot.lng)
        return location.distance(from: destination) <= radius
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let latest = locations.last else { return }
        location = latest
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }
}

private struct PhotoLibraryPicker: UIViewControllerRepresentable {
    @Binding var images: [String]
    @Environment(\.dismiss) private var dismiss
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .images
        configuration.selectionLimit = max(1, 4 - images.count)
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}
    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        var parent: PhotoLibraryPicker
        init(_ parent: PhotoLibraryPicker) { self.parent = parent }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard !results.isEmpty else { parent.dismiss(); return }
            let group = DispatchGroup()
            var loaded: [(Int, String)] = []
            let lock = NSLock()
            for (index, result) in results.enumerated() where result.itemProvider.canLoadObject(ofClass: UIImage.self) {
                group.enter()
                result.itemProvider.loadObject(ofClass: UIImage.self) { object, _ in
                    defer { group.leave() }
                    guard let image = object as? UIImage, let data = image.resizedForPost().jpegData(compressionQuality: 0.72) else { return }
                    lock.lock(); loaded.append((index, "data:image/jpeg;base64," + data.base64EncodedString())); lock.unlock()
                }
            }
            group.notify(queue: .main) {
                self.parent.images.append(contentsOf: loaded.sorted { $0.0 < $1.0 }.map(\.1))
                self.parent.images = Array(self.parent.images.prefix(4))
                self.parent.dismiss()
            }
        }
    }
}

private struct DataURLImage: View {
    let value: String
    var body: some View {
        Group {
            if let comma = value.firstIndex(of: ","), let data = Data(base64Encoded: String(value[value.index(after: comma)...])), let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else { Color(white: 0.15).overlay(Image(systemName: "photo")) }
        }
    }
}

private func decodedDataURLImage(_ value: String?) -> UIImage? {
    guard let value, value.lowercased().hasPrefix("data:image/"),
          let comma = value.firstIndex(of: ","),
          let data = Data(base64Encoded: String(value[value.index(after: comma)...])) else { return nil }
    return UIImage(data: data)
}

private struct ProfileImagePicker: UIViewControllerRepresentable {
    @Binding var image: String?
    @Environment(\.dismiss) private var dismiss
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}
    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        var parent: ProfileImagePicker
        init(_ parent: ProfileImagePicker) { self.parent = parent }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
                parent.dismiss(); return
            }
            provider.loadObject(ofClass: UIImage.self) { object, _ in
                guard let source = object as? UIImage,
                      let data = source.resizedForPost(maxSide: 256).jpegData(compressionQuality: 0.85) else {
                    DispatchQueue.main.async { self.parent.dismiss() }; return
                }
                DispatchQueue.main.async {
                    self.parent.image = "data:image/jpeg;base64," + data.base64EncodedString()
                    self.parent.dismiss()
                }
            }
        }
    }
}

private extension UIImage {
    func resizedForPost(maxSide: CGFloat = 1080) -> UIImage {
        let scale = min(1, maxSide / max(size.width, size.height))
        guard scale < 1 else { return self }
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        return UIGraphicsImageRenderer(size: target).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}

private struct PollEditorSheet: View {
    @Binding var poll: PostPoll?
    @Binding var isPresented: Bool
    @State private var question = ""
    @State private var first = ""
    @State private var second = ""
    var body: some View {
        NavigationView {
            VStack(spacing: 14) {
                TextField("質問", text: $question).spotcodeField()
                TextField("選択肢 1", text: $first).spotcodeField()
                TextField("選択肢 2", text: $second).spotcodeField()
                if poll != nil { Button("投票を削除", role: .destructive) { poll = nil; isPresented = false } }
                Spacer()
            }.padding().background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
                .navigationTitle("投票を作成").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Confirm") { poll = .init(question: question, options: [first, second]); isPresented = false }
                            .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || second.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .onAppear { question = poll?.question ?? ""; first = poll?.options.first ?? ""; second = poll?.options.dropFirst().first ?? "" }
        }.preferredColorScheme(.dark)
    }
}

private struct LocationPickerSheet: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("spotcode.native.dev-mode") private var developerMode = false
    @Binding var spot: Spot?
    @Binding var isPresented: Bool
    @StateObject private var location = ComposerLocationProvider()
    @State private var coordinate: CLLocationCoordinate2D?
    @State private var currentCoordinate: CLLocationCoordinate2D?
    @State private var label = ""
    @State private var address = "現在地を取得すると表示されます"
    @State private var locating = false
    @State private var mapRegion = MKCoordinateRegion(center: .init(latitude: 35.681236, longitude: 139.767125), span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006))
    @State private var adjustmentDenied = false

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Button {
                        locating = true
                        location.request()
                    } label: { Label("現在地を使う", systemImage: "location") }
                        .font(.subheadline.weight(.semibold)).padding(.horizontal, 12).padding(.vertical, 9)
                        .overlay(Capsule().stroke(SpotcodeTheme.border))
                    TextField("ラベル（任意・建物名や店名）", text: $label).spotcodeURLField()
                }.padding(14)
                HStack(spacing: 8) {
                    Image(systemName: "mappin.and.ellipse")
                    Text(statusText).font(.caption)
                    Spacer()
                }.foregroundColor(coordinate == nil ? SpotcodeTheme.muted : SpotcodeTheme.accent)
                    .padding(.horizontal, 16).padding(.vertical, 10).background(SpotcodeTheme.surface2)
                ZStack(alignment: .trailing) {
                    CurrentLocationMap(coordinate: $coordinate, currentCoordinate: currentCoordinate, region: $mapRegion, adjustmentDenied: $adjustmentDenied, unrestricted: developerMode && model.me?.isAdmin == true)
                    VStack(spacing: 8) {
                        pickerMapButton("plus") { pickerZoom(0.5) }
                        pickerMapButton("minus") { pickerZoom(2) }
                        pickerMapButton("location") { centerPickerMap() }
                    }.padding(.trailing, 12)
                }
                HStack(spacing: 12) {
                    HStack(spacing: 7) {
                        Text("住所").font(.caption).foregroundColor(SpotcodeTheme.muted)
                        Text(address).font(.caption).lineLimit(1)
                    }.padding(11).frame(maxWidth: .infinity, alignment: .leading)
                        .background(SpotcodeTheme.background).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
                    Button("削除") { spot = nil; isPresented = false }.foregroundColor(.red).disabled(spot == nil)
                }.padding(14)
            }
            .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
            .navigationTitle("場所を選ぶ").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Confirm") { confirm() }.disabled(coordinate == nil)
                }
            }
            .onAppear {
                coordinate = spot?.coordinate
                if let coordinate = spot?.coordinate {
                    mapRegion = .init(center: coordinate, span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006))
                }
                label = spot?.label ?? ""
                address = spot?.address ?? "現在地を取得すると表示されます"
                locating = true
                location.request()
            }
            .onChange(of: location.spot) { value in
                guard let value else { return }
                coordinate = value.coordinate
                currentCoordinate = value.coordinate
                mapRegion = .init(center: value.coordinate, span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006))
                locating = false
                reverseGeocode(value.coordinate)
            }
            .onChange(of: coordinate.map { "\($0.latitude),\($0.longitude)" }) { _ in
                if let coordinate { reverseGeocode(coordinate) }
            }
        }.preferredColorScheme(.dark)
    }

    private var statusText: String {
        if developerMode && model.me?.isAdmin == true { return "開発者モード: 地図上の任意の場所を選択できます。" }
        if locating { return "現在地を取得中… 取れるまで投稿はできません。" }
        if adjustmentDenied { return "現在地から300mを超えています。半径300m以内を選んでください。" }
        if coordinate != nil { return "現在地を基準に、地図タップで半径300m以内のポイントを調整できます。" }
        return "「現在地を使う」を押して場所を取得してください。"
    }
    private func confirm() {
        guard let coordinate else { return }
        let resolvedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        spot = Spot(lat: coordinate.latitude, lng: coordinate.longitude,
                    label: resolvedLabel.isEmpty ? "選択した場所" : resolvedLabel,
                    address: address == "現在地を取得すると表示されます" ? nil : address)
        isPresented = false
    }
    private func reverseGeocode(_ coordinate: CLLocationCoordinate2D) {
        CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)) { places, _ in
            guard let place = places?.first else { return }
            address = [place.postalCode, place.administrativeArea, place.locality, place.subLocality, place.thoroughfare, place.subThoroughfare]
                .compactMap { $0 }.joined(separator: " ")
        }
    }
    private func pickerZoom(_ multiplier: Double) {
        mapRegion.span.latitudeDelta = min(max(mapRegion.span.latitudeDelta * multiplier, 0.0005), 120)
        mapRegion.span.longitudeDelta = min(max(mapRegion.span.longitudeDelta * multiplier, 0.0005), 120)
    }
    private func centerPickerMap() {
        guard let currentCoordinate else { location.request(); locating = true; return }
        mapRegion = .init(center: currentCoordinate, span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006))
    }
    private func pickerMapButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).frame(width: 38, height: 38) }
            .background(SpotcodeTheme.surface.opacity(0.94)).foregroundColor(SpotcodeTheme.accent)
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(SpotcodeTheme.border)).clipShape(RoundedRectangle(cornerRadius: 9))
    }
}

private struct CurrentLocationMap: UIViewRepresentable {
    @Binding var coordinate: CLLocationCoordinate2D?
    let currentCoordinate: CLLocationCoordinate2D?
    @Binding var region: MKCoordinateRegion
    @Binding var adjustmentDenied: Bool
    let unrestricted: Bool
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.showsUserLocation = true
        map.isZoomEnabled = true
        map.isScrollEnabled = true
        map.delegate = context.coordinator
        map.setRegion(region, animated: false)
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.cancelsTouchesInView = false
        map.addGestureRecognizer(tap)
        context.coordinator.map = map
        return map
    }
    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        map.removeAnnotations(map.annotations.filter { !($0 is MKUserLocation) })
        if let coordinate {
            let pin = MKPointAnnotation(); pin.coordinate = coordinate
            map.addAnnotation(pin)
        }
        let spanChanged = abs(map.region.span.latitudeDelta - region.span.latitudeDelta) > 0.0001
        let centerChanged = abs(map.region.center.latitude - region.center.latitude) > 0.0001 || abs(map.region.center.longitude - region.center.longitude) > 0.0001
        let userIsTouchingMap = map.gestureRecognizers?.contains(where: { $0.state == .began || $0.state == .changed }) == true
        if !userIsTouchingMap && (spanChanged || centerChanged) { map.setRegion(region, animated: true) }
    }
    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: CurrentLocationMap
        weak var map: MKMapView?
        init(_ parent: CurrentLocationMap) { self.parent = parent }
        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            parent.region = mapView.region
        }
        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard gesture.state == .ended, let map, let origin = parent.currentCoordinate else { return }
            let picked = map.convert(gesture.location(in: map), toCoordinateFrom: map)
            let distance = CLLocation(latitude: origin.latitude, longitude: origin.longitude)
                .distance(from: CLLocation(latitude: picked.latitude, longitude: picked.longitude))
            if parent.unrestricted || distance <= 300 {
                parent.coordinate = picked
                parent.adjustmentDenied = false
            } else {
                parent.adjustmentDenied = true
            }
        }
    }
}

// TextEditor keeps an opaque system background on some iOS 15 builds even
// when SwiftUI's outer background is set. A native UITextView lets us apply
// the exact web composer surface (#21262d) to the actual editable layer.
private struct ComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = UIColor(red: 33/255, green: 38/255, blue: 45/255, alpha: 1)
        view.textColor = UIColor(red: 230/255, green: 237/255, blue: 243/255, alpha: 1)
        view.tintColor = UIColor(red: 29/255, green: 155/255, blue: 240/255, alpha: 1)
        view.font = .preferredFont(forTextStyle: .title3)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 13, left: 10, bottom: 13, right: 10)
        view.textContainer.lineFragmentPadding = 0
        view.keyboardDismissMode = .interactive
        view.layer.cornerRadius = 10
        view.clipsToBounds = true
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
        context.coordinator.parent = self
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextView
        init(_ parent: ComposerTextView) { self.parent = parent }
        func textViewDidChange(_ textView: UITextView) { parent.text = textView.text }
        func textViewDidBeginEditing(_ textView: UITextView) { parent.isFocused = true }
        func textViewDidEndEditing(_ textView: UITextView) { parent.isFocused = false }
    }
}

struct PostRow: View {
    @EnvironmentObject private var model: AppModel
    let post: Post
    var opensDetail = true
    @State private var editing = false
    @State private var confirmingDelete = false
    @State private var showSpotMap = false
    @State private var sharing = false
    @State private var reporting = false
    @State private var liked = false
    @State private var reposted = false
    @State private var bookmarked = false
    @State private var likeCount = 0
    @State private var repostCount: Int
    @State private var bookmarkCount: Int
    @State private var interactionInProgress: Set<String> = []
    @ObservedObject private var locationGate = PostLocationGate.shared
    @AppStorage("spotcode.native.dev-mode") private var developerMode = false

    init(post: Post, opensDetail: Bool = true) {
        self.post = post
        self.opensDetail = opensDetail
        _repostCount = State(initialValue: post.repostsCount ?? 0)
        _bookmarkCount = State(initialValue: post.bookmarksCount ?? 0)
    }

    private var canReadContent: Bool {
        guard let spot = post.spot else { return true }
        if post.authorID == model.me?.id { return true }
        if model.me?.isAdmin == true && developerMode { return true }
        return locationGate.isNear(spot)
    }

    private var canManagePost: Bool {
        post.authorID == model.displayProfile?.id || (
            developerMode && (model.me?.isAdmin == true || model.me?.isOperator == true)
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            NavigationLink(destination: ProfileLookupView(handle: post.author?.handle ?? "")) {
                AvatarView(profile: post.author, size: 42)
            }.buttonStyle(.plain).disabled(post.author?.handle == nil)
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
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        if let spot = post.spot {
                            Button { showSpotMap = true } label: {
                                PostMetadataBadge(icon: "mappin", text: spot.label ?? spot.address ?? "選択した場所", color: SpotcodeTheme.accent)
                            }.buttonStyle(.plain)
                        }
                        if post.kind == "idea" { PostMetadataBadge(icon: "sparkles", text: "アイデア", color: SpotcodeTheme.warning) }
                        if post.kind == "bug" { PostMetadataBadge(icon: "ladybug", text: "バグ", color: .red) }
                        PostMetadataBadge(icon: visibilityBadge(post.visibility ?? "public").icon, text: visibilityBadge(post.visibility ?? "public").text, color: SpotcodeTheme.muted)
                    }
                }
                if !canReadContent {
                    Label("この場所から半径100m以内に来ると内容を表示できます", systemImage: "location.slash")
                        .font(.subheadline).foregroundColor(SpotcodeTheme.muted)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 9))
                } else {
                    Text(post.body).foregroundColor(SpotcodeTheme.text).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if canReadContent, let photos = post.photos, !photos.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) { ForEach(photos, id: \.self) { DataURLImage(value: $0).frame(width: 180, height: 140).clipShape(RoundedRectangle(cornerRadius: 10)) } }
                    }
                }
                if canReadContent, let poll = post.poll {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(poll.question, systemImage: "chart.bar").font(.subheadline.weight(.bold))
                        ForEach(poll.options, id: \.self) { option in
                            Text(option).padding(.horizontal, 12).padding(.vertical, 9).frame(maxWidth: .infinity, alignment: .leading)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
                        }
                    }.padding(10).background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                if canReadContent, let link = post.githubLink, let url = URL(string: link) {
                    Link(destination: url) {
                        HStack(spacing: 5) {
                            Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13)
                            Text(githubLinkLabel(link)).lineLimit(1)
                        }.font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if canReadContent, let link = post.eventURL, let url = URL(string: link) {
                    Link(destination: url) {
                        Label("イベントを開く", systemImage: "calendar")
                            .font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if canReadContent {
                    HStack(spacing: 0) {
                        NavigationLink(destination: PostDetailView(post: post)) {
                            PostAction(icon: "bubble.left", count: post.commentsCount ?? 0)
                        }.buttonStyle(.plain); Spacer()
                        Button { toggleInteraction("reposts") } label: {
                            PostAction(icon: reposted ? "arrow.2.squarepath" : "arrow.2.squarepath", count: repostCount)
                        }.buttonStyle(.plain).disabled(interactionInProgress.contains("reposts")); Spacer()
                        Button { toggleInteraction("bookmarks") } label: {
                            PostAction(icon: bookmarked ? "star.fill" : "star", count: bookmarkCount)
                        }.buttonStyle(.plain).foregroundColor(bookmarked ? SpotcodeTheme.warning : SpotcodeTheme.muted)
                            .disabled(interactionInProgress.contains("bookmarks")); Spacer()
                        Button { toggleInteraction("likes") } label: {
                            PostAction(icon: liked ? "heart.fill" : "heart", count: likeCount)
                        }.buttonStyle(.plain).foregroundColor(liked ? .pink : SpotcodeTheme.muted)
                            .disabled(interactionInProgress.contains("likes")); Spacer()
                        Button { sharing = true } label: {
                            Image(systemName: "square.and.arrow.up")
                        }.buttonStyle(.plain)
                        if post.authorID != model.me?.id {
                            Spacer()
                            Button { reporting = true } label: {
                                Image(systemName: "flag")
                            }.buttonStyle(.plain).accessibilityLabel("投稿を報告")
                        }
                        if canManagePost {
                            Spacer()
                            NavigationLink(destination: PostDetailView(post: post)) {
                                Image(systemName: "chart.bar")
                            }.buttonStyle(.plain).accessibilityLabel("投稿の分析")
                            Spacer()
                            Button { editing = true } label: { Image(systemName: "pencil") }
                                .buttonStyle(.plain).accessibilityLabel("投稿を編集")
                            Spacer()
                            Button { confirmingDelete = true } label: { Image(systemName: "trash") }
                                .buttonStyle(.plain).accessibilityLabel("投稿を削除")
                        }
                    }
                    .font(.system(size: 15)).foregroundColor(SpotcodeTheme.muted).padding(.top, 7)
                }
            }
        }
        .padding(16).background(SpotcodeTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
        .overlay {
            if opensDetail {
                HStack(spacing: 0) {
                    Color.clear.frame(width: 70).allowsHitTesting(false)
                    NavigationLink(destination: PostDetailView(post: post)) {
                        Color.clear.contentShape(Rectangle())
                    }
                    // Keep the metadata row above this transparent detail
                    // link so the location badge can open its focused map.
                    .buttonStyle(.plain).padding(.top, 96).padding(.bottom, 44)
                }
            }
        }
        .sheet(isPresented: $editing) { EditPostView(post: post, isPresented: $editing).environmentObject(model) }
        .sheet(isPresented: $showSpotMap) {
            NavigationView {
                NativeMapView(focusPost: post)
                    .navigationTitle(post.spot?.label ?? "Spot")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { showSpotMap = false } } }
            }
        }
        .sheet(isPresented: $sharing) {
            ActivityShareSheet(items: [URL(string: "https://hrmc.ngs.computer/post/\(post.id.uuidString)")!])
        }
        .sheet(isPresented: $reporting) {
            ReportPostView(post: post, isPresented: $reporting).environmentObject(model)
        }
        .onAppear { if post.spot != nil { locationGate.request() } }
        .task(id: post.id) { await loadInteractions() }
        .confirmationDialog("この投稿を削除しますか？", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("削除", role: .destructive) { Task { _ = await model.deletePost(post) } }
            Button("キャンセル", role: .cancel) {}
        }
    }

    private func visibilityBadge(_ value: String) -> (icon: String, text: String) {
        switch value {
        case "public": return ("globe", "全員に公開")
        case "mutuals": return ("arrow.2.squarepath", "相互フォロー")
        case "following": return ("person.badge.plus", "フォロー中")
        case "friends": return ("heart", "親しい友達")
        case "org": return ("building.2", "同じ組織")
        default: return ("lock", "限定公開")
        }
    }

    private func loadInteractions() async {
        guard let token = model.session?.accessToken, let userID = model.me?.id else { return }
        async let likeState = try? SupabaseService.shared.postInteractionState(table: "likes", postID: post.id, userID: userID, token: token)
        async let repostState = try? SupabaseService.shared.postInteractionState(table: "reposts", postID: post.id, userID: userID, token: token)
        async let bookmarkState = try? SupabaseService.shared.postInteractionState(table: "bookmarks", postID: post.id, userID: userID, token: token)
        if let state = await likeState { liked = state.mine; likeCount = state.count }
        if let state = await repostState { reposted = state.mine; repostCount = max(post.repostsCount ?? 0, state.count) }
        if let state = await bookmarkState { bookmarked = state.mine; bookmarkCount = max(post.bookmarksCount ?? 0, state.count) }
    }

    private func toggleInteraction(_ table: String) {
        guard let token = model.session?.accessToken, let userID = model.me?.id else {
            model.errorMessage = "ログインしてください"
            return
        }
        guard !interactionInProgress.contains(table) else { return }
        interactionInProgress.insert(table)
        Task {
            defer { interactionInProgress.remove(table) }
            do {
                let current = table == "likes" ? liked : table == "reposts" ? reposted : bookmarked
                let active = try await SupabaseService.shared.togglePostInteraction(
                    table: table, postID: post.id, userID: userID, active: current, token: token
                )
                let delta = active ? 1 : -1
                if table == "likes" { liked = active; likeCount = max(0, likeCount + delta) }
                else if table == "reposts" { reposted = active; repostCount = max(0, repostCount + delta) }
                else { bookmarked = active; bookmarkCount = max(0, bookmarkCount + delta) }
            } catch {
                model.errorMessage = error.localizedDescription
            }
        }
    }
}

private struct ReportPostView: View {
    @EnvironmentObject private var model: AppModel
    let post: Post
    @Binding var isPresented: Bool
    @State private var reason = "spam"
    @State private var comment = ""
    @State private var submitting = false

    private let reasons = [
        ("spam", "スパム / 宣伝"),
        ("inappropriate", "不適切な内容"),
        ("harassment", "嫌がらせ / ヘイト"),
        ("misinfo", "誤情報"),
        ("other", "その他")
    ]

    var body: some View {
        NavigationView {
            Form {
                Section("報告する理由") {
                    Picker("理由", selection: $reason) {
                        ForEach(reasons, id: \.0) { value, label in
                            Text(LocalizedStringKey(label)).tag(value)
                        }
                    }.pickerStyle(.inline).labelsHidden()
                }
                Section("追加のコメント（任意）") {
                    TextEditor(text: $comment).frame(minHeight: 100)
                    Text("400文字まで").font(.caption).foregroundColor(SpotcodeTheme.muted)
                }
            }
            .navigationTitle("投稿を報告")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { isPresented = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("送信") { submit() }.disabled(submitting)
                }
            }
        }
    }

    private func submit() {
        guard let token = model.session?.accessToken, let reporterID = model.me?.id else {
            model.errorMessage = "ログインしてください"
            return
        }
        submitting = true
        Task {
            defer { submitting = false }
            do {
                try await SupabaseService.shared.reportPost(
                    postID: post.id, reporterID: reporterID, reason: reason,
                    comment: comment, token: token
                )
                isPresented = false
            } catch {
                model.errorMessage = error.localizedDescription
            }
        }
    }
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private struct PostAction: View {
    let icon: String
    let count: Int
    var body: some View { HStack(spacing: 5) { Image(systemName: icon); Text("\(count)") } }
}

private struct EditPostView: View {
    @EnvironmentObject private var model: AppModel
    let post: Post
    @Binding var isPresented: Bool
    @State private var bodyText: String
    @State private var githubLink: String
    @State private var repoFullName: String
    @State private var eventURL: String
    @State private var postKind: String?
    @State private var visibility: String
    @State private var saving = false
    @State private var editorFocused = false

    init(post: Post, isPresented: Binding<Bool>) {
        self.post = post
        _isPresented = isPresented
        _bodyText = State(initialValue: post.body)
        _githubLink = State(initialValue: post.githubLink ?? "")
        _repoFullName = State(initialValue: post.repoFullName ?? "")
        _eventURL = State(initialValue: post.eventURL ?? "")
        _postKind = State(initialValue: post.kind)
        _visibility = State(initialValue: post.visibility ?? "public")
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                ComposerTextView(text: $bodyText, isFocused: $editorFocused)
                    .frame(minHeight: 180)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(editorFocused ? SpotcodeTheme.accent : SpotcodeTheme.border, lineWidth: 2))
                HStack {
                    Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 16, height: 16)
                    TextField("https://github.com/…", text: $githubLink)
                        .textInputAutocapitalization(.never).keyboardType(.URL)
                }.spotcodeURLField()
                HStack {
                    Image(systemName: "shippingbox")
                    TextField("owner/repository（任意）", text: $repoFullName)
                        .textInputAutocapitalization(.never).autocorrectionDisabled(true)
                }.spotcodeURLField()
                HStack(spacing: 10) {
                    PostKindPicker(kind: $postKind)
                    Picker("公開範囲", selection: $visibility) {
                        Text("全員").tag("public")
                        Text("フォロー中").tag("following")
                        Text("相互フォロー").tag("mutuals")
                        Text("親しい友達").tag("friends")
                        Text("同じ組織").tag("org")
                    }.pickerStyle(.menu)
                    Spacer()
                }
                HStack {
                    Image(systemName: "calendar")
                    TextField("イベントURL（任意）", text: $eventURL)
                        .textInputAutocapitalization(.never).keyboardType(.URL)
                }.spotcodeURLField()
                Spacer()
            }
            .padding().background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
            .navigationTitle("投稿を編集").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        saving = true
                        Task {
                            let text = bodyText.trimmingCharacters(in: .whitespacesAndNewlines)
                            let link = githubLink.trimmingCharacters(in: .whitespacesAndNewlines)
                            let repository = repoFullName.trimmingCharacters(in: .whitespacesAndNewlines)
                            let event = eventURL.trimmingCharacters(in: .whitespacesAndNewlines)
                            if await model.editPost(
                                post, body: text, githubLink: link.isEmpty ? nil : link,
                                repoFullName: repository.isEmpty ? nil : repository,
                                eventURL: event.isEmpty ? nil : event,
                                kind: postKind, visibility: visibility
                            ) != nil {
                                isPresented = false
                            }
                            saving = false
                        }
                    }.disabled(saving || bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }.preferredColorScheme(.dark)
    }
}

private struct PostMetadataBadge: View {
    let icon: String
    let text: String
    let color: Color
    var body: some View {
        Label { Text(LocalizedStringKey(text)) } icon: { Image(systemName: icon) }
            .font(.caption2.weight(.semibold)).foregroundColor(color)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(color.opacity(0.12)).overlay(Capsule().stroke(color.opacity(0.55))).clipShape(Capsule())
    }
}

struct AvatarView: View {
    let profile: Profile?
    var size: CGFloat = 42
    var body: some View {
        Group {
            if let image = decodedDataURLImage(profile?.avatarURL) {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let url = profile?.avatarURL.flatMap(URL.init(string:)), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { avatarFallback }
                }
            } else { avatarFallback }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: profile?.avatarShape == "square" ? size * 0.2 : size / 2))
    }

    private var avatarFallback: some View {
        ZStack {
            LinearGradient(colors: [SpotcodeTheme.accent, Color(red: 46/255, green: 160/255, blue: 67/255)], startPoint: .topLeading, endPoint: .bottomTrailing)
            Text(String(profile?.name.first ?? "?"))
                .font(.system(size: max(13, size * 0.4), weight: .bold, design: .rounded))
                .foregroundColor(.white)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
    }
}

struct PostDetailView: View {
    let post: Post
    var body: some View {
        ScrollView { PostRow(post: post, opensDetail: false) }
            .background(SpotcodeTheme.surface).navigationTitle("Post").navigationBarTitleDisplayMode(.inline)
    }
}

struct ComposeView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @State private var bodyText = ""
    @State private var githubLink = ""
    @State private var repoFullName = ""
    @State private var eventURL = ""
    @State private var sending = false
    @State private var editorFocused = false
    @State private var showLink = false
    @State private var showEvent = false
    @State private var postKind: String? = nil
    @State private var visibility = "public"
    @State private var selectedSpot: Spot?
    @State private var photos: [String] = []
    @State private var poll: PostPoll?
    @State private var showLocationPicker = false
    @State private var showPhotoPicker = false
    @State private var showPollEditor = false

    init(isPresented: Binding<Bool>, initialGitHubLink: String = "") {
        _isPresented = isPresented
        _githubLink = State(initialValue: initialGitHubLink)
        _repoFullName = State(initialValue: githubRepositoryName(from: initialGitHubLink) ?? "")
        _showLink = State(initialValue: !initialGitHubLink.isEmpty)
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top, spacing: 12) {
                        AvatarView(profile: model.displayProfile, size: 42)
                        ZStack(alignment: .topLeading) {
                            ComposerTextView(text: $bodyText, isFocused: $editorFocused).frame(minHeight: 160)
                            if bodyText.isEmpty {
                                Text("いまどうしてる？").font(.title3).foregroundColor(SpotcodeTheme.muted)
                                    .padding(.horizontal, 14).padding(.vertical, 17).allowsHitTesting(false)
                            }
                        }
                        .background(SpotcodeTheme.inputSurface)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(editorFocused ? SpotcodeTheme.accent : SpotcodeTheme.border, lineWidth: 2))
                    }

                    VStack(alignment: .leading, spacing: 9) {
                        HStack(spacing: 8) {
                            Button { showLocationPicker = true } label: {
                                ComposerChip(icon: "mappin", title: selectedSpot?.label ?? "場所を追加", active: selectedSpot != nil)
                            }
                            Button { showLink.toggle() } label: { ComposerChip(icon: "link", title: "リンクを追加", active: showLink) }
                        }
                        HStack(spacing: 8) {
                            Button { showEvent.toggle() } label: { ComposerChip(icon: "calendar", title: "イベントを追加", active: showEvent) }
                            PostKindPicker(kind: $postKind)
                            audienceMenu
                        }
                    }

                    if showLink {
                        HStack {
                            Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 16, height: 16)
                            TextField("https://github.com/…", text: $githubLink).textInputAutocapitalization(.never).keyboardType(.URL)
                        }.spotcodeURLField()
                        HStack {
                            Image(systemName: "shippingbox")
                            TextField("owner/repository（任意）", text: $repoFullName).textInputAutocapitalization(.never).autocorrectionDisabled(true)
                        }.spotcodeURLField()
                    }
                    if showEvent {
                        HStack {
                            Image(systemName: "calendar")
                            TextField("イベントURL（任意）", text: $eventURL).textInputAutocapitalization(.never).keyboardType(.URL)
                        }.spotcodeURLField()
                    }
                    if !photos.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack {
                                ForEach(Array(photos.enumerated()), id: \.offset) { index, value in
                                    ZStack(alignment: .topTrailing) {
                                        DataURLImage(value: value).frame(width: 90, height: 90).clipShape(RoundedRectangle(cornerRadius: 9))
                                        Button { photos.remove(at: index) } label: { Image(systemName: "xmark.circle.fill") }
                                    }
                                }
                            }
                        }
                    }
                    if let poll { Label("投票: \(poll.question)", systemImage: "chart.bar").foregroundColor(SpotcodeTheme.accent) }

                    HStack(spacing: 28) {
                        Button { showPhotoPicker = true } label: { Image(systemName: "photo") }
                        Button { insertCodeBlock() } label: { Image(systemName: "chevron.left.forwardslash.chevron.right") }
                        Button { showLocationPicker = true } label: { Image(systemName: "mappin.circle") }
                        Button { showPollEditor = true } label: { Image(systemName: "chart.bar") }
                    }.font(.title3).foregroundColor(SpotcodeTheme.accent).padding(.leading, 54)
                }
                .padding()
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
             .navigationTitle("New idea").navigationBarTitleDisplayMode(.inline)
             .toolbar {
                 ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } }
                 ToolbarItem(placement: .confirmationAction) {
                     Button(sending ? "Posting…" : "Post") {
                         publish()
                     }.disabled(bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                 }
             }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showLocationPicker) { LocationPickerSheet(spot: $selectedSpot, isPresented: $showLocationPicker) }
        .sheet(isPresented: $showPhotoPicker) { PhotoLibraryPicker(images: $photos) }
        .sheet(isPresented: $showPollEditor) { PollEditorSheet(poll: $poll, isPresented: $showPollEditor) }
    }

    private var audienceMenu: some View {
        Menu {
            audienceButton("全員", value: "public")
            audienceButton("相互フォロー", value: "mutuals")
            audienceButton("フォロー中", value: "following")
            audienceButton("親しい友達", value: "friends")
            audienceButton("同じ組織", value: "org")
        } label: {
            ComposerChip(icon: visibilityIcon, title: visibilityLabel, strong: true, active: visibility != "public")
        }
    }

    private func audienceButton(_ title: String, value: String) -> some View {
        Button { visibility = value } label: {
            if visibility == value {
                Label { Text(LocalizedStringKey(title)) } icon: { Image(systemName: "checkmark") }
            } else {
                Text(LocalizedStringKey(title))
            }
        }
    }

    private var visibilityLabel: String {
        ["public":"全員", "mutuals":"相互フォロー", "following":"フォロー中", "friends":"親しい友達", "org":"同じ組織"][visibility] ?? "全員"
    }

    private var visibilityIcon: String {
        ["public":"globe", "mutuals":"arrow.2.squarepath", "following":"person.badge.plus", "friends":"heart", "org":"building.2"][visibility] ?? "globe"
    }

    private func insertCodeBlock() {
        if !bodyText.isEmpty && !bodyText.hasSuffix("\n") { bodyText += "\n" }
        bodyText += "```\nコードを入力\n```\n"
        editorFocused = true
    }

    private func publish() {
        sending = true
        Task {
            let link = githubLink.trimmingCharacters(in: .whitespacesAndNewlines)
            let repository = repoFullName.trimmingCharacters(in: .whitespacesAndNewlines)
            let event = eventURL.trimmingCharacters(in: .whitespacesAndNewlines)
            if await model.publish(
                body: bodyText.trimmingCharacters(in: .whitespacesAndNewlines),
                githubLink: link.isEmpty ? nil : link,
                repoFullName: repository.isEmpty ? nil : repository,
                eventURL: event.isEmpty ? nil : event,
                spot: selectedSpot,
                kind: postKind,
                visibility: visibility,
                photos: photos.isEmpty ? nil : photos,
                poll: poll
            ) { isPresented = false }
            sending = false
        }
    }
}

struct NativeMapView: View {
    @EnvironmentObject private var model: AppModel
    var focusPost: Post? = nil
    @State private var posts: [Post] = []
    @State private var region: MKCoordinateRegion
    @State private var selectedPost: Post?
    @State private var loading = false
    @StateObject private var location = ComposerLocationProvider()

    init(focusPost: Post? = nil) {
        self.focusPost = focusPost
        let center = focusPost?.spot?.coordinate ?? .init(latitude: 35.681236, longitude: 139.767125)
        _region = State(initialValue: .init(center: center, span: .init(latitudeDelta: 0.003, longitudeDelta: 0.003)))
    }

    var body: some View {
        ZStack(alignment: .trailing) {
            ClusteredPostMap(posts: posts, region: $region, selectedPost: $selectedPost)
            VStack(spacing: 8) {
                mapButton("plus") { zoom(0.5) }
                mapButton("minus") { zoom(2) }
                mapButton("arrow.counterclockwise") { resetMap() }
            }
            .padding(.trailing, 12)
            if loading { ProgressView().padding(10).background(.ultraThinMaterial).clipShape(Circle()) }
        }.task {
            guard posts.isEmpty else { return }
            location.request()
            loading = true; defer { loading = false }
            posts = (try? await SupabaseService.shared.spottedPosts(token: model.session?.accessToken)) ?? []
            if let focusPost, !posts.contains(where: { $0.id == focusPost.id }) { posts.append(focusPost) }
            if let coordinate = focusPost?.spot?.coordinate {
                region = .init(center: coordinate, span: .init(latitudeDelta: 0.003, longitudeDelta: 0.003))
            }
        }
        .onChange(of: location.spot) { value in
            guard focusPost == nil else { return }
            guard let coordinate = value?.coordinate else { return }
            region = .init(center: coordinate, span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006))
        }
        .sheet(item: $selectedPost) { post in
            NavigationView { PostDetailView(post: post) }
        }
    }

    private func zoom(_ multiplier: Double) {
        region.span.latitudeDelta = min(max(region.span.latitudeDelta * multiplier, 0.002), 120)
        region.span.longitudeDelta = min(max(region.span.longitudeDelta * multiplier, 0.002), 120)
    }
    private func resetMap() {
        if let coordinate = location.spot?.coordinate { region.center = coordinate }
        else { location.request() }
        region.span = .init(latitudeDelta: 0.006, longitudeDelta: 0.006)
    }
    private func mapButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: icon).frame(width: 38, height: 38) }
            .background(SpotcodeTheme.surface.opacity(0.94)).foregroundColor(SpotcodeTheme.accent)
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(SpotcodeTheme.border)).clipShape(RoundedRectangle(cornerRadius: 9))
    }
}

private struct ClusteredPostMap: UIViewRepresentable {
    let posts: [Post]
    @Binding var region: MKCoordinateRegion
    @Binding var selectedPost: Post?

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.isZoomEnabled = true
        map.isScrollEnabled = true
        map.isRotateEnabled = true
        map.isPitchEnabled = false
        map.showsUserLocation = true
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "post")
        map.setRegion(region, animated: false)
        return map
    }
    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        let wanted = Set(posts.map { $0.id.uuidString })
        let current = Set(map.annotations.compactMap { ($0 as? PostMapAnnotation)?.post.id.uuidString })
        if wanted != current {
            map.removeAnnotations(map.annotations.filter { !($0 is MKUserLocation) })
            map.addAnnotations(posts.compactMap { post in
                guard let coordinate = post.spot?.coordinate else { return nil }
                return PostMapAnnotation(post: post, coordinate: coordinate)
            })
        }
        let latitudeChanged = abs(map.region.span.latitudeDelta - region.span.latitudeDelta) > 0.0001
        let centerChanged = abs(map.region.center.latitude - region.center.latitude) > 0.0001 || abs(map.region.center.longitude - region.center.longitude) > 0.0001
        let userIsTouchingMap = map.gestureRecognizers?.contains(where: { $0.state == .began || $0.state == .changed }) == true
        if !userIsTouchingMap && (latitudeChanged || centerChanged) { map.setRegion(region, animated: true) }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: ClusteredPostMap
        init(_ parent: ClusteredPostMap) { self.parent = parent }
        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let postAnnotation = annotation as? PostMapAnnotation else { return nil }
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: "post", for: postAnnotation) as! MKMarkerAnnotationView
            view.markerTintColor = UIColor(red: 29/255, green: 155/255, blue: 240/255, alpha: 1)
            view.glyphImage = UIImage(systemName: "lightbulb.fill")
            view.clusteringIdentifier = "spotcode-post"
            view.canShowCallout = true
            view.rightCalloutAccessoryView = UIButton(type: .detailDisclosure)
            return view
        }
        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            parent.region = mapView.region
        }
        func mapView(_ mapView: MKMapView, annotationView view: MKAnnotationView, calloutAccessoryControlTapped control: UIControl) {
            if let annotation = view.annotation as? PostMapAnnotation { parent.selectedPost = annotation.post }
        }
    }
}

private final class PostMapAnnotation: NSObject, MKAnnotation {
    let post: Post
    let coordinate: CLLocationCoordinate2D
    var title: String? { post.spot?.label ?? post.author?.name ?? "Spot" }
    // Never expose the protected post body in an annotation callout.
    // PostDetailView applies the 100m gate after the user opens it.
    var subtitle: String? { "この場所の投稿" }
    init(post: Post, coordinate: CLLocationCoordinate2D) { self.post = post; self.coordinate = coordinate }
}

struct RepositoriesView: View {
    @EnvironmentObject private var model: AppModel
    let onCompose: (URL) -> Void
    @State private var repositories: [Repository] = []
    @State private var relatedPosts: [Post] = []
    @State private var loading = false
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 6) {
                    RepoMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: 22, height: 22).foregroundColor(SpotcodeTheme.accent)
                    Text("Repos").font(.title3).fontWeight(.bold)
                    Text("自分の GitHub リポジトリの動きを見る。")
                        .font(.subheadline).foregroundColor(SpotcodeTheme.muted)
                }.frame(maxWidth: .infinity).padding(.vertical, 22)
                if loading && repositories.isEmpty { ProgressView("リポジトリを読み込み中…").padding(.top, 50) }
            else if model.me?.githubHandle == nil { Spacer(); ContentUnavailableViewCompat(title: "GitHubをプロフィールに連携してください", icon: "link"); Spacer() }
            else {
                LazyVStack(spacing: 12) {
                    ForEach(repositories) { repo in
                        repositoryCard(repo)
                    }
                }.padding(.horizontal, 10).padding(.bottom, 20)
            }
            }.refreshable { await load() }
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true).task { await load() }
    }

    @ViewBuilder private func repositoryCard(_ repo: Repository) -> some View {
        let posts = relatedPosts.filter { repositoryName(for: $0)?.caseInsensitiveCompare(repo.fullName) == .orderedSame }
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Link(destination: repo.htmlURL) {
                    HStack(spacing: 6) {
                        Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13)
                        Text(repo.fullName.split(separator: "/").first.map(String.init) ?? "")
                            .foregroundColor(SpotcodeTheme.muted)
                        Text("/").foregroundColor(SpotcodeTheme.muted)
                        Text(repo.name).fontWeight(.bold)
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                Spacer(minLength: 8)
                Button { onCompose(repo.htmlURL) } label: {
                    Label("このリポで投稿", systemImage: "plus")
                        .font(.caption).padding(.horizontal, 10).padding(.vertical, 5)
                        .foregroundColor(SpotcodeTheme.accent)
                        .overlay(Capsule().stroke(SpotcodeTheme.accent.opacity(0.55)))
                }
            }
            if let description = repo.description, !description.isEmpty {
                Text(description).font(.subheadline)
            }
            HStack(spacing: 12) {
                if let language = repo.language {
                    HStack(spacing: 5) { Circle().fill(languageColor(language)).frame(width: 10, height: 10); Text(language) }
                }
                if repo.stars > 0 { Label("\(repo.stars)", systemImage: "star") }
                if let pushedAt = repo.pushedAt { Text(relativeTime(pushedAt)) }
            }.font(.caption).foregroundColor(SpotcodeTheme.muted)
            Divider().overlay(SpotcodeTheme.border)
            if posts.isEmpty {
                Text("関連投稿はありません").font(.caption).foregroundColor(SpotcodeTheme.muted)
            } else {
                Text("関連投稿 \(posts.count)件").font(.caption).fontWeight(.semibold).foregroundColor(SpotcodeTheme.muted)
                ForEach(posts.prefix(4)) { post in
                    NavigationLink(destination: PostDetailView(post: post)) {
                        HStack(spacing: 8) {
                            AvatarView(profile: post.author, size: 24)
                            Text(post.body).font(.caption).lineLimit(1).foregroundColor(SpotcodeTheme.text)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption2).foregroundColor(SpotcodeTheme.muted)
                        }
                    }
                }
            }
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(SpotcodeTheme.surface)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
    }

    private func load() async {
        guard let handle = model.me?.githubHandle else { return }
        loading = true; defer { loading = false }
        let loaded = (try? await SupabaseService.shared.repositories(handle: handle)) ?? []
        repositories = loaded.sorted { ($0.pushedAt ?? "") > ($1.pushedAt ?? "") }
        relatedPosts = (try? await SupabaseService.shared.posts(limit: 200, token: model.session?.accessToken)) ?? []
    }

    private func repositoryName(for post: Post) -> String? {
        if let value = post.repoFullName, !value.isEmpty { return value }
        guard let raw = post.githubLink, let url = URL(string: raw), url.host?.lowercased() == "github.com" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count >= 2 else { return nil }
        return "\(parts[0])/\(parts[1].replacingOccurrences(of: ".git", with: ""))"
    }

    private func languageColor(_ language: String) -> Color {
        switch language.lowercased() {
        case "javascript": return .yellow
        case "typescript": return .blue
        case "swift", "java": return .orange
        case "python": return Color(red: 0.25, green: 0.48, blue: 0.72)
        case "shell": return .green
        default: return SpotcodeTheme.muted
        }
    }
}

struct NotificationsView: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("spotcode.notifications.likes") private var likesEnabled = true
    @AppStorage("spotcode.notifications.comments") private var commentsEnabled = true
    @AppStorage("spotcode.notifications.mentions") private var mentionsEnabled = true
    @AppStorage("spotcode.notifications.follows") private var followsEnabled = true
    @State private var notifications: [AppNotification] = []
    @State private var loading = false
    var body: some View {
        VStack(spacing: 0) {
            PageHeader(title: "Notifications")
            if loading && notifications.isEmpty { Spacer(); ProgressView("通知を読み込み中…"); Spacer() }
            else if notifications.isEmpty { Spacer(); ContentUnavailableViewCompat(title: "通知はありません", icon: "bell"); Spacer() }
            else { ScrollView { LazyVStack(spacing: 0) { ForEach(notifications) { notification in
                NotificationRow(notification: notification) {
                    await respond(to: notification, accept: $0)
                }
            }}}.refreshable { await load() } }
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true).task { await load() }
    }
    private func load() async {
        guard let id = model.me?.id else { return }
        loading = true; defer { loading = false }
        do {
            var session = try await model.validSession()
            do {
                notifications = filterNotifications(try await SupabaseService.shared.notifications(
                    userID: id, handle: model.me?.handle ?? "", token: session.accessToken
                ))
            } catch where AppModel.isExpiredSessionError(error) {
                session = try await model.validSession(forceRefresh: true)
                notifications = filterNotifications(try await SupabaseService.shared.notifications(
                    userID: id, handle: model.me?.handle ?? "", token: session.accessToken
                ))
            }
        } catch {
            model.errorMessage = AppModel.isExpiredSessionError(error)
                ? "ログインの有効期限が切れました。もう一度ログインしてください。"
                : error.localizedDescription
        }
    }

    private func filterNotifications(_ values: [AppNotification]) -> [AppNotification] {
        values.filter { value in
            switch value.kind {
            case .like: return likesEnabled
            case .comment: return commentsEnabled
            case .mention: return mentionsEnabled
            case .follow, .followRequest: return followsEnabled
            }
        }
    }

    private func respond(to notification: AppNotification, accept: Bool) async {
        guard let followerID = notification.actor.id, let targetID = model.me?.id else { return }
        do {
            let session = try await model.validSession()
            try await SupabaseService.shared.respondToFollowRequest(
                followerID: followerID, targetID: targetID, accept: accept, token: session.accessToken
            )
            await load()
        } catch { model.errorMessage = error.localizedDescription }
    }
}

private struct NotificationRow: View {
    let notification: AppNotification
    let respond: (Bool) async -> Void
    @State private var responding = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                NavigationLink(destination: ProfileLookupView(handle: notification.actor.handle)) {
                    AvatarView(profile: notification.actor, size: 44)
                }.buttonStyle(.plain)
                Image(systemName: icon).font(.system(size: 10, weight: .bold)).foregroundColor(.white)
                    .frame(width: 20, height: 20).background(badgeColor).clipShape(Circle())
                    .overlay(Circle().stroke(SpotcodeTheme.surface, lineWidth: 2))
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(notification.actor.name).fontWeight(.bold)
                    Text("@\(notification.actor.handle)").foregroundColor(SpotcodeTheme.muted)
                    Spacer(minLength: 4)
                    if let date = notification.createdAt { Text(relativeTime(date)).font(.caption).foregroundColor(SpotcodeTheme.muted) }
                }
                Text(LocalizedStringKey(label)).font(.subheadline).foregroundColor(SpotcodeTheme.muted)
                if let context = notification.context ?? notification.post?.body, !context.isEmpty {
                    Text(context).font(.subheadline).lineLimit(3).padding(9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                if notification.kind == .followRequest {
                    HStack {
                        Button("承認") { act(true) }.buttonStyle(OutlineButtonStyle(filled: true))
                        Button("拒否") { act(false) }.buttonStyle(OutlineButtonStyle())
                    }.disabled(responding)
                } else if let post = notification.post {
                    NavigationLink("投稿を見る", destination: PostDetailView(post: post))
                        .font(.caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent)
                }
            }
        }
        .padding(16)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }

    private var label: String {
        switch notification.kind {
        case .like: return "あなたの投稿にいいねしました"
        case .comment: return "あなたの投稿にコメントしました"
        case .mention: return "あなたをメンションしました"
        case .follow: return "あなたをフォローしました"
        case .followRequest: return "フォローをリクエストしました"
        }
    }
    private var icon: String {
        switch notification.kind {
        case .like: return "heart.fill"
        case .comment: return "bubble.left.fill"
        case .mention: return "at"
        case .follow, .followRequest: return "person.fill"
        }
    }
    private var badgeColor: Color {
        switch notification.kind {
        case .like: return .pink
        case .comment: return .green
        case .mention: return .purple
        case .follow, .followRequest: return SpotcodeTheme.accent
        }
    }
    private func act(_ accept: Bool) {
        responding = true
        Task { await respond(accept); responding = false }
    }
}

private struct ProfileLookupView: View {
    @EnvironmentObject private var model: AppModel
    let handle: String
    @State private var profile: Profile?
    @State private var loading = true
    var body: some View {
        Group {
            if let profile { ProfileView(profile: profile) }
            else if loading { ProgressView("プロフィールを読み込み中…") }
            else { ContentUnavailableViewCompat(title: "プロフィールを取得できませんでした", icon: "person.crop.circle.badge.exclamationmark") }
        }
        .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
        .background(SwipeBackEnabler())
        .task {
            guard !handle.isEmpty else { loading = false; return }
            if model.displayProfile?.handle.caseInsensitiveCompare(handle) == .orderedSame { profile = model.displayProfile }
            else { profile = try? await SupabaseService.shared.profile(handle: handle, token: model.session?.accessToken) }
            loading = false
        }
    }
}

struct ProfileView: View {
    @EnvironmentObject private var model: AppModel
    let profile: Profile?
    @State private var profilePosts: [Post] = []
    @State private var counts = (following: 0, followers: 0, posts: 0)
    @State private var selectedTab = 0
    @State private var repositories: [Repository] = []
    @State private var languageStats: [GitHubLanguageStat] = []
    @State private var contributions: [GitHubContribution] = []
    @State private var issueSearch: GitHubIssueSearchResponse?
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                if let profile {
                    VStack(spacing: 0) {
                        ProfileHero(
                            profile: profile,
                            counts: counts,
                            repositories: repositories,
                            languageStats: languageStats,
                            contributions: contributions,
                            issueSearch: issueSearch,
                            isOwn: profile.id == model.me?.id || (
                                model.isPostingAsOfficial &&
                                profile.id == model.officialProfile?.id &&
                                (model.me?.isAdmin == true || model.me?.isOperator == true)
                            )
                        )
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
         .background(SwipeBackEnabler())
         .task(id: profile?.id) { await loadProfile() }
         .onReceive(model.$posts) { timelinePosts in
             guard let profileID = profile?.id else { return }
             profilePosts = mergedProfilePosts(
                 profilePosts,
                 timelinePosts.filter { $0.authorID == profileID }
             )
         }
         .onReceive(model.$lastUpdatedPost) { updated in
             guard let updated = updated, let index = profilePosts.firstIndex(where: { $0.id == updated.id }) else { return }
             profilePosts[index] = updated
         }
    }

    private func loadProfile() async {
        guard let id = profile?.id else { return }
        async let posts = try? SupabaseService.shared.posts(limit: 80, authorID: id, token: model.session?.accessToken)
        async let stats = SupabaseService.shared.profileCounts(userID: id, token: model.session?.accessToken)
        let fetchedPosts = await posts ?? []
        let timelinePosts = model.posts.filter { $0.authorID == id }
        profilePosts = mergedProfilePosts(fetchedPosts, timelinePosts)
        counts = await stats
        if let handle = profile?.githubHandle {
            let mayReadPrivate = profile?.id == model.me?.id && UserDefaults.standard.bool(forKey: "spotcode.privateIssuesEnabled")
            let githubToken = mayReadPrivate ? await model.hydrateSharedPrivateIssueToken() : nil
            async let loadedRepos = SupabaseService.shared.repositories(handle: handle)
            async let loadedContributions = SupabaseService.shared.githubContributions(handle: handle)
            async let loadedIssues = SupabaseService.shared.githubOpenIssues(handle: handle, githubToken: githubToken, includePrivate: mayReadPrivate && githubToken != nil)
            async let loadedLanguages = SupabaseService.shared.githubLanguageStats(handle: handle)
            repositories = (try? await loadedRepos) ?? []
            contributions = (try? await loadedContributions) ?? []
            issueSearch = try? await loadedIssues
            languageStats = (try? await loadedLanguages) ?? []
        }
    }

    private func mergedProfilePosts(_ primary: [Post], _ fallback: [Post]) -> [Post] {
        var postsByID: [UUID: Post] = [:]
        for post in fallback { postsByID[post.id] = post }
        for post in primary { postsByID[post.id] = post }
        return postsByID.values.sorted {
            ($0.createdAt ?? "") > ($1.createdAt ?? "")
        }
    }
}

// Profile pages intentionally hide SwiftUI's navigation bar to match the web
// layout. On some iOS versions that also disables UINavigationController's
// standard edge-swipe gesture. Re-enable it only when this view was pushed and
// there is an actual previous page to return to.
private struct SwipeBackEnabler: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> SwipeBackController {
        SwipeBackController()
    }

    func updateUIViewController(_ controller: SwipeBackController, context: Context) {
        controller.enableWhenAvailable()
    }

    final class SwipeBackController: UIViewController, UIGestureRecognizerDelegate {
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            enableWhenAvailable()
        }

        func enableWhenAvailable() {
            DispatchQueue.main.async { [weak self] in
                guard let self = self,
                      let navigationController = self.navigationController,
                      let gesture = navigationController.interactivePopGestureRecognizer else { return }
                gesture.delegate = self
                gesture.isEnabled = navigationController.viewControllers.count > 1
            }
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            (navigationController?.viewControllers.count ?? 0) > 1
        }
    }
}

private struct ProfileSearchView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State var initialQuery: String
    @State private var results: [Profile] = []
    @State private var loading = false
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                TextField("ユーザー・スポット・リポジトリを検索…", text: $initialQuery)
                    .textInputAutocapitalization(.never).submitLabel(.search).spotcodeField().padding()
                    .onSubmit { Task { await search() } }
                if loading { ProgressView().padding() }
                List(results) { profile in
                    NavigationLink(destination: ProfileView(profile: profile)) {
                        HStack(spacing: 12) { AvatarView(profile: profile, size: 42); VStack(alignment: .leading) { Text(profile.name).fontWeight(.bold); Text("@\(profile.handle)").foregroundColor(SpotcodeTheme.muted) } }
                    }.listRowBackground(SpotcodeTheme.surface)
                }.listStyle(.plain)
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
                .navigationTitle("Search").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } } }
                .task { await search() }
        }.preferredColorScheme(.dark)
    }
    private func search() async {
        guard !initialQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { results = []; return }
        loading = true; defer { loading = false }
        results = (try? await SupabaseService.shared.searchProfiles(query: initialQuery, token: model.session?.accessToken)) ?? []
    }
}

private struct ProfileHero: View {
    @EnvironmentObject private var model: AppModel
    let profile: Profile
    let counts: (following: Int, followers: Int, posts: Int)
    let repositories: [Repository]
    let languageStats: [GitHubLanguageStat]
    let contributions: [GitHubContribution]
    let issueSearch: GitHubIssueSearchResponse?
    let isOwn: Bool
    @State private var editing = false
    @State private var isFollowing = false
    @State private var followLoading = false
    @AppStorage("spotcode.hideBadges") private var hideBadges = false
    @AppStorage("spotcode.hideTasks") private var hideTasks = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            LinearGradient(colors: [Color(red: 8/255, green: 70/255, blue: 111/255), Color(red: 30/255, green: 116/255, blue: 77/255)], startPoint: .topLeading, endPoint: .bottomTrailing)
                .frame(height: 176)
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    AvatarView(profile: profile, size: 104).padding(5).background(SpotcodeTheme.surface).clipShape(Circle()).offset(y: -63)
                    Spacer()
                    if isOwn {
                        Button("Edit profile") { editing = true }.font(.body.weight(.bold)).foregroundColor(SpotcodeTheme.background)
                            .padding(.horizontal, 20).padding(.vertical, 11).background(SpotcodeTheme.text).clipShape(Capsule()).padding(.top, 14)
                    } else if model.session != nil {
                        HStack(spacing: 10) {
                            Menu {
                                Button("プロフィールURLをコピー") {
                                    UIPasteboard.general.string = "https://hrmcngs.github.io/spotcode-sns/#/\(profile.handle)"
                                }
                                if let handle = profile.githubHandle {
                                    Link("GitHubで開く", destination: URL(string: "https://github.com/\(handle)")!)
                                }
                            } label: { Text("More").profileActionCapsule(filled: false) }
                            Button(followLoading ? "…" : (isFollowing ? "Following" : "Follow")) { toggleFollow() }
                                .profileActionCapsule(filled: !isFollowing).disabled(followLoading)
                        }.padding(.top, 14)
                    }
                }.frame(height: 63)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 9) {
                        Text(profile.name).font(.title).fontWeight(.bold)
                        if !hideBadges {
                            Text("{ }").font(.caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent)
                                .padding(.horizontal, 8).padding(.vertical, 3).overlay(Capsule().stroke(SpotcodeTheme.accent))
                            ForEach(languageStats.prefix(4)) { language in
                                LanguageMedal(language: language)
                            }
                        }
                    }.padding(.vertical, 5)
                }
                Text("@\(profile.handle)").font(.title3).foregroundColor(SpotcodeTheme.muted)
                if let bio = profile.bio, !bio.isEmpty { Text(bio) }
                HStack(spacing: 14) {
                    if let location = profile.location, !location.isEmpty { Label(location, systemImage: "mappin") }
                    if let joined = profile.createdAt { Label("Joined \(String(joined.prefix(7)))", systemImage: "calendar") }
                }.foregroundColor(SpotcodeTheme.muted)
                if let handle = profile.githubHandle, let url = URL(string: "https://github.com/\(handle)") {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 15, height: 15)
                            Text("@\(handle)")
                            if profile.githubVerified == true {
                                Image(systemName: "checkmark").font(.caption.bold()).foregroundColor(.green)
                            }
                        }
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if let website = profile.website, !website.isEmpty, let url = normalizedWebsite(website) {
                    Link(destination: url) {
                        Label(prettyWebsite(url), systemImage: "globe")
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if let twitter = profile.twitter, !twitter.isEmpty, let url = URL(string: "https://x.com/\(twitter)") {
                    Link(destination: url) {
                        HStack(spacing: 6) { Text("𝕏").font(.body.bold()); Text("@\(twitter)") }
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if let instagram = profile.instagram, !instagram.isEmpty, let url = URL(string: "https://instagram.com/\(instagram)") {
                    Link(destination: url) {
                        Label("@\(instagram)", systemImage: "camera")
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                HStack(spacing: 22) {
                    if let id = profile.id {
                        NavigationLink(destination: FollowListView(userID: id, kind: .following)) { ProfileCount(value: counts.following, label: "Following") }.buttonStyle(.plain)
                        NavigationLink(destination: FollowListView(userID: id, kind: .followers)) { ProfileCount(value: counts.followers, label: "Followers") }.buttonStyle(.plain)
                    }
                    ProfileCount(value: counts.posts, label: "Posts")
                }.padding(.top, 5)
                if profile.githubHandle != nil {
                    GitHubActivity(handle: profile.githubHandle ?? "", contributions: contributions)
                    if !hideTasks { OpenIssuesCard(handle: profile.githubHandle ?? "", result: issueSearch) }
                }
            }.padding(.horizontal, 18).padding(.bottom, 20)
        }.overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
         .sheet(isPresented: $editing) { EditProfileView(profile: profile, isPresented: $editing).environmentObject(model) }
         .task { await loadFollowStatus() }
    }

    private func loadFollowStatus() async {
        guard !isOwn, let followerID = model.displayProfile?.id, let targetID = profile.id,
              let token = model.session?.accessToken else { return }
        isFollowing = (try? await SupabaseService.shared.followStatus(followerID: followerID, targetID: targetID, token: token)) ?? false
    }

    private func toggleFollow() {
        guard let followerID = model.displayProfile?.id, let targetID = profile.id,
              let token = model.session?.accessToken else { return }
        followLoading = true
        Task {
            do {
                if isFollowing { try await SupabaseService.shared.unfollow(followerID: followerID, targetID: targetID, token: token) }
                else { try await SupabaseService.shared.follow(followerID: followerID, targetID: targetID, token: token) }
                isFollowing.toggle()
            } catch { model.errorMessage = error.localizedDescription }
            followLoading = false
        }
    }
}

private struct LanguageMedal: View {
    let language: GitHubLanguageStat
    private var color: Color {
        [
            "JavaScript": Color(red: 241/255, green: 224/255, blue: 90/255),
            "TypeScript": Color(red: 49/255, green: 120/255, blue: 198/255),
            "HTML": Color(red: 227/255, green: 76/255, blue: 38/255),
            "CSS": Color(red: 86/255, green: 61/255, blue: 124/255),
            "Java": Color(red: 176/255, green: 114/255, blue: 25/255),
            "Python": Color(red: 53/255, green: 114/255, blue: 165/255),
            "C": Color(red: 85/255, green: 85/255, blue: 85/255),
            "C++": Color(red: 243/255, green: 75/255, blue: 125/255),
            "C#": Color(red: 23/255, green: 134/255, blue: 0),
            "Swift": Color(red: 240/255, green: 81/255, blue: 56/255),
            "Kotlin": Color(red: 169/255, green: 123/255, blue: 255/255),
            "JSON": Color(red: 68/255, green: 68/255, blue: 68/255)
        ][language.name] ?? SpotcodeTheme.muted
    }
    private var abbreviation: String {
        ["JavaScript":"JS", "TypeScript":"TS", "HTML":"HT", "CSS":"CS", "Java":"Jv", "Python":"Py", "C":"C", "C++":"C+", "C#":"C#", "Swift":"Sw", "Kotlin":"Kt", "JSON":"JN"][language.name]
            ?? String(language.name.filter(\.isLetter).prefix(2))
    }
    private var usesDarkText: Bool { ["JavaScript", "Java", "Kotlin"].contains(language.name) }
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Text(abbreviation)
                .font(.system(size: 10, weight: .heavy, design: .monospaced))
                .foregroundColor(usesDarkText ? .black : .white)
                .frame(width: 30, height: 30)
                .background(color)
                .clipShape(Circle())
                .overlay(Circle().stroke(color.opacity(0.65), lineWidth: 2))
            if language.repositoryCount > 1 {
                Text("×\(language.repositoryCount)")
                    .font(.system(size: 9, weight: .heavy, design: .monospaced))
                    .foregroundColor(color)
                    .padding(.horizontal, 3).frame(minHeight: 15)
                    .background(SpotcodeTheme.surface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(color, lineWidth: 1.5))
                    .offset(x: 7, y: 5)
            }
        }.padding(.trailing, language.repositoryCount > 1 ? 7 : 0)
         .accessibilityLabel("\(language.name), \(language.repositoryCount) repositories")
    }
}

private enum FollowListKind { case following, followers }

private struct FollowListView: View {
    @EnvironmentObject private var model: AppModel
    let userID: UUID
    let kind: FollowListKind
    @State private var profiles: [Profile] = []
    var body: some View {
        List(profiles) { profile in
            NavigationLink(destination: ProfileView(profile: profile)) {
                HStack(spacing: 12) { AvatarView(profile: profile, size: 42); VStack(alignment: .leading) { Text(profile.name).fontWeight(.bold); Text("@\(profile.handle)").foregroundColor(SpotcodeTheme.muted) } }
            }.listRowBackground(SpotcodeTheme.surface)
        }.listStyle(.plain).background(SpotcodeTheme.surface)
            .navigationTitle(kind == .following ? "Following" : "Followers")
            .task {
                if kind == .following { profiles = (try? await SupabaseService.shared.following(userID: userID, token: model.session?.accessToken)) ?? [] }
                else { profiles = (try? await SupabaseService.shared.followers(userID: userID, token: model.session?.accessToken)) ?? [] }
            }
    }
}

private struct EditProfileView: View {
    @EnvironmentObject private var model: AppModel
    let profile: Profile
    @Binding var isPresented: Bool
    @State private var name = ""
    @State private var bio = ""
    @State private var location = ""
    @State private var website = ""
    @State private var twitter = ""
    @State private var instagram = ""
    @State private var avatarURL: String?
    @State private var avatarShape = "round"
    @State private var showingImagePicker = false
    @State private var saving = false
    var body: some View {
        NavigationView {
            ScrollView {
              VStack(spacing: 14) {
                AvatarView(profile: previewProfile, size: 92)
                HStack {
                    Button("画像をアップロード") { showingImagePicker = true }.buttonStyle(OutlineButtonStyle())
                    if avatarURL != nil { Button("画像を消す") { avatarURL = nil }.buttonStyle(OutlineButtonStyle()) }
                }
                Picker("アイコンの形", selection: $avatarShape) {
                    Text("● 円").tag("round")
                    Text("■ 角丸").tag("square")
                }.pickerStyle(.segmented)
                TextField("表示名", text: $name).spotcodeField()
                TextField("自己紹介", text: $bio).spotcodeField()
                TextField("場所", text: $location).spotcodeField()
                TextField("プロフィールURL", text: $website)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).spotcodeField()
                if !websiteIsValid {
                    Label("http(s)形式のURLを入力してください。", systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote).foregroundColor(SpotcodeTheme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                TextField("Twitter / X", text: $twitter)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).spotcodeField()
                TextField("Instagram", text: $instagram)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).spotcodeField()
              }.padding()
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
                .navigationTitle("Edit profile").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(saving ? "保存中…" : "保存") { saving = true; Task { if await model.updateProfile(name: name, bio: bio, location: location, website: normalizedWebsiteValue, twitter: sanitizeSocialHandle(twitter), instagram: sanitizeSocialHandle(instagram), avatarURL: avatarURL, avatarShape: avatarShape) { isPresented = false }; saving = false } }.disabled(name.isEmpty || saving || !websiteIsValid)
                    }
                }
                .onAppear { name = profile.name; bio = profile.bio ?? ""; location = profile.location ?? ""; website = profile.website ?? ""; twitter = profile.twitter ?? ""; instagram = profile.instagram ?? ""; avatarURL = profile.avatarURL; avatarShape = profile.avatarShape ?? "round" }
                .sheet(isPresented: $showingImagePicker) { ProfileImagePicker(image: $avatarURL) }
        }.preferredColorScheme(.dark)
    }

    private var previewProfile: Profile {
        Profile(id: profile.id, handle: profile.handle, name: name.isEmpty ? profile.name : name, avatarURL: avatarURL, bio: profile.bio, location: profile.location, githubHandle: profile.githubHandle, githubVerified: profile.githubVerified, website: website, twitter: twitter, instagram: instagram, isPrivate: profile.isPrivate, isOrg: profile.isOrg, organization: profile.organization, closeFriends: profile.closeFriends, orgMembers: profile.orgMembers, createdAt: profile.createdAt, avatarShape: avatarShape, isAdmin: profile.isAdmin, isOperator: profile.isOperator)
    }

    private var normalizedWebsiteValue: String {
        let trimmed = website.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        return normalizedWebsite(trimmed)?.absoluteString ?? trimmed
    }

    private var websiteIsValid: Bool {
        website.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || normalizedWebsite(website) != nil
    }
}

private struct GitHubActivity: View {
    let handle: String
    let contributions: [GitHubContribution]
    private var cells: [GitHubContribution] { Array(contributions.suffix(26 * 7)) }
    var body: some View {
        Link(destination: URL(string: "https://github.com/\(handle)?tab=contributions")!) {
          VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) { Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13); Text("GitHub activity"); Text("last 12 months").foregroundColor(SpotcodeTheme.muted) }.font(.caption)
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(0..<26, id: \.self) { column in
                    VStack(spacing: 3) {
                        ForEach(0..<7, id: \.self) { row in
                            let index = column * 7 + row
                            let count = index < cells.count ? cells[index].count : 0
                            RoundedRectangle(cornerRadius: 2).fill(grassColor(count)).frame(width: 9, height: 9)
                        }
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).clipped()
          }.padding(.top, 8).foregroundColor(SpotcodeTheme.text)
        }.buttonStyle(.plain)
    }

    private func grassColor(_ count: Int) -> Color {
        if count == 0 { return SpotcodeTheme.surface2 }
        if count < 3 { return Color.green.opacity(0.38) }
        if count < 6 { return Color.green.opacity(0.58) }
        if count < 10 { return Color.green.opacity(0.78) }
        return Color.green
    }
}

private enum IssueDueStatus { case overdue, soon, later }

private struct OpenIssuesCard: View {
    let handle: String
    let result: GitHubIssueSearchResponse?
    @AppStorage("spotcode.hiddenIssueRepos") private var hiddenIssueReposJSON = "[]"
    @State private var listExpanded = false
    @State private var expandedIssues: Set<Int> = []
    @State private var selectedRepository: String?
    private var allowedIssues: [GitHubIssue] {
        let hidden = decodeRepoSet(hiddenIssueReposJSON)
        return (result?.items ?? []).filter { !$0.isHiddenFromSpotcode && !hidden.contains($0.repositoryName) }
    }
    private var total: Int { allowedIssues.count }
    private var issueGroups: [(key: String, value: [GitHubIssue])] {
        Array(Dictionary(grouping: allowedIssues, by: \.repositoryName).sorted { $0.key < $1.key }.prefix(8))
    }
    private var visibleIssues: [GitHubIssue] {
        let filtered = allowedIssues.filter { selectedRepository == nil || $0.repositoryName == selectedRepository }
        return Array(filtered.sorted { left, right in
            if left.isTemplateTask != right.isTemplateTask { return left.isTemplateTask }
            switch (left.dueDate, right.dueDate) {
            case let (a?, b?): return a < b
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil): return (left.createdAt ?? "") > (right.createdAt ?? "")
            }
        }.prefix(20))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) { RepoMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: 13, height: 13).foregroundColor(SpotcodeTheme.muted); Text("Open issues").foregroundColor(SpotcodeTheme.muted); Text("\(total)").fontWeight(.bold); Spacer(); Text("公開リポの未クローズ issue (task)").font(.caption2).foregroundColor(SpotcodeTheme.muted)
                if !allowedIssues.isEmpty {
                    Button(listExpanded ? "折りたたむ" : "リストを表示") { withAnimation { listExpanded.toggle() } }
                        .font(.caption2).foregroundColor(SpotcodeTheme.muted).padding(.horizontal, 8).padding(.vertical, 3)
                        .overlay(Capsule().stroke(SpotcodeTheme.border))
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    Button { selectedRepository = nil; listExpanded = true; expandedIssues.removeAll() } label: {
                        Text("All \(total)").issueFilterPill(selected: selectedRepository == nil)
                    }.buttonStyle(.plain)
                    ForEach(issueGroups, id: \.key) { entry in
                        Button { selectedRepository = entry.key; listExpanded = true; expandedIssues.removeAll() } label: {
                            Text("\(entry.key.split(separator: "/").last.map(String.init) ?? entry.key) \(entry.value.count)")
                                .issueFilterPill(selected: selectedRepository == entry.key)
                        }.buttonStyle(.plain)
                    }
                }.foregroundColor(SpotcodeTheme.text)
            }
            if result == nil {
                ProgressView("Issueを読み込み中…").font(.caption).foregroundColor(SpotcodeTheme.muted)
            } else if allowedIssues.isEmpty {
                Text("未クローズのIssueはありません").font(.caption).foregroundColor(SpotcodeTheme.muted)
            } else if listExpanded {
                ForEach(visibleIssues) { issue in
                    VStack(alignment: .leading, spacing: 7) {
                        HStack(spacing: 6) {
                            Button {
                                withAnimation {
                                    if expandedIssues.contains(issue.id) { expandedIssues.remove(issue.id) }
                                    else { expandedIssues.insert(issue.id) }
                                }
                            } label: {
                                Image(systemName: "chevron.down").font(.caption2).foregroundColor(SpotcodeTheme.muted)
                                    .rotationEffect(.degrees(expandedIssues.contains(issue.id) ? 0 : -90)).frame(width: 22, height: 22)
                            }.buttonStyle(.plain)
                            Text(issue.title).font(.caption.weight(.semibold)).lineLimit(expandedIssues.contains(issue.id) ? nil : 1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .onTapGesture {
                                    withAnimation {
                                        if expandedIssues.contains(issue.id) { expandedIssues.remove(issue.id) } else { expandedIssues.insert(issue.id) }
                                    }
                                }
                            Button { selectedRepository = issue.repositoryName; expandedIssues.removeAll() } label: {
                                Text(issue.repositoryName.split(separator: "/").last.map(String.init) ?? issue.repositoryName)
                                    .font(.caption2.monospaced()).lineLimit(1).frame(maxWidth: 90)
                                    .padding(.horizontal, 7).padding(.vertical, 2).overlay(Capsule().stroke(SpotcodeTheme.border))
                            }.buttonStyle(.plain).foregroundColor(SpotcodeTheme.muted)
                            if let due = issue.dueDate { Text(dueLabel(due)).issueDuePill(status: dueStatus(due)) }
                            Link(destination: issue.htmlURL) {
                                Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13)
                            }.foregroundColor(SpotcodeTheme.muted)
                        }
                        if !issue.labels.isEmpty {
                            HStack(spacing: 4) {
                                ForEach(Array(issue.labels.prefix(3)), id: \.name) { label in
                                    Text(label.name).font(.caption2).foregroundColor(SpotcodeTheme.muted)
                                        .padding(.horizontal, 6).padding(.vertical, 1).overlay(Capsule().stroke(SpotcodeTheme.border))
                                }
                            }.padding(.leading, 28)
                        }
                        if expandedIssues.contains(issue.id) {
                            if let body = issue.body, !body.isEmpty {
                                IssueMarkdownView(source: body)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                                    .background(Color.black.opacity(0.22)).clipShape(RoundedRectangle(cornerRadius: 8))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border)).padding(.leading, 28)
                            }
                        }
                    }.padding(.horizontal, 8).padding(.vertical, 7)
                        .background(Color.white.opacity(0.02)).clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(alignment: .leading) {
                            if let due = issue.dueDate, dueStatus(due) != .later {
                                Rectangle().fill(dueStatus(due) == .overdue ? Color.red : SpotcodeTheme.warning).frame(width: 3)
                            }
                        }
                }
            }
        }.padding(12).overlay(RoundedRectangle(cornerRadius: 10).stroke(SpotcodeTheme.border)).padding(.top, 8)
            .onAppear { collapseAll() }
            .onChange(of: handle) { _ in collapseAll() }
    }

    private func dueLabel(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()), to: Calendar.current.startOfDay(for: date)).day ?? 0
        return "\(formatter.string(from: date)) · " + (days < 0 ? "\(-days)日超過" : "あと\(days)日")
    }

    private func dueStatus(_ date: Date) -> IssueDueStatus {
        if date < Date() { return .overdue }
        if date.timeIntervalSinceNow < 259_200 { return .soon }
        return .later
    }

    private func collapseAll() {
        listExpanded = false
        expandedIssues.removeAll()
        selectedRepository = nil
    }
}

private enum IssueMarkdownBlock {
    case heading(Int, String)
    case paragraph(String)
    case bullets([(checked: Bool?, text: String)])
    case ordered([String])
    case quote(String)
    case code(String)
    case table([[String]])
}

private struct IssueMarkdownView: View {
    let source: String
    private var blocks: [IssueMarkdownBlock] { parseIssueMarkdown(source) }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                blockView(block)
            }
        }
        .font(.caption)
        .foregroundColor(SpotcodeTheme.text)
    }

    @ViewBuilder private func blockView(_ block: IssueMarkdownBlock) -> some View {
        switch block {
        case let .heading(level, value):
            Text(issueInlineMarkdown(value))
                .font(level == 1 ? .headline : (level == 2 ? .subheadline.bold() : .caption.bold()))
                .padding(.top, level == 1 ? 5 : 2)
        case let .paragraph(value):
            Text(issueInlineMarkdown(value)).lineSpacing(3)
        case let .bullets(items):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        if let checked = item.checked {
                            Image(systemName: checked ? "checkmark.square.fill" : "square")
                                .foregroundColor(checked ? .green : SpotcodeTheme.muted)
                        } else { Text("•").foregroundColor(SpotcodeTheme.muted) }
                        Text(issueInlineMarkdown(item.text))
                            .strikethrough(item.checked == true, color: SpotcodeTheme.muted)
                    }
                }
            }.padding(.leading, 4)
        case let .ordered(items):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text("\(index + 1).").foregroundColor(SpotcodeTheme.muted).frame(minWidth: 17, alignment: .trailing)
                        Text(issueInlineMarkdown(item))
                    }
                }
            }
        case let .quote(value):
            Text(issueInlineMarkdown(value)).lineSpacing(3).padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(SpotcodeTheme.muted).frame(width: 3) }
                .foregroundColor(SpotcodeTheme.muted)
        case let .code(value):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(value).font(.system(.caption, design: .monospaced)).textSelection(.enabled).padding(9)
            }.background(Color.black.opacity(0.35)).clipShape(RoundedRectangle(cornerRadius: 6))
        case let .table(rows):
            ScrollView(.horizontal, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                        HStack(spacing: 0) {
                            ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                Text(issueInlineMarkdown(cell)).font(rowIndex == 0 ? .caption.bold() : .caption)
                                    .frame(minWidth: 105, maxWidth: 190, alignment: .leading).padding(7)
                                    .overlay(Rectangle().stroke(SpotcodeTheme.border, lineWidth: 0.5))
                            }
                        }.background(rowIndex == 0 ? SpotcodeTheme.surface2 : Color.clear)
                    }
                }
            }
        }
    }
}

private func issueInlineMarkdown(_ value: String) -> AttributedString {
    (try? AttributedString(markdown: value, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
        ?? AttributedString(value)
}

private func parseIssueMarkdown(_ raw: String) -> [IssueMarkdownBlock] {
    let cleaned = raw
        .replacingOccurrences(of: "<!--[\\s\\S]*?-->", with: "", options: .regularExpression)
        .replacingOccurrences(of: "<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*>([\\s\\S]*?)</\\1>", with: "$2", options: .regularExpression)
        .replacingOccurrences(of: "</?[a-zA-Z][^>]*>", with: "", options: .regularExpression)
    let lines = cleaned.components(separatedBy: .newlines)
    var result: [IssueMarkdownBlock] = []
    var index = 0
    func cells(_ line: String) -> [String] {
        var values = line.split(separator: "|", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
        if values.first == "" { values.removeFirst() }
        if values.last == "" { values.removeLast() }
        return values
    }
    while index < lines.count {
        let line = lines[index]
        if line.trimmingCharacters(in: .whitespaces).isEmpty { index += 1; continue }
        if line.hasPrefix("```") {
            index += 1; var values: [String] = []
            while index < lines.count && !lines[index].hasPrefix("```") { values.append(lines[index]); index += 1 }
            if index < lines.count { index += 1 }
            result.append(.code(values.joined(separator: "\n"))); continue
        }
        if let match = line.range(of: "^(#{1,3})\\s+", options: .regularExpression) {
            let prefix = String(line[match]); let level = prefix.filter { $0 == "#" }.count
            result.append(.heading(level, String(line[match.upperBound...]))); index += 1; continue
        }
        let header = cells(line)
        if header.count > 1, index + 1 < lines.count {
            let separator = cells(lines[index + 1])
            if separator.count == header.count && separator.allSatisfy({ $0.range(of: "^:?-{3,}:?$", options: .regularExpression) != nil }) {
                var rows = [header]; index += 2
                while index < lines.count && lines[index].contains("|") && !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                    rows.append(cells(lines[index])); index += 1
                }
                result.append(.table(rows)); continue
            }
        }
        if line.range(of: "^\\s*[-*]\\s+", options: .regularExpression) != nil {
            var items: [(Bool?, String)] = []
            while index < lines.count, let range = lines[index].range(of: "^\\s*[-*]\\s+", options: .regularExpression) {
                var text = String(lines[index][range.upperBound...]); var checked: Bool?
                if text.range(of: "^\\[[ xX]\\]\\s*", options: .regularExpression) != nil {
                    checked = text.lowercased().hasPrefix("[x]")
                    text = text.replacingOccurrences(of: "^\\[[ xX]\\]\\s*", with: "", options: .regularExpression)
                }
                items.append((checked, text)); index += 1
            }
            result.append(.bullets(items)); continue
        }
        if line.range(of: "^\\s*\\d+[.)]\\s+", options: .regularExpression) != nil {
            var items: [String] = []
            while index < lines.count, let range = lines[index].range(of: "^\\s*\\d+[.)]\\s+", options: .regularExpression) {
                items.append(String(lines[index][range.upperBound...])); index += 1
            }
            result.append(.ordered(items)); continue
        }
        if line.range(of: "^\\s*>\\s?", options: .regularExpression) != nil {
            var values: [String] = []
            while index < lines.count {
                guard let range = lines[index].range(of: "^\\s*>\\s?", options: .regularExpression) else { break }
                values.append(String(lines[index][range.upperBound...])); index += 1
            }
            result.append(.quote(values.joined(separator: "\n"))); continue
        }
        var paragraph = [line]; index += 1
        while index < lines.count && !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
            if lines[index].range(of: "^(#{1,3})\\s+|^```|^\\s*[-*]\\s+|^\\s*\\d+[.)]\\s+|^\\s*>", options: .regularExpression) != nil { break }
            paragraph.append(lines[index]); index += 1
        }
        result.append(.paragraph(paragraph.joined(separator: "\n")))
    }
    return result
}

private extension Text {
    func issuePill() -> some View { self.font(.caption).padding(.horizontal, 9).padding(.vertical, 5).overlay(Capsule().stroke(SpotcodeTheme.border)) }
    func issueFilterPill(selected: Bool) -> some View {
        self.font(.system(.caption, design: .monospaced).weight(selected ? .bold : .regular))
            .padding(.horizontal, 9).padding(.vertical, 5)
            .foregroundColor(selected ? SpotcodeTheme.text : SpotcodeTheme.muted)
            .background(selected ? SpotcodeTheme.accent.opacity(0.08) : Color.clear).clipShape(Capsule())
            .overlay(Capsule().stroke(selected ? SpotcodeTheme.accent : SpotcodeTheme.border))
    }
    func issueDuePill(status: IssueDueStatus) -> some View {
        let color: Color = status == .overdue ? .red : (status == .soon ? SpotcodeTheme.warning : SpotcodeTheme.muted)
        return self.font(.caption2.monospaced()).foregroundColor(color).padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.08)).clipShape(Capsule()).overlay(Capsule().stroke(color.opacity(0.4)))
    }
}

private struct ProfileCount: View {
    let value: Int; let label: String
    var body: some View { HStack(spacing: 5) { Text("\(value)").fontWeight(.bold).foregroundColor(SpotcodeTheme.text); Text(label).foregroundColor(SpotcodeTheme.muted) } }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var tab: Int

    init() {
        let arguments = ProcessInfo.processInfo.arguments
        let screenshotTab = arguments.contains("-SpotcodeScreenshotMode") ? 2 : 0
        _tab = State(initialValue: screenshotTab)
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Settings").font(.title2).fontWeight(.bold)
                HStack(spacing: 0) {
                    SettingsTab(title: "アカウント", icon: "person", selected: tab == 0) { tab = 0 }
                    SettingsTab(title: "プライバシー", icon: "lock", selected: tab == 1) { tab = 1 }
                    SettingsTab(title: "画面表示", icon: "gearshape", selected: tab == 2) { tab = 2 }
                    if model.me?.isAdmin == true {
                        SettingsTab(title: "開発", icon: "hammer", selected: tab == 3) { tab = 3 }
                    }
                }
                if tab == 0 { AccountSettings() }
                else if tab == 1 { PrivacySettings() }
                else if tab == 2 { DisplaySettings() }
                else if model.me?.isAdmin == true { DeveloperSettings() }
            }.padding(16)
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true)
    }
}

private struct SettingsTab: View {
    let title: String; let icon: String; let selected: Bool; let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Label { Text(LocalizedStringKey(title)) } icon: { Image(systemName: icon) }
                    .font(.caption.weight(.semibold))
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
        VStack(alignment: .leading, spacing: 14) { Text(LocalizedStringKey(title)).font(.headline); content }
            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
    }
}

private struct SettingsStatusTag: View {
    let text: String
    let enabled: Bool
    var body: some View {
        Text(LocalizedStringKey(text)).font(.caption.bold())
            .foregroundColor(enabled ? .green : SpotcodeTheme.muted)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background((enabled ? Color.green : SpotcodeTheme.muted).opacity(0.12))
            .clipShape(Capsule())
            .overlay(Capsule().stroke((enabled ? Color.green : SpotcodeTheme.muted).opacity(0.45)))
    }
}

private struct AccountSettings: View {
    @EnvironmentObject private var model: AppModel
    @State private var showAddAccount = false
    @State private var isOrg = false
    @State private var organization = ""
    @State private var savingIdentity = false
    var body: some View {
        VStack(spacing: 18) {
            SettingsCard("アカウント") {
                Text("この端末にログイン済みのアカウントを切り替えられます。アカウント自体は削除されません。").foregroundColor(SpotcodeTheme.muted)
                ForEach(model.savedAccounts) { account in
                    let active = account.id == model.session?.user.id && !model.isPostingAsOfficial
                    Button {
                        guard !active else { return }
                        Task { _ = await model.switchAccount(to: account.id) }
                    } label: {
                        HStack {
                            AvatarView(profile: account.profile, size: 42)
                            VStack(alignment: .leading) {
                                Text(account.profile.name).fontWeight(.bold)
                                HStack(spacing: 4) {
                                    Text("@\(account.profile.handle)")
                                    if active {
                                        Text("·")
                                        Text("現在")
                                    }
                                }.font(.caption).foregroundColor(SpotcodeTheme.muted)
                            }
                            Spacer()
                            if !active { Text("切り替え").font(.caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent) }
                        }
                        .padding(12)
                        .background(active ? Color(red: 23/255, green: 40/255, blue: 54/255) : SpotcodeTheme.surface2)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                    }.buttonStyle(.plain)
                }
                Button("＋ 別のアカウントでログイン") { showAddAccount = true }.buttonStyle(OutlineButtonStyle())
            }
            MFASettingsCard()
            SettingsCard("役割") {
                Label { Text(LocalizedStringKey(roleTitle)) } icon: { Image(systemName: model.me?.isAdmin == true ? "sparkles" : (model.me?.isOperator == true ? "flag" : "person")) }.foregroundColor(SpotcodeTheme.accent)
                Text(LocalizedStringKey(roleDescription)).foregroundColor(SpotcodeTheme.muted)
            }
            SettingsCard("アカウントの種類") {
                SettingsStatusTag(text: isOrg ? "組織アカウント" : "個人アカウント", enabled: isOrg)
                Text(isOrg ? "プロフィールに組織バッジを表示します。" : "個人のプログラマープロフィールとして表示します。").foregroundColor(SpotcodeTheme.muted)
                Button(isOrg ? "個人アカウントに変更" : "組織アカウントに変更") {
                    isOrg.toggle(); saveIdentity()
                }.buttonStyle(OutlineButtonStyle(filled: !isOrg)).disabled(savingIdentity)
            }
            SettingsCard("所属・組織名") {
                Text("プロフィールに表示する会社・学校・コミュニティ名を設定します。").foregroundColor(SpotcodeTheme.muted)
                TextField("所属名", text: $organization).spotcodeField()
                Button("保存") { saveIdentity() }.buttonStyle(OutlineButtonStyle()).disabled(savingIdentity)
            }
        }.sheet(isPresented: $showAddAccount) { LoginView(isPresented: $showAddAccount).environmentObject(model) }
         .onAppear { isOrg = model.me?.isOrg ?? false; organization = model.me?.organization ?? "" }
    }
    private var roleTitle: String { model.me?.isAdmin == true ? "管理者" : (model.me?.isOperator == true ? "運営者" : "一般ユーザー") }
    private var roleDescription: String {
        if model.me?.isAdmin == true { return "すべての管理権限を持ちます。" }
        if model.me?.isOperator == true { return "通報対応・投稿管理・ピン管理を行えます。" }
        return "通常の投稿・フォロー・スポット機能を利用できます。"
    }
    private func saveIdentity() {
        savingIdentity = true
        Task {
            _ = await model.updateProfilePreferences(isPrivate: model.me?.isPrivate ?? false, isOrg: isOrg, organization: organization, closeFriends: model.me?.closeFriends ?? [], orgMembers: model.me?.orgMembers ?? [])
            savingIdentity = false
        }
    }
}

private struct DeveloperSettings: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("spotcode.native.dev-mode") private var developerMode = false
    @State private var password = ""
    @State private var projectURL = UserDefaults.standard.string(forKey: SupabaseService.projectURLKey) ?? SupabaseService.defaultProjectURL
    @State private var publishableKey = UserDefaults.standard.string(forKey: SupabaseService.publishableKeyKey) ?? SupabaseService.defaultPublishableKey
    @State private var showOverride = false
    @State private var busy = false
    @State private var message = ""
    @State private var messageIsError = false

    var body: some View {
        VStack(spacing: 18) {
            Text("この区画は管理者だけに表示されます。接続情報や内部IDは一般ユーザーには表示されません。")
                .foregroundColor(SpotcodeTheme.muted)
            SettingsCard("Developer mode") {
                Toggle("開発者向けUIを表示", isOn: $developerMode)
                Text("通知キューや内部IDなどの開発者向け表示を、この端末で切り替えます。")
                    .foregroundColor(SpotcodeTheme.muted)
                Text(developerMode ? "ON" : "OFF").font(.caption.bold())
                    .foregroundColor(developerMode ? .green : SpotcodeTheme.muted)
            }
            SettingsCard("dev test アカウントのパスワード") {
                Text("社内QA用の @spotcode_dev アカウントを作成し、パスワードを設定／変更します。")
                    .foregroundColor(SpotcodeTheme.muted)
                SecureField("新しいパスワード（8文字以上）", text: $password).spotcodeField()
                Button("パスワードを設定") { setDevPassword() }
                    .buttonStyle(OutlineButtonStyle(filled: true)).disabled(busy || password.count < 8)
            }
            SettingsCard("Supabase 接続") {
                HStack {
                    Text("CONNECTED").font(.caption.bold()).foregroundColor(.green)
                    Spacer()
                    Text(LocalizedStringKey(currentMode)).font(.caption.bold()).foregroundColor(.green)
                }
                Text(URL(string: projectURL)?.host ?? projectURL).font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                HStack {
                    Button("接続テスト") { testConnection() }.buttonStyle(OutlineButtonStyle())
                    Button(showOverride ? "編集を閉じる" : "自分のSupabaseに上書き") { showOverride.toggle() }
                        .buttonStyle(OutlineButtonStyle())
                }
                if showOverride {
                    TextField("https://xxxx.supabase.co", text: $projectURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().spotcodeField()
                    SecureField("anon / publishable key", text: $publishableKey).spotcodeField()
                    HStack {
                        Button("保存して上書き") { saveConnection() }
                            .buttonStyle(OutlineButtonStyle(filled: true)).disabled(busy)
                        Button("標準に戻す") { restoreDefault() }.buttonStyle(OutlineButtonStyle())
                    }
                    Text("⚠️ secret / service_role キーは保存できません。publishable key または旧形式の anon public JWT のみ使用できます。")
                        .font(.caption).foregroundColor(SpotcodeTheme.warning)
                }
                if !message.isEmpty {
                    Text(message).font(.caption).foregroundColor(messageIsError ? SpotcodeTheme.warning : .green)
                }
            }
        }
    }

    private var currentMode: String {
        projectURL == SupabaseService.defaultProjectURL ? "共有プロジェクト (DEFAULT)" : "CUSTOM"
    }

    private func setDevPassword() {
        busy = true; message = "設定中…"; messageIsError = false
        Task {
            do {
                let session = try await model.validSession()
                try await SupabaseService.shared.ensureDevAccount(password: password, token: session.accessToken)
                password = ""; message = "パスワードを設定しました。"
            } catch { message = error.localizedDescription; messageIsError = true }
            busy = false
        }
    }

    private func testConnection() {
        guard let normalized = validatedConnection() else { return }
        busy = true; message = "接続を確認中…"; messageIsError = false
        Task {
            do {
                try await SupabaseService.shared.testConnection(projectURL: normalized.0, publishableKey: normalized.1)
                message = "接続できました。"
            } catch { message = "接続できませんでした: \(error.localizedDescription)"; messageIsError = true }
            busy = false
        }
    }

    private func saveConnection() {
        guard let normalized = validatedConnection() else { return }
        busy = true
        Task {
            do {
                try await SupabaseService.shared.testConnection(projectURL: normalized.0, publishableKey: normalized.1)
                await SupabaseService.shared.saveConnection(projectURL: normalized.0, publishableKey: normalized.1)
                projectURL = normalized.0; publishableKey = normalized.1
                model.signOut()
                message = "保存しました。新しい接続先へログインしてください。"; messageIsError = false
            } catch { message = "保存できませんでした: \(error.localizedDescription)"; messageIsError = true }
            busy = false
        }
    }

    private func restoreDefault() {
        Task {
            await SupabaseService.shared.restoreDefaultConnection()
            projectURL = SupabaseService.defaultProjectURL
            publishableKey = SupabaseService.defaultPublishableKey
            model.signOut()
            message = "標準接続に戻しました。もう一度ログインしてください。"; messageIsError = false
        }
    }

    private func validatedConnection() -> (String, String)? {
        let url = projectURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let key = publishableKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parsed = URL(string: url), parsed.scheme == "https", parsed.host?.contains(".supabase.") == true else {
            message = "https://…supabase.co 形式のProject URLを入力してください。"; messageIsError = true; return nil
        }
        guard isPublicKey(key) else {
            message = "publishable key または anon public JWT を入力してください。"; messageIsError = true; return nil
        }
        return (url, key)
    }

    private func isPublicKey(_ key: String) -> Bool {
        if key.hasPrefix("sb_publishable_") { return true }
        guard key.hasPrefix("eyJ"), let payload = key.split(separator: ".").dropFirst().first else { return false }
        var encoded = String(payload).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return (json["role"] as? String) == "anon"
    }
}

private struct MFASettingsCard: View {
    @EnvironmentObject private var model: AppModel
    @State private var factor: MFAFactor?
    @State private var enrollment: MFAEnrollment?
    @State private var loading = true
    @State private var message = ""
    @State private var showDisableConfirmation = false

    var body: some View {
        SettingsCard("2段階認証") {
            HStack {
                Text(factor == nil ? "OFF" : "ON").font(.caption.bold())
                    .foregroundColor(factor == nil ? SpotcodeTheme.muted : .green)
                Spacer()
            }
            Text("ログイン時に認証アプリが生成する6桁のワンタイムパスワードを要求します。")
                .foregroundColor(SpotcodeTheme.muted)
            Button(factor == nil ? "2段階認証を設定する" : "2段階認証を無効にする") {
                if factor != nil { showDisableConfirmation = true }
                else {
                    loading = true
                    Task {
                        do { enrollment = try await model.beginMFAEnrollment(); message = "" }
                        catch { message = error.localizedDescription }
                        loading = false
                    }
                }
            }.buttonStyle(OutlineButtonStyle(filled: factor == nil)).disabled(loading)
            if !message.isEmpty { Text(message).font(.caption).foregroundColor(SpotcodeTheme.warning) }
        }
        .task { await refresh() }
        .sheet(item: $enrollment) { value in
            MFAEnrollmentView(enrollment: value) {
                enrollment = nil
                Task { await refresh() }
            }.environmentObject(model)
        }
        .confirmationDialog("2段階認証を無効にしますか？", isPresented: $showDisableConfirmation) {
            Button("無効にする", role: .destructive) {
                guard let factor else { return }
                loading = true
                Task {
                    do { try await model.disableMFA(factor); self.factor = nil; message = "無効にしました" }
                    catch { message = error.localizedDescription }
                    loading = false
                }
            }
        }
    }

    private func refresh() async {
        loading = true
        do { factor = try await model.currentMFAFactor() }
        catch { message = error.localizedDescription }
        loading = false
    }
}

private struct MFAEnrollmentView: View {
    @EnvironmentObject private var model: AppModel
    let enrollment: MFAEnrollment
    let completed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var busy = false
    @State private var errorMessage = ""

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 16) {
                    Text("認証アプリでワンタイムパスワードの追加を選び、QRコードを読み取ってください。")
                    if let image = qrImage(enrollment.totp.uri ?? enrollment.totp.secret) {
                        Image(uiImage: image).interpolation(.none).resizable().frame(width: 240, height: 240).padding(10).background(Color.white).cornerRadius(12)
                    }
                    Text("読み取れない場合").font(.caption).foregroundColor(SpotcodeTheme.muted)
                    Text(enrollment.totp.secret).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    TextField("6桁コード", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .onChange(of: code) { value in
                            code = String(value.filter(\.isNumber).prefix(6))
                        }
                        .spotcodeField()
                    Button(busy ? "確認中…" : "確認して有効にする") {
                        busy = true
                        Task {
                            do { try await model.confirmMFAEnrollment(enrollment, code: code); completed(); dismiss() }
                            catch { errorMessage = "確認コードが違うか、有効期限が切れています。"; busy = false }
                        }
                    }.buttonStyle(OutlineButtonStyle(filled: true)).disabled(busy)
                    if !errorMessage.isEmpty { Text(errorMessage).foregroundColor(SpotcodeTheme.warning) }
                }.padding()
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationTitle("2段階認証")
        }.preferredColorScheme(.dark)
    }

    private func qrImage(_ text: String) -> UIImage? {
        guard let data = text.data(using: .utf8), let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)) else { return nil }
        return UIImage(ciImage: output)
    }
}

private struct PrivacySettings: View {
    @EnvironmentObject private var model: AppModel
    @State private var privateAccount = false
    @State private var closeFriends = ""
    @State private var orgMembers = ""
    @State private var saving = false
    var body: some View { VStack(spacing: 18) {
        SettingsCard("アカウントの公開範囲") {
            SettingsStatusTag(text: privateAccount ? "非公開" : "公開", enabled: privateAccount)
            Text(privateAccount ? "承認したフォロワーだけが投稿を表示できます。" : "すべてのユーザーが投稿を表示できます。").foregroundColor(SpotcodeTheme.muted)
            Button(privateAccount ? "公開アカウントにする" : "非公開アカウントにする") { privateAccount.toggle(); save() }
                .buttonStyle(OutlineButtonStyle(filled: !privateAccount)).disabled(saving)
        }
        SettingsCard("公開対象リスト") {
            Text("「親しい友達」と「同じ組織」の投稿を表示できるユーザーを設定します。").foregroundColor(SpotcodeTheme.muted)
            TextField("親しい友達（@handle、カンマ区切り）", text: $closeFriends).spotcodeField()
            TextField("同じ組織（@handle、カンマ区切り）", text: $orgMembers).spotcodeField()
            Button("保存") { save() }.buttonStyle(OutlineButtonStyle()).disabled(saving)
        }
    }.onAppear {
        privateAccount = model.me?.isPrivate ?? false
        closeFriends = (model.me?.closeFriends ?? []).map { "@\($0)" }.joined(separator: ", ")
        orgMembers = (model.me?.orgMembers ?? []).map { "@\($0)" }.joined(separator: ", ")
    }}
    private func handles(_ value: String) -> [String] {
        value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "^@", with: "", options: .regularExpression) }.filter { !$0.isEmpty }
    }
    private func save() {
        saving = true
        Task {
            _ = await model.updateProfilePreferences(isPrivate: privateAccount, isOrg: model.me?.isOrg ?? false, organization: model.me?.organization ?? "", closeFriends: handles(closeFriends), orgMembers: handles(orgMembers))
            saving = false
        }
    }
}

private struct DisplaySettings: View {
    @EnvironmentObject private var model: AppModel
    @State private var compact = false
    @AppStorage("spotcode.hideBadges") private var hideBadges = false
    @AppStorage("spotcode.hideTasks") private var hideTasks = false
    @State private var issueRepositories: [String] = []
    @AppStorage("spotcode.hiddenIssueRepos") private var hiddenIssueReposJSON = "[]"
    @AppStorage("spotcode.privateIssuesEnabled") private var privateIssuesEnabled = false
    @State private var authorizingPrivateIssues = false
    @State private var privateIssueMessage = ""
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
    @State private var requestingNotifications = false
    @AppStorage("spotcode.notifications.likes") private var notifyLikes = true
    @AppStorage("spotcode.notifications.comments") private var notifyComments = true
    @AppStorage("spotcode.notifications.mentions") private var notifyMentions = true
    @AppStorage("spotcode.notifications.follows") private var notifyFollows = true
    @AppStorage("spotcode.native.language") private var appLanguage = "en"
    var body: some View { VStack(spacing: 18) {
        SettingsCard("Language") {
            Picker("Language", selection: $appLanguage) {
                Text("日本語").tag("ja")
                Text("English").tag("en")
            }.pickerStyle(.segmented)
            Text("アプリ内の表示言語を切り替えます。投稿本文は翻訳されません。")
                .foregroundColor(SpotcodeTheme.muted)
        }
        SettingsCard("装飾バッジの表示") {
            SettingsStatusTag(text: hideBadges ? "非表示" : "表示", enabled: !hideBadges)
            Text("プロフィールや投稿の { }・言語・アイデア・WIPなどのバッジをまとめて切り替えます。").foregroundColor(SpotcodeTheme.muted)
            Button(hideBadges ? "バッジを表示する" : "バッジを非表示にする") { hideBadges.toggle() }
                .buttonStyle(OutlineButtonStyle(filled: hideBadges))
        }
        SettingsCard("Open issues (task)") {
            SettingsStatusTag(text: hideTasks ? "OFF" : "ON", enabled: !hideTasks)
            Text("プロフィールのOpen issuesカードを表示するかどうかを切り替えます。").foregroundColor(SpotcodeTheme.muted)
            Button(hideTasks ? "Issueカードを表示する" : "Issueカードを非表示にする") { hideTasks.toggle() }
                .buttonStyle(OutlineButtonStyle(filled: hideTasks))
        }
        SettingsCard("通知") {
            HStack {
                Label { Text(LocalizedStringKey(notificationStatusText)) } icon: { Image(systemName: notificationStatus == .authorized ? "bell.badge.fill" : "bell.slash") }
                    .foregroundColor(notificationStatus == .authorized ? .green : SpotcodeTheme.muted)
                Spacer()
            }
            Text("いいね・コメント・メンション・フォローなどをiPhoneの通知として受け取ります。")
                .foregroundColor(SpotcodeTheme.muted)
            if notificationStatus == .denied {
                Button("iPhoneの通知設定を開く") { openSystemSettings() }
                    .buttonStyle(OutlineButtonStyle(filled: true))
                Text("通知が拒否されています。iPhoneの設定アプリでSpotcodeの通知を許可してください。")
                    .font(.caption).foregroundColor(SpotcodeTheme.warning)
            } else if notificationStatus != .authorized && notificationStatus != .provisional {
                Button(requestingNotifications ? "確認中…" : "通知をONにする") { requestNotificationPermission() }
                    .buttonStyle(OutlineButtonStyle(filled: true)).disabled(requestingNotifications)
            } else {
                Button("iPhoneの通知設定を開く") { openSystemSettings() }.buttonStyle(OutlineButtonStyle())
            }
            Divider().overlay(SpotcodeTheme.border)
            Text("通知する内容").font(.subheadline.weight(.bold))
            Toggle("いいね", isOn: $notifyLikes)
            Toggle("コメント", isOn: $notifyComments)
            Toggle("メンション", isOn: $notifyMentions)
            Toggle("フォロー・フォローリクエスト", isOn: $notifyFollows)
            Text("種類別の設定はSpotcode内の通知一覧に適用されます。通知音やバナー表示は上の「iPhoneの通知設定」で変更できます。")
                .font(.caption).foregroundColor(SpotcodeTheme.muted)
        }
        SettingsCard("Open issues") {
            Toggle("非公開Issueを表示", isOn: Binding(
                get: { privateIssuesEnabled && model.privateIssueToken != nil },
                set: { enabled in
                    if enabled {
                        authorizingPrivateIssues = true
                        Task {
                            do {
                                let token: String
                                if let shared = await model.hydrateSharedPrivateIssueToken() {
                                    token = shared
                                } else {
                                    token = try await GitHubPrivateIssueAuthorizer.shared.authorize()
                                }
                                model.savePrivateIssueToken(token)
                                try await model.uploadPrivateIssueToken(token)
                                privateIssuesEnabled = true
                                await savePreferences()
                                privateIssueMessage = "GitHubの非公開Issue表示を有効にしました。"
                                await loadIssueRepositories()
                            } catch {
                                privateIssuesEnabled = false
                                privateIssueMessage = error.localizedDescription
                            }
                            authorizingPrivateIssues = false
                        }
                    } else {
                        privateIssuesEnabled = false
                        model.removePrivateIssueToken()
                        Task { await savePreferences(); await loadIssueRepositories() }
                    }
                }
            )).disabled(authorizingPrivateIssues || model.me?.githubHandle == nil)
            if authorizingPrivateIssues { ProgressView("GitHubで認証中…") }
            if !privateIssueMessage.isEmpty { Text(privateIssueMessage).font(.caption).foregroundColor(SpotcodeTheme.muted) }
            Text("プロフィールに表示するリポジトリ").foregroundColor(SpotcodeTheme.muted)
            if issueRepositories.isEmpty { Text("Issue取得後に選択できます").font(.caption).foregroundColor(SpotcodeTheme.muted) }
            ForEach(issueRepositories, id: \.self) { repo in
                Toggle(repo, isOn: Binding(
                    get: { !decodeRepoSet(hiddenIssueReposJSON).contains(repo) },
                    set: { visible in
                        var hidden = decodeRepoSet(hiddenIssueReposJSON)
                        if visible { hidden.remove(repo) } else { hidden.insert(repo) }
                        hiddenIssueReposJSON = encodeRepoSet(hidden)
                        Task { await savePreferences() }
                    }
                )).font(.caption)
            }
        }
        SettingsCard("地図") {
            Text("スポット機能で使用するApple Mapsと位置情報を確認します。").foregroundColor(SpotcodeTheme.muted)
            Button("地図をテスト") { openSystemSettings() }.buttonStyle(OutlineButtonStyle())
        }
        SettingsCard("Spotcodeについて") {
            Text("Spotcodeは、コード・スポット・アイデアを共有するSNSです。").foregroundColor(SpotcodeTheme.muted)
            Link("プライバシーポリシー", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/privacy.html")!)
                .foregroundColor(SpotcodeTheme.accent)
        }
    }.task {
        await refreshNotificationStatus()
        await hydratePreferences()
        await loadIssueRepositories()
    }}

    private var notificationStatusText: String {
        switch notificationStatus {
        case .authorized, .provisional: return "通知 ON"
        case .denied: return "通知 OFF"
        case .notDetermined: return "未設定"
        case .ephemeral: return "一時的に許可"
        @unknown default: return "未設定"
        }
    }

    private func refreshNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationStatus = settings.authorizationStatus
    }

    private func requestNotificationPermission() {
        requestingNotifications = true
        Task {
            do {
                let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
                if granted { await MainActor.run { UIApplication.shared.registerForRemoteNotifications() } }
            } catch { model.errorMessage = "通知を有効にできませんでした: \(error.localizedDescription)" }
            await refreshNotificationStatus()
            requestingNotifications = false
        }
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func hydratePreferences() async {
        guard let id = model.me?.id else { return }
        do {
            let session = try await model.validSession()
            if let value = try await SupabaseService.shared.issueDisplayPreferences(userID: id, token: session.accessToken) {
                hiddenIssueReposJSON = encodeRepoSet(Set(value.hiddenRepos))
                privateIssuesEnabled = value.includePrivate
                if value.includePrivate { _ = await model.hydrateSharedPrivateIssueToken() }
            } else {
                await savePreferences()
            }
        } catch {
            // Stage 33 may not be installed yet. Keep the local preference.
        }
    }

    private func savePreferences() async {
        guard let id = model.me?.id else { return }
        do {
            let session = try await model.validSession()
            try await SupabaseService.shared.saveIssueDisplayPreferences(
                userID: id,
                hiddenRepos: Array(decodeRepoSet(hiddenIssueReposJSON)).sorted(),
                includePrivate: privateIssuesEnabled,
                token: session.accessToken
            )
        } catch {
            // Keep the device-local value and retry on the next settings load.
        }
    }

    private func loadIssueRepositories() async {
        guard let handle = model.me?.githubHandle else { return }
        let token = privateIssuesEnabled ? model.privateIssueToken : nil
        guard let result = try? await SupabaseService.shared.githubOpenIssues(
            handle: handle, githubToken: token, includePrivate: privateIssuesEnabled && token != nil
        ) else { return }
        issueRepositories = Array(Set(result.items.map(\.repositoryName))).sorted()
    }
}

private func decodeRepoSet(_ value: String) -> Set<String> {
    guard let data = value.data(using: .utf8), let items = try? JSONDecoder().decode([String].self, from: data) else { return [] }
    return Set(items)
}

private func encodeRepoSet(_ value: Set<String>) -> String {
    guard let data = try? JSONEncoder().encode(value.sorted()), let text = String(data: data, encoding: .utf8) else { return "[]" }
    return text
}

@MainActor
private final class GitHubPrivateIssueAuthorizer: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GitHubPrivateIssueAuthorizer()
    private var webSession: ASWebAuthenticationSession?

    func authorize() async throws -> String {
        guard let authorizationURL = await SupabaseService.shared.privateIssueAuthorizationURL() else {
            throw URLError(.badURL)
        }
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: authorizationURL, callbackURLScheme: "spotcode") { [weak self] callbackURL, error in
                defer { self?.webSession = nil }
                if let error { continuation.resume(throwing: error); return }
                guard let callbackURL,
                      let token = Self.callbackValues(callbackURL)["provider_token"], !token.isEmpty else {
                    continuation.resume(throwing: NSError(
                        domain: "GitHubOAuth", code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "GitHubの権限トークンを取得できませんでした。"]
                    ))
                    return
                }
                continuation.resume(returning: token)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            webSession = session
            if !session.start() {
                webSession = nil
                continuation.resume(throwing: NSError(
                    domain: "GitHubOAuth", code: -2,
                    userInfo: [NSLocalizedDescriptionKey: "GitHub認証画面を開けませんでした。"]
                ))
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }

    private static func callbackValues(_ url: URL) -> [String: String] {
        let encoded = [url.query, url.fragment].compactMap { $0 }.joined(separator: "&")
        return encoded.split(separator: "&").reduce(into: [:]) { values, pair in
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { return }
            values[parts[0].removingPercentEncoding ?? parts[0]] = parts[1].removingPercentEncoding ?? parts[1]
        }
    }
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
    var body: some View { Text(LocalizedStringKey(title)).font(.headline).frame(maxWidth: .infinity, alignment: .leading).padding(16).background(SpotcodeTheme.surface).overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) } }
}

struct LoginView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @State private var email = ""
    @State private var password = ""
    @State private var signing = false
    @State private var showsPassword = false
    @State private var otpCode = ""
    var body: some View {
        NavigationView {
            VStack(spacing: 14) {
                Image(systemName: "chevron.left.forwardslash.chevron.right").font(.largeTitle)
                if model.requiresReauthentication && !model.requiresMFA {
                    Label("iPhoneのログインセッションが無効になりました。アカウントを継続するため、もう一度ログインしてください。", systemImage: "lock.rotation")
                        .font(.footnote).foregroundColor(SpotcodeTheme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10).background(SpotcodeTheme.warning.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                if model.requiresMFA {
                    Text("2段階認証").font(.title3.bold())
                    Text("認証アプリに表示されている6桁コードを入力してください。")
                        .foregroundColor(SpotcodeTheme.muted)
                    TextField("123456", text: $otpCode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .onChange(of: otpCode) { value in
                            otpCode = String(value.filter(\.isNumber).prefix(6))
                        }
                        .spotcodeField()
                    Button {
                        signing = true
                        Task {
                            let succeeded = await model.verifyMFA(code: otpCode)
                            signing = false
                            if succeeded { isPresented = false }
                        }
                    } label: {
                        Text(LocalizedStringKey(signing ? "確認中…" : "確認してログイン"))
                            .font(.body.weight(.bold))
                            .frame(maxWidth: .infinity)
                            .padding(13)
                            .background(SpotcodeTheme.accent)
                            .foregroundColor(.white)
                            .clipShape(Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .contentShape(Capsule())
                    .disabled(signing)
                } else {
                TextField("メールまたはログイン名", text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .spotcodeField()
                HStack {
                    Group {
                        if showsPassword {
                            TextField("パスワード", text: $password)
                        } else {
                            SecureField("パスワード", text: $password)
                        }
                    }
                    .textContentType(.password)
                    .autocorrectionDisabled(true)
                    Button { showsPassword.toggle() } label: {
                        Image(systemName: showsPassword ? "eye.slash" : "eye")
                            .foregroundColor(SpotcodeTheme.accent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(showsPassword ? "パスワードを隠す" : "パスワードを表示")
                }.spotcodeField()
                Button {
                    signing = true
                    Task {
                        let succeeded = await model.signIn(emailOrAlias: email, password: password)
                        signing = false
                        if succeeded { isPresented = false }
                    }
                } label: {
                    Text(LocalizedStringKey(signing ? "ログイン中…" : "ログイン"))
                        .font(.body.weight(.bold))
                        .frame(maxWidth: .infinity)
                        .padding(13)
                        .background(SpotcodeTheme.accent)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .contentShape(Capsule())
                .disabled(email.isEmpty || password.isEmpty || signing)
                }
                if let message = model.authenticationError, !message.isEmpty {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundColor(SpotcodeTheme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(SpotcodeTheme.warning.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                Spacer()
            }.padding().background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationTitle("spotcodeへログイン")
        }
        .preferredColorScheme(.dark)
        .onDisappear { model.authenticationError = nil }
    }
}

struct ContentUnavailableViewCompat: View {
    let title: String; let icon: String
    var body: some View { VStack(spacing: 12) { Image(systemName: icon).font(.largeTitle); Text(LocalizedStringKey(title)).multilineTextAlignment(.center) }.foregroundColor(SpotcodeTheme.muted).padding() }
}

private extension View {
    func spotcodeIconButton() -> some View {
        self.foregroundColor(SpotcodeTheme.text).frame(width: 34, height: 34).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }
    func spotcodeField() -> some View {
        self.padding(12).background(SpotcodeTheme.background).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }
    func spotcodeURLField() -> some View {
        self.padding(12).background(SpotcodeTheme.inputSurface).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }
    func profileActionCapsule(filled: Bool) -> some View {
        self.font(.body.weight(.bold))
            .foregroundColor(filled ? SpotcodeTheme.background : SpotcodeTheme.text)
            .padding(.horizontal, 20).padding(.vertical, 11)
            .background(filled ? SpotcodeTheme.text : SpotcodeTheme.surface)
            .overlay(Capsule().stroke(SpotcodeTheme.border))
            .clipShape(Capsule())
    }
}

private func normalizedWebsite(_ value: String) -> URL? {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let hasScheme = trimmed.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil
    let candidate = hasScheme ? trimmed : "https://\(trimmed)"
    guard let url = URL(string: candidate),
          ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          url.host != nil else { return nil }
    return url
}

private func prettyWebsite(_ url: URL) -> String {
    let path = url.path == "/" ? "" : url.path
    return (url.host ?? url.absoluteString) + path
}

private func sanitizeSocialHandle(_ value: String) -> String {
    var handle = value.trimmingCharacters(in: .whitespacesAndNewlines)
    handle = handle.replacingOccurrences(
        of: "^https?://(www\\.)?(twitter|x|instagram)\\.com/",
        with: "",
        options: [.regularExpression, .caseInsensitive]
    )
    if handle.hasPrefix("@") { handle.removeFirst() }
    if let boundary = handle.firstIndex(where: { "/?#".contains($0) }) {
        handle = String(handle[..<boundary])
    }
    return String(handle.prefix(30))
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

private func githubLinkLabel(_ value: String) -> String {
    guard let url = URL(string: value),
          let host = url.host?.lowercased(), host == "github.com" || host == "www.github.com" else {
        return value
    }
    let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return path.isEmpty ? "github.com" : path
}

private func githubRepositoryName(from value: String) -> String? {
    guard let url = URL(string: value),
          let host = url.host?.lowercased(), host == "github.com" || host == "www.github.com" else { return nil }
    let parts = url.pathComponents.filter { $0 != "/" }
    guard parts.count >= 2 else { return nil }
    return "\(parts[0])/\(parts[1].replacingOccurrences(of: ".git", with: ""))"
}
