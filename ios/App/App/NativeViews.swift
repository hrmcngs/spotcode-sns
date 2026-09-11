import SwiftUI
import MapKit
import CoreLocation
import PhotosUI
import UIKit
import CoreImage
import AuthenticationServices
import UserNotifications

// Desktop spacing is shared by bars, forms and actions; touch layouts keep
// their original dimensions. Font sizes still follow accessibility scaling.
private enum SpotcodeLayout {
    static func value(_ desktop: CGFloat, _ touch: CGFloat) -> CGFloat {
        #if targetEnvironment(macCatalyst)
        return desktop
        #else
        return touch
        #endif
    }
    static var bodyFont: Font {
        #if targetEnvironment(macCatalyst)
        return .subheadline
        #else
        return .body
        #endif
    }
    static var titleFont: Font {
        #if targetEnvironment(macCatalyst)
        return .headline
        #else
        return .title3
        #endif
    }
    static var headlineFont: Font {
        #if targetEnvironment(macCatalyst)
        return bodyFont.weight(.semibold)
        #else
        return .headline
        #endif
    }
    static var controlSize: ControlSize {
        #if targetEnvironment(macCatalyst)
        return .regular
        #else
        return .regular
        #endif
    }
    // Catalyst's iPad-compatible interface is rendered at 77% on macOS.
    // Match the web toolbar's 34px controls in the actual Mac window.
    static var iconSize: CGFloat { value(34 / 0.77, 34) }
}

#if targetEnvironment(macCatalyst)
private enum MacTextSize {
    static let baseScale: CGFloat = 1 / 0.77
    static let key = "spotcode.mac.textSize"
    static let labels = ["小さい", "標準", "大きい", "特大", "最大"]
    static func dynamicTypeSize(_ selection: Int) -> DynamicTypeSize {
        switch selection {
        case 0: return .small
        case 2: return .xLarge
        case 3: return .xxLarge
        case 4: return .xxxLarge
        default: return .medium
        }
    }
    static func scale(for size: DynamicTypeSize) -> CGFloat {
        switch size {
        case .xSmall, .small: return 0.85
        case .xLarge: return 1.2
        case .xxLarge: return 1.4
        case .xxxLarge, .accessibility1, .accessibility2, .accessibility3, .accessibility4, .accessibility5: return 1.65
        default: return 1
        }
    }
    static func editorFont(_ size: DynamicTypeSize) -> UIFont {
        return .systemFont(ofSize: 16 * baseScale * scale(for: size))
    }
}

private struct MacSizedFont: ViewModifier {
    @AppStorage(MacTextSize.key) private var selection = 1
    let size: CGFloat
    let weight: Font.Weight
    func body(content: Content) -> some View {
        content.font(.system(size: (size == 14 ? 16 : size) * MacTextSize.baseScale * MacTextSize.scale(for: MacTextSize.dynamicTypeSize(selection)), weight: weight))
    }
}

private struct MacTextSizePreference: ViewModifier {
    @AppStorage(MacTextSize.key) private var selection = 1
    func body(content: Content) -> some View {
        content.dynamicTypeSize(MacTextSize.dynamicTypeSize(selection))
    }
}
#endif

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
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("spotcode.notifications.followedPosts") private var followedPostScope = "off"
    @State private var drawerOpen = false
    @State private var showLogin = false
    @State private var composing = false
    @State private var showAccounts = false
    @State private var repositoryComposeURL: String?
    @State private var navigationReset = UUID()
    @State private var recommendedProfileHandle: String?
    @AppStorage("spotcode.terms.acceptedVersion") private var acceptedTerms = ""
    private var appLanguage: String { Bundle.main.preferredLocalizations.first ?? "en" }

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
                #if targetEnvironment(macCatalyst)
                GeometryReader { geometry in
                    HStack(alignment: .top, spacing: 20) {
                        DesktopNavigation(section: $section, composing: $composing, showAccounts: $showAccounts, showLogin: $showLogin, navigationReset: $navigationReset, compact: geometry.size.width < 1000)
                            .frame(width: geometry.size.width < 1000 ? 76 : 340)
                        NavigationView {
                            sectionView.background {
                                NavigationLink(isActive: Binding(
                                    get: { recommendedProfileHandle != nil },
                                    set: { if !$0 { recommendedProfileHandle = nil } }
                                )) {
                                    VStack(spacing: 0) {
                                        HStack {
                                            Button { recommendedProfileHandle = nil } label: {
                                                Image(systemName: "arrow.left").frame(width: 44, height: 44)
                                            }.accessibilityLabel("戻る")
                                            Spacer()
                                        }.padding(.horizontal, 12)
                                        ProfileLookupView(handle: recommendedProfileHandle ?? "")
                                            .id(recommendedProfileHandle)
                                    }.background(SpotcodeTheme.surface).navigationBarHidden(true)
                                } label: { EmptyView() }
                                    .hidden().accessibilityHidden(true)
                            }
                        }
                            .id(navigationReset).navigationViewStyle(.stack)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
                        if geometry.size.width >= 1450 {
                            DesktopCommunity(openProfile: { profile in
                                recommendedProfileHandle = profile.handle
                            }).frame(width: 400)
                        }
                    }
                    .padding(20).frame(maxWidth: 1662, maxHeight: .infinity, alignment: .top)
                    .frame(maxWidth: .infinity)
                }
                #else
                HStack(spacing: 0) {
                    Spacer(minLength: horizontalSizeClass == .regular ? 24 : 0)
                    NavigationView { sectionView }
                        .id(navigationReset)
                        .navigationViewStyle(.stack)
                        .frame(maxWidth: horizontalSizeClass == .regular ? SpotcodeLayout.value(800, 720) : .infinity)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
                        .padding(8)
                    Spacer(minLength: horizontalSizeClass == .regular ? 24 : 0)
                }
                #endif
            }
            #if !targetEnvironment(macCatalyst)
            if drawerOpen {
                Color.black.opacity(0.55).ignoresSafeArea().onTapGesture { withAnimation { drawerOpen = false } }
                SideDrawer(section: $section, open: $drawerOpen, composing: $composing, navigationReset: $navigationReset)
                    .transition(.move(edge: .leading))
            }
            #endif
            if showAccounts {
                Color.black.opacity(Double(SpotcodeLayout.value(0.3, 0.72))).ignoresSafeArea().onTapGesture { showAccounts = false }
                AccountSwitcher(isPresented: $showAccounts, showLogin: $showLogin)
                    .desktopAccountPlacement()
            }
        }
        .preferredColorScheme(.dark)
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
        .environment(\.locale, Locale(identifier: appLanguage))
        .tint(SpotcodeTheme.accent)
        .task {
            if let screenshotSection { section = screenshotSection }
            if screenshotShowsLogin {
                showLogin = true
            } else if model.session == nil && !screenshotMode {
                showLogin = true
            }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-SpotcodeScreenshotShowAccounts") {
                showAccounts = true
            }
            #endif
            await model.bootstrap()
        }
        .task(id: "\(model.session?.user.id.uuidString ?? "guest"):\(scenePhase):\(followedPostScope)") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.pollFollowedPostNotifications()
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("spotcode.openNotifications"))) { _ in section = .notifications }
        .onChange(of: navigationReset) { _ in recommendedProfileHandle = nil }
        .fullScreenCover(isPresented: Binding(get: { model.session != nil && acceptedTerms != "2026-09-08" && !showLogin }, set: { _ in })) {
            TermsAgreementGate().environmentObject(model)
        }
        #if targetEnvironment(macCatalyst)
        .blur(radius: showLogin ? 4 : 0)
        #endif
        .sheet(isPresented: $showLogin) { LoginView(isPresented: $showLogin).environmentObject(model) }
        .sheet(isPresented: $composing) { ComposeView(isPresented: $composing).environmentObject(model) }
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
        case .profile:
            if let profile = model.displayProfile {
                ProfileView(profile: profile).id(profile.id)
            } else {
                VStack(spacing: 16) {
                    ContentUnavailableViewCompat(title: "ログインしてください", icon: "person.crop.circle")
                    Button("ログイン") {
                        if model.savedAccounts.isEmpty { showLogin = true }
                        else { showAccounts = true }
                    }.buttonStyle(OutlineButtonStyle(filled: true))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(SpotcodeTheme.surface).navigationBarHidden(true)
            }
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
    @FocusState private var searchFocused: Bool

    var body: some View {
        HStack(spacing: 9) {
            #if !targetEnvironment(macCatalyst)
            Button { withAnimation(.easeOut(duration: 0.2)) { drawerOpen.toggle() } } label: {
                Image(systemName: "line.3.horizontal").frame(width: SpotcodeLayout.iconSize, height: SpotcodeLayout.iconSize)
            }.spotcodeIconButton()
            #endif
            Button { section = .home; navigationReset = UUID() } label: {
                HStack(spacing: 7) {
                    SpotcodePinMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: SpotcodeLayout.value(24, 25), height: SpotcodeLayout.value(24, 25))
                    Text("spotcode").fontWeight(.bold).lineLimit(1)
                    #if targetEnvironment(macCatalyst)
                    Text("/").foregroundColor(SpotcodeTheme.muted)
                    Text("sns").foregroundColor(SpotcodeTheme.accent)
                    #endif
                }.foregroundColor(SpotcodeTheme.text)
            }
            #if targetEnvironment(macCatalyst)
            Spacer(minLength: 16)
            #endif
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass").foregroundColor(SpotcodeTheme.muted)
                TextField("Search…", text: $query).foregroundColor(SpotcodeTheme.text)
                    .focused($searchFocused)
                    .onSubmit { if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { showSearch = true } }
                #if targetEnvironment(macCatalyst)
                Button { searchFocused = true } label: {
                    Text("/").foregroundColor(SpotcodeTheme.muted).padding(.horizontal, 6)
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(SpotcodeTheme.border))
                }.buttonStyle(SpotcodePlainButtonStyle()).keyboardShortcut("/", modifiers: []).accessibilityLabel("Search…")
                #endif
            }
            .padding(.horizontal, 10).frame(height: SpotcodeLayout.iconSize)
            .frame(maxWidth: SpotcodeLayout.value(520 / 0.77, 520))
            .background(SpotcodeTheme.background)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
            Spacer(minLength: 0)
            #if targetEnvironment(macCatalyst)
            Button { section = .notifications; navigationReset = UUID() } label: { Image(systemName: "bell") }
                .spotcodeIconButton().accessibilityLabel("Notifications")
            #endif
            Button { section = .settings; navigationReset = UUID() } label: { Image(systemName: "gearshape") }.spotcodeIconButton()
            Button {
                if model.session == nil { showLogin = true } else { showAccounts = true }
            } label: { AvatarView(profile: model.displayProfile, size: SpotcodeLayout.iconSize) }
        }
        .padding(.horizontal, SpotcodeLayout.value(16 / 0.77, 10)).padding(.vertical, SpotcodeLayout.value(10 / 0.77, 7))
        .background(SpotcodeTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
        .sheet(isPresented: $showSearch) { ProfileSearchView(initialQuery: query).environmentObject(model) }
    }
}

#if targetEnvironment(macCatalyst)
private struct DesktopNavigation: View {
    @EnvironmentObject private var model: AppModel
    @Binding var section: AppSection
    @Binding var composing: Bool
    @Binding var showAccounts: Bool
    @Binding var showLogin: Bool
    @Binding var navigationReset: UUID
    let compact: Bool
    @State private var hoveredSection: AppSection?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(AppSection.allCases, id: \.self) { item in
                    Button {
                        section = item; navigationReset = UUID()
                    } label: {
                        HStack(spacing: 18) {
                            Image(systemName: item.icon).frame(width: 30)
                            if !compact { Text(LocalizedStringKey(item.rawValue)).fontWeight(section == item ? .bold : .medium) }
                        }
                        .padding(.horizontal, compact ? 16 : 24)
                        .padding(.vertical, 16)
                        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                        .background(Capsule().fill(hoveredSection == item ? SpotcodeTheme.surface2 : .clear))
                        .contentShape(Rectangle())
                        .foregroundColor(section == item ? SpotcodeTheme.accent : SpotcodeTheme.text)
                    }
                    .buttonStyle(SpotcodePlainButtonStyle()).accessibilityLabel(Text(LocalizedStringKey(item.rawValue)))
                    .accessibilityIdentifier("desktop.nav.\(item.rawValue)")
                    .onHover { hovering in
                        if hovering { hoveredSection = item }
                        else if hoveredSection == item { hoveredSection = nil }
                    }
                }
                Button {
                    if model.session == nil { showLogin = true } else { composing = true }
                } label: {
                    HStack {
                        Image(systemName: "plus")
                        if !compact { Text("New idea").fontWeight(.bold) }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 18)
                    .background(SpotcodeTheme.accent).foregroundColor(.white).clipShape(Capsule())
                    .contentShape(Capsule())
                }.buttonStyle(SpotcodePlainButtonStyle()).keyboardShortcut("n", modifiers: .command)
                Button {
                    if model.session == nil { showLogin = true } else { showAccounts = true }
                } label: {
                    HStack(spacing: 12) {
                        AvatarView(profile: model.displayProfile, size: 48)
                        if !compact, let profile = model.displayProfile {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(profile.name).fontWeight(.bold).lineLimit(1)
                                Text("@\(profile.handle)").spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted).lineLimit(1)
                            }
                        }
                    }
                    .padding(.horizontal, compact ? 0 : 16).padding(.vertical, 20)
                    .frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
                    .contentShape(Rectangle()).foregroundColor(SpotcodeTheme.text)
                }.buttonStyle(SpotcodePlainButtonStyle()).accessibilityLabel("アカウント")
            }
        }
    }
}

private struct DesktopCommunity: View {
    @EnvironmentObject private var model: AppModel
    let openProfile: (Profile) -> Void
    @State private var profiles: [Profile] = []
    @State private var contributions: [GitHubContribution] = []
    @State private var busy: Set<UUID> = []
    @State private var followed: Set<UUID> = []
    @State private var requested: Set<UUID> = []
    @State private var message: String?
    @State private var loading = true
    @State private var spotPosts: [Post] = []
    @State private var selectedCity: String?

    private var cities: [(name: String, prefecture: String, posts: [Post])] {
        let visible = spotPosts.filter {
            !model.blockedAccountIDs.contains($0.authorID) && !model.mutedAccountIDs.contains($0.authorID)
                && $0.spot?.lat.isFinite == true && $0.spot?.lng.isFinite == true
        }
        let groups = Dictionary(grouping: visible, by: { $0.spot?.addressDetails?.city?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" })
        var result: [(name: String, prefecture: String, posts: [Post])] = []
        for (name, posts) in groups where !name.isEmpty {
            result.append((name: name, prefecture: posts.first?.spot?.addressDetails?.prefecture ?? "", posts: posts))
        }
        result.sort {
            if $0.posts.count != $1.posts.count { return $0.posts.count > $1.posts.count }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
        return Array(result.prefix(5))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                DesktopRailCard("Your activity", subtitle: "last 12 months") {
                    if let handle = model.displayProfile?.githubHandle, !handle.isEmpty {
                        if contributions.isEmpty {
                            Color.clear.frame(height: 48)
                        } else { GitHubActivity(handle: handle, contributions: contributions, showsTitle: false) }
                    } else {
                        Color.clear.frame(height: 48)
                    }
                }
                if !cities.isEmpty {
                    DesktopRailCard("Trending spots", subtitle: "by city / ward") {
                        ForEach(Array(cities.enumerated()), id: \.element.name) { index, city in
                            Button { selectedCity = city.name } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text("Trending · #\(index + 1)").spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                                        Label(city.name, systemImage: "mappin.and.ellipse").spotcodeFont(16, weight: .bold, fallback: .headline)
                                        if !city.prefecture.isEmpty {
                                            Text(city.prefecture).spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                                        }
                                    }
                                    Spacer()
                                    Text("\(city.posts.count) \(city.posts.count == 1 ? "idea" : "ideas")")
                                        .spotcodeFont(12, fallback: .caption).foregroundColor(.green)
                                }.padding(.vertical, 10).frame(maxWidth: .infinity).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            if index < cities.count - 1 { Divider() }
                        }
                    }
                }
                if loading || !profiles.isEmpty || message != nil {
                DesktopRailCard("Who to follow") {
                    if loading { ProgressView() }
                    ForEach(profiles) { profile in
                        HStack(spacing: 10) {
                            Button { openProfile(profile) } label: {
                                HStack(spacing: 10) {
                                    AvatarView(profile: profile, size: 42)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(profile.name).fontWeight(.bold).lineLimit(1)
                                        Text("@\(profile.handle)").spotcodeFont(11, fallback: .caption2).foregroundColor(SpotcodeTheme.muted).lineLimit(1)
                                    }
                                }.frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                                    .contentShape(Rectangle())
                            }.buttonStyle(SpotcodePlainButtonStyle())
                                .accessibilityIdentifier("desktop.recommendation.\(profile.handle)")
                            if let id = profile.id {
                                Button(requested.contains(id) ? "Requested" : (followed.contains(id) ? "Following" : "Follow")) { follow(profile) }
                                    .buttonStyle(OutlineButtonStyle(filled: true))
                                    .disabled(model.session == nil || busy.contains(id) || followed.contains(id) || requested.contains(id))
                            }
                        }
                    }
                    if let message { Text(message).spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted) }
                    if !loading && profiles.isEmpty && message == nil {
                        Text("おすすめユーザーはありません").spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                    }
                }
                }
            }
        }
        .task(id: model.displayProfile?.id) { await load() }
        .sheet(isPresented: Binding(get: { selectedCity != nil }, set: { if !$0 { selectedCity = nil } })) {
            NavigationView {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(cities.first(where: { $0.name == selectedCity })?.posts ?? []) { post in
                            PostRow(post: post)
                        }
                    }
                }.navigationTitle(selectedCity ?? "")
                    .toolbar { Button("閉じる") { selectedCity = nil } }
            }.environmentObject(model).macTextSizePreference()
        }
    }

    private func load() async {
        profiles = []; contributions = []; spotPosts = []; followed = []; requested = []; message = nil; loading = true
        defer { loading = false }
        let owner = model.displayProfile?.id
        let spots = (try? await SupabaseService.shared.spottedPosts(token: model.session?.accessToken)) ?? []
        guard owner == model.displayProfile?.id else { return }
        spotPosts = spots
        do {
            let candidates = try await SupabaseService.shared.searchProfiles(query: "", token: model.session?.accessToken)
            var followingIDs: Set<UUID> = []
            if let owner {
                let rows = try await SupabaseService.shared.following(userID: owner, token: model.session?.accessToken)
                followingIDs = Set(rows.compactMap(\.id))
            }
            guard owner == model.displayProfile?.id else { return }
            profiles = Array(candidates.filter { profile in
                guard let id = profile.id else { return false }
                return id != owner && !followingIDs.contains(id) && !model.blockedAccountIDs.contains(id) && !model.mutedAccountIDs.contains(id)
            }.prefix(5))
        } catch { message = error.localizedDescription }
        if let handle = model.displayProfile?.githubHandle, !handle.isEmpty {
            let rows = (try? await SupabaseService.shared.githubContributions(handle: handle)) ?? []
            if owner == model.displayProfile?.id { contributions = rows }
        }
    }

    private func follow(_ profile: Profile) {
        guard let id = profile.id, let owner = model.displayProfile?.id,
              let token = model.session?.accessToken, !busy.contains(id) else { return }
        busy.insert(id)
        Task {
            defer { busy.remove(id) }
            do {
                // Search results omit privacy; fetch it before sending a request.
                guard let target = try await SupabaseService.shared.profile(id: id, token: token) else { return }
                guard owner == model.displayProfile?.id else { return }
                try await SupabaseService.shared.follow(followerID: owner, targetID: id, isPrivate: target.isPrivate == true, token: token)
                if owner == model.displayProfile?.id {
                    if target.isPrivate == true { requested.insert(id) } else { followed.insert(id) }
                }
            } catch { model.errorMessage = error.localizedDescription }
        }
    }
}

private struct DesktopRailCard<Content: View>: View {
    let title: String
    let subtitle: String
    let content: Content
    init(_ title: String, subtitle: String = "", @ViewBuilder content: () -> Content) {
        self.title = title; self.subtitle = subtitle; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            (Text(LocalizedStringKey(title)).bold() + Text(subtitle.isEmpty ? "" : " " + NSLocalizedString(subtitle, comment: "")).foregroundColor(SpotcodeTheme.muted))
                .spotcodeFont(16, fallback: .headline)
            content
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(SpotcodeTheme.surface).clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
    }
}
#endif

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
                    HStack(spacing: SpotcodeLayout.value(16, 16)) {
                        Image(systemName: item.icon).frame(width: 25)
                        Text(LocalizedStringKey(item.rawValue)).fontWeight(section == item ? .bold : .medium)
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, SpotcodeLayout.value(7, 12))
                }.foregroundColor(SpotcodeTheme.text)
            }
            Button { composing = true; open = false } label: {
                Label("New idea", systemImage: "plus")
                    .spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.weight(.bold)).frame(maxWidth: .infinity).padding(.vertical, SpotcodeLayout.value(8, 14))
                    .background(SpotcodeTheme.accent).foregroundColor(.white).clipShape(Capsule())
            }.padding(.top, 10).disabled(model.session == nil)
            Spacer()
            if let me = model.displayProfile {
                HStack(spacing: 10) {
                    AvatarView(profile: me, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(me.name).fontWeight(.bold)
                        Text("@\(me.handle)").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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
        VStack(alignment: .leading, spacing: SpotcodeLayout.value(16, 16)) {
            HStack {
                Text("アカウント").spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
                Spacer()
                Button { isPresented = false } label: { Image(systemName: "xmark") }
                    .spotcodeIconButton().keyboardShortcut(.cancelAction)
                    .accessibilityLabel("閉じる")
            }
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
                        AvatarView(profile: account.profile, size: SpotcodeLayout.value(40, 44))
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(account.profile.name).fontWeight(.bold)
                                if active { Text("現在").spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent).padding(4).background(SpotcodeTheme.accent.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 5)) }
                            }
                            Text("@\(account.profile.handle)").foregroundColor(SpotcodeTheme.muted)
                        }
                        Spacer()
                        if switchingID == account.id { ProgressView() }
                    }
                    .padding(SpotcodeLayout.value(10, 12)).frame(maxWidth: .infinity, alignment: .leading)
                    .background(active ? Color(red: 23/255, green: 40/255, blue: 54/255) : SpotcodeTheme.surface2)
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                }
                .buttonStyle(SpotcodePlainButtonStyle())
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
                        ZStack { LinearGradient(colors: [SpotcodeTheme.accent, .green], startPoint: .topLeading, endPoint: .bottomTrailing); Text("S").spotcodeFont(22, weight: .bold, fallback: .title2.weight(.bold)) }.frame(width: SpotcodeLayout.value(40, 44), height: SpotcodeLayout.value(40, 44)).clipShape(Circle())
                        VStack(alignment: .leading) {
                            HStack {
                                Text("spotcode").fontWeight(.bold)
                                Text("公式").spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(.yellow).padding(4).background(Color.yellow.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 5))
                                if model.isPostingAsOfficial { Text("現在").spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent) }
                            }
                            Text("@spotcode_official").foregroundColor(SpotcodeTheme.muted)
                        }
                        Spacer()
                    }.padding(SpotcodeLayout.value(10, 12)).background(model.isPostingAsOfficial ? Color(red: 23/255, green: 40/255, blue: 54/255) : SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 9))
                }.buttonStyle(SpotcodePlainButtonStyle())
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
                Label("別のアカウントを追加", systemImage: "plus").spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.bodyFont.weight(.semibold))
            }
            .disabled(switchingID != nil)
            Button { model.signOut(); isPresented = false; showLogin = true } label: { Label("Log out", systemImage: "arrow.right").foregroundColor(Color(red: 248/255, green: 81/255, blue: 73/255)).spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont) }
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
                            PostRow(post: post).onAppear {
                                if post.id == model.posts.last?.id && model.timelinePageError == nil && !ProcessInfo.processInfo.arguments.contains("-SpotcodeCaptureFullPage") {
                                    Task { await model.loadMoreTimeline() }
                                }
                            }
                        }
                        if model.hasMoreTimelinePosts && !ProcessInfo.processInfo.arguments.contains("-SpotcodeCaptureFullPage") {
                            VStack {
                                if let error = model.timelinePageError {
                                    Text(LocalizedStringKey(error)).spotcodeFont(12, weight: .regular, fallback: .caption)
                                    Button("再試行") { Task { await model.loadMoreTimeline() } }
                                } else { ProgressView("読み込み中…") }
                            }.padding().onAppear {
                                if model.timelinePageError == nil && !ProcessInfo.processInfo.arguments.contains("-SpotcodeCaptureFullPage") { Task { await model.loadMoreTimeline() } }
                            }
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
        .sheet(isPresented: $composing) { ComposeView(isPresented: $composing).environmentObject(model) }
    }
}

private struct TimelineTabs: View {
    @Binding var selected: Int
    private let labels = ["For you", "Following", "Spots"]
    var body: some View {
        HStack(spacing: 0) {
            ForEach(labels.indices, id: \.self) { index in
                Button { selected = index } label: {
                    VStack(spacing: SpotcodeLayout.value(9, 11)) {
                        Text(labels[index]).fontWeight(.semibold)
                        Capsule().fill(selected == index ? SpotcodeTheme.accent : .clear).frame(width: 56, height: SpotcodeLayout.value(2, 4))
                    }.frame(maxWidth: .infinity).padding(.top, SpotcodeLayout.value(10, 13)).contentShape(Rectangle())
                }.foregroundColor(selected == index ? SpotcodeTheme.text : SpotcodeTheme.muted)
            }
        }.background(SpotcodeTheme.surface)
         .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }
}

private struct InlineComposer: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
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
            AvatarView(profile: model.displayProfile, size: SpotcodeLayout.value(40, 42))
            VStack(alignment: .leading, spacing: 12) {
                ZStack(alignment: .topLeading) {
                    ComposerTextView(text: $draft, isFocused: $editorFocused)
                        .frame(minHeight: SpotcodeLayout.value(88, 108))
                    if draft.isEmpty {
                        Text("いまどうしてる？")
                            .spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont).foregroundColor(SpotcodeTheme.muted)
                            .padding(.horizontal, 14).padding(.vertical, SpotcodeLayout.value(11, 17))
                            .allowsHitTesting(false)
                    }
                }
                .background(SpotcodeTheme.inputSurface)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(editorFocused ? SpotcodeTheme.accent : Color(red: 74/255, green: 85/255, blue: 104/255), lineWidth: editorFocused ? 3 : 2))
                composerChips
                if showLink {
                    TextField("https://github.com/…", text: $githubLink).textInputAutocapitalization(.never).keyboardType(.URL).spotcodeURLField()
                    TextField("owner/repository（任意）", text: $repoFullName).textInputAutocapitalization(.never).autocorrectionDisabled(true).spotcodeURLField()
                    Text("連携済みOrganizationのメンバーがそのリポジトリを指定すると、組織アカウント名義で表示されます。").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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
                if let poll { Label(String(format: NSLocalizedString("投票: %@", comment: ""), poll.question), systemImage: "chart.bar").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.accent) }
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
                        Button(NSLocalizedString("破棄", comment: "")) { draft = ""; showDraftNotice = false }.foregroundColor(SpotcodeTheme.muted)
                    }.padding(.horizontal, 12).padding(.vertical, SpotcodeLayout.value(9, 11))
                     .background(Color(red: 18/255, green: 42/255, blue: 58/255))
                     .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.accent.opacity(0.45)))
                }
            }
        }.padding(SpotcodeLayout.value(16, 16))
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
        if horizontalSizeClass == .regular && dynamicTypeSize <= .large {
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
            ComposerChip(icon: "mappin", title: selectedSpot?.label ?? NSLocalizedString("場所を追加", comment: ""), active: selectedSpot != nil)
        }
    }
    private var linkChip: some View { Button { showLink.toggle() } label: { ComposerChip(icon: "link", title: "リンクを追加", active: showLink) } }
    private var eventChip: some View { Button { showEvent.toggle() } label: { ComposerChip(icon: "calendar", title: "イベントを追加", active: showEvent) } }
    private var kindChip: some View { PostKindPicker(kind: $postKind) }
    private var audienceChip: some View { PostAudiencePicker(visibility: $visibility) }

    private var composerTools: some View {
        HStack(spacing: SpotcodeLayout.value(16, 24)) {
            Button { showPhotoPicker = true } label: { Image(systemName: "photo") }
            Button { insertCodeBlock() } label: { Image(systemName: "chevron.left.forwardslash.chevron.right") }
            Button { showLocationPicker = true } label: { Image(systemName: "mappin.circle") }
            Button { showPollEditor = true } label: { Image(systemName: "chart.bar") }
        }.spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont).foregroundColor(SpotcodeTheme.accent)
    }

    private var composerActions: some View {
        HStack(spacing: 10) {
            Button("下書き保存") { showDraftNotice = true }
                .spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.bodyFont.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, SpotcodeLayout.value(8, 10))
                .overlay(Capsule().stroke(SpotcodeTheme.border))
            Button(sending ? NSLocalizedString("送信中…", comment: "") : "Push") { publish() }
                .spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.weight(.bold)).padding(.horizontal, SpotcodeLayout.value(18, 28)).padding(.vertical, SpotcodeLayout.value(9, 11))
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
        draft += NSLocalizedString("```\nコードを入力\n```\n", comment: "")
        editorFocused = true
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

private struct PostAudiencePicker: View {
    @EnvironmentObject private var model: AppModel
    @Binding var visibility: String

    var body: some View {
        Picker("公開範囲", selection: $visibility) {
            Label("全員", systemImage: "globe").tag("public")
            Label("相互フォロー", systemImage: "arrow.2.squarepath").tag("mutuals")
            Label("フォロー中", systemImage: "person.badge.plus").tag("following")
            Label("親しい友達", systemImage: "heart").tag("friends")
            Label("同じ組織", systemImage: "building.2").tag("org")
            if model.displayProfile?.isOrg == true || !model.githubOrganizations.isEmpty || visibility == "github_org" {
                Label("GitHub Organizationのみ", systemImage: "building.2").tag("github_org")
            }
            Label("自分だけ", systemImage: "lock").tag("only_me")
            if visibility == "restricted" {
                Label("限定公開", systemImage: "lock").tag("restricted")
            }
        }
        .pickerStyle(.menu)
        .spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold))
        .tint(SpotcodeTheme.accent)
        .accessibilityLabel("公開範囲")
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
                         title: kind == "bug" ? NSLocalizedString("バグ", comment: "") : kind == "idea" ? NSLocalizedString("アイデア", comment: "") : NSLocalizedString("投稿タグ", comment: ""),
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
            .spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold)).foregroundColor(active ? SpotcodeTheme.accent : (strong ? SpotcodeTheme.text : SpotcodeTheme.muted))
            .padding(.horizontal, 10).padding(.vertical, SpotcodeLayout.value(8, 7))
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
        spot = Spot(lat: coordinate.latitude, lng: coordinate.longitude, label: NSLocalizedString("現在地", comment: ""), address: nil)
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
            if let image = decodedDataURLImage(value) {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    case .empty: ProgressView()
                    default: placeholder
                    }
                }
            } else {
                placeholder
            }
        }.clipped()
    }

    private var placeholder: some View {
        Color(white: 0.15).overlay(Image(systemName: "photo"))
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
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
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
    @State private var address = NSLocalizedString("現在地を取得すると表示されます", comment: "")
    @State private var district = ""
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
                        .spotcodeFont(15, weight: .semibold, fallback: .subheadline.weight(.semibold)).padding(.horizontal, 12).padding(.vertical, SpotcodeLayout.value(8, 9))
                        .overlay(Capsule().stroke(SpotcodeTheme.border))
                    TextField("ラベル（任意・建物名や店名）", text: $label).spotcodeURLField()
                }.padding(14)
                HStack(spacing: 8) {
                    Image(systemName: "mappin.and.ellipse")
                    Text(statusText).spotcodeFont(12, weight: .regular, fallback: .caption)
                    Spacer()
                }.foregroundColor(coordinate == nil ? SpotcodeTheme.muted : SpotcodeTheme.accent)
                    .padding(.horizontal, 16).padding(.vertical, SpotcodeLayout.value(8, 10)).background(SpotcodeTheme.surface2)
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
                        Text("住所").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                        Text(address).spotcodeFont(12, weight: .regular, fallback: .caption).lineLimit(1)
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
                address = spot?.address ?? NSLocalizedString("現在地を取得すると表示されます", comment: "")
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
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
    }

    private var statusText: String {
        if developerMode && model.me?.isAdmin == true { return NSLocalizedString("開発者モード: 地図上の任意の場所を選択できます。", comment: "") }
        if locating { return NSLocalizedString("現在地を取得中… 取れるまで投稿はできません。", comment: "") }
        if adjustmentDenied { return NSLocalizedString("現在地から300mを超えています。半径300m以内を選んでください。", comment: "") }
        if coordinate != nil { return NSLocalizedString("現在地を基準に、地図タップで半径300m以内のポイントを調整できます。", comment: "") }
        return NSLocalizedString("「現在地を使う」を押して場所を取得してください。", comment: "")
    }
    private func confirm() {
        guard let coordinate else { return }
        let resolvedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        spot = Spot(lat: coordinate.latitude, lng: coordinate.longitude,
                    label: resolvedLabel.isEmpty ? NSLocalizedString("選択した場所", comment: "") : resolvedLabel,
                    address: address == NSLocalizedString("現在地を取得すると表示されます", comment: "") ? nil : address)
        if !district.isEmpty { spot?.addressDetails = SpotAddressDetails(city: district) }
        isPresented = false
    }
    private func reverseGeocode(_ coordinate: CLLocationCoordinate2D) {
        district = ""
        CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)) { places, _ in
            guard let place = places?.first, self.coordinate?.latitude == coordinate.latitude,
                  self.coordinate?.longitude == coordinate.longitude else { return }
            district = place.locality ?? place.subAdministrativeArea ?? ""
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
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = UIColor(red: 33/255, green: 38/255, blue: 45/255, alpha: 1)
        view.textColor = UIColor(red: 230/255, green: 237/255, blue: 243/255, alpha: 1)
        view.tintColor = UIColor(red: 29/255, green: 155/255, blue: 240/255, alpha: 1)
        #if targetEnvironment(macCatalyst)
        view.font = MacTextSize.editorFont(dynamicTypeSize)
        view.adjustsFontForContentSizeCategory = false
        #else
        view.font = .preferredFont(forTextStyle: .title3)
        view.adjustsFontForContentSizeCategory = true
        #endif
        view.textContainerInset = UIEdgeInsets(top: SpotcodeLayout.value(10, 13), left: 10, bottom: SpotcodeLayout.value(10, 13), right: 10)
        view.textContainer.lineFragmentPadding = 0
        view.keyboardDismissMode = .interactive
        view.layer.cornerRadius = 10
        view.clipsToBounds = true
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
        #if targetEnvironment(macCatalyst)
        let font = MacTextSize.editorFont(dynamicTypeSize)
        if view.font != font { view.font = font }
        #endif
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
    @State private var showingDetail = false
    @State private var showSpotMap = false
    @State private var sharing = false
    @State private var reporting = false
    @State private var confirmingBlock = false
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
        if post.visibility == "only_me" { return post.authorID == model.session?.user.id }
        return post.authorID == model.displayProfile?.id || (
            developerMode && (model.me?.isAdmin == true || model.me?.isOperator == true)
        )
    }

    var body: some View {
        if model.canReadPostAudience(post) && !model.isBlocked(post) && !model.isMuted(post) {
            postContent
        }
    }

    private var moderationMenu: some View {
Menu {
                                Button { reporting = true } label: { Label("投稿を報告", systemImage: "flag") }
                                Button(role: .destructive) { confirmingBlock = true } label: {
                                    Label("ユーザーをブロック", systemImage: "person.crop.circle.badge.xmark")
                                }
                            } label: { Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44) }
                            .accessibilityLabel("通報・ブロック")
    }

    private var postContent: some View {
        HStack(alignment: .top, spacing: 12) {
            NavigationLink(destination: ProfileLookupView(handle: post.displayAuthor?.handle ?? "")) {
                AvatarView(profile: post.displayAuthor, size: SpotcodeLayout.value(40, 42))
            }.buttonStyle(SpotcodePlainButtonStyle()).disabled(post.displayAuthor?.handle == nil)
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 5) {
                    Text(post.displayAuthor?.name ?? "User").fontWeight(.bold).foregroundColor(SpotcodeTheme.text)
                        .lineLimit(1).truncationMode(.tail).layoutPriority(1)
                    Text("@\(post.displayAuthor?.handle ?? "unknown")").foregroundColor(SpotcodeTheme.muted)
                        .lineLimit(1).truncationMode(.tail)
                    Text("· \(relativeTime(post.createdAt))").foregroundColor(SpotcodeTheme.muted)
                        .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 2)
                    Text((post.status ?? "wip").uppercased()).spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold))
                        .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                        .foregroundColor((post.status ?? "wip") == "active" ? .black : SpotcodeTheme.text)
                        .padding(.horizontal, 9).padding(.vertical, 4)
                        .background((post.status ?? "wip") == "active" ? Color.cyan : SpotcodeTheme.warning).clipShape(Capsule())
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        if let spot = post.spot {
                            Button { showSpotMap = true } label: {
                                PostMetadataBadge(icon: "mappin", text: spot.label ?? spot.address ?? NSLocalizedString("選択した場所", comment: ""), color: SpotcodeTheme.accent)
                            }.buttonStyle(SpotcodePlainButtonStyle())
                        }
                        if post.kind == "idea" { PostMetadataBadge(icon: "sparkles", text: "アイデア", color: SpotcodeTheme.warning) }
                        if post.kind == "bug" { PostMetadataBadge(icon: "ladybug", text: "バグ", color: .red) }
                        PostMetadataBadge(icon: visibilityBadge(post.visibility ?? "public").icon, text: visibilityBadge(post.visibility ?? "public").text, color: SpotcodeTheme.muted)
                    }
                }
                if !canReadContent {
                    Label("この場所から半径100m以内に来ると内容を表示できます", systemImage: "location.slash")
                        .spotcodeFont(15, weight: .regular, fallback: .subheadline).foregroundColor(SpotcodeTheme.muted)
                        .padding(SpotcodeLayout.value(10, 12)).frame(maxWidth: .infinity, alignment: .leading)
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
                        Label(poll.question, systemImage: "chart.bar").spotcodeFont(15, weight: .bold, fallback: .subheadline.weight(.bold))
                        ForEach(poll.options, id: \.self) { option in
                            Text(option).padding(.horizontal, 12).padding(.vertical, SpotcodeLayout.value(8, 9)).frame(maxWidth: .infinity, alignment: .leading)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
                        }
                    }.padding(10).background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                if canReadContent, let link = post.githubLink, let url = URL(string: link) {
                    Link(destination: url) {
                        HStack(spacing: 5) {
                            Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13)
                            Text(githubLinkLabel(link)).lineLimit(1)
                        }.spotcodeFont(12, weight: .regular, fallback: .caption).frame(maxWidth: .infinity, alignment: .leading)
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if canReadContent, let link = post.eventURL, let url = URL(string: link) {
                    Link(destination: url) {
                        Label("イベントを開く", systemImage: "calendar")
                            .spotcodeFont(12, weight: .regular, fallback: .caption).frame(maxWidth: .infinity, alignment: .leading)
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if canReadContent {
                    HStack(spacing: 0) {
                        NavigationLink(destination: PostDetailView(post: post)) {
                            PostAction(icon: "bubble.left", count: post.commentsCount ?? 0)
                        }.buttonStyle(SpotcodePlainButtonStyle()); Spacer()
                        Button { toggleInteraction("reposts") } label: {
                            PostAction(icon: reposted ? "arrow.2.squarepath" : "arrow.2.squarepath", count: repostCount)
                        }.buttonStyle(SpotcodePlainButtonStyle()).disabled(interactionInProgress.contains("reposts")); Spacer()
                        Button { toggleInteraction("bookmarks") } label: {
                            PostAction(icon: bookmarked ? "star.fill" : "star", count: bookmarkCount)
                        }.buttonStyle(SpotcodePlainButtonStyle()).foregroundColor(bookmarked ? SpotcodeTheme.warning : SpotcodeTheme.muted)
                            .disabled(interactionInProgress.contains("bookmarks")); Spacer()
                        Button { toggleInteraction("likes") } label: {
                            PostAction(icon: liked ? "heart.fill" : "heart", count: likeCount)
                        }.buttonStyle(SpotcodePlainButtonStyle()).foregroundColor(liked ? .pink : SpotcodeTheme.muted)
                            .disabled(interactionInProgress.contains("likes")); Spacer()
                        Button { sharing = true } label: {
                            Image(systemName: "square.and.arrow.up")
                        }.buttonStyle(SpotcodePlainButtonStyle())
                        if post.authorID != model.me?.id {
                            Spacer()
                            moderationMenu
                        }
                        if canManagePost {
                            Spacer()
                            NavigationLink(destination: PostDetailView(post: post)) {
                                Image(systemName: "chart.bar")
                            }.buttonStyle(SpotcodePlainButtonStyle()).accessibilityLabel("投稿の分析")
                            Spacer()
                            Button { editing = true } label: { Image(systemName: "pencil") }
                                .buttonStyle(SpotcodePlainButtonStyle()).accessibilityLabel("投稿を編集")
                            Spacer()
                            Button { confirmingDelete = true } label: { Image(systemName: "trash") }
                                .buttonStyle(SpotcodePlainButtonStyle()).accessibilityLabel("投稿を削除")
                        }
                    }
                    .spotcodeFont(15, fallback: .system(size: 15)).foregroundColor(SpotcodeTheme.muted).padding(.top, 7)
                }
            }
        }
        .padding(SpotcodeLayout.value(16, 16)).background(SpotcodeTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
        .contentShape(Rectangle())
        .onTapGesture { if opensDetail { showingDetail = true } }
        .background {
            if opensDetail {
                NavigationLink(destination: PostDetailView(post: post), isActive: $showingDetail) { EmptyView() }
                    .hidden().accessibilityHidden(true)
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
        .confirmationDialog("このユーザーをブロックしますか？投稿が非表示になり、運営へ通知されます。", isPresented: $confirmingBlock, titleVisibility: .visible) {
            Button("ブロック", role: .destructive) { Task { await model.block(post) } }
            Button("キャンセル", role: .cancel) {}
        }
        .confirmationDialog("この投稿を削除しますか？", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("削除", role: .destructive) { Task { _ = await model.deletePost(post) } }
            Button("キャンセル", role: .cancel) {}
        }
    }

    private func visibilityBadge(_ value: String) -> (icon: String, text: String) {
        switch value {
        case "public": return ("globe", NSLocalizedString("全員に公開", comment: ""))
        case "only_me": return ("lock", NSLocalizedString("自分だけ", comment: ""))
        case "github_org": return ("building.2", NSLocalizedString("GitHub Organizationのみ", comment: ""))
        case "mutuals": return ("arrow.2.squarepath", NSLocalizedString("相互フォロー", comment: ""))
        case "following": return ("person.badge.plus", NSLocalizedString("フォロー中", comment: ""))
        case "friends": return ("heart", NSLocalizedString("親しい友達", comment: ""))
        case "org": return ("building.2", NSLocalizedString("同じ組織", comment: ""))
        default: return ("lock", NSLocalizedString("限定公開", comment: ""))
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
            model.errorMessage = NSLocalizedString("ログインしてください", comment: "")
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
                    Text("400文字まで").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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
            model.errorMessage = NSLocalizedString("ログインしてください", comment: "")
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
            VStack(spacing: SpotcodeLayout.value(16, 16)) {
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
                    PostAudiencePicker(visibility: $visibility)
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
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
    }
}

private struct PostMetadataBadge: View {
    let icon: String
    let text: String
    let color: Color
    var body: some View {
        Label { Text(LocalizedStringKey(text)) } icon: { Image(systemName: icon) }
            .spotcodeFont(11, weight: .semibold, fallback: .caption2.weight(.semibold)).foregroundColor(color)
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
                VStack(alignment: .leading, spacing: SpotcodeLayout.value(16, 16)) {
                    HStack(alignment: .top, spacing: 12) {
                        AvatarView(profile: model.displayProfile, size: SpotcodeLayout.value(40, 42))
                        ZStack(alignment: .topLeading) {
                            ComposerTextView(text: $bodyText, isFocused: $editorFocused).frame(minHeight: 160)
                            if bodyText.isEmpty {
                                Text("いまどうしてる？").spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont).foregroundColor(SpotcodeTheme.muted)
                                    .padding(.horizontal, 14).padding(.vertical, SpotcodeLayout.value(11, 17)).allowsHitTesting(false)
                            }
                        }
                        .background(SpotcodeTheme.inputSurface)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(editorFocused ? SpotcodeTheme.accent : SpotcodeTheme.border, lineWidth: 2))
                    }

                    VStack(alignment: .leading, spacing: 9) {
                        HStack(spacing: 8) {
                            Button { showLocationPicker = true } label: {
                                ComposerChip(icon: "mappin", title: selectedSpot?.label ?? NSLocalizedString("場所を追加", comment: ""), active: selectedSpot != nil)
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
                        Text("連携済みOrganizationのメンバーがそのリポジトリを指定すると、組織アカウント名義で表示されます。").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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
                    if let poll { Label(String(format: NSLocalizedString("投票: %@", comment: ""), poll.question), systemImage: "chart.bar").foregroundColor(SpotcodeTheme.accent) }

                    HStack(spacing: 28) {
                        Button { showPhotoPicker = true } label: { Image(systemName: "photo") }
                        Button { insertCodeBlock() } label: { Image(systemName: "chevron.left.forwardslash.chevron.right") }
                        Button { showLocationPicker = true } label: { Image(systemName: "mappin.circle") }
                        Button { showPollEditor = true } label: { Image(systemName: "chart.bar") }
                    }.spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont).foregroundColor(SpotcodeTheme.accent).padding(.leading, 54)
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
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
        .sheet(isPresented: $showLocationPicker) { LocationPickerSheet(spot: $selectedSpot, isPresented: $showLocationPicker) }
        .sheet(isPresented: $showPhotoPicker) { PhotoLibraryPicker(images: $photos) }
        .sheet(isPresented: $showPollEditor) { PollEditorSheet(poll: $poll, isPresented: $showPollEditor) }
    }

    private var audienceMenu: some View { PostAudiencePicker(visibility: $visibility) }

    private func insertCodeBlock() {
        if !bodyText.isEmpty && !bodyText.hasSuffix("\n") { bodyText += "\n" }
        bodyText += NSLocalizedString("```\nコードを入力\n```\n", comment: "")
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
    var title: String? { post.spot?.label ?? post.displayAuthor?.name ?? "Spot" }
    // Never expose the protected post body in an annotation callout.
    // PostDetailView applies the 100m gate after the user opens it.
    var subtitle: String? { NSLocalizedString("この場所の投稿", comment: "") }
    init(post: Post, coordinate: CLLocationCoordinate2D) { self.post = post; self.coordinate = coordinate }
}

struct RepositoriesView: View {
    @EnvironmentObject private var model: AppModel
    let onCompose: (URL) -> Void
    @State private var repositoryNotice = ""
    @State private var repositoryOwner: UUID?
    @State private var repositories: [Repository] = []
    @State private var relatedPosts: [Post] = []
    @State private var loading = false
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 6) {
                    RepoMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: 22, height: 22).foregroundColor(SpotcodeTheme.accent)
                    Text("Repos").spotcodeFont(16, weight: .bold, fallback: SpotcodeLayout.titleFont.weight(.bold))
                    Text("自分と許可済みOrganizationのリポジトリ")
                        .spotcodeFont(15, weight: .regular, fallback: .subheadline).foregroundColor(SpotcodeTheme.muted)
                }.frame(maxWidth: .infinity).padding(.vertical, 22)
                if !repositoryNotice.isEmpty { Text(repositoryNotice).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted).padding(.horizontal) }
                if loading && repositories.isEmpty { ProgressView("リポジトリを読み込み中…").padding(.top, 50) }
            else if model.me?.githubHandle == nil { Spacer(); ContentUnavailableViewCompat(title: "GitHubをプロフィールに連携してください", icon: "link"); Spacer() }
            else {
                LazyVStack(spacing: 12) {
                    ForEach(repositoryOwner == model.session?.user.id ? repositories : []) { repo in
                        repositoryCard(repo)
                    }
                }.padding(.horizontal, 10).padding(.bottom, 20)
            }
            }.refreshable { await load() }
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true).task(id: model.session?.user.id) { await load() }
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
                        .spotcodeFont(12, weight: .regular, fallback: .caption).padding(.horizontal, 10).padding(.vertical, 5)
                        .foregroundColor(SpotcodeTheme.accent)
                        .overlay(Capsule().stroke(SpotcodeTheme.accent.opacity(0.55)))
                }
            }
            if let description = repo.description, !description.isEmpty {
                Text(description).spotcodeFont(15, weight: .regular, fallback: .subheadline)
            }
            HStack(spacing: 12) {
                if let language = repo.language {
                    HStack(spacing: 5) { Circle().fill(languageColor(language)).frame(width: 10, height: 10); Text(language) }
                }
                if repo.stars > 0 { Label("\(repo.stars)", systemImage: "star") }
                if let pushedAt = repo.pushedAt { Text(relativeTime(pushedAt)) }
            }.spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            Divider().overlay(SpotcodeTheme.border)
            if posts.isEmpty {
                Text("関連投稿はありません").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            } else {
                Text(String(format: NSLocalizedString("関連投稿 %lld件", comment: ""), Int64(posts.count))).spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold)).foregroundColor(SpotcodeTheme.muted)
                ForEach(posts.prefix(4)) { post in
                    NavigationLink(destination: PostDetailView(post: post)) {
                        HStack(spacing: 8) {
                            AvatarView(profile: post.displayAuthor, size: 24)
                            Text(post.body).spotcodeFont(12, weight: .regular, fallback: .caption).lineLimit(1).foregroundColor(SpotcodeTheme.text)
                            Spacer()
                            Image(systemName: "chevron.right").spotcodeFont(11, weight: .regular, fallback: .caption2).foregroundColor(SpotcodeTheme.muted)
                        }
                    }
                }
            }
        }.padding(SpotcodeLayout.value(16, 16)).frame(maxWidth: .infinity, alignment: .leading)
            .background(SpotcodeTheme.surface)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
    }

    private func load() async {
        repositories = []; relatedPosts = []; repositoryOwner = nil; repositoryNotice = ""
        guard let handle = model.me?.githubHandle, let session = model.session else { return }
        loading = true; defer { loading = false }
        do {
            let loaded: [Repository]
            let githubToken = await model.hydrateSharedPrivateIssueToken()
            if githubToken != nil || model.me?.isOrg == true {
                do {
                    if model.me?.isOrg == true {
                        loaded = try await model.syncGithubOrganizations(includeRepositories: true).repositories ?? []
                    } else {
                        loaded = try await SupabaseService.shared.authorizedGithubRepositories(handle: handle, githubToken: githubToken ?? "")
                    }
                } catch {
                    loaded = try await SupabaseService.shared.repositories(handle: handle)
                    guard session.user.id == model.session?.user.id else { return }
                    repositoryNotice = error.localizedDescription
                }
            } else {
                loaded = try await SupabaseService.shared.repositories(handle: handle)
            }
            guard session.user.id == model.session?.user.id else { return }
            repositoryOwner = session.user.id
            repositories = loaded.sorted { ($0.pushedAt ?? "") > ($1.pushedAt ?? "") }
            let posts = (try? await SupabaseService.shared.posts(limit: 200, token: session.accessToken)) ?? []
            guard session.user.id == model.session?.user.id else { return }
            relatedPosts = posts
        } catch { model.errorMessage = error.localizedDescription }
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
    @AppStorage("spotcode.notifications.followedPosts") private var followedPostScope = "off"
    @State private var notifications: [AppNotification] = []
    @State private var loading = false
    var body: some View {
        VStack(spacing: 0) {
            #if targetEnvironment(macCatalyst)
            Text("Notifications").spotcodeFont(18, weight: .bold, fallback: .headline)
                .frame(maxWidth: .infinity, alignment: .leading).padding(20)
            #else
            PageHeader(title: "Notifications")
            #endif
            if loading && notifications.isEmpty { Spacer(); ProgressView("通知を読み込み中…"); Spacer() }
            else if notifications.isEmpty { Spacer(); ContentUnavailableViewCompat(title: "通知はありません", icon: "bell"); Spacer() }
            else { ScrollView { LazyVStack(spacing: 0) { ForEach(filterNotifications(notifications)) { notification in
                NotificationRow(notification: notification) {
                    await respond(to: notification, accept: $0)
                }
            }}}.refreshable { await load() } }
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true).task(id: "\(model.session?.user.id.uuidString ?? "guest"):\(model.me?.id?.uuidString ?? "loading"):\(followedPostScope)") { notifications = []; await load() }
    }
    private func load() async {
        guard let id = model.me?.id else { return }
        let scope = followedPostScope
        loading = true; defer { loading = false }
        do {
            var session = try await model.validSession()
            let result: [AppNotification]
            do {
                result = try await SupabaseService.shared.notifications(userID: id, handle: model.me?.handle ?? "", token: session.accessToken)
            } catch where AppModel.isExpiredSessionError(error) {
                session = try await model.validSession(forceRefresh: true)
                guard model.session?.user.id == id else { return }
                result = try await SupabaseService.shared.notifications(userID: id, handle: model.me?.handle ?? "", token: session.accessToken)
            }
            guard !Task.isCancelled, model.session?.user.id == id, scope == followedPostScope else { return }
            notifications = filterNotifications(result)
        } catch {
            guard !Task.isCancelled, model.session?.user.id == id else { return }
            model.errorMessage = AppModel.isExpiredSessionError(error)
                ? NSLocalizedString("ログインの有効期限が切れました。もう一度ログインしてください。", comment: "")
                : error.localizedDescription
        }
    }

    private func filterNotifications(_ values: [AppNotification]) -> [AppNotification] {
        values.filter { value in
            if let id = value.actor.id, model.blockedAccountIDs.contains(id) || model.mutedAccountIDs.contains(id) { return false }
            switch value.kind {
            case .followedPost: return followedPostScope != "off"
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
    @State private var showingPost = false
    @State private var showingActor = false
    @State private var hovered = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                NavigationLink(destination: ProfileLookupView(handle: notification.actor.handle)) {
                    AvatarView(profile: notification.actor, size: SpotcodeLayout.value(44 / 0.77, 44))
                }.buttonStyle(SpotcodePlainButtonStyle())
                Image(systemName: icon).font(.system(size: 10, weight: .bold)).foregroundColor(.white)
                    .frame(width: 20, height: 20).background(badgeColor).clipShape(Circle())
                    .overlay(Circle().stroke(SpotcodeTheme.surface, lineWidth: 2))
            }
            VStack(alignment: .leading, spacing: 6) {
                #if targetEnvironment(macCatalyst)
                (Text(notification.actor.name).bold()
                 + Text(" @\(notification.actor.handle)").foregroundColor(SpotcodeTheme.muted)
                 + Text(" " + label)
                 + Text(notification.createdAt.map { " · " + relativeTime($0) } ?? "").foregroundColor(SpotcodeTheme.muted))
                    .spotcodeFont(15, fallback: .subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                #else
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    NavigationLink(destination: ProfileLookupView(handle: notification.actor.handle)) {
                        HStack(spacing: 4) {
                            Text(notification.actor.name).fontWeight(.bold)
                            Text("@\(notification.actor.handle)").foregroundColor(SpotcodeTheme.muted)
                        }
                    }.buttonStyle(SpotcodePlainButtonStyle())
                    Spacer(minLength: 4)
                    if let date = notification.createdAt { Text(relativeTime(date)).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted) }
                }
                Text(LocalizedStringKey(label)).spotcodeFont(15, weight: .regular, fallback: .subheadline).foregroundColor(SpotcodeTheme.muted)
                #endif
                if let context = (notification.kind == .followedPost ? notification.post?.body : notification.context ?? notification.post?.body), !context.isEmpty {
                    Text(context).spotcodeFont(14, weight: .regular, fallback: .subheadline).foregroundColor(SpotcodeTheme.muted).lineLimit(3).padding(SpotcodeLayout.value(12, 9))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                if notification.kind == .followRequest {
                    HStack {
                        Button("承認") { act(true) }.buttonStyle(OutlineButtonStyle(filled: true))
                        Button("拒否") { act(false) }.buttonStyle(OutlineButtonStyle())
                    }.disabled(responding)
                }
            }
        }
        .padding(SpotcodeLayout.value(20, 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(hovered ? SpotcodeTheme.surface2.opacity(0.5) : SpotcodeTheme.surface)
        .contentShape(Rectangle())
        .onTapGesture {
            if notification.post != nil && notification.kind != .followRequest { showingPost = true }
            else if notification.kind == .follow { showingActor = true }
        }
        .onHover { hovered = $0 }
        .background {
            if let post = notification.post, notification.kind != .followRequest {
                NavigationLink(destination: PostDetailView(post: post), isActive: $showingPost) { EmptyView() }
                    .hidden().accessibilityHidden(true)
            }
            NavigationLink(destination: ProfileLookupView(handle: notification.actor.handle), isActive: $showingActor) { EmptyView() }
                .hidden().accessibilityHidden(true)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }

    private var label: String {
        switch notification.kind {
        case .followedPost: return notification.context ?? NSLocalizedString("投稿しました", comment: "")
        case .like: return NSLocalizedString("あなたの投稿にいいねしました", comment: "")
        case .comment: return NSLocalizedString("あなたの投稿にコメントしました", comment: "")
        case .mention: return NSLocalizedString("あなたをメンションしました", comment: "")
        case .follow: return NSLocalizedString("あなたをフォローしました", comment: "")
        case .followRequest: return NSLocalizedString("フォローをリクエストしました", comment: "")
        }
    }
    private var icon: String {
        switch notification.kind {
        case .followedPost: return "mappin.circle.fill"
        case .like: return "heart.fill"
        case .comment: return "bubble.left.fill"
        case .mention: return "at"
        case .follow, .followRequest: return "person.fill"
        }
    }
    private var badgeColor: Color {
        switch notification.kind {
        case .followedPost: return SpotcodeTheme.accent
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
                            isOwn: (!model.isPostingAsOfficial && profile.id == model.me?.id) || (
                                model.isPostingAsOfficial &&
                                profile.id == model.officialProfile?.id &&
                                (model.me?.isAdmin == true || model.me?.isOperator == true)
                            )
                        )
                        HStack(spacing: 0) {
                            ForEach(["Posts", "Spots", "Likes"].indices, id: \.self) { index in
                                Button { selectedTab = index } label: {
                                    VStack(spacing: 13) {
                                        Text(["Posts", "Spots", "Likes"][index]).spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont)
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
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
         .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true)
         .background(SwipeBackEnabler())
         .task(id: profile?.id) { await loadProfile() }
         .onReceive(model.$posts) { timelinePosts in
             guard let profileID = profile?.id else { return }
             profilePosts = mergedProfilePosts(
                 profilePosts,
                 timelinePosts.filter { ($0.authorID == profileID || $0.organizationAuthorID == profileID) }
             )
         }
         .onReceive(model.$lastUpdatedPost) { updated in
             guard let updated = updated, let index = profilePosts.firstIndex(where: { $0.id == updated.id }) else { return }
             if updated.authorID == profile?.id || updated.organizationAuthorID == profile?.id {
                 profilePosts[index] = updated
             } else {
                 profilePosts.remove(at: index)
             }
         }
    }

    private func loadProfile() async {
        guard let id = profile?.id else { return }
        async let posts = try? SupabaseService.shared.posts(limit: 80, authorID: id, token: model.session?.accessToken)
        async let stats = SupabaseService.shared.profileCounts(userID: id, token: model.session?.accessToken)
        let fetchedPosts = await posts ?? []
        let timelinePosts = model.posts.filter { ($0.authorID == id || $0.organizationAuthorID == id) }
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
                        HStack(spacing: 12) { AvatarView(profile: profile, size: SpotcodeLayout.value(40, 42)); VStack(alignment: .leading) { Text(profile.name).fontWeight(.bold); Text("@\(profile.handle)").foregroundColor(SpotcodeTheme.muted) } }
                    }.listRowBackground(SpotcodeTheme.surface)
                }.listStyle(.plain)
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
                .navigationTitle("Search").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { dismiss() } } }
                .task { await search() }
        }.preferredColorScheme(.dark)
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
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
    @State private var followState = "none"
    private var isFollowing: Bool { followState != "none" }
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
                        Button("Edit profile") { editing = true }.spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.weight(.bold)).foregroundColor(SpotcodeTheme.background)
                            .padding(.horizontal, 20).padding(.vertical, SpotcodeLayout.value(9, 11)).background(SpotcodeTheme.text).clipShape(Capsule()).padding(.top, 14)
                    } else if model.session != nil {
                        HStack(spacing: 10) {
                            Menu {
                                Button("プロフィールURLをコピー") {
                                    UIPasteboard.general.string = "https://hrmcngs.github.io/spotcode-sns/#/\(profile.handle)"
                                }
                                if let handle = profile.githubHandle {
                                    Link("GitHubで開く", destination: URL(string: "https://github.com/\(handle)")!)
                                }
                                if let id = profile.id { ProfileSocialActions(profile: profile, targetID: id) }
                            } label: { Text("More").profileActionCapsule(filled: false) }
                            if isFollowing && !model.isPostingAsOfficial {
                                FollowAudienceMenu(profile: profile, title: "Following", unfollow: { toggleFollow() })
                                    .profileActionCapsule(filled: false).disabled(followLoading)
                            } else {
                                Button(followLoading ? "…" : (followState == "pending" ? "Requested" : "Follow")) { toggleFollow() }
                                    .profileActionCapsule(filled: !isFollowing).disabled(followLoading)
                            }
                        }.padding(.top, 14)
                    }
                }.frame(height: 63)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 9) {
                        Text(profile.name).spotcodeFont(28, weight: .bold, fallback: .title.weight(.bold))
                        if !hideBadges {
                            Text("{ }").spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent)
                                .padding(.horizontal, 8).padding(.vertical, 3).overlay(Capsule().stroke(SpotcodeTheme.accent))
                            ForEach(languageStats.prefix(4)) { language in
                                LanguageMedal(language: language)
                            }
                        }
                    }.padding(.vertical, 5)
                }
                Text("@\(profile.handle)").spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont).foregroundColor(SpotcodeTheme.muted)
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
                                Image(systemName: "checkmark").spotcodeFont(12, weight: .bold, fallback: .caption.bold()).foregroundColor(.green)
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
                        HStack(spacing: 6) { Text("𝕏").spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.bold()); Text("@\(twitter)") }
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if let instagram = profile.instagram, !instagram.isEmpty, let url = URL(string: "https://instagram.com/\(instagram)") {
                    Link(destination: url) {
                        Label("@\(instagram)", systemImage: "camera")
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                HStack(spacing: 22) {
                    if let id = profile.id {
                        NavigationLink(destination: FollowListView(userID: id, kind: .following)) { ProfileCount(value: counts.following, label: "Following") }.buttonStyle(SpotcodePlainButtonStyle())
                        NavigationLink(destination: FollowListView(userID: id, kind: .followers)) { ProfileCount(value: counts.followers, label: "Followers") }.buttonStyle(SpotcodePlainButtonStyle())
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
         .task(id: model.displayProfile?.id) { await loadFollowStatus() }
    }

    private func loadFollowStatus() async {
        followState = "none"
        guard !isOwn, let followerID = model.displayProfile?.id, let targetID = profile.id,
              let token = model.session?.accessToken else { return }
        let state = (try? await SupabaseService.shared.followStatus(followerID: followerID, targetID: targetID, token: token)) ?? "none"
        guard model.displayProfile?.id == followerID else { return }
        followState = state
    }

    private func toggleFollow() {
        guard let followerID = model.displayProfile?.id, let targetID = profile.id,
              let token = model.session?.accessToken else { return }
        followLoading = true
        Task {
            do {
                if isFollowing { try await SupabaseService.shared.unfollow(followerID: followerID, targetID: targetID, token: token) }
                else { try await SupabaseService.shared.follow(followerID: followerID, targetID: targetID, isPrivate: profile.isPrivate == true, token: token) }
                guard model.displayProfile?.id == followerID else { followLoading = false; return }
                followState = isFollowing ? "none" : (profile.isPrivate == true ? "pending" : "accepted")
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

private struct ProfileSocialActions: View {
    @EnvironmentObject private var model: AppModel
    let profile: Profile
    let targetID: UUID
    @State private var busy = false
    var body: some View {
        Group {
            Button(model.mutedAccountIDs.contains(targetID) ? NSLocalizedString("ミュート解除", comment: "") : NSLocalizedString("ミュート", comment: "")) {
                perform { try await model.setMuted(targetID, enabled: !model.mutedAccountIDs.contains(targetID)) }
            }
            Button(model.blockedAccountIDs.contains(targetID) ? NSLocalizedString("ブロック解除", comment: "") : NSLocalizedString("ブロック", comment: ""), role: .destructive) {
                perform {
                    if model.blockedAccountIDs.contains(targetID) { try await model.unblock(targetID) }
                    else { try await model.blockProfile(targetID) }
                }
            }
        }.disabled(busy || model.session == nil || model.isPostingAsOfficial)
    }
    private func perform(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }; busy = true
        Task { defer { busy = false }; do { try await action() } catch { model.errorMessage = error.localizedDescription } }
    }
}

private struct FollowAudienceMenu: View {
    @EnvironmentObject private var model: AppModel
    let profile: Profile
    var title: String? = nil
    var unfollow: (() -> Void)? = nil
    @State private var busy = false
    var body: some View {
        Menu {
            Button { change("friends", enabled: !friends) } label: {
                Label(friends ? NSLocalizedString("親しい友達から解除", comment: "") : NSLocalizedString("親しい友達に登録", comment: ""), systemImage: friends ? "checkmark.circle.fill" : "heart")
            }
            Button { change("org", enabled: !organization) } label: {
                Label(organization ? NSLocalizedString("同じ組織から解除", comment: "") : NSLocalizedString("同じ組織に登録", comment: ""), systemImage: organization ? "checkmark.circle.fill" : "building.2")
            }
            if let unfollow { Button("フォロー解除", role: .destructive, action: unfollow) }
        } label: { Label(title ?? (friends || organization ? NSLocalizedString("登録済み", comment: "") : NSLocalizedString("リストに登録", comment: "")), systemImage: "person.crop.circle.badge.checkmark").spotcodeFont(12, weight: .regular, fallback: .caption) }
        .disabled(busy)
    }
    private var friends: Bool { model.me?.closeFriends?.contains(profile.handle) == true }
    private var organization: Bool { model.me?.orgMembers?.contains(profile.handle) == true }
    private func change(_ kind: String, enabled: Bool) {
        guard !busy, let id = profile.id else { return }; busy = true
        Task { defer { busy = false }; do { try await model.setAudienceMember(id, kind: kind, enabled: enabled) }
            catch { model.errorMessage = error.localizedDescription } }
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
            HStack {
                NavigationLink(destination: ProfileView(profile: profile)) {
                    HStack(spacing: 12) { AvatarView(profile: profile, size: SpotcodeLayout.value(40, 42)); VStack(alignment: .leading) { Text(profile.name).fontWeight(.bold); Text("@\(profile.handle)").foregroundColor(SpotcodeTheme.muted) } }
                }
                if kind == .following && userID == model.session?.user.id && !model.isPostingAsOfficial {
                    FollowAudienceMenu(profile: profile)
                }
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
                        .spotcodeFont(13, weight: .regular, fallback: .footnote).foregroundColor(SpotcodeTheme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if model.me?.isOrg != true { GitHubConnectionPermissions() }
                if model.me?.isOrg == true {
                    GitHubOrganizationSettings()
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
                        Button(saving ? NSLocalizedString("保存中…", comment: "") : NSLocalizedString("保存", comment: "")) { saving = true; Task { if await model.updateProfile(name: name, bio: bio, location: location, website: normalizedWebsiteValue, twitter: sanitizeSocialHandle(twitter), instagram: sanitizeSocialHandle(instagram), avatarURL: avatarURL, avatarShape: avatarShape) { isPresented = false }; saving = false } }.disabled(name.isEmpty || saving || !websiteIsValid)
                    }
                }
                .onAppear { name = profile.name; bio = profile.bio ?? ""; location = profile.location ?? ""; website = profile.website ?? ""; twitter = profile.twitter ?? ""; instagram = profile.instagram ?? ""; avatarURL = profile.avatarURL; avatarShape = profile.avatarShape ?? "round" }
                .sheet(isPresented: $showingImagePicker) { ProfileImagePicker(image: $avatarURL) }
        }.preferredColorScheme(.dark)
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
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
    var showsTitle = true
    private var cells: [GitHubContribution] { Array(contributions.suffix(26 * 7)) }
    var body: some View {
        Link(destination: URL(string: "https://github.com/\(handle)?tab=contributions")!) {
          VStack(alignment: .leading, spacing: 8) {
            if showsTitle {
                HStack(spacing: 5) { Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13); Text("GitHub activity"); Text("last 12 months").foregroundColor(SpotcodeTheme.muted) }.spotcodeFont(12, weight: .regular, fallback: .caption)
            }
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
        }.buttonStyle(SpotcodePlainButtonStyle())
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
    @EnvironmentObject private var model: AppModel
    let handle: String
    let result: GitHubIssueSearchResponse?
    @AppStorage("spotcode.hiddenIssueRepos") private var hiddenIssueReposJSON = "[]"
    @AppStorage("spotcode.selectedIssueReposByUser") private var selectedIssueReposJSON = "{}"
    @State private var listExpanded = false
    @State private var expandedIssues: Set<Int> = []
    @State private var selectedRepository: String?
    private var allowedIssues: [GitHubIssue] {
        let selected = selectedRepoSet(selectedIssueReposJSON, owner: model.session?.user.id)
        return (result?.items ?? []).filter { !$0.isHiddenFromSpotcode && selected.contains($0.repositoryName.lowercased()) }
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
            HStack(spacing: 6) { RepoMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: 13, height: 13).foregroundColor(SpotcodeTheme.muted); Text("Open issues").foregroundColor(SpotcodeTheme.muted); Text("\(total)").fontWeight(.bold); Spacer(); Text("公開リポの未クローズ issue (task)").spotcodeFont(11, weight: .regular, fallback: .caption2).foregroundColor(SpotcodeTheme.muted)
                if !allowedIssues.isEmpty {
                    Button(listExpanded ? NSLocalizedString("折りたたむ", comment: "") : NSLocalizedString("リストを表示", comment: "")) { withAnimation { listExpanded.toggle() } }
                        .spotcodeFont(11, weight: .regular, fallback: .caption2).foregroundColor(SpotcodeTheme.muted).padding(.horizontal, 8).padding(.vertical, 3)
                        .overlay(Capsule().stroke(SpotcodeTheme.border))
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    Button { selectedRepository = nil; listExpanded = true; expandedIssues.removeAll() } label: {
                        Text("All \(total)").issueFilterPill(selected: selectedRepository == nil)
                    }.buttonStyle(SpotcodePlainButtonStyle())
                    ForEach(issueGroups, id: \.key) { entry in
                        Button { selectedRepository = entry.key; listExpanded = true; expandedIssues.removeAll() } label: {
                            Text("\(entry.key.split(separator: "/").last.map(String.init) ?? entry.key) \(entry.value.count)")
                                .issueFilterPill(selected: selectedRepository == entry.key)
                        }.buttonStyle(SpotcodePlainButtonStyle())
                    }
                }.foregroundColor(SpotcodeTheme.text)
            }
            if result == nil {
                ProgressView("Issueを読み込み中…").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            } else if allowedIssues.isEmpty {
                Text("未クローズのIssueはありません").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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
                                Image(systemName: "chevron.down").spotcodeFont(11, weight: .regular, fallback: .caption2).foregroundColor(SpotcodeTheme.muted)
                                    .rotationEffect(.degrees(expandedIssues.contains(issue.id) ? 0 : -90)).frame(width: 22, height: 22)
                            }.buttonStyle(SpotcodePlainButtonStyle())
                            Text(issue.title).spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold)).lineLimit(expandedIssues.contains(issue.id) ? nil : 1)
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
                            }.buttonStyle(SpotcodePlainButtonStyle()).foregroundColor(SpotcodeTheme.muted)
                            if let due = issue.dueDate { Text(dueLabel(due)).issueDuePill(status: dueStatus(due)) }
                            Link(destination: issue.htmlURL) {
                                Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13)
                            }.foregroundColor(SpotcodeTheme.muted)
                        }
                        if !issue.labels.isEmpty {
                            HStack(spacing: 4) {
                                ForEach(Array(issue.labels.prefix(3)), id: \.name) { label in
                                    Text(label.name).spotcodeFont(11, weight: .regular, fallback: .caption2).foregroundColor(SpotcodeTheme.muted)
                                        .padding(.horizontal, 6).padding(.vertical, 1).overlay(Capsule().stroke(SpotcodeTheme.border))
                                }
                            }.padding(.leading, 28)
                        }
                        if expandedIssues.contains(issue.id) {
                            if let body = issue.body, !body.isEmpty {
                                IssueMarkdownView(source: body)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(SpotcodeLayout.value(10, 12))
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
        }.padding(SpotcodeLayout.value(10, 12)).overlay(RoundedRectangle(cornerRadius: 10).stroke(SpotcodeTheme.border)).padding(.top, 8)
            .onAppear { collapseAll() }
            .onChange(of: handle) { _ in collapseAll() }
    }

    private func dueLabel(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"
        let days = Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: Date()), to: Calendar.current.startOfDay(for: date)).day ?? 0
        return "\(formatter.string(from: date)) · " + (days < 0 ? String(format: NSLocalizedString("%lld日超過", comment: ""), Int64(-days)) : String(format: NSLocalizedString("あと%lld日", comment: ""), Int64(days)))
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
        .spotcodeFont(12, weight: .regular, fallback: .caption)
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
    func issuePill() -> some View { self.spotcodeFont(12, weight: .regular, fallback: .caption).padding(.horizontal, 9).padding(.vertical, 5).overlay(Capsule().stroke(SpotcodeTheme.border)) }
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
                Text("Settings").spotcodeFont(22, weight: .bold, fallback: .title2.weight(.bold))
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
            }.padding(SpotcodeLayout.value(16, 16))
        }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true)
    }
}

private struct SettingsTab: View {
    let title: String; let icon: String; let selected: Bool; let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Label { Text(LocalizedStringKey(title)) } icon: { Image(systemName: icon) }
                    .spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold))
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
        VStack(alignment: .leading, spacing: 14) { Text(LocalizedStringKey(title)).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont); content }
            .padding(SpotcodeLayout.value(16, 16)).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
    }
}

private struct SettingsStatusTag: View {
    let text: String
    let enabled: Bool
    var body: some View {
        Text(LocalizedStringKey(text)).spotcodeFont(12, weight: .bold, fallback: .caption.bold())
            .foregroundColor(enabled ? .green : SpotcodeTheme.muted)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background((enabled ? Color.green : SpotcodeTheme.muted).opacity(0.12))
            .clipShape(Capsule())
            .overlay(Capsule().stroke((enabled ? Color.green : SpotcodeTheme.muted).opacity(0.45)))
    }
}

private struct GitHubOrganizationSettings: View {
    @EnvironmentObject private var model: AppModel
    @State private var busy = false
    @State private var message = ""
    @State private var login = ""
    @State private var challenge: SupabaseService.OrganizationFileChallenge?

    var body: some View {
        SettingsCard("GitHub Organization") {
            if model.me?.isOrg == true {
                Text("公開の.githubリポジトリに確認ファイルを追加して承認します。承認後もファイルは残してください。")
                    .foregroundColor(SpotcodeTheme.muted)
                TextField("Organization名（Drowse-Lab）", text: $login)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().spotcodeField()
                Button("確認コードを発行") { perform(issue: true) }.disabled(busy)
                if let challenge {
                    Text(challenge.login + "/.github → spotcode-verification.txt")
                        .spotcodeFont(12, weight: .regular, fallback: .caption).textSelection(.enabled)
                    Text("次の内容をファイルに保存してください。有効期限は24時間です。")
                    Text(challenge.content).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    Button("確認コードをコピー") { UIPasteboard.general.string = challenge.content }
                    Link("GitHubでファイルを追加", destination: challenge.create_url)
                    Button("確認して承認") { perform(issue: false) }.disabled(busy)
                }
            }
            Button("連携状態を確認") { synchronize() }.disabled(busy)
            if let linked = model.linkedGithubOrganization { Text(linked.login).fontWeight(.bold) }
            if busy { ProgressView() }
            if !message.isEmpty { Text(message).spotcodeFont(12, weight: .regular, fallback: .caption) }
        }
    }
    private func perform(issue: Bool) {
        guard !busy else { return }
        let owner = model.session?.user.id
        busy = true
        message = ""
        if issue { challenge = nil }
        Task {
            defer { busy = false }
            do {
                if issue {
                    let result = try await model.issueOrganizationFile(login: login.trimmingCharacters(in: .whitespacesAndNewlines))
                    guard model.session?.user.id == owner else { return }
                    challenge = result
                    message = NSLocalizedString("確認ファイルをコミットしてください。", comment: "")
                } else {
                    try await model.confirmOrganizationFile()
                    guard model.session?.user.id == owner else { return }
                    challenge = nil
                    message = NSLocalizedString("Organizationを承認しました。", comment: "")
                }
            } catch {
                guard model.session?.user.id == owner else { return }
                message = error.localizedDescription
            }
        }
    }
    private func synchronize() {
        busy = true
        Task {
            defer { busy = false }
            do { try await model.syncGithubOrganizations(); message = NSLocalizedString("更新しました", comment: "") }
            catch { message = error.localizedDescription }
        }
    }
}

private struct GitHubConnectionPermissions: View {
    @EnvironmentObject private var model: AppModel
    @State private var busy = false
    @State private var message = ""
    @State private var authorizer: GitHubPrivateIssueAuthorizer?

    var body: some View {
        SettingsCard("GitHub") {
            Text("Organizationへのアクセスは、最初のGitHub連携時にGitHubの認証画面で許可します。管理者の承認が必要な場合があります。")
                .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            if let handle = model.me?.githubHandle { Text("@" + handle).fontWeight(.semibold) }
            Button(model.me?.githubHandle == nil ? NSLocalizedString("GitHubと連携", comment: "") : NSLocalizedString("GitHubの連携権限を更新", comment: "")) { authorize() }.disabled(busy)
            if busy { ProgressView("GitHubで認証中…") }
            if !message.isEmpty { Text(message).spotcodeFont(12, weight: .regular, fallback: .caption) }
        }
    }
    private func authorize() {
        busy = true
        let flow = GitHubPrivateIssueAuthorizer()
        authorizer = flow
        Task {
            defer { busy = false; authorizer = nil }
            do {
                let session = try await model.validSession()
                let owner = session.user.id
                if model.me?.isOrg == true {
                    let existing = await model.hydrateSharedPrivateIssueToken()
                    var includePrivate = UserDefaults.standard.bool(forKey: "spotcode.privateIssuesEnabled")
                    if let existing, (try? await SupabaseService.shared.githubTokenCanReadPrivateRepos(existing)) == true { includePrivate = true }
                    let token = try await flow.authorize(includePrivate: includePrivate)
                    guard model.session?.user.id == owner else { throw CancellationError() }
                    model.savePrivateIssueToken(token)
                    try await model.uploadPrivateIssueToken(token)
                    try await model.syncGithubOrganizations()
                    message = NSLocalizedString("連携するOrganizationを選んでください。", comment: "")
                    return
                }
                if model.me?.githubHandle == nil {
                    let url = try await SupabaseService.shared.githubLinkAuthorizationURL(token: session.accessToken)
                    guard model.session?.user.id == owner else { throw CancellationError() }
                    let token = try await flow.authorize(url: url)
                    try await model.completeGithubLink(owner: owner, githubToken: token)
                    message = NSLocalizedString("GitHubと連携しました。", comment: "")
                    return
                }
                let existing = await model.hydrateSharedPrivateIssueToken()
                var includePrivate = UserDefaults.standard.bool(forKey: "spotcode.privateIssuesEnabled")
                if let existing, (try? await SupabaseService.shared.githubTokenCanReadPrivateRepos(existing)) == true { includePrivate = true }
                let token = try await flow.authorize(includePrivate: includePrivate)
                guard model.session?.user.id == owner else { throw CancellationError() }
                model.savePrivateIssueToken(token)
                try await model.uploadPrivateIssueToken(token)
                _ = try? await model.syncGithubOrganizations()
                message = NSLocalizedString("更新しました", comment: "")
            } catch { message = error.localizedDescription }
        }
    }
}

private struct AccountSettings: View {
    @EnvironmentObject private var model: AppModel
    @State private var showAddAccount = false
    @State private var isOrg = false
    @State private var organization = ""
    @State private var savingIdentity = false
    var body: some View {
        VStack(spacing: SpotcodeLayout.value(12, 18)) {
            SettingsCard("アカウント") {
                Text("この端末にログイン済みのアカウントを切り替えられます。アカウント自体は削除されません。").foregroundColor(SpotcodeTheme.muted)
                ForEach(model.savedAccounts) { account in
                    let active = account.id == model.session?.user.id && !model.isPostingAsOfficial
                    Button {
                        guard !active else { return }
                        Task { _ = await model.switchAccount(to: account.id) }
                    } label: {
                        HStack {
                            AvatarView(profile: account.profile, size: SpotcodeLayout.value(40, 42))
                            VStack(alignment: .leading) {
                                Text(account.profile.name).fontWeight(.bold)
                                HStack(spacing: 4) {
                                    Text("@\(account.profile.handle)")
                                    if active {
                                        Text("·")
                                        Text("現在")
                                    }
                                }.spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                            }
                            Spacer()
                            if !active { Text("切り替え").spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent) }
                        }
                        .padding(SpotcodeLayout.value(10, 12))
                        .background(active ? Color(red: 23/255, green: 40/255, blue: 54/255) : SpotcodeTheme.surface2)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                    }.buttonStyle(SpotcodePlainButtonStyle())
                }
                Button("＋ 別のアカウントでログイン") { showAddAccount = true }.buttonStyle(OutlineButtonStyle())
            }
            MFASettingsCard()
            SettingsCard("役割") {
                Label { Text(LocalizedStringKey(roleTitle)) } icon: { Image(systemName: model.me?.isAdmin == true ? "sparkles" : (model.me?.isOperator == true ? "flag" : "person")) }.foregroundColor(SpotcodeTheme.accent)
                Text(LocalizedStringKey(roleDescription)).foregroundColor(SpotcodeTheme.muted)
            }
            SettingsCard("アカウントの種類") {
                SettingsStatusTag(text: isOrg ? NSLocalizedString("組織アカウント", comment: "") : NSLocalizedString("個人アカウント", comment: ""), enabled: isOrg)
                Text(isOrg ? NSLocalizedString("プロフィールに組織バッジを表示します。", comment: "") : NSLocalizedString("個人のプログラマープロフィールとして表示します。", comment: "")).foregroundColor(SpotcodeTheme.muted)
                Button(isOrg ? NSLocalizedString("個人アカウントに変更", comment: "") : NSLocalizedString("組織アカウントに変更", comment: "")) {
                    isOrg.toggle(); saveIdentity()
                }.buttonStyle(OutlineButtonStyle(filled: !isOrg)).disabled(savingIdentity)
            }
            GitHubOrganizationSettings()
            SettingsCard("所属・組織名") {
                Text("プロフィールに表示する会社・学校・コミュニティ名を設定します。").foregroundColor(SpotcodeTheme.muted)
                TextField("所属名", text: $organization).spotcodeField()
                Button("保存") { saveIdentity() }.buttonStyle(OutlineButtonStyle()).disabled(savingIdentity)
            }
        }.sheet(isPresented: $showAddAccount) { LoginView(isPresented: $showAddAccount).environmentObject(model) }
         .onAppear { isOrg = model.me?.isOrg ?? false; organization = model.me?.organization ?? "" }
    }
    private var roleTitle: String { model.me?.isAdmin == true ? NSLocalizedString("管理者", comment: "") : (model.me?.isOperator == true ? NSLocalizedString("運営者", comment: "") : NSLocalizedString("一般ユーザー", comment: "")) }
    private var roleDescription: String {
        if model.me?.isAdmin == true { return NSLocalizedString("すべての管理権限を持ちます。", comment: "") }
        if model.me?.isOperator == true { return NSLocalizedString("通報対応・投稿管理・ピン管理を行えます。", comment: "") }
        return NSLocalizedString("通常の投稿・フォロー・スポット機能を利用できます。", comment: "")
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
        VStack(spacing: SpotcodeLayout.value(12, 18)) {
            Text("この区画は管理者だけに表示されます。接続情報や内部IDは一般ユーザーには表示されません。")
                .foregroundColor(SpotcodeTheme.muted)
            SettingsCard("Developer mode") {
                Toggle("開発者向けUIを表示", isOn: $developerMode)
                    .onChange(of: developerMode) { _ in Task { await model.loadTimeline() } }
                Text("通知キューや内部IDなどの開発者向け表示を、この端末で切り替えます。")
                    .foregroundColor(SpotcodeTheme.muted)
                Text(developerMode ? "ON" : "OFF").spotcodeFont(12, weight: .bold, fallback: .caption.bold())
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
                    Text("CONNECTED").spotcodeFont(12, weight: .bold, fallback: .caption.bold()).foregroundColor(.green)
                    Spacer()
                    Text(LocalizedStringKey(currentMode)).spotcodeFont(12, weight: .bold, fallback: .caption.bold()).foregroundColor(.green)
                }
                Text(URL(string: projectURL)?.host ?? projectURL).font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                HStack {
                    Button("接続テスト") { testConnection() }.buttonStyle(OutlineButtonStyle())
                    Button(showOverride ? NSLocalizedString("編集を閉じる", comment: "") : NSLocalizedString("自分のSupabaseに上書き", comment: "")) { showOverride.toggle() }
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
                        .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.warning)
                }
                if !message.isEmpty {
                    Text(message).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(messageIsError ? SpotcodeTheme.warning : .green)
                }
            }
        }
    }

    private var currentMode: String {
        projectURL == SupabaseService.defaultProjectURL ? NSLocalizedString("共有プロジェクト (DEFAULT)", comment: "") : "CUSTOM"
    }

    private func setDevPassword() {
        busy = true; message = NSLocalizedString("設定中…", comment: ""); messageIsError = false
        Task {
            do {
                let session = try await model.validSession()
                try await SupabaseService.shared.ensureDevAccount(password: password, token: session.accessToken)
                password = ""; message = NSLocalizedString("パスワードを設定しました。", comment: "")
            } catch { message = error.localizedDescription; messageIsError = true }
            busy = false
        }
    }

    private func testConnection() {
        guard let normalized = validatedConnection() else { return }
        busy = true; message = NSLocalizedString("接続を確認中…", comment: ""); messageIsError = false
        Task {
            do {
                try await SupabaseService.shared.testConnection(projectURL: normalized.0, publishableKey: normalized.1)
                message = NSLocalizedString("接続できました。", comment: "")
            } catch { message = String(format: NSLocalizedString("接続できませんでした: %@", comment: ""), error.localizedDescription); messageIsError = true }
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
                message = NSLocalizedString("保存しました。新しい接続先へログインしてください。", comment: ""); messageIsError = false
            } catch { message = String(format: NSLocalizedString("保存できませんでした: %@", comment: ""), error.localizedDescription); messageIsError = true }
            busy = false
        }
    }

    private func restoreDefault() {
        Task {
            await SupabaseService.shared.restoreDefaultConnection()
            projectURL = SupabaseService.defaultProjectURL
            publishableKey = SupabaseService.defaultPublishableKey
            model.signOut()
            message = NSLocalizedString("標準接続に戻しました。もう一度ログインしてください。", comment: ""); messageIsError = false
        }
    }

    private func validatedConnection() -> (String, String)? {
        let url = projectURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let key = publishableKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parsed = URL(string: url), parsed.scheme == "https", parsed.host?.contains(".supabase.") == true else {
            message = NSLocalizedString("https://…supabase.co 形式のProject URLを入力してください。", comment: ""); messageIsError = true; return nil
        }
        guard isPublicKey(key) else {
            message = NSLocalizedString("publishable key または anon public JWT を入力してください。", comment: ""); messageIsError = true; return nil
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
                Text(factor == nil ? "OFF" : "ON").spotcodeFont(12, weight: .bold, fallback: .caption.bold())
                    .foregroundColor(factor == nil ? SpotcodeTheme.muted : .green)
                Spacer()
            }
            Text("ログイン時に認証アプリが生成する6桁のワンタイムパスワードを要求します。")
                .foregroundColor(SpotcodeTheme.muted)
            Button(factor == nil ? NSLocalizedString("2段階認証を設定する", comment: "") : NSLocalizedString("2段階認証を無効にする", comment: "")) {
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
            if !message.isEmpty { Text(message).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.warning) }
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
                    do { try await model.disableMFA(factor); self.factor = nil; message = NSLocalizedString("無効にしました", comment: "") }
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
                VStack(spacing: SpotcodeLayout.value(16, 16)) {
                    Text("認証アプリでワンタイムパスワードの追加を選び、QRコードを読み取ってください。")
                    if let image = qrImage(enrollment.totp.uri ?? enrollment.totp.secret) {
                        Image(uiImage: image).interpolation(.none).resizable().frame(width: 240, height: 240).padding(10).background(Color.white).cornerRadius(12)
                    }
                    Text("読み取れない場合").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                    Text(enrollment.totp.secret).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    TextField("6桁コード", text: $code)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .onChange(of: code) { value in
                            code = String(value.filter(\.isNumber).prefix(6))
                        }
                        .spotcodeField()
                    Button(busy ? NSLocalizedString("確認中…", comment: "") : NSLocalizedString("確認して有効にする", comment: "")) {
                        busy = true
                        Task {
                            do { try await model.confirmMFAEnrollment(enrollment, code: code); completed(); dismiss() }
                            catch { errorMessage = NSLocalizedString("確認コードが違うか、有効期限が切れています。", comment: ""); busy = false }
                        }
                    }.buttonStyle(OutlineButtonStyle(filled: true)).disabled(busy)
                    if !errorMessage.isEmpty { Text(errorMessage).foregroundColor(SpotcodeTheme.warning) }
                }.padding()
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationTitle("2段階認証")
        }.preferredColorScheme(.dark)
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
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
    var body: some View { VStack(spacing: SpotcodeLayout.value(12, 18)) {
        SettingsCard("アカウントの公開範囲") {
            SettingsStatusTag(text: privateAccount ? NSLocalizedString("非公開", comment: "") : NSLocalizedString("公開", comment: ""), enabled: privateAccount)
            Text(privateAccount ? NSLocalizedString("承認したフォロワーだけが投稿を表示できます。", comment: "") : NSLocalizedString("すべてのユーザーが投稿を表示できます。", comment: "")).foregroundColor(SpotcodeTheme.muted)
            Button(privateAccount ? NSLocalizedString("公開アカウントにする", comment: "") : NSLocalizedString("非公開アカウントにする", comment: "")) { privateAccount.toggle(); save() }
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
    #if targetEnvironment(macCatalyst)
    @AppStorage(MacTextSize.key) private var macTextSize = 1
    #endif
    @State private var compact = false
    @AppStorage("spotcode.hideBadges") private var hideBadges = false
    @AppStorage("spotcode.hideTasks") private var hideTasks = false
    @State private var issueRepositories: [String] = []
    @State private var issueRepositoryQuery = ""
    @AppStorage("spotcode.hiddenIssueRepos") private var hiddenIssueReposJSON = "[]"
    @AppStorage("spotcode.selectedIssueReposByUser") private var selectedIssueReposJSON = "{}"
    @AppStorage("spotcode.privateIssuesEnabled") private var privateIssuesEnabled = false
    @State private var authorizingPrivateIssues = false
    @State private var privateIssueMessage = ""
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
    @State private var requestingNotifications = false
    @AppStorage("spotcode.notifications.likes") private var notifyLikes = true
    @AppStorage("spotcode.notifications.comments") private var notifyComments = true
    @AppStorage("spotcode.notifications.mentions") private var notifyMentions = true
    @AppStorage("spotcode.notifications.follows") private var notifyFollows = true
    @AppStorage("spotcode.notifications.followedPosts") private var followedPostScope = "off"
    private var appLanguage: String { Bundle.main.preferredLocalizations.first ?? "en" }
    var body: some View { VStack(spacing: SpotcodeLayout.value(12, 18)) {
        #if targetEnvironment(macCatalyst)
        SettingsCard("文字サイズ") {
            Picker("文字サイズ", selection: $macTextSize) {
                ForEach(MacTextSize.labels.indices, id: \.self) { index in
                    Text(LocalizedStringKey(MacTextSize.labels[index])).tag(index)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("settings.macTextSize")
            Text("投稿やメニュー、入力欄の文字サイズを変更します。")
                .foregroundColor(SpotcodeTheme.muted)
            Text("文字サイズのプレビュー").spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
            Button("標準に戻す") { macTextSize = 1 }
                .buttonStyle(OutlineButtonStyle()).disabled(macTextSize == 1)
        }
        #endif
        SettingsCard("Language") {
            #if targetEnvironment(macCatalyst)
            Text("Macのシステム設定の「一般」→「言語と地域」で、アプリの言語を変更できます。")
            #else
            Button("iOS設定でアプリの言語を変更") { openSystemSettings() }.buttonStyle(OutlineButtonStyle())
            #endif
            Text("権限確認もアプリと同じ言語で表示されます。")
                .foregroundColor(SpotcodeTheme.muted)
        }
        SettingsCard("装飾バッジの表示") {
            SettingsStatusTag(text: hideBadges ? NSLocalizedString("非表示", comment: "") : NSLocalizedString("表示", comment: ""), enabled: !hideBadges)
            Text("プロフィールや投稿の { }・言語・アイデア・WIPなどのバッジをまとめて切り替えます。").foregroundColor(SpotcodeTheme.muted)
            Button(hideBadges ? NSLocalizedString("バッジを表示する", comment: "") : NSLocalizedString("バッジを非表示にする", comment: "")) { hideBadges.toggle() }
                .buttonStyle(OutlineButtonStyle(filled: hideBadges))
        }
        issueDisplayCard
        SettingsCard("通知") {
            HStack {
                Label { Text(LocalizedStringKey(notificationStatusText)) } icon: { Image(systemName: notificationStatus == .authorized ? "bell.badge.fill" : "bell.slash") }
                    .foregroundColor(notificationStatus == .authorized ? .green : SpotcodeTheme.muted)
                Spacer()
            }
            Text("いいね・コメント・メンション・フォローなどを端末の通知として受け取ります。")
                .foregroundColor(SpotcodeTheme.muted)
            if notificationStatus == .denied {
                Button("端末の通知設定を開く") { openSystemSettings() }
                    .buttonStyle(OutlineButtonStyle(filled: true))
                Text("通知が拒否されています。端末の設定でSpotcodeの通知を許可してください。")
                    .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.warning)
            } else if notificationStatus != .authorized && notificationStatus != .provisional {
                Button(requestingNotifications ? NSLocalizedString("確認中…", comment: "") : NSLocalizedString("通知をONにする", comment: "")) { requestNotificationPermission() }
                    .buttonStyle(OutlineButtonStyle(filled: true)).disabled(requestingNotifications)
            } else {
                Button("端末の通知設定を開く") { openSystemSettings() }.buttonStyle(OutlineButtonStyle())
            }
            Divider().overlay(SpotcodeTheme.border)
            Text("通知する内容").spotcodeFont(15, weight: .bold, fallback: .subheadline.weight(.bold))
            Toggle("いいね", isOn: $notifyLikes)
            Toggle("コメント", isOn: $notifyComments)
            Toggle("メンション", isOn: $notifyMentions)
            Toggle("フォロー・フォローリクエスト", isOn: $notifyFollows)
            Picker("投稿と地区の通知", selection: $followedPostScope) {
                Text("OFF").tag("off")
                Text("相互フォロー").tag("mutuals")
                Text("フォロー中").tag("following")
            }
            Text("投稿のスポットの市区町村を表示します。スポットがない投稿は地区未設定になります。アプリ利用中に新着を確認し、通知一覧と端末のバナーに表示します。")
                .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            Text("種類別の設定はSpotcode内の通知一覧に適用されます。通知音やバナー表示は端末の通知設定で変更できます。")
                .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
        }
        SettingsCard("地図") {
            Text("スポット機能で使用するApple Mapsと位置情報を確認します。").foregroundColor(SpotcodeTheme.muted)
            Button("地図をテスト") { openSystemSettings() }.buttonStyle(OutlineButtonStyle())
        }
        SafetySettingsCard()
        SettingsCard("Spotcodeについて") {
            Text("Spotcodeは、コード・スポット・アイデアを共有するSNSです。").foregroundColor(SpotcodeTheme.muted)
            Link("利用規約", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/terms.html")!)
            Link("プライバシーポリシー", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/privacy.html")!)
                .foregroundColor(SpotcodeTheme.accent)
        }
    }.task {
        await refreshNotificationStatus()
        await hydratePreferences()
        await loadIssueRepositories()
    }}

    private var privateIssueDisplayBinding: Binding<Bool> {
        Binding(

                get: { privateIssuesEnabled },
                set: { enabled in
                    if enabled {
                        authorizingPrivateIssues = true
                        Task {
                            do {
                                let token: String
                                if let shared = await model.hydrateSharedPrivateIssueToken(),
                                   try await SupabaseService.shared.githubTokenCanReadPrivateRepos(shared) {
                                    token = shared
                                } else {
                                    token = try await GitHubPrivateIssueAuthorizer.shared.authorize()
                                }
                                model.savePrivateIssueToken(token)
                                try await model.uploadPrivateIssueToken(token)
                                privateIssuesEnabled = true
                                await savePreferences()
                                privateIssueMessage = NSLocalizedString("GitHubの非公開Issue表示を有効にしました。", comment: "")
                                await loadIssueRepositories()
                            } catch {
                                privateIssuesEnabled = false
                                privateIssueMessage = error.localizedDescription
                            }
                            authorizingPrivateIssues = false
                        }
                    } else {
                        privateIssuesEnabled = false
                        Task { await savePreferences(); await loadIssueRepositories() }
                    }
                }

        )
    }

    private var matchingIssueRepositories: [String] {
        let query = issueRepositoryQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        return issueRepositories.filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }
    }

    private var issueDisplayCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("プロフィールに Open issue (task) を表示").spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
                Text(hideTasks ? NSLocalizedString("非表示", comment: "") : NSLocalizedString("表示", comment: ""))
                    .spotcodeFont(12, weight: .bold, fallback: .caption.bold()).foregroundColor(SpotcodeTheme.muted)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .overlay(Capsule().stroke(SpotcodeTheme.border))
                    .fixedSize()
            }
            Text("プロフィールページの下に「Open issues」カード (GitHub の未クローズ issue = task 一覧) を出します。OFF にするとカード自体が消え、GitHub Search API の呼び出しもスキップします。")
                .foregroundColor(SpotcodeTheme.muted)
            Button(hideTasks ? NSLocalizedString("タスクを表示する", comment: "") : NSLocalizedString("タスクを非表示にする", comment: "")) { hideTasks.toggle() }
                .buttonStyle(OutlineButtonStyle())
            Text("表示するリポジトリ").spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
            TextField("リポジトリ名で検索（owner/repo）", text: $issueRepositoryQuery)
                .textInputAutocapitalization(.never).autocorrectionDisabled(true)
                .spotcodeField()
                .accessibilityLabel(Text("表示するリポジトリ"))
            if issueRepositories.isEmpty {
                Text("表示できるリポジトリがありません。").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            } else if matchingIssueRepositories.isEmpty {
                Text("一致するリポジトリがありません。").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(matchingIssueRepositories, id: \.self) { repo in
                            issueRepositoryRow(repo)
                        }
                    }
                }.frame(maxHeight: 280)
            }
            Button(privateIssuesEnabled ? NSLocalizedString("非公開Issue表示をOFF", comment: "") : NSLocalizedString("非公開Issue表示をON", comment: "")) {
                privateIssueDisplayBinding.wrappedValue.toggle()
            }
            .buttonStyle(OutlineButtonStyle())
            .disabled(authorizingPrivateIssues || model.me?.githubHandle == nil)
            if authorizingPrivateIssues { ProgressView("GitHubで認証中…") }
            if !privateIssueMessage.isEmpty {
                Text(privateIssueMessage).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            }
        }
        .padding(SpotcodeLayout.value(16, 16)).frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(SpotcodeTheme.border))
    }

    private func issueRepositoryRow(_ repo: String) -> some View {
        let selected = selectedRepoSet(selectedIssueReposJSON, owner: model.session?.user.id).contains(repo.lowercased())
        return Button {
            var repos = selectedRepoSet(selectedIssueReposJSON, owner: model.session?.user.id)
            if selected { repos.remove(repo.lowercased()) } else { repos.insert(repo.lowercased()) }
            selectedIssueReposJSON = storingSelectedRepos(repos, in: selectedIssueReposJSON, owner: model.session?.user.id)
            Task { await savePreferences() }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: selected ? "checkmark.square.fill" : "square")
                    .foregroundColor(selected ? SpotcodeTheme.accent : SpotcodeTheme.muted)
                Text(repo).font(.system(.body, design: .monospaced))
                    .foregroundColor(SpotcodeTheme.text).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, SpotcodeLayout.value(8, 10))
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(SpotcodeTheme.border))
        }
        .buttonStyle(SpotcodePlainButtonStyle())
        .accessibilityLabel(Text(repo))
        .accessibilityValue(Text(selected ? NSLocalizedString("選択済み", comment: "") : NSLocalizedString("未選択", comment: "")))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private var notificationStatusText: String {
        switch notificationStatus {
        case .authorized, .provisional: return NSLocalizedString("通知 ON", comment: "")
        case .denied: return NSLocalizedString("通知 OFF", comment: "")
        case .notDetermined: return NSLocalizedString("未設定", comment: "")
        case .ephemeral: return NSLocalizedString("一時的に許可", comment: "")
        @unknown default: return NSLocalizedString("未設定", comment: "")
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
            } catch { model.errorMessage = String(format: NSLocalizedString("通知を有効にできませんでした: %@", comment: ""), error.localizedDescription) }
            await refreshNotificationStatus()
            requestingNotifications = false
        }
    }

    private func openSystemSettings() {
        #if targetEnvironment(macCatalyst)
        guard let url = URL(string: "x-apple.systempreferences:") else { return }
        #else
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        #endif
        UIApplication.shared.open(url)
    }

    private func hydratePreferences() async {
        guard let id = model.me?.id else { return }
        do {
            let session = try await model.validSession()
            if let value = try await SupabaseService.shared.issueDisplayPreferences(userID: id, token: session.accessToken) {
                guard model.session?.user.id == id else { return }
                if let selected = value.selectedRepos {
                    selectedIssueReposJSON = storingSelectedRepos(Set(selected.map { $0.lowercased() }), in: selectedIssueReposJSON, owner: id)
                }
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
                selectedRepos: Array(selectedRepoSet(selectedIssueReposJSON, owner: id)).sorted(),
                includePrivate: privateIssuesEnabled,
                token: session.accessToken
            )
        } catch {
            // Keep the device-local value and retry on the next settings load.
        }
    }

    private func loadIssueRepositories() async {
        guard let handle = model.me?.githubHandle, let owner = model.session?.user.id else { return }
        var repositories: [Repository] = []
        let repositoryToken = await model.hydrateSharedPrivateIssueToken()
        if repositoryToken != nil || model.me?.isOrg == true,
           let result = try? await (model.me?.isOrg == true
               ? model.syncGithubOrganizations(includeRepositories: true).repositories ?? []
               : SupabaseService.shared.authorizedGithubRepositories(handle: handle, githubToken: repositoryToken ?? "")) {
            repositories = result
        } else {
            repositories = (try? await SupabaseService.shared.repositories(handle: handle)) ?? []
        }
        let token = privateIssuesEnabled ? await model.hydrateSharedPrivateIssueToken() : nil
        let result = try? await SupabaseService.shared.githubOpenIssues(
            handle: handle, githubToken: token, includePrivate: privateIssuesEnabled && token != nil
        )
        guard model.session?.user.id == owner else { return }
        issueRepositories = Array(Set(repositories.map(\.fullName) + (result?.items.map(\.repositoryName) ?? []))).sorted()
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

    func authorize(includePrivate: Bool = true) async throws -> String {
        guard let authorizationURL = await SupabaseService.shared.privateIssueAuthorizationURL(includePrivate: includePrivate) else {
            throw URLError(.badURL)
        }
        return try await authorize(url: authorizationURL)
    }

    func authorize(url authorizationURL: URL, responseKey: String = "provider_token") async throws -> String {
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: authorizationURL, callbackURLScheme: "spotcode") { [weak self] callbackURL, error in
                defer { self?.webSession = nil }
                if let error { continuation.resume(throwing: error); return }
                if let callbackURL, let message = Self.callbackValues(callbackURL)["error_description"] {
                    continuation.resume(throwing: NSError(domain: "GitHubOAuth", code: -3, userInfo: [NSLocalizedDescriptionKey: message]))
                    return
                }
                guard let callbackURL,
                      callbackURL.scheme == "spotcode", callbackURL.host == "github-oauth",
                      let token = Self.callbackValues(callbackURL)[responseKey], !token.isEmpty else {
                    continuation.resume(throwing: NSError(
                        domain: "GitHubOAuth", code: -1,
                        userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("GitHubの権限トークンを取得できませんでした。", comment: "")]
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
                    userInfo: [NSLocalizedDescriptionKey: NSLocalizedString("GitHub認証画面を開けませんでした。", comment: "")]
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

// Define the hit area after sizing the label, including transparent padding.
private struct SpotcodePlainButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        #if targetEnvironment(macCatalyst)
        configuration.label
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.7 : 1)
        #else
        configuration.label.contentShape(Rectangle()).opacity(configuration.isPressed ? 0.7 : 1)
        #endif
    }
}

private struct OutlineButtonStyle: ButtonStyle {
    var filled = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.bodyFont.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, SpotcodeLayout.value(8, 9))
            .foregroundColor(filled ? SpotcodeTheme.background : SpotcodeTheme.text)
            .background(filled ? SpotcodeTheme.text : Color.clear).clipShape(Capsule())
            .overlay(Capsule().stroke(SpotcodeTheme.border)).opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Capsule())
    }
}

private struct PageHeader: View {
    let title: String
    var body: some View { Text(LocalizedStringKey(title)).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont).frame(maxWidth: .infinity, alignment: .leading).padding(SpotcodeLayout.value(16, 16)).background(SpotcodeTheme.surface).overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) } }
}

private struct SafetySettingsCard: View {
    @EnvironmentObject private var model: AppModel
    @State private var events: [SupabaseService.ModerationEvent] = []
    @State private var names: [UUID: String] = [:]
    @State private var message = ""
    var body: some View {
        SettingsCard("安全・サポート") {
            Link("サポート・お問い合わせ", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/support.html")!)
            Text("ブロックしたユーザー").spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
            ForEach(Array(model.blockedAccountIDs).sorted { $0.uuidString < $1.uuidString }, id: \.self) { id in
                HStack {
                    Text(names[id] ?? id.uuidString).lineLimit(2)
                    Spacer()
                    Button(NSLocalizedString("ブロック解除", comment: "")) { Task { do { try await model.unblock(id) } catch { message = error.localizedDescription } } }
                }
            }
            if model.me?.isAdmin == true || model.me?.isOperator == true {
                Text("運営への通報・ブロック通知").spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
                ForEach(events) { event in
                    VStack(alignment: .leading) {
                        Text(event.kind + " · " + event.created_at).spotcodeFont(12, weight: .regular, fallback: .caption)
                        Text(event.detail)
                        if let post = event.post_id {
                            Link("対象の投稿を開く", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/#/post/" + post.uuidString)!)
                        }
                    }
                }
            }
            if !message.isEmpty { Text(message).spotcodeFont(12, weight: .regular, fallback: .caption) }
        }.task {
            do {
                let session = try await model.validSession()
                let rows = try await SupabaseService.shared.blockedAccounts(token: session.accessToken)
                guard model.session?.user.id == session.user.id else { return }
                names = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0.target?.handle ?? $0.id.uuidString) })
                if model.me?.isAdmin == true || model.me?.isOperator == true {
                    events = try await SupabaseService.shared.moderationEvents(token: session.accessToken)
                }
            } catch { message = error.localizedDescription }
        }
    }
}

private struct TermsAgreementContent: View {
    @Binding var agreed: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("利用規約への同意").spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
            Text("不適切な投稿、嫌がらせ、差別、脅迫、性的搾取、違法行為は禁止です。違反投稿の削除や利用停止を行います。通報・ブロック情報は運営に送信されます。")
            Link("利用規約を読む", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/terms.html")!)
            Link("プライバシーポリシー", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/privacy.html")!)
            Toggle("利用規約に同意します", isOn: $agreed)
        }
    }
}
private struct TermsAgreementGate: View {
    @EnvironmentObject private var model: AppModel
    @AppStorage("spotcode.terms.acceptedVersion") private var acceptedTerms = ""
    @State private var agreed = false
    var body: some View {
        ScrollView { VStack(spacing: 20) {
            TermsAgreementContent(agreed: $agreed)
            Button("同意して続ける") { acceptedTerms = "2026-09-08" }.disabled(!agreed)
            Button("ログアウト") { model.signOut() }
        }.padding(24).frame(maxWidth: 600) }
        .interactiveDismissDisabled()
    }
}

#if targetEnvironment(macCatalyst)
private struct LoginSheetSize: UIViewControllerRepresentable {
    var height: CGFloat = 800
    func makeUIViewController(context: Context) -> Controller { Controller() }
    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.desiredHeight = height
        controller.resizeSheet()
    }

    final class Controller: UIViewController {
        var desiredHeight: CGFloat = 800
        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            resizeSheet()
        }
        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            resizeSheet()
        }
        func resizeSheet() {
            guard view.window != nil else { return }
            // Catalyst can host the sheet in its own window. Measuring that
            // window here would repeatedly shrink the preferred size.
            let size = CGSize(width: 580, height: desiredHeight)
            var ancestor = parent
            while let controller = ancestor {
                if controller.presentingViewController != nil && controller.preferredContentSize != size {
                    controller.preferredContentSize = size
                }
                ancestor = controller.parent
            }
        }
    }
}
#endif

struct LoginView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @State private var showingSignup = false
    @State private var email = ""
    @State private var password = ""
    @State private var signing = false
    @State private var showsPassword = false
    @State private var otpCode = ""
    @State private var agreedToTerms = false
    @AppStorage("spotcode.terms.acceptedVersion") private var acceptedTerms = ""
    var body: some View {
        #if targetEnvironment(macCatalyst)
        DesktopLoginView(isPresented: $isPresented)
        #else
        NavigationView {
            ScrollView { VStack(spacing: 14) {
                TermsAgreementContent(agreed: $agreedToTerms)
                Image(systemName: "chevron.left.forwardslash.chevron.right").spotcodeFont(34, weight: .regular, fallback: .largeTitle)
                if model.requiresReauthentication && !model.requiresMFA {
                    Label("ログインセッションが無効になりました。アカウントを継続するため、もう一度ログインしてください。", systemImage: "lock.rotation")
                        .spotcodeFont(13, weight: .regular, fallback: .footnote).foregroundColor(SpotcodeTheme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10).background(SpotcodeTheme.warning.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                if model.requiresMFA {
                    Text("2段階認証").spotcodeFont(20, weight: .bold, fallback: .title3.bold())
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
                        guard agreedToTerms else { return }
                        acceptedTerms = "2026-09-08"
                        signing = true
                        Task {
                            let succeeded = await model.verifyMFA(code: otpCode)
                            signing = false
                            if succeeded { isPresented = false }
                        }
                    } label: {
                        Text(LocalizedStringKey(signing ? NSLocalizedString("確認中…", comment: "") : NSLocalizedString("確認してログイン", comment: "")))
                            .spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.weight(.bold))
                            .frame(maxWidth: .infinity)
                            .padding(SpotcodeLayout.value(10, 13))
                            .background(SpotcodeTheme.accent)
                            .foregroundColor(.white)
                            .clipShape(Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(SpotcodePlainButtonStyle())
                    .contentShape(Capsule())
                    .disabled(signing || !agreedToTerms)
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
                    .buttonStyle(SpotcodePlainButtonStyle())
                    .accessibilityLabel(showsPassword ? NSLocalizedString("パスワードを隠す", comment: "") : NSLocalizedString("パスワードを表示", comment: ""))
                }.spotcodeField()
                Button {
                    guard agreedToTerms else { return }
                    acceptedTerms = "2026-09-08"
                    signing = true
                    Task {
                        let succeeded = await model.signIn(emailOrAlias: email, password: password)
                        signing = false
                        if succeeded { isPresented = false }
                    }
                } label: {
                    Text(LocalizedStringKey(signing ? NSLocalizedString("ログイン中…", comment: "") : NSLocalizedString("ログイン", comment: "")))
                        .spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.weight(.bold))
                        .frame(maxWidth: .infinity)
                        .padding(SpotcodeLayout.value(10, 13))
                        .background(SpotcodeTheme.accent)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(SpotcodePlainButtonStyle())
                .contentShape(Capsule())
                .disabled(email.isEmpty || password.isEmpty || signing || !agreedToTerms)
                }
                #if !targetEnvironment(macCatalyst)
                if !model.requiresMFA && !model.requiresReauthentication {
                    Button("signup.create") { showingSignup = true }
                        .disabled(signing)
                        .padding(.vertical, 8)
                }
                #endif
                if let message = model.authenticationError, !message.isEmpty {
                    Label(message, systemImage: "exclamationmark.triangle.fill")
                        .spotcodeFont(13, weight: .regular, fallback: .footnote)
                        .foregroundColor(SpotcodeTheme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(SpotcodeTheme.warning.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }.padding().padding(.bottom, SpotcodeLayout.value(16, 0)) }
            .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
            #if targetEnvironment(macCatalyst)
            .navigationBarHidden(true)
            .safeAreaInset(edge: .top, spacing: 0) {
                HStack(spacing: 16) {
                    Button { isPresented = false } label: {
                        Text("閉じる").fixedSize(horizontal: true, vertical: false)
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("login.close")
                    Text("spotcodeへログイン")
                        .spotcodeFont(18, weight: .bold, fallback: .headline)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.padding(12).background(SpotcodeTheme.surface)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if !model.requiresMFA && !model.requiresReauthentication {
                    Button { showingSignup = true } label: {
                        Text("signup.create")
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain).disabled(signing)
                        .accessibilityIdentifier("login.createAccount")
                        .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 16)
                        .background(SpotcodeTheme.surface)
                }
            }
            #else
            .navigationTitle("spotcodeへログイン")
            .desktopInlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("閉じる") { isPresented = false }
                        .keyboardShortcut(.cancelAction)
                        .accessibilityIdentifier("login.close")
                }
            }
            #endif
        }
        .preferredColorScheme(.dark)
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
        .sheet(isPresented: $showingSignup) {
            SignupView { signedIn in
                showingSignup = false
                if signedIn { isPresented = false }
            }.environmentObject(model)
        }
        #if targetEnvironment(macCatalyst)
        .frame(idealWidth: 1000, idealHeight: 740)
        .background(LoginSheetSize().frame(width: 0, height: 0))
        #endif
        .onDisappear { model.authenticationError = nil }
        #endif
    }
}

#if targetEnvironment(macCatalyst)
private struct DesktopLoginView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @State private var signup = false
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var handle = ""
    @State private var code = ""
    @State private var agreed = false
    @State private var busy = false
    @State private var visiblePassword = false
    @State private var confirmation = false
    @State private var message = ""
    @AppStorage("spotcode.terms.acceptedVersion") private var acceptedTerms = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                tab("Log in", selected: !signup) { signup = false }
                tab("Sign up", selected: signup) { signup = true }
                Button { isPresented = false } label: {
                    Image(systemName: "xmark").frame(width: 36, height: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).keyboardShortcut(.cancelAction)
                    .accessibilityLabel("閉じる").accessibilityIdentifier("login.close")
            }.padding(.horizontal, 24).padding(.top, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if confirmation {
                        Text("signup.confirm_email")
                        Text(email).textSelection(.enabled)
                    } else {
                        Text("不適切な投稿、嫌がらせ、差別、脅迫、性的搾取、違法行為は禁止です。違反投稿の削除や利用停止を行います。通報・ブロック情報は運営に送信されます。")
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 8) {
                            Link("利用規約を読む", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/terms.html")!)
                            Text("·")
                            Link("プライバシーポリシー", destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/privacy.html")!)
                        }.spotcodeFont(12, fallback: .caption)
                        Button { agreed.toggle() } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: agreed ? "checkmark.square.fill" : "square")
                                    .foregroundColor(agreed ? SpotcodeTheme.accent : SpotcodeTheme.muted)
                                Text("利用規約に同意します").fixedSize(horizontal: false, vertical: true)
                            }.frame(maxWidth: .infinity, minHeight: 32, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityValue(agreed ? "ON" : "OFF")
                        if !model.requiresMFA {
                            Button { githubLogin() } label: {
                                Text("Continue with GitHub").fontWeight(.semibold)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .background(SpotcodeTheme.background).clipShape(Capsule())
                                    .overlay(Capsule().stroke(SpotcodeTheme.border)).contentShape(Capsule())
                            }.buttonStyle(.plain).disabled(busy || !agreed)
                            HStack(spacing: 12) {
                                Rectangle().fill(SpotcodeTheme.border).frame(height: 1)
                                Text("or").spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                                Rectangle().fill(SpotcodeTheme.border).frame(height: 1)
                            }
                                .padding(.vertical, 8)
                        }
                        Text(LocalizedStringKey(model.requiresMFA ? "2段階認証" : (signup ? "Sign up" : "Log in")))
                            .spotcodeFont(18, weight: .bold, fallback: .headline).padding(.top, 6)
                        if model.requiresMFA {
                            TextField("123456", text: $code).textContentType(.oneTimeCode).spotcodeField()
                                .onChange(of: code) { code = String($0.filter(\.isNumber).prefix(6)) }
                        } else {
                            if signup {
                                field("signup.name") { TextField("", text: $name).textContentType(.name) }
                                field("signup.handle") { TextField("", text: $handle).textInputAutocapitalization(.never).autocorrectionDisabled() }
                            }
                            field(signup ? "signup.email" : "メールまたはログイン名") {
                                TextField("", text: $email).textContentType(.username)
                                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                            }
                            field("パスワード") {
                                HStack {
                                    Group {
                                        if visiblePassword { TextField("", text: $password) }
                                        else { SecureField("", text: $password) }
                                    }.textContentType(signup ? .newPassword : .password)
                                    Button { visiblePassword.toggle() } label: {
                                        Image(systemName: visiblePassword ? "eye.slash" : "eye")
                                            .frame(width: 32, height: 28)
                                    }.buttonStyle(.plain).foregroundColor(SpotcodeTheme.accent)
                                        .accessibilityLabel("パスワードを表示")
                                }
                            }
                        }
                        Button { submit() } label: {
                            Text(LocalizedStringKey(busy ? "確認中…" : (model.requiresMFA ? "確認してログイン" : (signup ? "Sign up" : "Log in"))))
                                .spotcodeFont(14, weight: .bold, fallback: .headline)
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(SpotcodeTheme.text).foregroundColor(SpotcodeTheme.background)
                                .clipShape(Capsule()).contentShape(Capsule())
                        }.buttonStyle(.plain).disabled(busy || !agreed)
                    }
                    if !message.isEmpty { Text(message).foregroundColor(SpotcodeTheme.warning) }
                    if let error = model.authenticationError { Text(error).foregroundColor(SpotcodeTheme.warning) }
                }.padding(24)
            }
        }
        .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
        .preferredColorScheme(.dark).macTextSizePreference().spotcodeFont(14, fallback: .body)
        .background(LoginSheetSize(height: signup ? 920 : 800).frame(width: 0, height: 0))
        .onDisappear { model.authenticationError = nil }
    }

    private func tab(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button { action(); message = ""; confirmation = false } label: {
            VStack(spacing: 12) {
                Text(LocalizedStringKey(title)).fontWeight(.bold)
                Capsule().fill(selected ? SpotcodeTheme.accent : .clear).frame(width: 48, height: 3)
            }.padding(.top, 20).frame(maxWidth: .infinity).contentShape(Rectangle())
        }.buttonStyle(.plain).foregroundColor(selected ? SpotcodeTheme.text : SpotcodeTheme.muted)
            .disabled(busy || model.requiresMFA)
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(LocalizedStringKey(title)).spotcodeFont(12, weight: .semibold, fallback: .caption)
                .foregroundColor(SpotcodeTheme.muted)
            content().spotcodeField().accessibilityLabel(Text(LocalizedStringKey(title)))
        }
    }

    private func submit() {
        guard agreed, !busy else { return }
        busy = true; message = ""
        Task {
            defer { busy = false }
            if model.requiresMFA {
                if await model.verifyMFA(code: code) { acceptedTerms = "2026-09-08"; isPresented = false }
            } else if signup {
                do {
                    let input = try SignupInput(email: email, password: password, handle: handle, name: name)
                    let signedIn = try await model.createAccount(input)
                    acceptedTerms = "2026-09-08"; password = ""
                    if signedIn { isPresented = false } else { confirmation = true }
                } catch { message = error.localizedDescription }
            } else if await model.signIn(emailOrAlias: email, password: password) {
                acceptedTerms = "2026-09-08"; isPresented = false
            }
        }
    }

    private func githubLogin() {
        guard agreed, !busy else { return }
        busy = true; message = ""
        Task {
            defer { busy = false }
            do {
                guard let url = await SupabaseService.shared.privateIssueAuthorizationURL(includePrivate: false) else { throw URLError(.badURL) }
                let refreshToken = try await GitHubPrivateIssueAuthorizer.shared.authorize(url: url, responseKey: "refresh_token")
                if await model.signInWithOAuth(refreshToken: refreshToken) {
                    acceptedTerms = "2026-09-08"; isPresented = false
                }
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                // Closing the browser leaves the login form available.
            } catch { message = error.localizedDescription }
        }
    }
}
#endif

private struct SignupView: View {
    @EnvironmentObject private var model: AppModel
    let completed: (Bool) -> Void
    @State private var name = ""
    @State private var handle = ""
    @State private var email = ""
    @State private var password = ""
    @State private var agreed = false
    @State private var busy = false
    @State private var confirmationPending = false
    @State private var message = ""
    @AppStorage("spotcode.terms.acceptedVersion") private var acceptedTerms = ""

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: SpotcodeLayout.value(16, 16)) {
                    if confirmationPending {
                        Image(systemName: "envelope.badge").spotcodeFont(34, weight: .regular, fallback: .largeTitle)
                        Text("signup.confirm_email")
                        Text(email).textSelection(.enabled)
                        Button("signup.back_to_login") { completed(false) }
                            .buttonStyle(OutlineButtonStyle(filled: true))
                    } else {
                        TextField("signup.name", text: $name).textContentType(.name).spotcodeField()
                        TextField("signup.handle", text: $handle)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().spotcodeField()
                        Text("signup.handle_hint").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                        TextField("signup.email", text: $email)
                            .textContentType(.emailAddress).keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().spotcodeField()
                        SecureField("signup.password", text: $password)
                            .textContentType(.newPassword).textInputAutocapitalization(.never)
                            .autocorrectionDisabled().spotcodeField()
                        TermsAgreementContent(agreed: $agreed)
                        Button(busy ? NSLocalizedString("signup.creating", comment: "") : NSLocalizedString("signup.create", comment: "")) {
                            submit()
                        }.buttonStyle(OutlineButtonStyle(filled: true))
                            .disabled(busy || !agreed || name.isEmpty || handle.isEmpty || email.isEmpty || password.isEmpty)
                        if !message.isEmpty {
                            Text(message).spotcodeFont(13, weight: .regular, fallback: .footnote).foregroundColor(SpotcodeTheme.warning)
                        }
                    }
                }.padding().disabled(busy)
            }
            .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
            .navigationTitle("signup.create").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) {
                Button("signup.back_to_login") { completed(false) }.disabled(busy)
            } }
        }.preferredColorScheme(.dark)
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference().interactiveDismissDisabled(busy)
    }

    private func submit() {
        guard agreed, !busy else { return }
        message = ""
        do {
            let input = try SignupInput(email: email, password: password, handle: handle, name: name)
            busy = true
            Task {
                defer { busy = false }
                do {
                    let signedIn = try await model.createAccount(input)
                    acceptedTerms = "2026-09-08"
                    password = ""
                    if signedIn { completed(true) }
                    else { confirmationPending = true }
                } catch {
                    message = NSLocalizedString("signup.failed", comment: "") + "\n" + error.localizedDescription
                }
            }
        } catch { message = error.localizedDescription }
    }
}

struct ContentUnavailableViewCompat: View {
    let title: String; let icon: String
    var body: some View { VStack(spacing: 12) { Image(systemName: icon).spotcodeFont(34, weight: .regular, fallback: .largeTitle); Text(LocalizedStringKey(title)).multilineTextAlignment(.center) }.foregroundColor(SpotcodeTheme.muted).padding() }
}

private extension View {
    @ViewBuilder func spotcodeFont(_ size: CGFloat, weight: Font.Weight = .regular, fallback: Font) -> some View {
        #if targetEnvironment(macCatalyst)
        self.modifier(MacSizedFont(size: size, weight: weight))
        #else
        self.font(fallback)
        #endif
    }
    @ViewBuilder func macTextSizePreference() -> some View {
        #if targetEnvironment(macCatalyst)
        self.modifier(MacTextSizePreference())
        #else
        self
        #endif
    }
    @ViewBuilder func desktopInlineTitle() -> some View {
        #if targetEnvironment(macCatalyst)
        self.navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }
    @ViewBuilder func desktopAccountPlacement() -> some View {
        #if targetEnvironment(macCatalyst)
        self.frame(maxWidth: 400)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            .padding(.horizontal, 12).padding(.top, 80)
        #else
        self.padding(.horizontal, 15)
        #endif
    }
    func spotcodeIconButton() -> some View {
        self.foregroundColor(SpotcodeTheme.text).frame(width: SpotcodeLayout.iconSize, height: SpotcodeLayout.iconSize).contentShape(Rectangle()).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }
    func spotcodeField() -> some View {
        self.spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont).padding(SpotcodeLayout.value(10, 12)).background(SpotcodeTheme.background).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }
    func spotcodeURLField() -> some View {
        self.spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont).padding(SpotcodeLayout.value(10, 12)).background(SpotcodeTheme.inputSurface).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }
    func profileActionCapsule(filled: Bool) -> some View {
        self.spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.weight(.bold))
            .foregroundColor(filled ? SpotcodeTheme.background : SpotcodeTheme.text)
            .padding(.horizontal, 20).padding(.vertical, SpotcodeLayout.value(9, 11))
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

private func selectedRepoSet(_ value: String, owner: UUID?) -> Set<String> {
    guard let owner, let data = value.data(using: .utf8),
          let map = try? JSONDecoder().decode([String: [String]].self, from: data) else { return [] }
    return Set((map[owner.uuidString] ?? []).map { $0.lowercased() })
}

private func storingSelectedRepos(_ repos: Set<String>, in value: String, owner: UUID?) -> String {
    guard let owner else { return value }
    var map = value.data(using: .utf8).flatMap { try? JSONDecoder().decode([String: [String]].self, from: $0) } ?? [:]
    map[owner.uuidString] = repos.sorted()
    guard let data = try? JSONEncoder().encode(map) else { return value }
    return String(data: data, encoding: .utf8) ?? value
}
