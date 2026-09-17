import SwiftUI
import MapKit
import CoreLocation
import PhotosUI
import UniformTypeIdentifiers
import UIKit
import CoreImage
import ImageIO
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
    static let labels = [NSLocalizedString("小さい", comment: ""), NSLocalizedString("標準", comment: ""), NSLocalizedString("大きい", comment: ""), NSLocalizedString("特大", comment: ""), NSLocalizedString("最大", comment: "")]
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
        return .systemFont(ofSize: 20 * baseScale * scale(for: size))
    }
}

private struct MacSizedFont: ViewModifier {
    @AppStorage(MacTextSize.key) private var selection = 1
    let size: CGFloat
    let weight: Font.Weight
    func body(content: Content) -> some View {
        content.font(.system(size: ((size == 14 ? 16 : size) + 2) * MacTextSize.baseScale * MacTextSize.scale(for: MacTextSize.dynamicTypeSize(selection)), weight: weight))
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
    static var palette: [String: [String: String]]? {
        AppColorThemes.palettes[UserDefaults.standard.string(forKey: "spotcode.colorTheme") ?? "standard"]
    }
    private static func paletteColor(_ key: String, fallback: Color) -> Color {
        guard let variants = palette else { return fallback }
        return Color(UIColor { traits in
            let mode = traits.userInterfaceStyle == .dark ? "dark" : "light"
            guard let hex = variants[mode]?[key], let rgb = UInt32(hex.dropFirst(), radix: 16) else {
                return UIColor(fallback).resolvedColor(with: traits)
            }
            return UIColor(red: CGFloat((rgb >> 16) & 255) / 255,
                           green: CGFloat((rgb >> 8) & 255) / 255,
                           blue: CGFloat(rgb & 255) / 255, alpha: 1)
        })
    }
    // Resolve against each window's appearance, including live system changes.
    private static func neutral(_ light: CGFloat, _ dark: CGFloat) -> Color {
        Color(UIColor { traits in
            UIColor(white: traits.userInterfaceStyle == .dark ? dark : light, alpha: 1)
        })
    }
    static var background: Color { paletteColor("bg", fallback: neutral(0.98, 0.07)) }
    static var surface: Color { paletteColor("surface", fallback: neutral(1.0, 0.10)) }
    static var surface2: Color { paletteColor("surface-2", fallback: neutral(0.95, 0.15)) }
    static var inputSurface: Color { paletteColor("input-surface", fallback: neutral(1.0, 0.12)) }
    static var border: Color { paletteColor("border", fallback: neutral(0.84, 0.25)) }
    static var text: Color { neutral(0.125, 0.929) }
    static var muted: Color { neutral(0.349, 0.702) }
    static var accent: Color { paletteColor("accent", fallback: neutral(0.12, 0.90)) }
    static var onAccent: Color { paletteColor("on-accent", fallback: neutral(1.0, 0.08)) }
    static var warning: Color { paletteColor("warn", fallback: Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.99, green: 0.74, blue: 0.18, alpha: 1)
            : UIColor(red: 0.55, green: 0.34, blue: 0.02, alpha: 1)
    })) }
    static var selection: Color { paletteColor("selection", fallback: neutral(0.90, 0.21)) }
}

// Changing a palette invalidates colors without recreating forms or navigation.
private struct AppColorThemeKey: EnvironmentKey {
    static let defaultValue = "standard"
}
private extension EnvironmentValues {
    var appColorTheme: String {
        get { self[AppColorThemeKey.self] }
        set { self[AppColorThemeKey.self] = newValue }
    }
}

private struct AppAppearancePreference: ViewModifier {
    @AppStorage("spotcode.native.privacy-mode") private var privacyMode = false
    @AppStorage("spotcode.colorTheme") private var colorTheme = "standard"
    @AppStorage("spotcode.appearance") private var appearance = "system"
    private var scheme: ColorScheme? {
        switch appearance {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }
    func body(content: Content) -> some View {
        content.environment(\.appColorTheme, colorTheme + (privacyMode ? ":private" : "")).preferredColorScheme(scheme)
            .onAppear { colorTheme = AppColorThemes.normalizedName(colorTheme) }
    }
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

struct CityMapDestination: Identifiable {
    let id = UUID()
    let name: String
    let posts: [Post]
    var region: MKCoordinateRegion {
        let coordinates = posts.compactMap { $0.spot?.coordinate }
        let latitudes = coordinates.map(\.latitude), longitudes = coordinates.map(\.longitude)
        let south = latitudes.min() ?? 35.681236, north = latitudes.max() ?? south
        let west = longitudes.min() ?? 139.767125, east = longitudes.max() ?? west
        return .init(center: .init(latitude: (south + north) / 2, longitude: (west + east) / 2),
                     span: .init(latitudeDelta: max(0.006, (north - south) * 1.5),
                                 longitudeDelta: max(0.006, (east - west) * 1.5)))
    }
}

struct RootView: View {
    @AppStorage("spotcode.colorTheme") private var selectedColorTheme = "standard"
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var section: AppSection = .home
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("spotcode.notifications.followedPosts") private var followedPostScope = "off"
    @State private var drawerOpen = false
    #if !targetEnvironment(macCatalyst)
    @ObservedObject private var nearbyNotifications = NearbySpotNotifications.shared
    @AppStorage("spotcode.notifications.nearbySpots") private var notifyNearbySpots = true
    @State private var showingNearbySpots = false
    private var nearbyNotificationContext: String {
        let coordinate = nearbyNotifications.location?.coordinate
        return [model.session?.user.id.uuidString ?? "guest", String(describing: scenePhase),
                String(notifyNearbySpots), String(nearbyNotifications.authorization.rawValue),
                String(model.requiresReauthentication), appLanguage,
                model.blockedAccountIDs.map(\.uuidString).sorted().joined(),
                model.mutedAccountIDs.map(\.uuidString).sorted().joined(),
                String(Int((coordinate?.latitude ?? 0) * 1000)), String(Int((coordinate?.longitude ?? 0) * 1000))].joined(separator: ":")
    }
    #endif
    @State private var showLogin = false
    @State private var composing = false
    @State private var showAccounts = false
    @State private var repositoryComposeURL: String?
    @State private var navigationReset = UUID()
    @State private var cityDestination: CityMapDestination?
    @State private var recommendedProfileHandle: String?
    @AppStorage("spotcode.terms.acceptedVersion") private var acceptedTerms = ""
    @AppStorage("spotcode.language") private var appLanguage = AppLocalization.language

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
        let _ = selectedColorTheme
        let _ = appColorTheme

        ZStack(alignment: .leading) {
            SpotcodeTheme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                TopBar(drawerOpen: $drawerOpen, section: $section, showAccounts: $showAccounts, showLogin: $showLogin, navigationReset: $navigationReset)
                #if targetEnvironment(macCatalyst)
                NavigationView { sectionView }
                    .id(navigationReset).navigationViewStyle(.stack)
                    .frame(maxWidth: 1280, maxHeight: .infinity)
                    .padding(.horizontal, 24)
                    .frame(maxWidth: .infinity)
                #else
                HStack(spacing: 0) {
                    Spacer(minLength: horizontalSizeClass == .regular ? 24 : 0)
                    NavigationView { sectionView }
                        .id(navigationReset)
                        .navigationViewStyle(.stack)
                        .frame(maxWidth: horizontalSizeClass == .regular ? SpotcodeLayout.value(800, 720) : .infinity)
                        .padding(.horizontal, horizontalSizeClass == .regular ? 24 : 20)
                    Spacer(minLength: horizontalSizeClass == .regular ? 24 : 0)
                }
                #endif
            }
            .padding(.bottom, 80)
            .overlay(alignment: .bottomTrailing) {
                Button {
                    if model.session == nil { showLogin = true } else { composing = true }
                } label: {
                    Label(NSLocalizedString("投稿を書く", comment: ""), systemImage: "square.and.pencil")
                        .spotcodeFont(17, weight: .semibold, fallback: .body.weight(.semibold))
                        .padding(.horizontal, 20).frame(minHeight: 56)
                        .background(SpotcodeTheme.accent).foregroundColor(SpotcodeTheme.onAccent)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(SpotcodePlainButtonStyle())
                .accessibilityIdentifier("app.compose")
                .keyboardShortcut("n", modifiers: .command)
                .padding(.trailing, 20).padding(.bottom, 16)
            }
            #if !targetEnvironment(macCatalyst)
            if drawerOpen {
                Color.black.opacity(0.55).ignoresSafeArea().onTapGesture { withAnimation { drawerOpen = false } }
                SideDrawer(section: $section, open: $drawerOpen, navigationReset: $navigationReset)
                    .transition(.move(edge: .leading))
            }
            #endif
            if showAccounts {
                // Desktop account menus dismiss on outside clicks without dimming the page.
                Color.black.opacity(Double(SpotcodeLayout.value(0, 0.72)))
                    .contentShape(Rectangle()).ignoresSafeArea().onTapGesture { showAccounts = false }
                AccountSwitcher(isPresented: $showAccounts, showLogin: $showLogin)
                    .desktopAccountPlacement()
            }
        }
        .modifier(AppAppearancePreference())
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
        .environment(\.locale, Locale(identifier: appLanguage))
        .id(appLanguage)
        .tint(SpotcodeTheme.accent)
        .task {
            if let screenshotSection { section = screenshotSection }
            if screenshotShowsLogin {
                showLogin = true
            } else if model.session == nil && !model.sessionRestorePending && !screenshotMode {
                showLogin = true
            }
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-SpotcodeScreenshotShowAccounts") {
                showAccounts = true
            }
            #endif
            await model.bootstrap()
            #if DEBUG
            let arguments = ProcessInfo.processInfo.arguments
            if screenshotMode,
               let index = arguments.firstIndex(of: "-SpotcodeScreenshotAccount"),
               arguments.indices.contains(index + 1),
               let account = model.savedAccounts.first(where: { $0.profile.handle == arguments[index + 1] }) {
                _ = await model.switchAccount(to: account.id)
            }
            #endif
            if model.session != nil && !model.requiresReauthentication && !screenshotMode { showLogin = false }
        }
        .onChange(of: scenePhase) { phase in
            PostLocationGate.shared.setActive(phase == .active)
            if phase == .active && model.sessionRestorePending {
                Task { await model.bootstrap() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.protectedDataDidBecomeAvailableNotification)) { _ in
            if model.sessionRestorePending { Task { await model.bootstrap() } }
        }
        .task(id: "\(model.session?.user.id.uuidString ?? "guest"):\(scenePhase):\(followedPostScope)") {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                await model.pollFollowedPostNotifications()
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("spotcode.openNotifications"))) { _ in section = .notifications }
        #if !targetEnvironment(macCatalyst)
        .task(id: nearbyNotificationContext) {
            guard !screenshotMode else { return }
            guard scenePhase == .active else { nearbyNotifications.pause(); return }
            if UserDefaults.standard.bool(forKey: "spotcode.openNearbySpot") {
                UserDefaults.standard.removeObject(forKey: "spotcode.openNearbySpot")
                showingNearbySpots = true
            }
            while !Task.isCancelled {
                await nearbyNotifications.refresh(model: model, enabled: notifyNearbySpots)
                do { try await Task.sleep(nanoseconds: 60_000_000_000) } catch { return }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("spotcode.openNearbySpot"))) { _ in
            UserDefaults.standard.removeObject(forKey: "spotcode.openNearbySpot")
            showingNearbySpots = true
        }
        .sheet(isPresented: $showingNearbySpots) {
            NavigationView {
                NativeMapView()
                    .toolbar { ToolbarItem(placement: .cancellationAction) { MapSheetCloseButton { showingNearbySpots = false } } }
            }
        }
        #endif
        .onChange(of: navigationReset) { _ in recommendedProfileHandle = nil }
        .fullScreenCover(isPresented: Binding(get: { model.session != nil && acceptedTerms != "2026-09-08" && !showLogin }, set: { _ in })) {
            TermsAgreementGate().environmentObject(model)
        }
        #if targetEnvironment(macCatalyst)
        .blur(radius: showLogin ? 4 : 0)
        #endif
        .sheet(isPresented: $showLogin) { LoginView(isPresented: $showLogin).environmentObject(model) }
        .sheet(isPresented: $composing) { ComposeView(isPresented: $composing).environmentObject(model) }
        .alert(NSLocalizedString("エラー", comment: ""), isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            if model.sessionRestorePending { Button(NSLocalizedString("再試行", comment: "")) { Task { await model.bootstrap() } } }
            Button("OK") {}
        } message: { Text(LocalizedStringKey(model.errorMessage ?? "")) }
        .onChange(of: model.requiresReauthentication) { required in
            if required && !screenshotMode {
                showAccounts = false
                showLogin = true
            }
        }
    }

    @ViewBuilder private var sectionView: some View {
        switch section {
        case .home: TimelineView(repositoryComposeURL: $repositoryComposeURL, drawerOpen: $drawerOpen, cityDestination: cityDestination)
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
                    ContentUnavailableViewCompat(title: NSLocalizedString("ログインしてください", comment: ""), icon: "person.crop.circle")
                    Button(NSLocalizedString("ログイン", comment: "")) {
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
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        Group {
            #if targetEnvironment(macCatalyst)
            GeometryReader { geometry in
                let navigationWidth = min(660, max(160, geometry.size.width - 440))
                let sideWidth = max(0, (geometry.size.width - navigationWidth - 24) / 2)
                HStack(spacing: 12) {
                    brand.frame(width: sideWidth, alignment: .leading)
                    DesktopNavigation(section: $section, navigationReset: $navigationReset)
                        .frame(width: navigationWidth, height: 44)
                    HStack(spacing: 9) {
                        searchField
                        accountButton
                    }.frame(width: sideWidth, alignment: .trailing)
                }.frame(height: SpotcodeLayout.iconSize)
            }.frame(height: SpotcodeLayout.iconSize)
            #else
            HStack(spacing: 9) {
                Button { withAnimation(.easeOut(duration: 0.2)) { drawerOpen.toggle() } } label: {
                    Image(systemName: "line.3.horizontal").frame(width: SpotcodeLayout.iconSize, height: SpotcodeLayout.iconSize)
                }.spotcodeIconButton()
                brand
                searchField
                Spacer(minLength: 0)
                Button { section = .settings; navigationReset = UUID() } label: { Image(systemName: "gearshape") }.spotcodeIconButton()
                accountButton
            }
            #endif
        }
        .padding(.horizontal, SpotcodeLayout.value(16 / 0.77, 10)).padding(.vertical, SpotcodeLayout.value(10 / 0.77, 7))
        .frame(maxWidth: SpotcodeLayout.value(1328, .infinity))
        .frame(maxWidth: .infinity)
        .background(SpotcodeTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
        .sheet(isPresented: $showSearch) { ProfileSearchView(initialQuery: query).environmentObject(model) }
    }

    private var brand: some View {
        Button { section = .home; navigationReset = UUID() } label: {
            HStack(spacing: 7) {
                SpotcodePinMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: SpotcodeLayout.value(24, 25), height: SpotcodeLayout.value(24, 25))
                Text("spotcode").fontWeight(.bold).lineLimit(1)

            }.foregroundColor(SpotcodeTheme.text)
        }
    }

    private var searchField: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass").foregroundColor(SpotcodeTheme.muted)
            TextField(NSLocalizedString("Search…", comment: ""), text: $query).foregroundColor(SpotcodeTheme.text)
                .focused($searchFocused)
                .onSubmit { if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { showSearch = true } }
            #if targetEnvironment(macCatalyst)
            Button { searchFocused = true } label: {
                Text("/").foregroundColor(SpotcodeTheme.muted).padding(.horizontal, 6)
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(SpotcodeTheme.border))
            }.buttonStyle(SpotcodePlainButtonStyle()).keyboardShortcut("/", modifiers: []).accessibilityLabel(NSLocalizedString("Search…", comment: ""))
            #endif
        }
        .padding(.horizontal, 10).frame(height: SpotcodeLayout.iconSize)
        .frame(minWidth: 0, maxWidth: SpotcodeLayout.value(260, 520))
        .background(SpotcodeTheme.background)
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
    }

    private var accountButton: some View {
        Button {
            if model.session == nil { showLogin = true } else { showAccounts = true }
        } label: { AvatarView(profile: model.displayProfile, size: SpotcodeLayout.iconSize) }
    }
}

// Hover stays local to each row, avoiding redraws of the entire navigation.
private struct DesktopMenuRowStyle: ButtonStyle {
    var selected = false
    func makeBody(configuration: Configuration) -> some View {
        DesktopMenuRow(configuration: configuration, selected: selected)
    }

    private struct DesktopMenuRow: View {
        @Environment(\.appColorTheme) private var appColorTheme
        let configuration: ButtonStyleConfiguration
        let selected: Bool
        @State private var hovering = false
        var body: some View {
            let _ = appColorTheme

            configuration.label
                .frame(maxWidth: .infinity)
                .background(configuration.isPressed ? SpotcodeTheme.border :
                    (hovering ? SpotcodeTheme.selection : (selected ? SpotcodeTheme.surface2 : .clear)))
                .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
                .overlay(alignment: .bottom) {
                    if selected { Rectangle().fill(SpotcodeTheme.text).frame(height: 3) }
                }
                .contentShape(Rectangle())
                .onHover { hovering = $0 }
        }
    }
}

#if targetEnvironment(macCatalyst)
private struct DesktopNavigation: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Binding var section: AppSection
    @Binding var navigationReset: UUID

    var body: some View {
        GeometryReader { geometry in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(AppSection.allCases, id: \.self) { item in
                        Button {
                            section = item; navigationReset = UUID()
                        } label: {
                            Text(LocalizedStringKey(item.rawValue))
                                .spotcodeFont(16, weight: .bold, fallback: .body)
                                .fixedSize(horizontal: true, vertical: false)
                                .hidden()
                                .overlay {
                                    Text(LocalizedStringKey(item.rawValue))
                                        .spotcodeFont(16, weight: section == item ? .bold : .regular, fallback: .body)
                                        .fixedSize(horizontal: true, vertical: false)
                                }
                                .padding(.horizontal, 12).frame(minHeight: 44)
                                .foregroundColor(SpotcodeTheme.text).contentShape(Rectangle())
                        }.buttonStyle(DesktopMenuRowStyle(selected: section == item))
                            .accessibilityAddTraits(section == item ? .isSelected : [])
                            .accessibilityIdentifier("desktop.nav.\(item.rawValue)")
                    }

                }.frame(minWidth: geometry.size.width)
            }
        }
    }
}

private struct DesktopCommunity: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let openProfile: (Profile) -> Void
    let openCity: (CityMapDestination) -> Void
    @State private var profiles: [Profile] = []
    @State private var contributions: [GitHubContribution] = []
    @State private var busy: Set<UUID> = []
    @State private var followed: Set<UUID> = []
    @State private var requested: Set<UUID> = []
    @State private var message: String?
    @State private var loading = true
    @State private var spotPosts: [Post] = []

    private var cities: [(name: String, prefecture: String, posts: [Post])] {
        let visible = spotPosts.filter {
            !model.blockedAccountIDs.contains($0.authorID) && !model.mutedAccountIDs.contains($0.authorID)
                && $0.spot?.lat.isFinite == true && $0.spot?.lng.isFinite == true
        }
        let groups = Dictionary(grouping: visible, by: { $0.spot?.addressDetails?.canonicalCity ?? "" })
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
        let _ = appColorTheme

        ScrollView {
            VStack(spacing: 20) {
                DesktopRailCard("Your activity", subtitle: NSLocalizedString("last 12 months", comment: "")) {
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
                            Button { openCity(CityMapDestination(name: city.name, posts: city.posts)) } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(String(format: NSLocalizedString("注目 · #%d", comment: ""), index + 1)).spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                                        Label(city.name, systemImage: "mappin.and.ellipse").spotcodeFont(16, weight: .bold, fallback: .headline)
                                        if !city.prefecture.isEmpty {
                                            Text(city.prefecture).spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                                        }
                                    }
                                    Spacer()
                                    Text(String(format: NSLocalizedString("アイデア %d件", comment: ""), city.posts.count))
                                        .spotcodeFont(12, fallback: .caption).foregroundColor(.green)
                                }.padding(.vertical, 10).frame(maxWidth: .infinity).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            if index < cities.count - 1 { Divider() }
                        }
                    }
                }
                if loading || !profiles.isEmpty || message != nil {
                DesktopRailCard(NSLocalizedString("Who to follow", comment: "")) {
                    if loading { ProgressView() }
                    ForEach(profiles) { profile in
                        HStack(spacing: 10) {
                            Button { openProfile(profile) } label: {
                                HStack(spacing: 10) {
                                    AvatarView(profile: profile, size: 42)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(profile.visibleName).fontWeight(.bold).lineLimit(1)
                                        Text("@\(profile.visibleHandle)").spotcodeFont(11, fallback: .caption2).foregroundColor(SpotcodeTheme.muted).lineLimit(1)
                                    }
                                }.frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                                    .contentShape(Rectangle())
                            }.buttonStyle(SpotcodePlainButtonStyle())
                                .accessibilityIdentifier("desktop.recommendation.\(profile.handle)")
                            if let id = profile.id {
                                Button(requested.contains(id) ? NSLocalizedString("Requested", comment: "") : (followed.contains(id) ? NSLocalizedString("Following", comment: "") : NSLocalizedString("Follow", comment: ""))) { follow(profile) }
                                    .buttonStyle(OutlineButtonStyle(filled: true))
                                    .disabled(model.session == nil || busy.contains(id) || followed.contains(id) || requested.contains(id))
                            }
                        }
                    }
                    if let message {
                        Text(message).spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                        Button(NSLocalizedString("再試行", comment: "")) { Task { await load() } }
                            .buttonStyle(OutlineButtonStyle()).disabled(loading)
                    }
                    if !loading && profiles.isEmpty && message == nil {
                        Text(NSLocalizedString("おすすめユーザーはありません", comment: "")).spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                    }
                }
                }
            }
        }
        .task(id: model.displayProfile?.id) { await load() }
    }

    private func load() async {
        profiles = []; contributions = []; spotPosts = []; followed = []; requested = []; message = nil; loading = true
        defer { loading = false }
        let owner = model.displayProfile?.id
        do {
            let fetch = { (token: String?) async throws -> ([Profile], Set<UUID>, [Post]) in
                let candidates = try await SupabaseService.shared.searchProfiles(query: "", token: token)
                var followingIDs: Set<UUID> = []
                if let owner {
                    let rows = try await SupabaseService.shared.following(userID: owner, token: token)
                    followingIDs = Set(rows.compactMap(\.id))
                }
                let spots = (try? await SupabaseService.shared.spottedPosts(token: token)) ?? []
                return (candidates, followingIDs, spots)
            }
            let snapshot: ([Profile], Set<UUID>, [Post])
            if model.session != nil {
                snapshot = try await model.withRefreshedSession { token in try await fetch(token) }
            } else {
                snapshot = try await fetch(nil)
            }
            guard owner == model.displayProfile?.id, !Task.isCancelled else { return }
            let (candidates, followingIDs, spots) = snapshot
            spotPosts = spots
            profiles = Array(candidates.filter { profile in
                guard let id = profile.id else { return false }
                return id != owner && !followingIDs.contains(id) && !model.blockedAccountIDs.contains(id) && !model.mutedAccountIDs.contains(id)
            }.prefix(5))
        } catch {
            guard owner == model.displayProfile?.id, !Task.isCancelled else { return }
            message = AppModel.isExpiredSessionError(error)
                ? NSLocalizedString("ログインセッションが無効になりました。もう一度ログインしてください。", comment: "")
                : NSLocalizedString("おすすめユーザーを取得できませんでした。接続を確認して再試行してください。", comment: "")
        }
        if let handle = model.displayProfile?.githubHandle, !handle.isEmpty {
            let rows = (try? await SupabaseService.shared.githubContributions(handle: handle)) ?? []
            if owner == model.displayProfile?.id, !Task.isCancelled { contributions = rows }
        }
    }

    private func follow(_ profile: Profile) {
        guard let id = profile.id, let owner = model.displayProfile?.id,
              model.session != nil, !busy.contains(id) else { return }
        busy.insert(id)
        Task {
            defer { busy.remove(id) }
            do {
                // Search results omit privacy; fetch it before sending a request.
                let target = try await model.withRefreshedSession { token in
                    guard owner == model.displayProfile?.id else { throw CancellationError() }
                    guard let target = try await SupabaseService.shared.profile(id: id, token: token) else { return nil as Profile? }
                    guard owner == model.displayProfile?.id else { throw CancellationError() }
                    try await SupabaseService.shared.follow(followerID: owner, targetID: id, isPrivate: target.isPrivate == true, token: token)
                    return target
                }
                guard let target else { return }
                if owner == model.displayProfile?.id {
                    if target.isPrivate == true { requested.insert(id) } else { followed.insert(id) }
                }
            } catch {
                guard owner == model.displayProfile?.id, !(error is CancellationError) else { return }
                model.errorMessage = error.localizedDescription
            }
        }
    }
}

private struct DesktopRailCard<Content: View>: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let title: String
    let subtitle: String
    let content: Content
    init(_ title: String, subtitle: String = "", @ViewBuilder content: () -> Content) {
        self.title = title; self.subtitle = subtitle; self.content = content()
    }
    var body: some View {
        let _ = appColorTheme

        VStack(alignment: .leading, spacing: 20) {
            (Text(LocalizedStringKey(title)).bold() + Text(subtitle.isEmpty ? "" : " " + NSLocalizedString(subtitle, comment: "")).foregroundColor(SpotcodeTheme.muted))
                .spotcodeFont(16, fallback: .headline)
            content
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(SpotcodeTheme.surface)
            .overlay(alignment: .top) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }
}
#endif

private struct SideDrawer: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Binding var section: AppSection
    @Binding var open: Bool
    @Binding var navigationReset: UUID

    var body: some View {
        let _ = appColorTheme

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
            Spacer()
            if let me = model.displayProfile {
                HStack(spacing: 10) {
                    AvatarView(profile: me, size: 36)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(me.visibleName).fontWeight(.bold)
                        Text("@\(me.visibleHandle)").spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Binding var isPresented: Bool
    @Binding var showLogin: Bool
    @State private var switchingID: UUID?
    var body: some View {
        let _ = appColorTheme

        VStack(alignment: .leading, spacing: SpotcodeLayout.value(16, 16)) {
            HStack {
                Text(NSLocalizedString("アカウント", comment: "")).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
                Spacer()
                Button { isPresented = false } label: { Image(systemName: "xmark") }
                    .spotcodeIconButton().keyboardShortcut(.cancelAction)
                    .accessibilityLabel(NSLocalizedString("閉じる", comment: ""))
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
                                Text(account.profile.visibleName).fontWeight(.bold)
                                if active { Text(NSLocalizedString("現在", comment: "")).spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent).padding(4).background(SpotcodeTheme.accent.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 5)) }
                            }
                            Text("@\(account.profile.visibleHandle)").foregroundColor(SpotcodeTheme.muted)
                        }
                        Spacer()
                        if switchingID == account.id { ProgressView() }
                    }
                    .padding(SpotcodeLayout.value(10, 12)).frame(maxWidth: .infinity, alignment: .leading)
                    .background(active ? SpotcodeTheme.selection : SpotcodeTheme.surface2)
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
                        ZStack { Color(red: 102/255, green: 102/255, blue: 102/255); Text("S").spotcodeFont(22, weight: .bold, fallback: .title2.weight(.bold)).foregroundColor(.white) }.frame(width: SpotcodeLayout.value(40, 44), height: SpotcodeLayout.value(40, 44)).clipShape(Circle())
                        VStack(alignment: .leading) {
                            HStack {
                                Text("spotcode").fontWeight(.bold)
                                Text(NSLocalizedString("公式", comment: "")).spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.warning).padding(4).background(SpotcodeTheme.warning.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 5))
                                if model.isPostingAsOfficial { Text(NSLocalizedString("現在", comment: "")).spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent) }
                            }
                            Text("@spotcode_official").foregroundColor(SpotcodeTheme.muted)
                        }
                        Spacer()
                    }.padding(SpotcodeLayout.value(10, 12)).background(model.isPostingAsOfficial ? SpotcodeTheme.selection : SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 9))
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
                Label(NSLocalizedString("別のアカウントを追加", comment: ""), systemImage: "plus").spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.bodyFont.weight(.semibold))
            }
            .disabled(switchingID != nil)
            Button { model.signOut(); isPresented = false; showLogin = true } label: { Label(NSLocalizedString("Log out", comment: ""), systemImage: "arrow.right").foregroundColor(Color(red: 248/255, green: 81/255, blue: 73/255)).spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont) }
        }
        .padding(15).background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(SpotcodeTheme.border)).clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct TimelineView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Binding var repositoryComposeURL: String?
    @Binding var drawerOpen: Bool
    var cityDestination: CityMapDestination? = nil
    @State private var selectedTab = 0
    @State private var composing = false

    var body: some View {
        let _ = appColorTheme

        VStack(spacing: 0) {
            Text(NSLocalizedString("みんなの活動", comment: ""))
                .spotcodeFont(20, weight: .semibold, fallback: .title3.weight(.semibold))
                .frame(maxWidth: 1040, alignment: .leading)
                .frame(maxWidth: .infinity)
                .foregroundColor(SpotcodeTheme.text)
                .padding(.vertical, 16)
            TimelineTabs(selected: $selectedTab)
                .frame(maxWidth: 1040)
                .frame(maxWidth: .infinity)
            if selectedTab == 2 {
                NativeMapView(cityDestination: cityDestination).id(cityDestination?.id)
            } else if selectedTab == 1 {
                FollowingTimelineView()
            } else if model.posts.isEmpty && model.isLoading {
                Spacer(); ProgressView("Loading timeline…").foregroundColor(SpotcodeTheme.muted); Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
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
                                    Button(NSLocalizedString("再試行", comment: "")) { Task { await model.loadMoreTimeline() } }
                                } else if model.isLoadingMoreTimeline {
                                    ProgressView(NSLocalizedString("読み込み中…", comment: ""))
                                } else {
                                    Button(NSLocalizedString("もっと昔の投稿を読み込む", comment: "")) { Task { await model.loadMoreTimeline() } }
                                        .disabled(model.isLoading)
                                }
                            }.padding().id(model.posts.last?.id).task(id: model.isLoading) {
                                // Retry after refresh finishes: onAppear can run
                                // while isLoading still prevents pagination.
                                if !model.isLoading && model.timelinePageError == nil { await model.loadMoreTimeline() }
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
        .background(SpotcodeTheme.background).navigationBarHidden(true)
        .onAppear { if cityDestination != nil { selectedTab = 2 } }
        .onChange(of: cityDestination?.id) { value in if value != nil { selectedTab = 2 } }
        .onChange(of: repositoryComposeURL) { value in if value != nil { composing = true } }
        .onAppear { if repositoryComposeURL != nil { composing = true } }
        .sheet(isPresented: $composing, onDismiss: { repositoryComposeURL = nil }) {
            ComposeView(isPresented: $composing, initialGitHubLink: repositoryComposeURL ?? "").environmentObject(model)
        }
    }
}

private struct FollowingTimelineView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var posts: [Post] = []
    @State private var loading = false
    @State private var failed = false
    @State private var hasMore = true
    @State private var generation = UUID()

    var body: some View {
        let _ = appColorTheme

        ScrollView {
            LazyVStack(spacing: 0) {
                if model.session == nil {
                    Text(NSLocalizedString("フォロー中の投稿を見るにはログインしてください。", comment: "")).padding()
                } else {
                    ForEach(posts) { post in PostRow(post: post) }
                    if loading { ProgressView(NSLocalizedString("読み込み中…", comment: "")).padding() }
                    else if failed {
                        Text(NSLocalizedString("続きを取得できませんでした。再試行してください。", comment: "")).padding()
                        Button(NSLocalizedString("再試行", comment: "")) { Task { await load() } }
                    } else if posts.isEmpty {
                        Text(NSLocalizedString("フォロー中のユーザーの投稿はまだありません。", comment: "")).padding()
                    } else if hasMore {
                        Button(NSLocalizedString("もっと昔の投稿を読み込む", comment: "")) { Task { await load() } }.padding()
                    }
                }
            }
        }
        .task(id: model.session?.user.id) { await load(reset: true) }
        .refreshable { await load(reset: true) }
        .onDisappear { generation = UUID(); loading = false }
    }

    @MainActor private func load(reset: Bool = false) async {
        if !reset && loading { return }
        let request = UUID()
        generation = request
        if reset { posts = []; hasMore = true }
        guard let owner = model.session?.user.id else { loading = false; return }
        loading = true; failed = false
        let cursor = posts.last
        defer { if generation == request { loading = false } }
        do {
            let page = try await model.withRefreshedSession { token in
                try await SupabaseService.shared.posts(token: token, before: cursor, followingUserID: owner)
            }
            guard !Task.isCancelled, generation == request, model.session?.user.id == owner else { return }
            let known = Set(posts.map(\.id))
            posts.append(contentsOf: page.filter { !known.contains($0.id) })
            hasMore = page.count == 24
        } catch {
            guard !Task.isCancelled, generation == request, model.session?.user.id == owner else { return }
            failed = true
        }
    }
}

private struct TimelineTabs: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @Binding var selected: Int
    private let labels = [NSLocalizedString("すべて", comment: ""), NSLocalizedString("Following", comment: ""), NSLocalizedString("Spots", comment: "")]
    var body: some View {
        let _ = appColorTheme

        HStack(spacing: 24) {
            ForEach(labels.indices, id: \.self) { index in
                Button { selected = index } label: {
                    VStack(spacing: SpotcodeLayout.value(9, 11)) {
                        Text(labels[index]).spotcodeFont(17, weight: .semibold, fallback: .title3.weight(.semibold))
                        Rectangle().fill(selected == index ? SpotcodeTheme.text : .clear).frame(height: 1)
                    }.fixedSize(horizontal: true, vertical: false).padding(.top, 8).contentShape(Rectangle())
                }.foregroundColor(selected == index ? SpotcodeTheme.text : SpotcodeTheme.muted)
            }
        }.frame(maxWidth: .infinity, alignment: .leading).background(SpotcodeTheme.background)
         .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }
}

private struct InlineComposer: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var repositoryComposeURL: String?
    // Do not bind the editor directly to @AppStorage. That performs a
    // synchronous UserDefaults write for every keystroke and made typing
    // visibly stall on real devices. Keep editing in memory and persist
    // only after the user pauses.
    @State private var draft = ""
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
    @State private var editorFocused = false
    var body: some View {
        let _ = appColorTheme

        HStack(alignment: .top, spacing: 12) {
            AvatarView(profile: model.displayProfile, size: SpotcodeLayout.value(40, 42))
            VStack(alignment: .leading, spacing: 12) {
                ZStack(alignment: .topLeading) {
                    ComposerTextView(text: $draft, isFocused: $editorFocused)
                        .frame(height: editorHeight(draft, expanded: editorFocused))
                    if draft.isEmpty {
                        Text(NSLocalizedString("いまどうしてる？", comment: ""))
                            .spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont).foregroundColor(SpotcodeTheme.muted)
                            .padding(.horizontal, 14).padding(.vertical, SpotcodeLayout.value(11, 17))
                            .allowsHitTesting(false)
                    }
                }
                .background(SpotcodeTheme.inputSurface)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(editorFocused ? SpotcodeTheme.accent : SpotcodeTheme.border, lineWidth: editorFocused ? 3 : 2))
                composerChips
                if showLink {
                    TextField("https://github.com/…", text: $githubLink).textInputAutocapitalization(.never).keyboardType(.URL).spotcodeURLField()
                    TextField(NSLocalizedString("owner/repository（任意）", comment: ""), text: $repoFullName).textInputAutocapitalization(.never).autocorrectionDisabled(true).spotcodeURLField()
                    Text(NSLocalizedString("連携済みOrganizationのメンバーがそのリポジトリを指定すると、組織アカウント名義で表示されます。", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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

            }
        }.padding(SpotcodeLayout.value(16, 16))
         .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
         .onAppear { applyRepositoryRequest(repositoryComposeURL) }
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
    private var linkChip: some View { Button { showLink.toggle() } label: { ComposerChip(icon: "link", title: NSLocalizedString("リンクを追加", comment: ""), active: showLink) } }
    private var eventChip: some View { Button { showEvent.toggle() } label: { ComposerChip(icon: "calendar", title: NSLocalizedString("イベントを追加", comment: ""), active: showEvent) } }
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
            NativeDraftControls(account: draftAccount, slot: "inline", draft: draftSnapshot, restore: restoreDraft)
            Button(sending ? NSLocalizedString("送信中…", comment: "") : NSLocalizedString("Push", comment: "")) { publish() }
                .spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.weight(.bold)).padding(.horizontal, SpotcodeLayout.value(18, 28)).padding(.vertical, SpotcodeLayout.value(9, 11))
                .background(SpotcodeTheme.accent).foregroundColor(SpotcodeTheme.onAccent).clipShape(Capsule())
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending || model.session == nil)
        }
    }

    private func publish() {
        sending = true
        Task {
            if await model.publish(body: draft.trimmingCharacters(in: .whitespacesAndNewlines), githubLink: githubLink.isEmpty ? nil : githubLink, repoFullName: repoFullName.isEmpty ? nil : repoFullName, eventURL: eventURL.isEmpty ? nil : eventURL, spot: selectedSpot, kind: postKind, visibility: visibility, photos: photos.isEmpty ? nil : photos, poll: poll) {
                NativeDraftStore.completePublishing(draftSnapshot, account: draftAccount, slot: "inline")
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

    private var draftAccount: String { model.displayProfile?.id?.uuidString ?? model.session?.user.id.uuidString ?? "guest" }
    private var draftSnapshot: NativeComposerDraft {
        NativeComposerDraft(body: draft, githubLink: githubLink, repoFullName: repoFullName, eventURL: eventURL, kind: postKind, visibility: visibility, photos: photos, poll: poll, spot: selectedSpot)
    }
    private func restoreDraft(_ value: NativeComposerDraft) {
        draft = value.body; githubLink = value.githubLink; repoFullName = value.repoFullName
        eventURL = value.eventURL; postKind = value.kind; visibility = value.visibility
        photos = value.photos; poll = value.poll; selectedSpot = value.spot
        showLink = !githubLink.isEmpty || !repoFullName.isEmpty; showEvent = !eventURL.isEmpty
    }
}

private struct NativeDraftControls: View {
    let account: String
    let slot: String
    let draft: NativeComposerDraft
    let restore: (NativeComposerDraft) -> Void
    @State private var generation = 0
    @State private var loadedAccount: String?
    @AppStorage("spotcode.native.draft.revision") private var revision = 0
    @State private var hasSaved = false
    @State private var notice = ""
    @State private var confirmingRestore = false
    @State private var pendingSave: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 12) {
                Button(NSLocalizedString("下書き保存", comment: "")) {
                    pendingSave?.cancel()
                    NativeDraftStore.save(draft, account: account, slot: slot)
                    NativeDraftStore.save(draft, account: account, slot: "saved")
                    hasSaved = true
                    notice = NSLocalizedString("下書きを保存しました", comment: "")
                }.disabled(!draft.hasContent)
                if hasSaved {
                    Button(NSLocalizedString("下書きを復元", comment: "")) {
                        if draft.hasContent { confirmingRestore = true } else { restoreSaved() }
                    }
                }
            }
            if !notice.isEmpty { Text(notice).font(.caption).foregroundColor(SpotcodeTheme.muted) }
        }
        .font(.subheadline)
        .onAppear { loadWorkingCopy() }
        .onChange(of: account) { _ in
            pendingSave?.cancel()
            if let loadedAccount { NativeDraftStore.save(draft, account: loadedAccount, slot: slot) }
            loadWorkingCopy()
        }
        .onChange(of: revision) { _ in hasSaved = NativeDraftStore.load(account: account, slot: "saved")?.hasContent == true }
        .onChange(of: draft) { value in
            guard loadedAccount == account else { return }
            pendingSave?.cancel()
            let owner = account
            let version = NativeDraftStore.generation(account: owner, slot: slot)
            generation = version
            pendingSave = Task { @MainActor in
                do { try await Task.sleep(nanoseconds: 500_000_000) } catch { return }
                guard NativeDraftStore.generation(account: owner, slot: slot) == version else { return }
                NativeDraftStore.save(value, account: owner, slot: slot)
            }
        }
        .onDisappear {
            pendingSave?.cancel()
            if loadedAccount == account, generation == NativeDraftStore.generation(account: account, slot: slot) { NativeDraftStore.save(draft, account: account, slot: slot) }
        }
        .confirmationDialog(NSLocalizedString("入力中の内容を下書きで置き換えますか？", comment: ""), isPresented: $confirmingRestore, titleVisibility: .visible) {
            Button(NSLocalizedString("下書きを復元", comment: "")) { restoreSaved() }
            Button(NSLocalizedString("キャンセル", comment: ""), role: .cancel) {}
        }
    }

    private func loadWorkingCopy() {
        NativeDraftStore.migrateLegacy(account: account)
        hasSaved = NativeDraftStore.load(account: account, slot: "saved")?.hasContent == true
        guard loadedAccount != account else { return }
        let changedAccount = loadedAccount != nil
        loadedAccount = account
        generation = NativeDraftStore.generation(account: account, slot: slot)
        notice = ""
        if let working = NativeDraftStore.load(account: account, slot: slot) ?? (slot == "sheet" ? NativeDraftStore.load(account: account, slot: "inline") : nil), working.hasContent {
            restore(working)
            notice = NSLocalizedString("下書きを復元しました", comment: "")
        } else if changedAccount {
            restore(NativeComposerDraft())
        }
    }
    private func restoreSaved() {
        guard let saved = NativeDraftStore.load(account: account, slot: "saved") else { hasSaved = false; return }
        restore(saved)
        notice = NSLocalizedString("下書きを復元しました", comment: "")
    }
}

private struct PostAudiencePicker: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Binding var visibility: String

    var body: some View {
        let _ = appColorTheme

        Picker(NSLocalizedString("公開範囲", comment: ""), selection: $visibility) {
            Label(NSLocalizedString("全員", comment: ""), systemImage: "globe").tag("public")
            Label(NSLocalizedString("相互フォロー", comment: ""), systemImage: "arrow.2.squarepath").tag("mutuals")
            Label(NSLocalizedString("フォロー中", comment: ""), systemImage: "person.badge.plus").tag("following")
            Label(NSLocalizedString("親しい友達", comment: ""), systemImage: "heart").tag("friends")
            Label(NSLocalizedString("同じ組織", comment: ""), systemImage: "building.2").tag("org")
            if model.displayProfile?.isOrg == true || !model.githubOrganizations.isEmpty || visibility == "github_org" {
                Label(NSLocalizedString("GitHub Organizationのみ", comment: ""), systemImage: "building.2").tag("github_org")
            }
            Label(NSLocalizedString("自分だけ", comment: ""), systemImage: "lock").tag("only_me")
            if visibility == "restricted" {
                Label(NSLocalizedString("限定公開", comment: ""), systemImage: "lock").tag("restricted")
            }
        }
        .pickerStyle(.menu)
        .spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold))
        .tint(SpotcodeTheme.accent)
        .accessibilityLabel(NSLocalizedString("公開範囲", comment: ""))
    }
}

private struct PostKindPicker: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @Binding var kind: String?

    var body: some View {
        let _ = appColorTheme

        Menu {
            Picker(NSLocalizedString("投稿タグ", comment: ""), selection: $kind) {
                Text(NSLocalizedString("タグなし", comment: "")).tag(String?.none)
                Label(NSLocalizedString("アイデア", comment: ""), systemImage: "sparkles").tag(String?.some(NSLocalizedString("idea", comment: "")))
                Label(NSLocalizedString("バグ", comment: ""), systemImage: "ladybug").tag(String?.some("bug"))
            }
        } label: {
            ComposerChip(icon: kind == "bug" ? "ladybug" : "sparkles",
                         title: kind == "bug" ? NSLocalizedString("バグ", comment: "") : kind == NSLocalizedString("idea", comment: "") ? NSLocalizedString("アイデア", comment: "") : NSLocalizedString("投稿タグ", comment: ""),
                         active: kind != nil)
        }
    }
}

private struct ComposerChip: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let icon: String; let title: String
    var strong = false
    var active = false
    var body: some View {
        let _ = appColorTheme

        Label { Text(LocalizedStringKey(title)) } icon: { Image(systemName: icon) }
            .spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold)).foregroundColor(active ? SpotcodeTheme.accent : (strong ? SpotcodeTheme.text : SpotcodeTheme.muted))
            .padding(.horizontal, 10).padding(.vertical, SpotcodeLayout.value(8, 7))
            .background(active ? SpotcodeTheme.accent.opacity(0.12) : Color.clear).clipShape(Capsule())
            .overlay(Capsule().stroke(active ? SpotcodeTheme.accent : SpotcodeTheme.border, style: StrokeStyle(lineWidth: 1, dash: active ? [] : [5])))
    }
}

private final class ComposerLocationProvider: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var spot: Spot?
    @Published private(set) var errorMessage: String?
    private let manager = CLLocationManager()
    private var requested = false
    private var timeout: DispatchWorkItem?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }
    func request() {
        requested = true
        errorMessage = nil
        updateAuthorization()
    }
    func clear() { spot = nil }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard requested, let latest = locations.last(where: {
            $0.horizontalAccuracy >= 0 && abs($0.timestamp.timeIntervalSinceNow) < 120
        }) else { return }
        let coordinate = latest.coordinate
        finish()
        spot = Spot(lat: coordinate.latitude, lng: coordinate.longitude, label: NSLocalizedString("現在地", comment: ""), address: nil)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard requested else { return }
        // On Mac, Wi-Fi positioning may initially be unavailable. Keep
        // listening until a fix arrives or the bounded timeout expires.
        if (error as? CLError)?.code == .locationUnknown { return }
        finish()
        errorMessage = NSLocalizedString("現在地を取得できませんでした。位置情報の設定を確認して再試行してください。", comment: "")
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard requested else { return }
        updateAuthorization()
    }
    private func updateAuthorization() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            timeout?.cancel()
            manager.startUpdatingLocation()
            let work = DispatchWorkItem { [weak self] in
                guard let self, self.requested else { return }
                self.finish()
                self.errorMessage = NSLocalizedString("現在地を取得できませんでした。位置情報の設定を確認して再試行してください。", comment: "")
            }
            timeout = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
        case .denied, .restricted:
            finish()
            errorMessage = NSLocalizedString("現在地を表示するには、システム設定でspotcodeの位置情報を許可してください。", comment: "")
        @unknown default: finish()
        }
    }
    private func finish() {
        requested = false
        timeout?.cancel()
        timeout = nil
        manager.stopUpdatingLocation()
    }
    deinit { timeout?.cancel(); manager.stopUpdatingLocation() }
}

// Shared reader-location gate for every timeline row. One CLLocationManager
// serves For you, Following, profile and detail views, so dozens of visible
// rows never create competing permission/location requests. Following an
// author does not affect this check: a spot post unlocks only for its author
// or when this device is physically within 100 metres of the pin.
private final class PostLocationGate: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = PostLocationGate()
    @Published private(set) var location: CLLocation?
    @Published private(set) var errorMessage: String?
    private let manager = CLLocationManager()
    private var readers: Set<UUID> = []
    private var active = true
    private var updating = false
    private let radius: CLLocationDistance = 100

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 10
    }

    func observe(_ id: UUID) {
        readers.insert(id)
        request()
    }

    func removeObserver(_ id: UUID) {
        readers.remove(id)
        if readers.isEmpty { stop() }
    }

    func setActive(_ value: Bool) {
        active = value
        if active { request() } else { stop() }
    }

    private func stop() {
        manager.stopUpdatingLocation()
        updating = false
        location = nil
    }

    func request() {
        guard active, !readers.isEmpty else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            guard !updating else { return }
            errorMessage = nil
            updating = true
            manager.startUpdatingLocation()
        case .denied, .restricted:
            stop()
            errorMessage = NSLocalizedString("現在地を表示するには、システム設定でspotcodeの位置情報を許可してください。", comment: "")
        @unknown default:
            stop()
        }
    }

    func isNear(_ spot: Spot) -> Bool {
        guard let location, Self.isUsable(location) else { return false }
        let destination = CLLocation(latitude: spot.lat, longitude: spot.lng)
        return location.distance(from: destination) <= radius
    }

    private static func isUsable(_ location: CLLocation) -> Bool {
        CLLocationCoordinate2DIsValid(location.coordinate) &&
        location.horizontalAccuracy >= 0 && abs(location.timestamp.timeIntervalSinceNow) < 120
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active, updating, !readers.isEmpty,
              let latest = locations.last(where: Self.isUsable) else { return }
        errorMessage = nil
        location = latest
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard updating else { return }
        location = nil
        errorMessage = NSLocalizedString("現在地を取得できませんでした。位置情報の設定を確認して再試行してください。", comment: "")
        // A temporary failure can recover on the next continuous update.
        if (error as? CLError)?.code != .locationUnknown { stop() }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        request()
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

struct DataURLImage: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let value: String
    var fit = false
    var body: some View {
        let _ = appColorTheme

        Group {
            if let image = decodedDataURLImage(value) {
                Image(uiImage: image).resizable().aspectRatio(contentMode: fit ? .fit : .fill)
            } else if let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().aspectRatio(contentMode: fit ? .fit : .fill)
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

// Reuse decoded pixels across SwiftUI redraws, with a modest memory budget.
private let inlineImageCache: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>()
    cache.totalCostLimit = 12 * 1024 * 1024
    cache.countLimit = 64
    return cache
}()

private func decodedDataURLImage(_ value: String?, maxPixelSize: Int = 1080) -> UIImage? {
    guard let value, value.prefix(11).lowercased() == "data:image/" else { return nil }
    let key = "\(maxPixelSize):\(value)" as NSString
    if let cached = inlineImageCache.object(forKey: key) { return cached }
    guard
          let comma = value.firstIndex(of: ","),
          let data = Data(base64Encoded: String(value[value.index(after: comma)...])),
          let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            kCGImageSourceShouldCacheImmediately: true
          ] as CFDictionary) else { return nil }
    let image = UIImage(cgImage: thumbnail)
    inlineImageCache.setObject(image, forKey: key,
        cost: thumbnail.bytesPerRow * thumbnail.height + key.length * 2)
    return image
}

private struct ProfileImagePicker: UIViewControllerRepresentable {
    @Binding var image: String?
    var maxSide: CGFloat = 256
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
                      let data = source.resizedForPost(maxSide: self.parent.maxSide).jpegData(compressionQuality: 0.85) else {
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
    @Environment(\.appColorTheme) private var appColorTheme
    @Binding var poll: PostPoll?
    @Binding var isPresented: Bool
    @State private var question = ""
    @State private var first = ""
    @State private var second = ""
    var body: some View {
        let _ = appColorTheme

        NavigationView {
            VStack(spacing: 14) {
                TextField(NSLocalizedString("質問", comment: ""), text: $question).spotcodeField()
                TextField(NSLocalizedString("選択肢 1", comment: ""), text: $first).spotcodeField()
                TextField(NSLocalizedString("選択肢 2", comment: ""), text: $second).spotcodeField()
                if poll != nil { Button(NSLocalizedString("投票を削除", comment: ""), role: .destructive) { poll = nil; isPresented = false } }
                Spacer()
            }.padding().background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
                .navigationTitle(NSLocalizedString("投票を作成", comment: "")).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(NSLocalizedString("Cancel", comment: "")) { isPresented = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(NSLocalizedString("Confirm", comment: "")) { poll = .init(question: question, options: [first, second]); isPresented = false }
                            .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || first.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || second.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .onAppear { question = poll?.question ?? ""; first = poll?.options.first ?? ""; second = poll?.options.dropFirst().first ?? "" }
        }.modifier(AppAppearancePreference())
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
    }
}

private struct LocationPickerSheet: View {
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        NavigationView {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Button {
                        locating = true
                        location.request()
                    } label: { Label(NSLocalizedString("現在地を使う", comment: ""), systemImage: "location") }
                        .spotcodeFont(15, weight: .semibold, fallback: .subheadline.weight(.semibold)).padding(.horizontal, 12).padding(.vertical, SpotcodeLayout.value(8, 9))
                        .overlay(Capsule().stroke(SpotcodeTheme.border))
                    TextField(NSLocalizedString("ラベル（任意・建物名や店名）", comment: ""), text: $label).spotcodeURLField()
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
                        Text(NSLocalizedString("住所", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                        Text(address).spotcodeFont(12, weight: .regular, fallback: .caption).lineLimit(1)
                    }.padding(11).frame(maxWidth: .infinity, alignment: .leading)
                        .background(SpotcodeTheme.background).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
                    Button(NSLocalizedString("削除", comment: "")) { spot = nil; isPresented = false }.foregroundColor(.red).disabled(spot == nil)
                }.padding(14)
            }
            .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
            .navigationTitle(NSLocalizedString("場所を選ぶ", comment: "")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(NSLocalizedString("Cancel", comment: "")) { isPresented = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(NSLocalizedString("Confirm", comment: "")) { confirm() }.disabled(coordinate == nil)
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
        }.modifier(AppAppearancePreference())
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
private func editorHeight(_ text: String, expanded: Bool) -> CGFloat {
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false).count
    return min(220, max(expanded || !text.isEmpty ? 112 : 72, CGFloat(lines) * 24 + 24))
}

private struct ComposerTextView: UIViewRepresentable {
    @Environment(\.appColorTheme) private var appColorTheme
    @Binding var text: String
    @Binding var isFocused: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = UIColor(SpotcodeTheme.inputSurface)
        view.textColor = UIColor(SpotcodeTheme.text)
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
        let _ = appColorTheme
        view.textColor = UIColor(SpotcodeTheme.text)
        view.backgroundColor = UIColor(SpotcodeTheme.inputSurface)
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

private final class SelectablePostTextView: UITextView {
    private var measuredWidth: CGFloat = 0
    override var intrinsicContentSize: CGSize {
        let height = bounds.width > 0
            ? sizeThatFits(CGSize(width: bounds.width, height: .greatestFiniteMagnitude)).height
            : (font?.lineHeight ?? 20)
        return CGSize(width: UIView.noIntrinsicMetric, height: ceil(height))
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        if measuredWidth != bounds.width {
            measuredWidth = bounds.width
            invalidateIntrinsicContentSize()
        }
    }
}

private struct SelectablePostBody: UIViewRepresentable {
    @Environment(\.appColorTheme) private var appColorTheme
    let text: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeUIView(context: Context) -> SelectablePostTextView {
        let view = SelectablePostTextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.textColor = UIColor(SpotcodeTheme.text)
        view.tintColor = .systemBlue
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }
    func updateUIView(_ view: SelectablePostTextView, context: Context) {
        let _ = appColorTheme
        view.textColor = UIColor(SpotcodeTheme.text)
        // Do not assign unchanged text: a timeline refresh must retain selection.
        if view.text != text { view.text = text }
        #if targetEnvironment(macCatalyst)
        let font = MacTextSize.editorFont(dynamicTypeSize)
        #else
        let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 20))
        #endif
        if view.font != font { view.font = font }
        view.invalidateIntrinsicContentSize()
    }
    @available(iOS 16.0, *)
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: SelectablePostTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        return CGSize(width: width, height: ceil(uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height))
    }
}

struct PostRow: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let post: Post
    var opensDetail = true
    var onSpotTap: ((Post) -> Void)?
    @State private var selectedPhoto: PostPhotoSelection?
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
    @State private var locationReaderID = UUID()
    @AppStorage("spotcode.native.dev-mode") private var developerMode = false

    init(post: Post, opensDetail: Bool = true, onSpotTap: ((Post) -> Void)? = nil) {
        self.post = post
        self.opensDetail = opensDetail
        self.onSpotTap = onSpotTap
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
        let _ = appColorTheme

        if model.canReadPostAudience(post) && !model.isBlocked(post) && !model.isMuted(post) {
            postContent
        }
    }

    private var moderationMenu: some View {
Menu {
                                Button { reporting = true } label: { Label(NSLocalizedString("投稿を報告", comment: ""), systemImage: "flag") }
                                Button(role: .destructive) { confirmingBlock = true } label: {
                                    Label(NSLocalizedString("ユーザーをブロック", comment: ""), systemImage: "person.crop.circle.badge.xmark")
                                }
                            } label: { Image(systemName: "ellipsis").frame(minWidth: 44, minHeight: 44) }
                            .accessibilityLabel(NSLocalizedString("通報・ブロック", comment: ""))
    }

    private var postContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 5) {
                    NavigationLink(destination: ProfileLookupView(handle: post.displayAuthor?.handle ?? "")) {
                        AvatarView(profile: post.displayAuthor, size: 36)
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .buttonStyle(SpotcodePlainButtonStyle())
                    .disabled(post.displayAuthor?.handle == nil)
                    .accessibilityLabel(post.displayAuthor?.visibleName ?? NSLocalizedString("User", comment: ""))
                    NavigationLink(destination: ProfileLookupView(handle: post.displayAuthor?.handle ?? "")) {
                        Text(post.displayAuthor?.visibleName ?? NSLocalizedString("User", comment: "")).fontWeight(.semibold).foregroundColor(SpotcodeTheme.text)
                            .lineLimit(1).truncationMode(.tail)
                    }.buttonStyle(SpotcodePlainButtonStyle()).disabled(post.displayAuthor?.handle == nil).layoutPriority(1)
                    NavigationLink(destination: ProfileLookupView(handle: post.displayAuthor?.handle ?? "")) {
                        Text("@\(post.displayAuthor?.visibleHandle ?? "unknown")").foregroundColor(SpotcodeTheme.muted)
                            .lineLimit(1).truncationMode(.tail)
                    }.buttonStyle(SpotcodePlainButtonStyle()).disabled(post.displayAuthor?.handle == nil)
                    Text("· \(relativeTime(post.createdAt))").foregroundColor(SpotcodeTheme.muted)
                        .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                    Spacer(minLength: 2)
                }
                .spotcodeFont(15, fallback: .body).foregroundColor(SpotcodeTheme.muted)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        if let status = post.status, !status.isEmpty, status.lowercased() != "wip" {
                            Text(NSLocalizedString(status.uppercased(), comment: "")).spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold))
                                .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                                .foregroundColor(status == "active" ? .black : SpotcodeTheme.text)
                                .padding(.horizontal, 9).padding(.vertical, 4)
                                .background(status == "active" ? Color.cyan : SpotcodeTheme.warning).clipShape(Capsule())
                        }
                        if let spot = post.spot {
                            Button {
                                if let onSpotTap { onSpotTap(post) }
                                else { showSpotMap = true }
                            } label: {
                                PostMetadataBadge(icon: "mappin", text: spot.label ?? spot.address ?? NSLocalizedString("選択した場所", comment: ""), color: SpotcodeTheme.accent)
                            }.buttonStyle(SpotcodePlainButtonStyle())
                        }
                        if post.kind == NSLocalizedString("idea", comment: "") { PostMetadataBadge(icon: "sparkles", text: NSLocalizedString("アイデア", comment: ""), color: SpotcodeTheme.warning) }
                        if post.kind == "bug" { PostMetadataBadge(icon: "ladybug", text: NSLocalizedString("バグ", comment: ""), color: .red) }
                        PostMetadataBadge(icon: visibilityBadge(post.visibility ?? "public").icon, text: visibilityBadge(post.visibility ?? "public").text, color: SpotcodeTheme.muted)
                    }
                }
                if !canReadContent {
                    VStack(alignment: .leading, spacing: 8) {
                        if let message = locationGate.errorMessage {
                            Label(message, systemImage: "location.slash")
                            Button(NSLocalizedString("再試行", comment: "")) { locationGate.request() }
                        } else if locationGate.location == nil {
                            Label(NSLocalizedString("現在地を取得中…", comment: ""), systemImage: "location")
                        } else {
                            Label(NSLocalizedString("この場所から半径100m以内に来ると内容を表示できます", comment: ""), systemImage: "location.slash")
                        }
                    }
                        .spotcodeFont(15, weight: .regular, fallback: .subheadline).foregroundColor(SpotcodeTheme.muted)
                        .padding(SpotcodeLayout.value(10, 12)).frame(maxWidth: .infinity, alignment: .leading)
                        .background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 9))
                } else {
                    SelectablePostBody(text: NativePrivacy.text(post.body))
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if canReadContent, let photos = post.photos, !photos.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(photos.enumerated()), id: \.offset) { index, value in
                                Button { selectedPhoto = PostPhotoSelection(photos: photos, index: index) } label: {
                                    DataURLImage(value: value, fit: true).frame(width: 180, height: 140)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                }.buttonStyle(SpotcodePlainButtonStyle())
                                    .accessibilityLabel(NSLocalizedString("画像を拡大", comment: ""))
                            }
                        }
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
                        Label(NSLocalizedString("イベントを開く", comment: ""), systemImage: "calendar")
                            .spotcodeFont(12, weight: .regular, fallback: .caption).frame(maxWidth: .infinity, alignment: .leading)
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if canReadContent {
                    ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 16) {
                        NavigationLink(destination: PostDetailView(post: post)) {
                            PostAction(icon: "bubble.left", count: post.commentsCount ?? 0)
                        }.buttonStyle(SpotcodePlainButtonStyle())
                        Button { toggleInteraction("reposts") } label: {
                            PostAction(icon: reposted ? "arrow.2.squarepath" : "arrow.2.squarepath", count: repostCount)
                        }.buttonStyle(SpotcodePlainButtonStyle()).disabled(interactionInProgress.contains("reposts"))
                        Button { toggleInteraction("bookmarks") } label: {
                            PostAction(icon: bookmarked ? "star.fill" : "star", count: bookmarkCount)
                        }.buttonStyle(SpotcodePlainButtonStyle()).foregroundColor(bookmarked ? SpotcodeTheme.warning : SpotcodeTheme.muted)
                            .disabled(interactionInProgress.contains("bookmarks"))
                        Button { toggleInteraction("likes") } label: {
                            PostAction(icon: liked ? "heart.fill" : "heart", count: likeCount)
                        }.buttonStyle(SpotcodePlainButtonStyle()).foregroundColor(liked ? .pink : SpotcodeTheme.muted)
                            .disabled(interactionInProgress.contains("likes"))
                        Button { sharing = true } label: {
                            Image(systemName: "square.and.arrow.up")
                        }.buttonStyle(SpotcodePlainButtonStyle())
                        if post.authorID != model.me?.id {
                            moderationMenu
                        }
                        if canManagePost {
                            NavigationLink(destination: NativePostActivityView(post: post)) {
                                Image(systemName: "chart.bar")
                            }.buttonStyle(SpotcodePlainButtonStyle()).accessibilityLabel(NSLocalizedString("投稿の分析", comment: ""))
                            Button { editing = true } label: { Image(systemName: "pencil") }
                                .buttonStyle(SpotcodePlainButtonStyle()).accessibilityLabel(NSLocalizedString("投稿を編集", comment: ""))
                            Button { confirmingDelete = true } label: { Image(systemName: "trash") }
                                .buttonStyle(SpotcodePlainButtonStyle()).accessibilityLabel(NSLocalizedString("投稿を削除", comment: ""))
                        }
                    }
                    }
                    .spotcodeFont(15, fallback: .system(size: 15)).foregroundColor(SpotcodeTheme.muted).padding(.top, 7)
                }
            }
            .frame(maxWidth: 1040, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .padding(.vertical, 20).padding(.horizontal, 4).background(SpotcodeTheme.background)
        .overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
        .contentShape(Rectangle())
        .onTapGesture {
            if opensDetail { showingDetail = true }
        }
        .background {
            if opensDetail {
                NavigationLink(destination: PostDetailView(post: post), isActive: $showingDetail) { EmptyView() }
                    .hidden().accessibilityHidden(true)
            }
        }
        .sheet(item: $selectedPhoto) { selection in
            PostPhotoViewer(photos: selection.photos, index: selection.index)
        }
        .onChange(of: canReadContent) { allowed in if !allowed { selectedPhoto = nil } }
        .sheet(isPresented: $editing) { EditPostView(post: post, isPresented: $editing).environmentObject(model) }
        .sheet(isPresented: $showSpotMap) {
            NavigationView {
                NativeMapView(focusPost: post)
                    .navigationTitle(post.spot?.label ?? NSLocalizedString("Spot", comment: ""))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { MapSheetCloseButton { showSpotMap = false } } }
            }
        }
        .sheet(isPresented: $sharing) {
            ActivityShareSheet(items: [URL(string: "https://hrmc.ngs.computer/post/\(post.id.uuidString)")!])
        }
        .sheet(isPresented: $reporting) {
            ReportPostView(post: post, isPresented: $reporting).environmentObject(model)
        }
        .onAppear { if post.spot != nil { locationGate.observe(locationReaderID) } }
        .onDisappear { locationGate.removeObserver(locationReaderID) }
        .task(id: post.id) { await loadInteractions() }
        .confirmationDialog(NSLocalizedString("このユーザーをブロックしますか？投稿が非表示になり、運営へ通知されます。", comment: ""), isPresented: $confirmingBlock, titleVisibility: .visible) {
            Button(NSLocalizedString("ブロック", comment: ""), role: .destructive) { Task { await model.block(post) } }
            Button(NSLocalizedString("キャンセル", comment: ""), role: .cancel) {}
        }
        .confirmationDialog(NSLocalizedString("この投稿を削除しますか？", comment: ""), isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button(NSLocalizedString("削除", comment: ""), role: .destructive) { Task { _ = await model.deletePost(post) } }
            Button(NSLocalizedString("キャンセル", comment: ""), role: .cancel) {}
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let post: Post
    @Binding var isPresented: Bool
    @State private var reason = "spam"
    @State private var comment = ""
    @State private var submitting = false

    private let reasons = [
        ("spam", NSLocalizedString("スパム / 宣伝", comment: "")),
        ("inappropriate", NSLocalizedString("不適切な内容", comment: "")),
        ("harassment", NSLocalizedString("嫌がらせ / ヘイト", comment: "")),
        ("misinfo", NSLocalizedString("誤情報", comment: "")),
        ("other", NSLocalizedString("その他", comment: ""))
    ]

    var body: some View {
        let _ = appColorTheme

        NavigationView {
            Form {
                Section(NSLocalizedString("報告する理由", comment: "")) {
                    Picker(NSLocalizedString("理由", comment: ""), selection: $reason) {
                        ForEach(reasons, id: \.0) { value, label in
                            Text(LocalizedStringKey(label)).tag(value)
                        }
                    }.pickerStyle(.inline).labelsHidden()
                }
                Section(NSLocalizedString("追加のコメント（任意）", comment: "")) {
                    TextEditor(text: $comment).frame(minHeight: 100)
                    Text(NSLocalizedString("400文字まで", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                }
            }
            .navigationTitle(NSLocalizedString("投稿を報告", comment: ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(NSLocalizedString("キャンセル", comment: "")) { isPresented = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(NSLocalizedString("送信", comment: "")) { submit() }.disabled(submitting)
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
    @Environment(\.appColorTheme) private var appColorTheme
    let icon: String
    let count: Int
    var body: some View {
        let _ = appColorTheme
         HStack(spacing: 5) { Image(systemName: icon); Text("\(count)") } }
}

private struct EditPostView: View {
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

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
                    TextField(NSLocalizedString("owner/repository（任意）", comment: ""), text: $repoFullName)
                        .textInputAutocapitalization(.never).autocorrectionDisabled(true)
                }.spotcodeURLField()
                HStack(spacing: 10) {
                    PostKindPicker(kind: $postKind)
                    PostAudiencePicker(visibility: $visibility)
                    Spacer()
                }
                HStack {
                    Image(systemName: "calendar")
                    TextField(NSLocalizedString("イベントURL（任意）", comment: ""), text: $eventURL)
                        .textInputAutocapitalization(.never).keyboardType(.URL)
                }.spotcodeURLField()
                Spacer()
            }
            .padding().background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
            .navigationTitle(NSLocalizedString("投稿を編集", comment: "")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(NSLocalizedString("Cancel", comment: "")) { isPresented = false } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : NSLocalizedString("Save", comment: "")) {
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
        }.modifier(AppAppearancePreference())
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
    }
}

private struct PostMetadataBadge: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let icon: String
    let text: String
    let color: Color
    var body: some View {
        let _ = appColorTheme

        Label { Text(LocalizedStringKey(text)) } icon: { Image(systemName: icon) }
            .spotcodeFont(11, weight: .semibold, fallback: .caption2.weight(.semibold)).foregroundColor(color)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(color.opacity(0.12)).overlay(Capsule().stroke(color.opacity(0.55))).clipShape(Capsule())
    }
}

struct AvatarView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let profile: Profile?
    var size: CGFloat = 42
    var body: some View {
        let _ = appColorTheme
        // Existing rows must re-evaluate masking when the active account changes.
        let _ = model.me

        Group {
            if let image = decodedDataURLImage(profile?.visibleAvatarURL, maxPixelSize: max(1, Int(ceil(size * 3)))) {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let url = profile?.visibleAvatarURL.flatMap(URL.init(string:)), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
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
            Color(red: 102/255, green: 102/255, blue: 102/255)
            Text(profile?.visibleInitial ?? "?")
                .font(.system(size: max(13, size * 0.4), weight: .bold, design: .rounded))
                .foregroundColor(.white)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
    }
}

private struct NativePostActivityView: View {
    @EnvironmentObject private var model: AppModel
    let post: Post
    @AppStorage("spotcode.native.dev-mode") private var developerMode = false
    private var allowed: Bool {
        if post.visibility == "only_me" { return post.authorID == model.session?.user.id }
        return post.authorID == model.displayProfile?.id ||
            (developerMode && (model.me?.isAdmin == true || model.me?.isOperator == true))
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if allowed, let token = model.session?.accessToken {
                    Text(NativePrivacy.text(post.body)).lineLimit(3).foregroundColor(SpotcodeTheme.muted)
                    NativeActivitySection(postID: post.id, table: "likes", title: "いいね", token: token)
                    NativeActivitySection(postID: post.id, table: "comments", title: "コメント", token: token)
                    NativeActivitySection(postID: post.id, table: "reposts", title: "リポスト", token: token)
                    NativeActivitySection(postID: post.id, table: "bookmarks", title: "保存", token: token)
                } else {
                    Text(NSLocalizedString("この画面は投稿主だけが見られます。", comment: ""))
                }
            }.padding().frame(maxWidth: 760, alignment: .leading).frame(maxWidth: .infinity)
        }
        .background(SpotcodeTheme.background).foregroundColor(SpotcodeTheme.text)
        .navigationTitle(NSLocalizedString("アクティビティ", comment: ""))
        .navigationBarTitleDisplayMode(.inline)
        .id(model.session?.user.id)
    }
}

private struct NativeActivitySection: View {
    let postID: UUID
    let table: String
    let title: String
    let token: String
    @State private var rows: [NativePostActivity] = []
    @State private var loading = true
    @State private var error: String?
    @State private var retry = 0
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(NSLocalizedString(title, comment: "") + (loading || error != nil ? "" : " (\(rows.count))")).font(.headline)
            if loading { ProgressView() }
            else if let error {
                Text(error).font(.caption).foregroundColor(SpotcodeTheme.muted)
                Button(NSLocalizedString("再試行", comment: "")) { retry += 1 }
            } else if rows.isEmpty {
                Text(NSLocalizedString("まだアクティビティはありません", comment: "")).foregroundColor(SpotcodeTheme.muted)
            } else {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    if let profile = row.user {
                        NavigationLink(destination: ProfileLookupView(handle: profile.handle)) {
                            HStack {
                                AvatarView(profile: profile, size: 32)
                                VStack(alignment: .leading) {
                                    Text(profile.visibleName)
                                    Text("@" + profile.visibleHandle).font(.caption).foregroundColor(SpotcodeTheme.muted)
                                }
                                Spacer()
                            }.padding(.vertical, 4)
                        }.buttonStyle(SpotcodePlainButtonStyle())
                    }
                }
            }
            Divider()
        }
        .task(id: "\(postID):\(retry)") {
            loading = true; error = nil
            do {
                let result = try await SupabaseService.shared.postActivity(table: table, postID: postID, token: token)
                try Task.checkCancellation()
                rows = result; loading = false
            } catch {
                guard !Task.isCancelled, (error as? URLError)?.code != .cancelled else { return }
                self.error = error.localizedDescription; loading = false
            }
        }
    }
}

private struct PostPhotoSelection: Identifiable {
    let id = UUID()
    let photos: [String]
    let index: Int
}

private struct PostPhotoViewer: View {
    @Environment(\.dismiss) private var dismiss
    let photos: [String]
    @State var index: Int
    @State private var image: UIImage?
    @State private var failed = false
    @State private var zoom: CGFloat = 1
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                ZStack {
                    Color.black
                    if let image { NativeZoomableImage(image: image, zoom: $zoom) }
                    else if failed { Text(NSLocalizedString("画像を読み込めませんでした", comment: "")).foregroundColor(.white) }
                    else { ProgressView().tint(.white) }
                }
                HStack(spacing: 24) {
                    Button { index -= 1 } label: { Image(systemName: "chevron.left") }.disabled(index == 0)
                    Text("\(index + 1) / \(photos.count)")
                    Button { index += 1 } label: { Image(systemName: "chevron.right") }.disabled(index + 1 == photos.count)
                    Spacer()
                    Button { zoom = max(1, zoom / 1.5) } label: { Image(systemName: "minus.magnifyingglass") }
                        .accessibilityLabel(NSLocalizedString("縮小", comment: ""))
                    Button { zoom = min(6, zoom * 1.5) } label: { Image(systemName: "plus.magnifyingglass") }
                        .accessibilityLabel(NSLocalizedString("拡大", comment: ""))
                }.padding().foregroundColor(SpotcodeTheme.text).background(SpotcodeTheme.surface)
            }
            .navigationTitle(NSLocalizedString("画像", comment: ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { MapSheetCloseButton { dismiss() } } }
        }
        .navigationViewStyle(.stack)
        .task(id: index) {
            image = nil; failed = false; zoom = 1
            let value = photos[index]
            if let decoded = decodedDataURLImage(value, maxPixelSize: 4096) { image = decoded; return }
            do {
                guard let url = URL(string: value), ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { throw URLError(.badURL) }
                let (data, response) = try await URLSession.shared.data(from: url)
                try Task.checkCancellation()
                guard (response as? HTTPURLResponse)?.statusCode == 200, let decoded = UIImage(data: data) else { throw URLError(.cannotDecodeContentData) }
                image = decoded
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}

private final class NativeImageScrollView: UIScrollView {
    let picture = UIImageView()
    private var viewport = CGSize.zero
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black; minimumZoomScale = 1; maximumZoomScale = 6
        picture.contentMode = .scaleAspectFit
        addSubview(picture)
        let tap = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        tap.numberOfTapsRequired = 2; addGestureRecognizer(tap)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() {
        super.layoutSubviews()
        if viewport != bounds.size {
            viewport = bounds.size
            setZoomScale(1, animated: false)
            picture.frame = CGRect(origin: .zero, size: viewport)
            contentSize = viewport
        }
    }
    @objc private func doubleTap(_ tap: UITapGestureRecognizer) {
        if zoomScale > 1 { setZoomScale(1, animated: true) }
        else {
            let point = tap.location(in: picture)
            let size = CGSize(width: bounds.width / 3, height: bounds.height / 3)
            zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
        }
    }
}

private struct NativeZoomableImage: UIViewRepresentable {
    let image: UIImage
    @Binding var zoom: CGFloat
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> NativeImageScrollView {
        let view = NativeImageScrollView()
        view.delegate = context.coordinator
        return view
    }
    func updateUIView(_ view: NativeImageScrollView, context: Context) {
        context.coordinator.parent = self
        if view.picture.image !== image { view.picture.image = image; view.setZoomScale(1, animated: false) }
        if abs(view.zoomScale - zoom) > 0.01 && !view.isZooming { view.setZoomScale(zoom, animated: true) }
    }
    final class Coordinator: NSObject, UIScrollViewDelegate {
        var parent: NativeZoomableImage
        init(_ parent: NativeZoomableImage) { self.parent = parent }
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { (scrollView as? NativeImageScrollView)?.picture }
        func scrollViewDidEndZooming(_ scrollView: UIScrollView, with view: UIView?, atScale scale: CGFloat) { parent.zoom = scale }
        func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) { parent.zoom = scrollView.zoomScale }
    }
}

struct PostDetailView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let post: Post
    var onSpotTap: ((Post) -> Void)? = nil
    var onClose: (() -> Void)? = nil
    var body: some View {
        let _ = appColorTheme

        ScrollView { PostRow(post: post, opensDetail: false, onSpotTap: onSpotTap) }
            .background(SpotcodeTheme.surface).navigationTitle(NSLocalizedString("Post", comment: "")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if let onClose { MapSheetCloseButton(action: onClose) }
                }
            }
    }
}

private struct MapSheetCloseButton: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let action: () -> Void
    var body: some View {
        let _ = appColorTheme

        Button(action: action) {
            Image(systemName: "xmark").frame(width: 32, height: 32)
        }
        .accessibilityLabel(NSLocalizedString("閉じる", comment: ""))
        .keyboardShortcut(.cancelAction)
    }
}

struct ComposeView: View {
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: SpotcodeLayout.value(16, 16)) {
                    HStack(alignment: .top, spacing: 12) {
                        AvatarView(profile: model.displayProfile, size: SpotcodeLayout.value(40, 42))
                        ZStack(alignment: .topLeading) {
                            ComposerTextView(text: $bodyText, isFocused: $editorFocused).frame(height: editorHeight(bodyText, expanded: editorFocused))
                            if bodyText.isEmpty {
                                Text(NSLocalizedString("いまどうしてる？", comment: "")).spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont).foregroundColor(SpotcodeTheme.muted)
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
                            Button { showLink.toggle() } label: { ComposerChip(icon: "link", title: NSLocalizedString("リンクを追加", comment: ""), active: showLink) }
                        }
                        HStack(spacing: 8) {
                            Button { showEvent.toggle() } label: { ComposerChip(icon: "calendar", title: NSLocalizedString("イベントを追加", comment: ""), active: showEvent) }
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
                            TextField(NSLocalizedString("owner/repository（任意）", comment: ""), text: $repoFullName).textInputAutocapitalization(.never).autocorrectionDisabled(true)
                        }.spotcodeURLField()
                        Text(NSLocalizedString("連携済みOrganizationのメンバーがそのリポジトリを指定すると、組織アカウント名義で表示されます。", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                    }
                    if showEvent {
                        HStack {
                            Image(systemName: "calendar")
                            TextField(NSLocalizedString("イベントURL（任意）", comment: ""), text: $eventURL).textInputAutocapitalization(.never).keyboardType(.URL)
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
                NativeDraftControls(account: draftAccount, slot: "sheet", draft: draftSnapshot, restore: restoreDraft)
                    .padding(.horizontal).padding(.bottom)

            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
             .navigationTitle(NSLocalizedString("New idea", comment: "")).navigationBarTitleDisplayMode(.inline)
             .toolbar {
                 ToolbarItem(placement: .cancellationAction) {
                     Button { isPresented = false } label: {
                         Text(NSLocalizedString("Cancel", comment: ""))
                             .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                             .padding(.horizontal, 8)
                     }
                 }
                 ToolbarItem(placement: .confirmationAction) {
                     Button { publish() } label: {
                         Text(sending ? "Posting…" : NSLocalizedString("Post", comment: ""))
                             .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                             .padding(.horizontal, 8)
                     }.disabled(bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                 }
             }
        }
        .navigationViewStyle(.stack)
        #if targetEnvironment(macCatalyst)
        .frame(idealWidth: 640, idealHeight: 520)
        #endif
        .modifier(AppAppearancePreference())
        .spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
        .controlSize(SpotcodeLayout.controlSize)
        .buttonStyle(SpotcodePlainButtonStyle())
        .macTextSizePreference()
        .sheet(isPresented: $showLocationPicker) { LocationPickerSheet(spot: $selectedSpot, isPresented: $showLocationPicker) }
        .sheet(isPresented: $showPhotoPicker) { PhotoLibraryPicker(images: $photos) }
        .sheet(isPresented: $showPollEditor) { PollEditorSheet(poll: $poll, isPresented: $showPollEditor) }
    }

    private var draftAccount: String { model.displayProfile?.id?.uuidString ?? model.session?.user.id.uuidString ?? "guest" }
    private var draftSnapshot: NativeComposerDraft {
        NativeComposerDraft(body: bodyText, githubLink: githubLink, repoFullName: repoFullName, eventURL: eventURL, kind: postKind, visibility: visibility, photos: photos, poll: poll, spot: selectedSpot)
    }
    private func restoreDraft(_ value: NativeComposerDraft) {
        bodyText = value.body
        githubLink = value.githubLink; repoFullName = value.repoFullName
        eventURL = value.eventURL; postKind = value.kind; visibility = value.visibility
        photos = value.photos; poll = value.poll; selectedSpot = value.spot
        showLink = !githubLink.isEmpty || !repoFullName.isEmpty; showEvent = !eventURL.isEmpty
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
            ) {
                NativeDraftStore.completePublishing(draftSnapshot, account: draftAccount, slot: "sheet")
                bodyText = ""; githubLink = ""; repoFullName = ""; eventURL = ""
                photos = []; poll = nil; selectedSpot = nil; postKind = nil; visibility = "public"
                NativeDraftStore.save(draftSnapshot, account: draftAccount, slot: "sheet")
                isPresented = false
            }
            sending = false
        }
    }
}

private struct MapPostSelection: Identifiable {
    let id = UUID()
    let posts: [Post]
}

struct NativeMapView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    var focusPost: Post? = nil
    var cityDestination: CityMapDestination? = nil
    @State private var posts: [Post] = []
    @State private var region: MKCoordinateRegion
    @State private var selectedPosts: MapPostSelection?
    @State private var loading = false
    @State private var awaitingCurrentLocation: Bool
    @State private var locationRequestID = UUID()
    @State private var cameraRequestID = UUID()
    @StateObject private var location = ComposerLocationProvider()

    init(focusPost: Post? = nil, cityDestination: CityMapDestination? = nil) {
        self.focusPost = focusPost
        self.cityDestination = cityDestination
        _posts = State(initialValue: cityDestination?.posts ?? [])
        _awaitingCurrentLocation = State(initialValue: focusPost == nil && cityDestination == nil)
        let center = focusPost?.spot?.coordinate ?? .init(latitude: 35.681236, longitude: 139.767125)
        _region = State(initialValue: cityDestination?.region ?? .init(center: center, span: .init(latitudeDelta: 0.003, longitudeDelta: 0.003)))
    }

    var body: some View {
        let _ = appColorTheme

        ZStack(alignment: .trailing) {
            ClusteredPostMap(posts: posts, region: $region, selectedPosts: $selectedPosts,
                             locationRequestID: locationRequestID, initiallyLocateUser: focusPost == nil && cityDestination == nil,
                             cameraRequestID: cameraRequestID,
                             onLocated: { awaitingCurrentLocation = false })
            VStack(spacing: 8) {
                mapButton("plus") { zoom(0.5) }
                mapButton("minus") { zoom(2) }
                mapButton("arrow.counterclockwise") { resetMap() }
                mapButton("location.fill") { resetMap() }
                    .accessibilityLabel(NSLocalizedString("現在地", comment: ""))
            }
            .padding(.trailing, 12)
            if loading { ProgressView().padding(10).background(.ultraThinMaterial).clipShape(Circle()) }
        }
        .overlay(alignment: .bottom) {
            if awaitingCurrentLocation, let message = location.errorMessage {
                VStack(spacing: 8) {
                    Text(message).font(.caption)
                    Button(NSLocalizedString("再試行", comment: "")) { resetMap() }
                }.padding().background(.regularMaterial).cornerRadius(12).padding()
            } else if awaitingCurrentLocation {
                ProgressView(NSLocalizedString("現在地を取得中…", comment: ""))
                    .padding().background(.regularMaterial).cornerRadius(12).padding()
            }
        }
        .task {
            if cityDestination == nil { location.request() }
            guard posts.isEmpty else { return }
            loading = true; defer { loading = false }
            posts = (try? await SupabaseService.shared.spottedPosts(token: model.session?.accessToken)) ?? []
            if let focusPost, !posts.contains(where: { $0.id == focusPost.id }) { posts.append(focusPost) }
            if let coordinate = focusPost?.spot?.coordinate {
                region = .init(center: coordinate, span: .init(latitudeDelta: 0.003, longitudeDelta: 0.003))
            }
        }
        .onReceive(location.$spot) { value in
            guard awaitingCurrentLocation else { return }
            guard let coordinate = value?.coordinate else { return }
            region = .init(center: coordinate, span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006))
            awaitingCurrentLocation = false
        }
        .sheet(item: $selectedPosts) { selection in
            NavigationView {
                if selection.posts.count == 1, let post = selection.posts.first {
                    PostDetailView(post: post, onSpotTap: showSpotOnMap, onClose: { selectedPosts = nil })
                } else {
                    List(selection.posts) { post in
                        NavigationLink(destination: PostDetailView(post: post, onSpotTap: showSpotOnMap, onClose: { selectedPosts = nil })) {
                            // Only public pin metadata here; the detail view
                            // checks the location gate before showing the body.
                            VStack(alignment: .leading, spacing: 6) {
                                Text(post.displayAuthor?.visibleName ?? NSLocalizedString("Spot", comment: ""))
                                Text(post.spot?.label ?? NSLocalizedString("この場所の投稿", comment: ""))
                                    .font(.caption).foregroundColor(.secondary)
                                Text(relativeTime(post.createdAt))
                                    .font(.caption2).foregroundColor(.secondary)
                            }
                        }
                    }
                    .navigationTitle(NSLocalizedString("この場所の投稿", comment: ""))
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { MapSheetCloseButton { selectedPosts = nil } }
                    }
                }
            }
        }
    }

    private func showSpotOnMap(_ post: Post) {
        guard let coordinate = post.spot?.coordinate else { return }
        cameraRequestID = UUID()
        awaitingCurrentLocation = false
        selectedPosts = nil
        region = .init(center: coordinate, span: .init(latitudeDelta: 0.003, longitudeDelta: 0.003))
    }

    private func zoom(_ multiplier: Double) {
        cameraRequestID = UUID()
        region.span.latitudeDelta = min(max(region.span.latitudeDelta * multiplier, 0.002), 120)
        region.span.longitudeDelta = min(max(region.span.longitudeDelta * multiplier, 0.002), 120)
    }
    private func resetMap() {
        awaitingCurrentLocation = true
        locationRequestID = UUID()
        location.request()
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
    @Binding var selectedPosts: MapPostSelection?
    let locationRequestID: UUID
    let initiallyLocateUser: Bool
    let cameraRequestID: UUID
    let onLocated: () -> Void

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
        map.register(MKMarkerAnnotationView.self, forAnnotationViewWithReuseIdentifier: "post-cluster")
        map.setRegion(region, animated: false)
        context.coordinator.lastLocationRequestID = locationRequestID
        context.coordinator.lastCameraRequestID = cameraRequestID
        if initiallyLocateUser { map.setUserTrackingMode(.follow, animated: false) }
        return map
    }
    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.lastCameraRequestID != cameraRequestID {
            context.coordinator.lastCameraRequestID = cameraRequestID
            map.setUserTrackingMode(.none, animated: false)
        }
        if context.coordinator.lastLocationRequestID != locationRequestID {
            context.coordinator.lastLocationRequestID = locationRequestID
            // Let MapKit move its own camera when the blue-dot location arrives,
            // including when CLLocationManager and SwiftUI update out of order.
            map.setUserTrackingMode(.follow, animated: true)
        }
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
        if map.userTrackingMode == .none && !userIsTouchingMap && (latitudeChanged || centerChanged) {
            map.setRegion(region, animated: false)
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: ClusteredPostMap
        var lastLocationRequestID: UUID?
        var lastCameraRequestID: UUID?
        init(_ parent: ClusteredPostMap) { self.parent = parent }
        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if let cluster = annotation as? MKClusterAnnotation {
                let view = mapView.dequeueReusableAnnotationView(withIdentifier: "post-cluster", for: cluster) as! MKMarkerAnnotationView
                view.markerTintColor = .systemBlue
                view.glyphText = String(cluster.memberAnnotations.count)
                view.glyphImage = nil
                view.canShowCallout = false
                view.accessibilityLabel = NSLocalizedString("この場所の投稿", comment: "") + ": \(cluster.memberAnnotations.count)"
                return view
            }
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
        func mapView(_ mapView: MKMapView, didUpdate userLocation: MKUserLocation) {
            guard mapView.userTrackingMode != .none,
                  let fix = userLocation.location, fix.horizontalAccuracy >= 0,
                  abs(fix.timestamp.timeIntervalSinceNow) < 120 else { return }
            let target = MKCoordinateRegion(center: fix.coordinate,
                                            span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006))
            // Complete the one-shot move on the actual map, then release
            // tracking so zoom, panning and a post's address remain usable.
            mapView.setUserTrackingMode(.none, animated: false)
            mapView.setRegion(target, animated: false)
            parent.region = mapView.region
            parent.onLocated()
        }
        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            guard let cluster = view.annotation as? MKClusterAnnotation else { return }
            let posts = cluster.memberAnnotations.compactMap { ($0 as? PostMapAnnotation)?.post }
                .sorted {
                    if $0.createdAt != $1.createdAt { return ($0.createdAt ?? "") > ($1.createdAt ?? "") }
                    return $0.id.uuidString < $1.id.uuidString
                }
            guard !posts.isEmpty else { return }
            parent.selectedPosts = MapPostSelection(posts: posts)
            mapView.deselectAnnotation(cluster, animated: false)
        }
        func mapView(_ mapView: MKMapView, annotationView view: MKAnnotationView, calloutAccessoryControlTapped control: UIControl) {
            if let annotation = view.annotation as? PostMapAnnotation { parent.selectedPosts = MapPostSelection(posts: [annotation.post]) }
        }
    }
}

private final class PostMapAnnotation: NSObject, MKAnnotation {
    let post: Post
    let coordinate: CLLocationCoordinate2D
    var title: String? { post.spot?.label ?? post.displayAuthor?.name ?? NSLocalizedString("Spot", comment: "") }
    // Never expose the protected post body in an annotation callout.
    // PostDetailView applies the 100m gate after the user opens it.
    var subtitle: String? { NSLocalizedString("この場所の投稿", comment: "") }
    init(post: Post, coordinate: CLLocationCoordinate2D) { self.post = post; self.coordinate = coordinate }
}

struct RepositoriesView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let onCompose: (URL) -> Void
    @State private var repositoryNotice = ""
    @State private var repositoryOwner: UUID?
    @State private var repositories: [Repository] = []
    @State private var relatedPosts: [Post] = []
    @State private var loading = false
    @State private var loadGeneration = UUID()
    var body: some View {
        let _ = appColorTheme

        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 6) {
                    RepoMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: 22, height: 22).foregroundColor(SpotcodeTheme.accent)
                    Text(NSLocalizedString("Repos", comment: "")).spotcodeFont(16, weight: .bold, fallback: SpotcodeLayout.titleFont.weight(.bold))
                    Text(NSLocalizedString("自分と許可済みOrganizationのリポジトリ", comment: ""))
                        .spotcodeFont(15, weight: .regular, fallback: .subheadline).foregroundColor(SpotcodeTheme.muted)
                }.frame(maxWidth: .infinity).padding(.vertical, 22)
                if !repositoryNotice.isEmpty { Text(repositoryNotice).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted).padding(.horizontal) }
                if loading && repositories.isEmpty { ProgressView(NSLocalizedString("リポジトリを読み込み中…", comment: "")).padding(.top, 50) }
            else if model.me?.githubHandle == nil { Spacer(); ContentUnavailableViewCompat(title: NSLocalizedString("GitHubをプロフィールに連携してください", comment: ""), icon: "link"); Spacer() }
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
                    Label(NSLocalizedString("このリポで投稿", comment: ""), systemImage: "plus")
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
                Text(NSLocalizedString("関連投稿はありません", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            } else {
                Text(String(format: NSLocalizedString("関連投稿 %lld件", comment: ""), Int64(posts.count))).spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold)).foregroundColor(SpotcodeTheme.muted)
                ForEach(posts.prefix(4)) { post in
                    NavigationLink(destination: PostDetailView(post: post)) {
                        HStack(spacing: 8) {
                            AvatarView(profile: post.displayAuthor, size: 24)
                            Text(NativePrivacy.text(post.body)).spotcodeFont(12, weight: .regular, fallback: .caption).lineLimit(1).foregroundColor(SpotcodeTheme.text)
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
        guard !Task.isCancelled else { return }
        let generation = UUID()
        loadGeneration = generation
        loading = false
        repositories = []; relatedPosts = []; repositoryOwner = nil; repositoryNotice = ""
        guard let handle = model.me?.githubHandle, let session = model.session else { return }
        loading = true
        defer { if loadGeneration == generation { loading = false } }
        do {
            let loaded: [Repository]
            let githubToken = await model.hydrateSharedPrivateIssueToken()
            guard !Task.isCancelled, loadGeneration == generation, session.user.id == model.session?.user.id else { return }
            if githubToken != nil || model.me?.isOrg == true {
                do {
                    if model.me?.isOrg == true {
                        loaded = try await model.syncGithubOrganizations(includeRepositories: true).repositories ?? []
                    } else {
                        loaded = try await SupabaseService.shared.authorizedGithubRepositories(handle: handle, githubToken: githubToken ?? "")
                    }
                } catch is CancellationError { return
                } catch let error as URLError where error.code == .cancelled { return
                } catch {
                    guard !Task.isCancelled, loadGeneration == generation, session.user.id == model.session?.user.id else { return }
                    loaded = try await SupabaseService.shared.repositories(handle: handle)
                    guard !Task.isCancelled, loadGeneration == generation, session.user.id == model.session?.user.id else { return }
                    repositoryNotice = error.localizedDescription
                }
            } else {
                loaded = try await SupabaseService.shared.repositories(handle: handle)
            }
            guard !Task.isCancelled, loadGeneration == generation, session.user.id == model.session?.user.id else { return }
            repositoryOwner = session.user.id
            repositories = loaded.sorted { ($0.pushedAt ?? "") > ($1.pushedAt ?? "") }
            let posts = (try? await SupabaseService.shared.posts(limit: 200, token: session.accessToken)) ?? []
            guard !Task.isCancelled, loadGeneration == generation, session.user.id == model.session?.user.id else { return }
            relatedPosts = posts
        } catch is CancellationError { return
        } catch let error as URLError where error.code == .cancelled { return
        } catch {
            guard !Task.isCancelled, loadGeneration == generation, session.user.id == model.session?.user.id else { return }
            model.errorMessage = error.localizedDescription
        }
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @AppStorage("spotcode.notifications.likes") private var likesEnabled = true
    @AppStorage("spotcode.notifications.comments") private var commentsEnabled = true
    @AppStorage("spotcode.notifications.mentions") private var mentionsEnabled = true
    @AppStorage("spotcode.notifications.follows") private var followsEnabled = true
    @AppStorage("spotcode.notifications.followedPosts") private var followedPostScope = "off"
    @State private var notifications: [AppNotification] = []
    @State private var loading = false
    var body: some View {
        let _ = appColorTheme

        VStack(spacing: 0) {
            #if targetEnvironment(macCatalyst)
            Text(NSLocalizedString("Notifications", comment: "")).spotcodeFont(18, weight: .bold, fallback: .headline)
                .frame(maxWidth: .infinity, alignment: .leading).padding(20)
            #else
            PageHeader(title: NSLocalizedString("Notifications", comment: ""))
            #endif
            if loading && notifications.isEmpty { Spacer(); ProgressView(NSLocalizedString("通知を読み込み中…", comment: "")); Spacer() }
            else if notifications.isEmpty { Spacer(); ContentUnavailableViewCompat(title: NSLocalizedString("通知はありません", comment: ""), icon: "bell"); Spacer() }
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
    @Environment(\.appColorTheme) private var appColorTheme
    let notification: AppNotification
    let respond: (Bool) async -> Void
    @State private var responding = false
    @State private var showingPost = false
    @State private var showingActor = false
    @State private var hovered = false

    var body: some View {
        let _ = appColorTheme

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
                (Text(notification.actor.visibleName).bold()
                 + Text(" @\(notification.actor.visibleHandle)").foregroundColor(SpotcodeTheme.muted)
                 + Text(" " + label)
                 + Text(notification.createdAt.map { " · " + relativeTime($0) } ?? "").foregroundColor(SpotcodeTheme.muted))
                    .spotcodeFont(15, fallback: .subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                #else
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    NavigationLink(destination: ProfileLookupView(handle: notification.actor.handle)) {
                        HStack(spacing: 4) {
                            Text(notification.actor.visibleName).fontWeight(.bold)
                            Text("@\(notification.actor.visibleHandle)").foregroundColor(SpotcodeTheme.muted)
                        }
                    }.buttonStyle(SpotcodePlainButtonStyle())
                    Spacer(minLength: 4)
                    if let date = notification.createdAt { Text(relativeTime(date)).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted) }
                }
                Text(LocalizedStringKey(label)).spotcodeFont(15, weight: .regular, fallback: .subheadline).foregroundColor(SpotcodeTheme.muted)
                #endif
                if let context = (notification.kind == .followedPost ? notification.post?.body : notification.context ?? notification.post?.body), !context.isEmpty {
                    Text(NativePrivacy.text(context)).spotcodeFont(14, weight: .regular, fallback: .subheadline).foregroundColor(SpotcodeTheme.muted).lineLimit(3).padding(SpotcodeLayout.value(12, 9))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 8))
                }
                if notification.kind == .followRequest {
                    HStack {
                        Button(NSLocalizedString("承認", comment: "")) { act(true) }.buttonStyle(OutlineButtonStyle(filled: true))
                        Button(NSLocalizedString("拒否", comment: "")) { act(false) }.buttonStyle(OutlineButtonStyle())
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let handle: String
    @State private var profile: Profile?
    @State private var loading = true
    var body: some View {
        let _ = appColorTheme

        VStack(spacing: 0) {
            Button { dismiss() } label: {
                Label(NSLocalizedString("戻る", comment: ""), systemImage: "chevron.left")
                    .spotcodeFont(16, weight: .semibold, fallback: .body)
                    .frame(minHeight: 44)
                    .padding(.horizontal, 16)
            }
            .buttonStyle(SpotcodePlainButtonStyle())
            .accessibilityIdentifier("profile.back")
            .frame(maxWidth: .infinity, alignment: .leading)
            Group {
                if let profile { ProfileView(profile: profile) }
                else if loading { ProgressView(NSLocalizedString("プロフィールを読み込み中…", comment: "")) }
                else { ContentUnavailableViewCompat(title: NSLocalizedString("プロフィールを取得できませんでした", comment: ""), icon: "person.crop.circle.badge.exclamationmark") }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationBarHidden(true)
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let profile: Profile?
    @AppStorage("spotcode.selectedIssueReposByUser") private var taskRepositoriesJSON = "{}"
    @AppStorage("spotcode.privateIssuesEnabled") private var taskPrivateEnabled = false
    @AppStorage("spotcode.hideTasks") private var taskCardHidden = false
    @State private var profilePosts: [Post] = []
    @State private var counts = (following: 0, followers: 0, posts: 0)
    @State private var selectedTab = 0
    @State private var repositories: [Repository] = []
    @State private var languageStats: [GitHubLanguageStat] = []
    @State private var contributions: [GitHubContribution] = []
    @State private var issueSearch: GitHubIssueSearchResponse?
    var body: some View {
        let _ = appColorTheme

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
                            ForEach([NSLocalizedString("Posts", comment: ""), NSLocalizedString("Spots", comment: ""), NSLocalizedString("Likes", comment: "")].indices, id: \.self) { index in
                                Button { selectedTab = index } label: {
                                    VStack(spacing: 13) {
                                        Text([NSLocalizedString("Posts", comment: ""), NSLocalizedString("Spots", comment: ""), NSLocalizedString("Likes", comment: "")][index]).spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont)
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
                            ContentUnavailableViewCompat(title: NSLocalizedString("いいねした投稿はありません", comment: ""), icon: "heart")
                        }
                    }
                } else { ContentUnavailableViewCompat(title: NSLocalizedString("ログインしてください", comment: ""), icon: "person.crop.circle") }
            }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
         .background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationBarHidden(true)
         .background(SwipeBackEnabler())
         .task(id: "\(profile?.id?.uuidString ?? "none"):\(model.session?.user.id.uuidString ?? "guest"):\(taskRepositoriesJSON):\(taskPrivateEnabled):\(taskCardHidden)") { await loadProfile() }
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
        let viewer = model.session?.user.id
        issueSearch = nil
        guard let id = profile?.id else { return }
        async let posts = try? SupabaseService.shared.posts(limit: 80, authorID: id, token: model.session?.accessToken)
        async let stats = SupabaseService.shared.profileCounts(userID: id, token: model.session?.accessToken)
        let fetchedPosts = await posts ?? []
        guard !Task.isCancelled, model.session?.user.id == viewer else { return }
        let timelinePosts = model.posts.filter { ($0.authorID == id || $0.organizationAuthorID == id) }
        profilePosts = mergedProfilePosts(fetchedPosts, timelinePosts)
        counts = await stats
        if let handle = profile?.githubHandle {
            let mayReadPrivate = profile?.id == model.me?.id && UserDefaults.standard.bool(forKey: "spotcode.privateIssuesEnabled")
            let githubToken = await model.hydrateSharedPrivateIssueToken()
            guard !Task.isCancelled, model.session?.user.id == viewer else { return }
            let selected = taskCardHidden ? Set<String>() : selectedRepoSet(taskRepositoriesJSON, owner: viewer)
            async let loadedRepos = SupabaseService.shared.repositories(handle: handle)
            async let loadedContributions = SupabaseService.shared.githubContributions(handle: handle)
            async let loadedIssues = SupabaseService.shared.githubOpenIssues(handle: handle, repositories: Array(selected), githubToken: githubToken, includePrivate: mayReadPrivate && githubToken != nil)
            async let loadedLanguages = SupabaseService.shared.githubLanguageStats(handle: handle)
            repositories = (try? await loadedRepos) ?? []
            contributions = (try? await loadedContributions) ?? []
            let issues = try? await loadedIssues
            guard !Task.isCancelled, model.session?.user.id == viewer else { return }
            issueSearch = issues
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
        private var horizontalBackGesture: UIPanGestureRecognizer?
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
                #if targetEnvironment(macCatalyst)
                // Catalyst's edge-pop does not handle a two-finger trackpad
                // scroll. Attach one recognizer to the existing navigation
                // stack; popping preserves the previous scroll view and offset.
                guard navigationController.viewControllers.count > 1,
                      self.horizontalBackGesture == nil,
                      !(navigationController.view.gestureRecognizers ?? []).contains(where: { $0.name == "spotcode.profile.scrollBack" }) else { return }
                let pan = UIPanGestureRecognizer(target: self, action: #selector(self.scrollBack(_:)))
                pan.name = "spotcode.profile.scrollBack"
                pan.allowedScrollTypesMask = .continuous
                pan.allowedTouchTypes = []
                pan.cancelsTouchesInView = false
                pan.delegate = self
                navigationController.view.addGestureRecognizer(pan)
                self.horizontalBackGesture = pan
                #endif
            }
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            if let horizontalBackGesture {
                horizontalBackGesture.view?.removeGestureRecognizer(horizontalBackGesture)
                self.horizontalBackGesture = nil
            }
        }

        @objc private func scrollBack(_ pan: UIPanGestureRecognizer) {
            guard pan.state == .ended, let navigationController,
                  navigationController.viewControllers.count > 1,
                  navigationController.transitionCoordinator == nil else { return }
            let delta = pan.translation(in: pan.view)
            guard delta.x > 100, delta.x > abs(delta.y) * 2 else { return }
            navigationController.popViewController(animated: true)
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard (navigationController?.viewControllers.count ?? 0) > 1,
                  navigationController?.transitionCoordinator == nil else { return false }
            if let pan = gestureRecognizer as? UIPanGestureRecognizer, pan === horizontalBackGesture {
                let velocity = pan.velocity(in: pan.view)
                return velocity.x > 0 && velocity.x > abs(velocity.y) * 2
            }
            return true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            gestureRecognizer === horizontalBackGesture
        }
    }
}

private struct ProfileSearchView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State var initialQuery: String
    @State private var results: [Profile] = []
    @State private var loading = false
    var body: some View {
        let _ = appColorTheme

        NavigationView {
            VStack(spacing: 0) {
                TextField(NSLocalizedString("ユーザー・スポット・リポジトリを検索…", comment: ""), text: $initialQuery)
                    .textInputAutocapitalization(.never).submitLabel(.search).spotcodeField().padding()
                    .onSubmit { Task { await search() } }
                if loading { ProgressView().padding() }
                List(results) { profile in
                    NavigationLink(destination: ProfileView(profile: profile)) {
                        HStack(spacing: 12) { AvatarView(profile: profile, size: SpotcodeLayout.value(40, 42)); VStack(alignment: .leading) { Text(profile.visibleName).fontWeight(.bold); Text("@\(profile.visibleHandle)").foregroundColor(SpotcodeTheme.muted) } }
                    }.listRowBackground(SpotcodeTheme.surface)
                }.listStyle(.plain)
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
                .navigationTitle(NSLocalizedString("Search", comment: "")).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(NSLocalizedString("閉じる", comment: "")) { dismiss() } } }
                .task { await search() }
        }.modifier(AppAppearancePreference())
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
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    AvatarView(profile: profile, size: 56)
                    Spacer()
                    if isOwn {
                        Button(NSLocalizedString("Edit profile", comment: "")) { editing = true }.spotcodeFont(14, weight: .bold, fallback: SpotcodeLayout.bodyFont.weight(.bold)).foregroundColor(SpotcodeTheme.background)
                            .padding(.horizontal, 20).padding(.vertical, SpotcodeLayout.value(9, 11)).background(SpotcodeTheme.text).clipShape(Capsule()).padding(.top, 14)
                    } else if model.session != nil {
                        HStack(spacing: 10) {
                            Menu {
                                Button(NSLocalizedString("プロフィールURLをコピー", comment: "")) {
                                    UIPasteboard.general.string = "https://hrmcngs.github.io/spotcode-sns/#/\(profile.handle)"
                                }
                                if let handle = profile.githubHandle {
                                    Link(NSLocalizedString("GitHubで開く", comment: ""), destination: URL(string: "https://github.com/\(handle)")!)
                                }
                                if let id = profile.id { ProfileSocialActions(profile: profile, targetID: id) }
                            } label: { Text(NSLocalizedString("More", comment: "")).profileActionCapsule(filled: false) }
                            if isFollowing && !model.isPostingAsOfficial {
                                FollowAudienceMenu(profile: profile, title: NSLocalizedString("Following", comment: ""), unfollow: { toggleFollow() })
                                    .profileActionCapsule(filled: false).disabled(followLoading)
                            } else {
                                Button(followLoading ? "…" : (followState == "pending" ? NSLocalizedString("Requested", comment: "") : NSLocalizedString("Follow", comment: ""))) { toggleFollow() }
                                    .profileActionCapsule(filled: !isFollowing).disabled(followLoading)
                            }
                        }.padding(.top, 14)
                    }
                }.padding(.top, 28).padding(.bottom, 16)
                HStack(spacing: 14) {
                    NavigationLink(destination: BusinessCardView(profile: profile)) {
                        Label(isOwn ? NSLocalizedString("名刺を共有", comment: "") : NSLocalizedString("名刺を見る", comment: ""), systemImage: "rectangle.on.rectangle")
                    }
                    if isOwn { NavigationLink(NSLocalizedString("名刺コレクション", comment: ""), destination: BusinessCardCollectionView()) }
                }.font(.subheadline).padding(.vertical, 8)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 9) {
                        Text(profile.visibleName).spotcodeFont(28, weight: .bold, fallback: .title.weight(.bold))
                        if !hideBadges {
                            Text("{ }").spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent)
                                .padding(.horizontal, 8).padding(.vertical, 3).overlay(Capsule().stroke(SpotcodeTheme.accent))
                            ForEach(languageStats.prefix(4)) { language in
                                LanguageMedal(language: language)
                            }
                        }
                    }.padding(.vertical, 5)
                }
                Text("@\(profile.visibleHandle)").spotcodeFont(16, weight: .semibold, fallback: SpotcodeLayout.titleFont).foregroundColor(SpotcodeTheme.muted)
                if let bio = profile.bio, !bio.isEmpty { Text(bio) }
                HStack(spacing: 14) {
                    if let location = profile.location, !location.isEmpty { Label(location, systemImage: "mappin") }
                    if let joined = profile.createdAt { Label(String(format: NSLocalizedString("登録日: %@", comment: ""), String(joined.prefix(7))), systemImage: "calendar") }
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
                        NavigationLink(destination: FollowListView(userID: id, kind: .following)) { ProfileCount(value: counts.following, label: NSLocalizedString("Following", comment: "")) }.buttonStyle(SpotcodePlainButtonStyle())
                        NavigationLink(destination: FollowListView(userID: id, kind: .followers)) { ProfileCount(value: counts.followers, label: NSLocalizedString("Followers", comment: "")) }.buttonStyle(SpotcodePlainButtonStyle())
                    }
                    ProfileCount(value: counts.posts, label: NSLocalizedString("Posts", comment: ""))
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
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

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
         .accessibilityLabel(String(format: NSLocalizedString("%@、%d個のリポジトリ", comment: ""), language.name, language.repositoryCount))
    }
}

private struct ProfileSocialActions: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let profile: Profile
    let targetID: UUID
    @State private var busy = false
    var body: some View {
        let _ = appColorTheme

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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let profile: Profile
    var title: String? = nil
    var unfollow: (() -> Void)? = nil
    @State private var busy = false
    var body: some View {
        let _ = appColorTheme

        Menu {
            Button { change("friends", enabled: !friends) } label: {
                Label(friends ? NSLocalizedString("親しい友達から解除", comment: "") : NSLocalizedString("親しい友達に登録", comment: ""), systemImage: friends ? "checkmark.circle.fill" : "heart")
            }
            Button { change("org", enabled: !organization) } label: {
                Label(organization ? NSLocalizedString("同じ組織から解除", comment: "") : NSLocalizedString("同じ組織に登録", comment: ""), systemImage: organization ? "checkmark.circle.fill" : "building.2")
            }
            if let unfollow { Button(NSLocalizedString("フォロー解除", comment: ""), role: .destructive, action: unfollow) }
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let userID: UUID
    let kind: FollowListKind
    @State private var profiles: [Profile] = []
    var body: some View {
        let _ = appColorTheme

        List(profiles) { profile in
            HStack {
                NavigationLink(destination: ProfileView(profile: profile)) {
                    HStack(spacing: 12) { AvatarView(profile: profile, size: SpotcodeLayout.value(40, 42)); VStack(alignment: .leading) { Text(profile.visibleName).fontWeight(.bold); Text("@\(profile.visibleHandle)").foregroundColor(SpotcodeTheme.muted) } }
                }
                if kind == .following && userID == model.session?.user.id && !model.isPostingAsOfficial {
                    FollowAudienceMenu(profile: profile)
                }
            }.listRowBackground(SpotcodeTheme.surface)
        }.listStyle(.plain).background(SpotcodeTheme.surface)
            .navigationTitle(kind == .following ? NSLocalizedString("Following", comment: "") : NSLocalizedString("Followers", comment: ""))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Group {
                        if let me = model.me {
                            NavigationLink(destination: BusinessCardView(profile: me)) { Label(NSLocalizedString("名刺を共有", comment: ""), systemImage: "rectangle.on.rectangle") }
                        }
                    }
                }
            }
            .task {
                if kind == .following { profiles = (try? await SupabaseService.shared.following(userID: userID, token: model.session?.accessToken)) ?? [] }
                else { profiles = (try? await SupabaseService.shared.followers(userID: userID, token: model.session?.accessToken)) ?? [] }
            }
    }
}

private struct EditProfileView: View {
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        NavigationView {
            ScrollView {
              VStack(spacing: 14) {
                AvatarView(profile: previewProfile, size: 92)
                HStack {
                    Button(NSLocalizedString("画像をアップロード", comment: "")) { showingImagePicker = true }.buttonStyle(OutlineButtonStyle())
                    if avatarURL != nil { Button(NSLocalizedString("画像を消す", comment: "")) { avatarURL = nil }.buttonStyle(OutlineButtonStyle()) }
                }
                Picker(NSLocalizedString("アイコンの形", comment: ""), selection: $avatarShape) {
                    Text(NSLocalizedString("● 円", comment: "")).tag("round")
                    Text(NSLocalizedString("■ 角丸", comment: "")).tag("square")
                }.pickerStyle(.segmented)
                TextField(NSLocalizedString("表示名", comment: ""), text: $name).spotcodeField()
                TextField(NSLocalizedString("自己紹介", comment: ""), text: $bio).spotcodeField()
                TextField(NSLocalizedString("場所", comment: ""), text: $location).spotcodeField()
                TextField(NSLocalizedString("プロフィールURL", comment: ""), text: $website)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL).spotcodeField()
                if !websiteIsValid {
                    Label(NSLocalizedString("http(s)形式のURLを入力してください。", comment: ""), systemImage: "exclamationmark.triangle.fill")
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
                .navigationTitle(NSLocalizedString("Edit profile", comment: "")).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(NSLocalizedString("Cancel", comment: "")) { isPresented = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(saving ? NSLocalizedString("保存中…", comment: "") : NSLocalizedString("保存", comment: "")) { saving = true; Task { if await model.updateProfile(name: name, bio: bio, location: location, website: normalizedWebsiteValue, twitter: sanitizeSocialHandle(twitter), instagram: sanitizeSocialHandle(instagram), avatarURL: avatarURL, avatarShape: avatarShape) { isPresented = false }; saving = false } }.disabled(name.isEmpty || saving || !websiteIsValid)
                    }
                }
                .onAppear { name = profile.name; bio = profile.bio ?? ""; location = profile.location ?? ""; website = profile.website ?? ""; twitter = profile.twitter ?? ""; instagram = profile.instagram ?? ""; avatarURL = profile.avatarURL; avatarShape = profile.avatarShape ?? "round" }
                .sheet(isPresented: $showingImagePicker) { ProfileImagePicker(image: $avatarURL) }
        }.modifier(AppAppearancePreference())
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
    @Environment(\.appColorTheme) private var appColorTheme
    let handle: String
    let contributions: [GitHubContribution]
    var showsTitle = true
    // Match Web's 53 × 7 grid and align by date rather than response length.
    private var cells: [GitHubContribution] {
        let counts = Dictionary(contributions.map { ($0.date, $0.count) }, uniquingKeysWith: { _, latest in latest })
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"; formatter.timeZone = TimeZone(secondsFromGMT: 0)
        let today = Date()
        return (0..<371).map { index in
            let date = Calendar.current.date(byAdding: .day, value: index - 370, to: today) ?? today
            let key = formatter.string(from: date)
            return GitHubContribution(date: key, count: counts[key] ?? 0)
        }
    }
    var body: some View {
        let _ = appColorTheme

        let days = cells
        Link(destination: URL(string: "https://github.com/\(handle)?tab=contributions")!) {
          VStack(alignment: .leading, spacing: 8) {
            if showsTitle {
                HStack(spacing: 5) { Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13); Text(NSLocalizedString("GitHub activity", comment: "")); Text(NSLocalizedString("last 12 months", comment: "")).foregroundColor(SpotcodeTheme.muted) }.spotcodeFont(12, weight: .regular, fallback: .caption)
            }
            GeometryReader { geometry in
                // Scale the entire 53-week grid to the available profile/rail
                // width, keeping square cells and proportional spacing.
                let scale = geometry.size.width / 687
                HStack(alignment: .top, spacing: 2 * scale) {
                    ForEach(0..<53, id: \.self) { column in
                        VStack(spacing: 2 * scale) {
                            ForEach(0..<7, id: \.self) { row in
                                let day = days[column * 7 + row]
                                RoundedRectangle(cornerRadius: 2 * scale)
                                    .fill(grassColor(day.count))
                                    .frame(width: 11 * scale, height: 11 * scale)
                                    .help("\(day.date): \(day.count) contributions")
                            }
                        }
                    }
                }
            }.aspectRatio(687.0 / 89.0, contentMode: .fit)
             .frame(maxWidth: .infinity)
          }.padding(.top, 8).foregroundColor(SpotcodeTheme.text)
        }.buttonStyle(SpotcodePlainButtonStyle())
    }

    private func grassColor(_ count: Int) -> Color {
        let hex = count <= 0 ? "#161b22" : count < 2 ? "#0e4429" : count < 4 ? "#006d32" : count < 8 ? "#26a641" : "#39d353"
        return businessCardColor(hex)
    }
}

private enum IssueDueStatus { case overdue, soon, later }

private struct OpenIssuesCard: View {
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) { RepoMark().stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round)).frame(width: 13, height: 13).foregroundColor(SpotcodeTheme.muted); Text(NSLocalizedString("Open issues", comment: "")).foregroundColor(SpotcodeTheme.muted); Text("\(total)").fontWeight(.bold); Spacer(); Text(NSLocalizedString("公開リポの未クローズ issue (task)", comment: "")).spotcodeFont(11, weight: .regular, fallback: .caption2).foregroundColor(SpotcodeTheme.muted)
                if !allowedIssues.isEmpty {
                    Button(listExpanded ? NSLocalizedString("折りたたむ", comment: "") : NSLocalizedString("リストを表示", comment: "")) { withAnimation { listExpanded.toggle() } }
                        .spotcodeFont(11, weight: .regular, fallback: .caption2).foregroundColor(SpotcodeTheme.muted).padding(.horizontal, 8).padding(.vertical, 3)
                        .overlay(Capsule().stroke(SpotcodeTheme.border))
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    Button { selectedRepository = nil; listExpanded = true; expandedIssues.removeAll() } label: {
                        Text(String(format: NSLocalizedString("すべて %d", comment: ""), total)).issueFilterPill(selected: selectedRepository == nil)
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
                ProgressView(NSLocalizedString("Issueを読み込み中…", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            } else if allowedIssues.isEmpty {
                Text(NSLocalizedString("未クローズのIssueはありません", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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
    @Environment(\.appColorTheme) private var appColorTheme
    let source: String
    private var blocks: [IssueMarkdownBlock] { parseIssueMarkdown(source) }

    var body: some View {
        let _ = appColorTheme

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
    @Environment(\.appColorTheme) private var appColorTheme
    let value: Int; let label: String
    var body: some View {
        let _ = appColorTheme
         HStack(spacing: 5) { Text("\(value)").fontWeight(.bold).foregroundColor(SpotcodeTheme.text); Text(label).foregroundColor(SpotcodeTheme.muted) } }
}

struct SettingsView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var tab: Int

    init() {
        let arguments = ProcessInfo.processInfo.arguments
        let screenshotTab = arguments.contains("-SpotcodeScreenshotMode") ? 2 : 0
        _tab = State(initialValue: screenshotTab)
    }
    var body: some View {
        let _ = appColorTheme

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(NSLocalizedString("Settings", comment: "")).spotcodeFont(22, weight: .bold, fallback: .title2.weight(.bold))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 0) {
                        SettingsTab(title: NSLocalizedString("アカウント", comment: ""), icon: "person", selected: tab == 0) { tab = 0 }
                        SettingsTab(title: NSLocalizedString("プライバシー", comment: ""), icon: "lock", selected: tab == 1) { tab = 1 }
                        SettingsTab(title: NSLocalizedString("画面表示", comment: ""), icon: "gearshape", selected: tab == 2) { tab = 2 }
                        if model.me?.isAdmin == true {
                            SettingsTab(title: NSLocalizedString("開発", comment: ""), icon: "hammer", selected: tab == 3) { tab = 3 }
                        }
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
    @Environment(\.appColorTheme) private var appColorTheme
    let title: String; let icon: String; let selected: Bool; let action: () -> Void
    var body: some View {
        let _ = appColorTheme

        Button(action: action) {
            VStack(spacing: 10) {
                Label { Text(LocalizedStringKey(title)) } icon: { Image(systemName: icon) }
                    .spotcodeFont(12, weight: .semibold, fallback: .caption.weight(.semibold))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.horizontal, 12)
                Rectangle().fill(selected ? SpotcodeTheme.accent : SpotcodeTheme.muted).frame(height: selected ? 3 : 1)
            }.frame(minWidth: 100, minHeight: 44)
        }.foregroundColor(selected ? SpotcodeTheme.accent : SpotcodeTheme.muted)
    }
}

private struct SettingsCard<Content: View>: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let title: String
    @ViewBuilder let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) { self.title = title; self.content = content() }
    var body: some View {
        let _ = appColorTheme

        VStack(alignment: .leading, spacing: 14) { Text(LocalizedStringKey(title)).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont); content }
            .padding(.vertical, 16).frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
    }
}

private struct SettingsStatusTag: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let text: String
    let enabled: Bool
    var body: some View {
        let _ = appColorTheme

        Text(LocalizedStringKey(text)).spotcodeFont(12, weight: .bold, fallback: .caption.bold())
            .foregroundColor(enabled ? .green : SpotcodeTheme.muted)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background((enabled ? Color.green : SpotcodeTheme.muted).opacity(0.12))
            .clipShape(Capsule())
            .overlay(Capsule().stroke((enabled ? Color.green : SpotcodeTheme.muted).opacity(0.45)))
    }
}

private struct GitHubOrganizationSettings: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var busy = false
    @State private var message = ""
    @State private var login = ""
    @State private var challenge: SupabaseService.OrganizationFileChallenge?

    var body: some View {
        let _ = appColorTheme

        SettingsCard("GitHub Organization") {
            if model.me?.isOrg == true {
                Text(NSLocalizedString("公開の.githubリポジトリに確認ファイルを追加して承認します。承認後もファイルは残してください。", comment: ""))
                    .foregroundColor(SpotcodeTheme.muted)
                TextField(NSLocalizedString("Organization名（Drowse-Lab）", comment: ""), text: $login)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().spotcodeField()
                Button(NSLocalizedString("確認コードを発行", comment: "")) { perform(issue: true) }.disabled(busy)
                if let challenge {
                    Text(challenge.login + "/.github → spotcode-verification.txt")
                        .spotcodeFont(12, weight: .regular, fallback: .caption).textSelection(.enabled)
                    Text(NSLocalizedString("次の内容をファイルに保存してください。有効期限は24時間です。", comment: ""))
                    Text(challenge.content).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    Button(NSLocalizedString("確認コードをコピー", comment: "")) { UIPasteboard.general.string = challenge.content }
                    Link(NSLocalizedString("GitHubでファイルを追加", comment: ""), destination: challenge.create_url)
                    Button(NSLocalizedString("確認して承認", comment: "")) { perform(issue: false) }.disabled(busy)
                }
            }
            Button(NSLocalizedString("連携状態を確認", comment: "")) { synchronize() }.disabled(busy)
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var busy = false
    @State private var message = ""
    @State private var authorizer: GitHubPrivateIssueAuthorizer?

    var body: some View {
        let _ = appColorTheme

        SettingsCard("GitHub") {
            Text(NSLocalizedString("Organizationへのアクセスは、最初のGitHub連携時にGitHubの認証画面で許可します。管理者の承認が必要な場合があります。", comment: ""))
                .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            if let handle = model.me?.githubHandle { Text("@" + handle).fontWeight(.semibold) }
            Button(model.me?.githubHandle == nil ? NSLocalizedString("GitHubと連携", comment: "") : NSLocalizedString("GitHubの連携権限を更新", comment: "")) { authorize() }.disabled(busy)
            if busy { ProgressView(NSLocalizedString("GitHubで認証中…", comment: "")) }
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var showAddAccount = false
    @State private var isOrg = false
    @State private var organization = ""
    @State private var savingIdentity = false
    var body: some View {
        let _ = appColorTheme

        VStack(spacing: SpotcodeLayout.value(12, 18)) {
            SettingsCard(NSLocalizedString("アカウント", comment: "")) {
                Text(NSLocalizedString("この端末にログイン済みのアカウントを切り替えられます。アカウント自体は削除されません。", comment: "")).foregroundColor(SpotcodeTheme.muted)
                ForEach(model.savedAccounts) { account in
                    let active = account.id == model.session?.user.id && !model.isPostingAsOfficial
                    Button {
                        guard !active else { return }
                        Task { _ = await model.switchAccount(to: account.id) }
                    } label: {
                        HStack {
                            AvatarView(profile: account.profile, size: SpotcodeLayout.value(40, 42))
                            VStack(alignment: .leading) {
                                Text(account.profile.visibleName).fontWeight(.bold)
                                HStack(spacing: 4) {
                                    Text("@\(account.profile.visibleHandle)")
                                    if active {
                                        Text("·")
                                        Text(NSLocalizedString("現在", comment: ""))
                                    }
                                }.spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                            }
                            Spacer()
                            if !active { Text(NSLocalizedString("切り替え", comment: "")).spotcodeFont(12, weight: .bold, fallback: .caption.weight(.bold)).foregroundColor(SpotcodeTheme.accent) }
                        }
                        .padding(SpotcodeLayout.value(10, 12))
                        .background(active ? SpotcodeTheme.selection : SpotcodeTheme.surface2)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                    }.buttonStyle(SpotcodePlainButtonStyle())
                }
                Button(NSLocalizedString("＋ 別のアカウントでログイン", comment: "")) { showAddAccount = true }.buttonStyle(OutlineButtonStyle())
            }
            MFASettingsCard()
            SettingsCard(NSLocalizedString("役割", comment: "")) {
                Label { Text(LocalizedStringKey(roleTitle)) } icon: { Image(systemName: model.me?.isAdmin == true ? "sparkles" : (model.me?.isOperator == true ? "flag" : "person")) }.foregroundColor(SpotcodeTheme.accent)
                Text(LocalizedStringKey(roleDescription)).foregroundColor(SpotcodeTheme.muted)
            }
            SettingsCard(NSLocalizedString("アカウントの種類", comment: "")) {
                SettingsStatusTag(text: isOrg ? NSLocalizedString("組織アカウント", comment: "") : NSLocalizedString("個人アカウント", comment: ""), enabled: isOrg)
                Text(isOrg ? NSLocalizedString("プロフィールに組織バッジを表示します。", comment: "") : NSLocalizedString("個人のプログラマープロフィールとして表示します。", comment: "")).foregroundColor(SpotcodeTheme.muted)
                Button(isOrg ? NSLocalizedString("個人アカウントに変更", comment: "") : NSLocalizedString("組織アカウントに変更", comment: "")) {
                    isOrg.toggle(); saveIdentity()
                }.buttonStyle(OutlineButtonStyle(filled: !isOrg)).disabled(savingIdentity)
            }
            GitHubOrganizationSettings()
            SettingsCard(NSLocalizedString("所属・組織名", comment: "")) {
                Text(NSLocalizedString("プロフィールに表示する会社・学校・コミュニティ名を設定します。", comment: "")).foregroundColor(SpotcodeTheme.muted)
                TextField(NSLocalizedString("所属名", comment: ""), text: $organization).spotcodeField()
                Button(NSLocalizedString("保存", comment: "")) { saveIdentity() }.buttonStyle(OutlineButtonStyle()).disabled(savingIdentity)
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
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        VStack(spacing: SpotcodeLayout.value(12, 18)) {
            Text(NSLocalizedString("この区画は管理者だけに表示されます。接続情報や内部IDは一般ユーザーには表示されません。", comment: ""))
                .foregroundColor(SpotcodeTheme.muted)
            SettingsCard(NSLocalizedString("Developer mode", comment: "")) {
                Toggle(NSLocalizedString("開発者向けUIを表示", comment: ""), isOn: $developerMode)
                    .onChange(of: developerMode) { _ in Task { await model.loadTimeline() } }
                Text(NSLocalizedString("通知キューや内部IDなどの開発者向け表示を、この端末で切り替えます。", comment: ""))
                    .foregroundColor(SpotcodeTheme.muted)
                Text(developerMode ? NSLocalizedString("ON", comment: "") : NSLocalizedString("OFF", comment: "")).spotcodeFont(12, weight: .bold, fallback: .caption.bold())
                    .foregroundColor(developerMode ? .green : SpotcodeTheme.muted)
            }
            SettingsCard(NSLocalizedString("dev test アカウントのパスワード", comment: "")) {
                Text(NSLocalizedString("社内QA用の @spotcode_dev アカウントを作成し、パスワードを設定／変更します。", comment: ""))
                    .foregroundColor(SpotcodeTheme.muted)
                SecureField(NSLocalizedString("新しいパスワード（8文字以上）", comment: ""), text: $password).spotcodeField()
                Button(NSLocalizedString("パスワードを設定", comment: "")) { setDevPassword() }
                    .buttonStyle(OutlineButtonStyle(filled: true)).disabled(busy || password.count < 8)
            }
            SettingsCard(NSLocalizedString("Supabase 接続", comment: "")) {
                HStack {
                    Text(NSLocalizedString("CONNECTED", comment: "")).spotcodeFont(12, weight: .bold, fallback: .caption.bold()).foregroundColor(.green)
                    Spacer()
                    Text(LocalizedStringKey(currentMode)).spotcodeFont(12, weight: .bold, fallback: .caption.bold()).foregroundColor(.green)
                }
                Text(URL(string: projectURL)?.host ?? projectURL).font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                HStack {
                    Button(NSLocalizedString("接続テスト", comment: "")) { testConnection() }.buttonStyle(OutlineButtonStyle())
                    Button(showOverride ? NSLocalizedString("編集を閉じる", comment: "") : NSLocalizedString("自分のSupabaseに上書き", comment: "")) { showOverride.toggle() }
                        .buttonStyle(OutlineButtonStyle())
                }
                if showOverride {
                    TextField("https://xxxx.supabase.co", text: $projectURL)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().spotcodeField()
                    SecureField("anon / publishable key", text: $publishableKey).spotcodeField()
                    HStack {
                        Button(NSLocalizedString("保存して上書き", comment: "")) { saveConnection() }
                            .buttonStyle(OutlineButtonStyle(filled: true)).disabled(busy)
                        Button(NSLocalizedString("標準に戻す", comment: "")) { restoreDefault() }.buttonStyle(OutlineButtonStyle())
                    }
                    Text(NSLocalizedString("⚠️ secret / service_role キーは保存できません。publishable key または旧形式の anon public JWT のみ使用できます。", comment: ""))
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var factor: MFAFactor?
    @State private var enrollment: MFAEnrollment?
    @State private var loading = true
    @State private var message = ""
    @State private var showDisableConfirmation = false

    var body: some View {
        let _ = appColorTheme

        SettingsCard(NSLocalizedString("2段階認証", comment: "")) {
            HStack {
                Text(factor == nil ? NSLocalizedString("OFF", comment: "") : NSLocalizedString("ON", comment: "")).spotcodeFont(12, weight: .bold, fallback: .caption.bold())
                    .foregroundColor(factor == nil ? SpotcodeTheme.muted : .green)
                Spacer()
            }
            Text(NSLocalizedString("ログイン時に認証アプリが生成する6桁のワンタイムパスワードを要求します。", comment: ""))
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
        .confirmationDialog(NSLocalizedString("2段階認証を無効にしますか？", comment: ""), isPresented: $showDisableConfirmation) {
            Button(NSLocalizedString("無効にする", comment: ""), role: .destructive) {
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    let enrollment: MFAEnrollment
    let completed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var busy = false
    @State private var errorMessage = ""

    var body: some View {
        let _ = appColorTheme

        NavigationView {
            ScrollView {
                VStack(spacing: SpotcodeLayout.value(16, 16)) {
                    Text(NSLocalizedString("認証アプリでワンタイムパスワードの追加を選び、QRコードを読み取ってください。", comment: ""))
                    if let image = qrImage(enrollment.totp.uri ?? enrollment.totp.secret) {
                        Image(uiImage: image).interpolation(.none).resizable().frame(width: 240, height: 240).padding(10).background(Color.white).cornerRadius(12)
                    }
                    Text(NSLocalizedString("読み取れない場合", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                    Text(enrollment.totp.secret).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    TextField(NSLocalizedString("6桁コード", comment: ""), text: $code)
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
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text).navigationTitle(NSLocalizedString("2段階認証", comment: ""))
        }.modifier(AppAppearancePreference())
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
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var privateAccount = false
    @State private var closeFriends = ""
    @State private var orgMembers = ""
    @State private var saving = false
    var body: some View {
        let _ = appColorTheme
         VStack(spacing: SpotcodeLayout.value(12, 18)) {
        SettingsCard(NSLocalizedString("アカウントの公開範囲", comment: "")) {
            SettingsStatusTag(text: privateAccount ? NSLocalizedString("非公開", comment: "") : NSLocalizedString("公開", comment: ""), enabled: privateAccount)
            Text(privateAccount ? NSLocalizedString("承認したフォロワーだけが投稿を表示できます。", comment: "") : NSLocalizedString("すべてのユーザーが投稿を表示できます。", comment: "")).foregroundColor(SpotcodeTheme.muted)
            Button(privateAccount ? NSLocalizedString("公開アカウントにする", comment: "") : NSLocalizedString("非公開アカウントにする", comment: "")) { privateAccount.toggle(); save() }
                .buttonStyle(OutlineButtonStyle(filled: !privateAccount)).disabled(saving)
        }
        SettingsCard(NSLocalizedString("公開対象リスト", comment: "")) {
            Text(NSLocalizedString("「親しい友達」と「同じ組織」の投稿を表示できるユーザーを設定します。", comment: "")).foregroundColor(SpotcodeTheme.muted)
            TextField(NSLocalizedString("親しい友達（@handle、カンマ区切り）", comment: ""), text: $closeFriends).spotcodeField()
            TextField(NSLocalizedString("同じ組織（@handle、カンマ区切り）", comment: ""), text: $orgMembers).spotcodeField()
            Button(NSLocalizedString("保存", comment: "")) { save() }.buttonStyle(OutlineButtonStyle()).disabled(saving)
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
    @AppStorage("spotcode.native.privacy-mode") private var privacyMode = false
    @Environment(\.appColorTheme) private var appColorTheme
    @AppStorage("spotcode.colorTheme") private var colorTheme = "standard"
    @AppStorage("spotcode.appearance") private var appearance = "system"
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
    #if !targetEnvironment(macCatalyst)
    @ObservedObject private var nearbyNotifications = NearbySpotNotifications.shared
    @AppStorage("spotcode.notifications.nearbySpots") private var notifyNearbySpots = true
    #endif
    @AppStorage("spotcode.notifications.likes") private var notifyLikes = true
    @AppStorage("spotcode.notifications.comments") private var notifyComments = true
    @AppStorage("spotcode.notifications.mentions") private var notifyMentions = true
    @AppStorage("spotcode.notifications.follows") private var notifyFollows = true
    @AppStorage("spotcode.notifications.followedPosts") private var followedPostScope = "off"
    @AppStorage("spotcode.language") private var appLanguage = AppLocalization.language
    var body: some View {
        let _ = appColorTheme
         VStack(spacing: SpotcodeLayout.value(12, 18)) {
        if NativePrivacy.canUse {
            SettingsCard(NSLocalizedString("プライバシーモード (匿名化表示)", comment: "")) {
                Toggle(NSLocalizedString("他ユーザーの名前・ID・アイコンを匿名化", comment: ""), isOn: $privacyMode)
                    .accessibilityIdentifier("settings.privacyMode")
            }
        }
        SettingsCard(NSLocalizedString("外観", comment: "")) {
            Picker(NSLocalizedString("外観", comment: ""), selection: $appearance) {
                Text(NSLocalizedString("システムに合わせる", comment: "")).tag("system")
                Text(NSLocalizedString("ライト", comment: "")).tag("light")
                Text(NSLocalizedString("ダーク", comment: "")).tag("dark")
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("settings.appearance")
            Picker(NSLocalizedString("テーマカラー", comment: ""), selection: $colorTheme) {
                Text(NSLocalizedString("標準", comment: "")).tag("standard")
                ForEach(AppColorThemes.names, id: \.self) { name in Text(LocalizedStringKey(AppColorThemes.labels[name] ?? name)).tag(name) }
            }.pickerStyle(.menu).accessibilityIdentifier("settings.colorTheme")
            HStack(spacing: 8) {
                Circle().fill(SpotcodeTheme.surface).overlay(Circle().stroke(SpotcodeTheme.border)).frame(width: 24, height: 24)
                Circle().fill(SpotcodeTheme.text).frame(width: 24, height: 24)
                Circle().fill(SpotcodeTheme.accent).frame(width: 24, height: 24)
            }.accessibilityHidden(true)
        }

        #if targetEnvironment(macCatalyst)
        SettingsCard(NSLocalizedString("文字サイズ", comment: "")) {
            Picker(NSLocalizedString("文字サイズ", comment: ""), selection: $macTextSize) {
                ForEach(MacTextSize.labels.indices, id: \.self) { index in
                    Text(LocalizedStringKey(MacTextSize.labels[index])).tag(index)
                }
            }
            .pickerStyle(.menu)
            .accessibilityIdentifier("settings.macTextSize")
            Text(NSLocalizedString("投稿やメニュー、入力欄の文字サイズを変更します。", comment: ""))
                .foregroundColor(SpotcodeTheme.muted)
            Text(NSLocalizedString("文字サイズのプレビュー", comment: "")).spotcodeFont(14, weight: .regular, fallback: SpotcodeLayout.bodyFont)
            Button(NSLocalizedString("標準に戻す", comment: "")) { macTextSize = 1 }
                .buttonStyle(OutlineButtonStyle()).disabled(macTextSize == 1)
        }
        #endif
        SettingsCard(NSLocalizedString("Language", comment: "")) {
            Picker(NSLocalizedString("Language", comment: ""), selection: Binding(
                get: { appLanguage },
                set: { AppLocalization.select($0); appLanguage = $0 }
            )) {
                Text(verbatim: "English").tag("en")
                Text(NSLocalizedString("日本語", comment: "")).tag("ja")
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("settings.language")
        }
        SettingsCard(NSLocalizedString("装飾バッジの表示", comment: "")) {
            SettingsStatusTag(text: hideBadges ? NSLocalizedString("非表示", comment: "") : NSLocalizedString("表示", comment: ""), enabled: !hideBadges)
            Text(NSLocalizedString("プロフィールや投稿の { }・言語・アイデアなどのバッジをまとめて切り替えます。", comment: "")).foregroundColor(SpotcodeTheme.muted)
            Button(hideBadges ? NSLocalizedString("バッジを表示する", comment: "") : NSLocalizedString("バッジを非表示にする", comment: "")) { hideBadges.toggle() }
                .buttonStyle(OutlineButtonStyle(filled: hideBadges))
        }
        issueDisplayCard
        SettingsCard(NSLocalizedString("通知", comment: "")) {
            HStack {
                Label { Text(LocalizedStringKey(notificationStatusText)) } icon: { Image(systemName: notificationStatus == .authorized ? "bell.badge.fill" : "bell.slash") }
                    .foregroundColor(notificationStatus == .authorized ? .green : SpotcodeTheme.muted)
                Spacer()
            }
            Text(NSLocalizedString("いいね・コメント・メンション・フォローなどを端末の通知として受け取ります。", comment: ""))
                .foregroundColor(SpotcodeTheme.muted)
            if notificationStatus == .denied {
                Button(NSLocalizedString("端末の通知設定を開く", comment: "")) { openSystemSettings() }
                    .buttonStyle(OutlineButtonStyle(filled: true))
                Text(NSLocalizedString("通知が拒否されています。端末の設定でSpotcodeの通知を許可してください。", comment: ""))
                    .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.warning)
            } else if notificationStatus != .authorized && notificationStatus != .provisional {
                Button(requestingNotifications ? NSLocalizedString("確認中…", comment: "") : NSLocalizedString("通知をONにする", comment: "")) { requestNotificationPermission() }
                    .buttonStyle(OutlineButtonStyle(filled: true)).disabled(requestingNotifications)
            } else {
                Button(NSLocalizedString("端末の通知設定を開く", comment: "")) { openSystemSettings() }.buttonStyle(OutlineButtonStyle())
            }
            Divider().overlay(SpotcodeTheme.border)
            #if !targetEnvironment(macCatalyst)
            Toggle(NSLocalizedString("スポットに近づいたときに通知", comment: ""), isOn: $notifyNearbySpots)
                .onChange(of: notifyNearbySpots) { enabled in
                    if enabled { nearbyNotifications.requestPermission(); requestNotificationPermission() }
                }
            Text(NSLocalizedString("アプリで取得した公開スポット投稿のうち、現在地に近い最大20件を対象に、半径100mへの接近を通知します。アプリを閉じている間も登録済みのスポットが対象です。", comment: ""))
                .font(.caption).foregroundColor(SpotcodeTheme.muted)
            if notifyNearbySpots {
                Text(nearbyNotifications.status).font(.caption).foregroundColor(SpotcodeTheme.muted)
                if nearbyNotifications.authorization == .notDetermined {
                    Button(NSLocalizedString("接近通知の位置情報を許可", comment: "")) { nearbyNotifications.requestPermission() }
                        .buttonStyle(OutlineButtonStyle())
                } else if nearbyNotifications.authorization == .denied || nearbyNotifications.authorization == .restricted {
                    Button(NSLocalizedString("位置情報の設定を開く", comment: "")) { openSystemSettings() }
                        .buttonStyle(OutlineButtonStyle())
                }
            }
            #endif
            Text(NSLocalizedString("通知する内容", comment: "")).spotcodeFont(15, weight: .bold, fallback: .subheadline.weight(.bold))
            Toggle(NSLocalizedString("いいね", comment: ""), isOn: $notifyLikes)
            Toggle(NSLocalizedString("コメント", comment: ""), isOn: $notifyComments)
            Toggle(NSLocalizedString("メンション", comment: ""), isOn: $notifyMentions)
            Toggle(NSLocalizedString("フォロー・フォローリクエスト", comment: ""), isOn: $notifyFollows)
            Picker(NSLocalizedString("投稿と地区の通知", comment: ""), selection: $followedPostScope) {
                Text(NSLocalizedString("OFF", comment: "")).tag("off")
                Text(NSLocalizedString("相互フォロー", comment: "")).tag("mutuals")
                Text(NSLocalizedString("フォロー中", comment: "")).tag("following")
            }
            Text(NSLocalizedString("投稿のスポットの市区町村を表示します。スポットがない投稿は地区未設定になります。アプリ利用中に新着を確認し、通知一覧と端末のバナーに表示します。", comment: ""))
                .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            Text(NSLocalizedString("種類別の設定はSpotcode内の通知一覧に適用されます。通知音やバナー表示は端末の通知設定で変更できます。", comment: ""))
                .spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
        }
        SettingsCard(NSLocalizedString("地図", comment: "")) {
            Text(NSLocalizedString("スポット機能で使用するApple Mapsと位置情報を確認します。", comment: "")).foregroundColor(SpotcodeTheme.muted)
            Button(NSLocalizedString("地図をテスト", comment: "")) { openSystemSettings() }.buttonStyle(OutlineButtonStyle())
        }
        SafetySettingsCard()
        SettingsCard(NSLocalizedString("Spotcodeについて", comment: "")) {
            Text(NSLocalizedString("Spotcodeは、コード・スポット・アイデアを共有するSNSです。", comment: "")).foregroundColor(SpotcodeTheme.muted)
            Link(NSLocalizedString("利用規約", comment: ""), destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/terms.html")!)
            Link(NSLocalizedString("プライバシーポリシー", comment: ""), destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/privacy.html")!)
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
                Text(NSLocalizedString("プロフィールに Open issue (task) を表示", comment: "")).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
                Text(hideTasks ? NSLocalizedString("非表示", comment: "") : NSLocalizedString("表示", comment: ""))
                    .spotcodeFont(12, weight: .bold, fallback: .caption.bold()).foregroundColor(SpotcodeTheme.muted)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .overlay(Capsule().stroke(SpotcodeTheme.border))
                    .fixedSize()
            }
            Text(NSLocalizedString("プロフィールページの下に「Open issues」カード (GitHub の未クローズ issue = task 一覧) を出します。OFF にするとカード自体が消え、GitHub Search API の呼び出しもスキップします。", comment: ""))
                .foregroundColor(SpotcodeTheme.muted)
            Button(hideTasks ? NSLocalizedString("タスクを表示する", comment: "") : NSLocalizedString("タスクを非表示にする", comment: "")) { hideTasks.toggle() }
                .buttonStyle(OutlineButtonStyle())
            Text(NSLocalizedString("表示するリポジトリ", comment: "")).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
            TextField(NSLocalizedString("リポジトリ名で検索（owner/repo）", comment: ""), text: $issueRepositoryQuery)
                .textInputAutocapitalization(.never).autocorrectionDisabled(true)
                .spotcodeField()
                .accessibilityLabel(Text(NSLocalizedString("表示するリポジトリ", comment: "")))
            if issueRepositories.isEmpty {
                Text(NSLocalizedString("表示できるリポジトリがありません。", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
            } else if matchingIssueRepositories.isEmpty {
                Text(NSLocalizedString("一致するリポジトリがありません。", comment: "")).spotcodeFont(12, weight: .regular, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
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
            if authorizingPrivateIssues { ProgressView(NSLocalizedString("GitHubで認証中…", comment: "")) }
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
        let token = repositoryToken
        let result = try? await SupabaseService.shared.githubOpenIssues(
            handle: handle, repositories: Array(selectedRepoSet(selectedIssueReposJSON, owner: owner)),
            githubToken: token, includePrivate: privateIssuesEnabled && token != nil
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
    @Environment(\.appColorTheme) private var appColorTheme
    var filled = false
    func makeBody(configuration: Configuration) -> some View {
        let _ = appColorTheme
        return configuration.label.spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.bodyFont.weight(.semibold)).padding(.horizontal, 14).padding(.vertical, SpotcodeLayout.value(8, 9))
            .foregroundColor(filled ? SpotcodeTheme.background : SpotcodeTheme.text)
            .background(filled ? SpotcodeTheme.text : Color.clear).clipShape(Capsule())
            .overlay(Capsule().stroke(SpotcodeTheme.border)).opacity(configuration.isPressed ? 0.7 : 1)
            .contentShape(Capsule())
    }
}

private struct PageHeader: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let title: String
    var body: some View {
        let _ = appColorTheme
         Text(LocalizedStringKey(title)).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont).frame(maxWidth: .infinity, alignment: .leading).padding(SpotcodeLayout.value(16, 16)).background(SpotcodeTheme.surface).overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) } }
}

private struct SafetySettingsCard: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var events: [SupabaseService.ModerationEvent] = []
    @State private var names: [UUID: String] = [:]
    @State private var message = ""
    var body: some View {
        let _ = appColorTheme

        SettingsCard(NSLocalizedString("安全・サポート", comment: "")) {
            Link(NSLocalizedString("サポート・お問い合わせ", comment: ""), destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/support.html")!)
            Text(NSLocalizedString("ブロックしたユーザー", comment: "")).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
            ForEach(Array(model.blockedAccountIDs).sorted { $0.uuidString < $1.uuidString }, id: \.self) { id in
                HStack {
                    Text(names[id] ?? id.uuidString).lineLimit(2)
                    Spacer()
                    Button(NSLocalizedString("ブロック解除", comment: "")) { Task { do { try await model.unblock(id) } catch { message = error.localizedDescription } } }
                }
            }
            if model.me?.isAdmin == true || model.me?.isOperator == true {
                Text(NSLocalizedString("運営への通報・ブロック通知", comment: "")).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
                ForEach(events) { event in
                    VStack(alignment: .leading) {
                        Text(event.kind + " · " + event.created_at).spotcodeFont(12, weight: .regular, fallback: .caption)
                        Text(event.detail)
                        if let post = event.post_id {
                            Link(NSLocalizedString("対象の投稿を開く", comment: ""), destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/#/post/" + post.uuidString)!)
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
    @Environment(\.appColorTheme) private var appColorTheme
    @Binding var agreed: Bool
    var body: some View {
        let _ = appColorTheme

        VStack(alignment: .leading, spacing: 12) {
            Text(NSLocalizedString("利用規約への同意", comment: "")).spotcodeFont(14, weight: .semibold, fallback: SpotcodeLayout.headlineFont)
            Text(NSLocalizedString("不適切な投稿、嫌がらせ、差別、脅迫、性的搾取、違法行為は禁止です。違反投稿の削除や利用停止を行います。通報・ブロック情報は運営に送信されます。", comment: ""))
            Link(NSLocalizedString("利用規約を読む", comment: ""), destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/terms.html")!)
            Link(NSLocalizedString("プライバシーポリシー", comment: ""), destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/privacy.html")!)
            Toggle(NSLocalizedString("利用規約に同意します", comment: ""), isOn: $agreed)
        }
    }
}
private struct TermsAgreementGate: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @AppStorage("spotcode.terms.acceptedVersion") private var acceptedTerms = ""
    @State private var agreed = false
    var body: some View {
        let _ = appColorTheme

        ScrollView { VStack(spacing: 20) {
            TermsAgreementContent(agreed: $agreed)
            Button(NSLocalizedString("同意して続ける", comment: "")) { acceptedTerms = "2026-09-08" }.disabled(!agreed)
            Button(NSLocalizedString("ログアウト", comment: "")) { model.signOut() }
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
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        #if targetEnvironment(macCatalyst)
        DesktopLoginView(isPresented: $isPresented)
        #else
        NavigationView {
            ScrollView { VStack(spacing: 14) {
                TermsAgreementContent(agreed: $agreedToTerms)
                Image(systemName: "chevron.left.forwardslash.chevron.right").spotcodeFont(34, weight: .regular, fallback: .largeTitle)
                if model.requiresReauthentication && !model.requiresMFA {
                    Label(NSLocalizedString("ログインセッションが無効になりました。アカウントを継続するため、もう一度ログインしてください。", comment: ""), systemImage: "lock.rotation")
                        .spotcodeFont(13, weight: .regular, fallback: .footnote).foregroundColor(SpotcodeTheme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10).background(SpotcodeTheme.warning.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                if model.requiresMFA {
                    Text(NSLocalizedString("2段階認証", comment: "")).spotcodeFont(20, weight: .bold, fallback: .title3.bold())
                    Text(NSLocalizedString("認証アプリに表示されている6桁コードを入力してください。", comment: ""))
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
                            .foregroundColor(SpotcodeTheme.onAccent)
                            .clipShape(Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(SpotcodePlainButtonStyle())
                    .contentShape(Capsule())
                    .disabled(signing || !agreedToTerms)
                } else {
                TextField(NSLocalizedString("メールまたはログイン名", comment: ""), text: $email)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .spotcodeField()
                HStack {
                    Group {
                        if showsPassword {
                            TextField(NSLocalizedString("パスワード", comment: ""), text: $password)
                        } else {
                            SecureField(NSLocalizedString("パスワード", comment: ""), text: $password)
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
                        .foregroundColor(SpotcodeTheme.onAccent)
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
                        Text(NSLocalizedString("閉じる", comment: "")).fixedSize(horizontal: true, vertical: false)
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("login.close")
                    Text(NSLocalizedString("spotcodeへログイン", comment: ""))
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
            .navigationTitle(NSLocalizedString("spotcodeへログイン", comment: ""))
            .desktopInlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(NSLocalizedString("閉じる", comment: "")) { isPresented = false }
                        .keyboardShortcut(.cancelAction)
                        .accessibilityIdentifier("login.close")
                }
            }
            #endif
        }
        .modifier(AppAppearancePreference())
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
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

        VStack(spacing: 0) {
            HStack(spacing: 0) {
                tab(NSLocalizedString("Log in", comment: ""), selected: !signup) { signup = false }
                tab(NSLocalizedString("Sign up", comment: ""), selected: signup) { signup = true }
                Button { isPresented = false } label: {
                    Image(systemName: "xmark").frame(width: 36, height: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).keyboardShortcut(.cancelAction)
                    .accessibilityLabel(NSLocalizedString("閉じる", comment: "")).accessibilityIdentifier("login.close")
            }.padding(.horizontal, 24).padding(.top, 12)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if confirmation {
                        Text("signup.confirm_email")
                        Text(email).textSelection(.enabled)
                    } else {
                        Text(NSLocalizedString("不適切な投稿、嫌がらせ、差別、脅迫、性的搾取、違法行為は禁止です。違反投稿の削除や利用停止を行います。通報・ブロック情報は運営に送信されます。", comment: ""))
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 8) {
                            Link(NSLocalizedString("利用規約を読む", comment: ""), destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/terms.html")!)
                            Text("·")
                            Link(NSLocalizedString("プライバシーポリシー", comment: ""), destination: URL(string: "https://hrmcngs.github.io/spotcode-sns/privacy.html")!)
                        }.spotcodeFont(12, fallback: .caption)
                        Button { agreed.toggle() } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: agreed ? "checkmark.square.fill" : "square")
                                    .foregroundColor(agreed ? SpotcodeTheme.accent : SpotcodeTheme.muted)
                                Text(NSLocalizedString("利用規約に同意します", comment: "")).fixedSize(horizontal: false, vertical: true)
                            }.frame(maxWidth: .infinity, minHeight: 32, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityValue(agreed ? NSLocalizedString("ON", comment: "") : NSLocalizedString("OFF", comment: ""))
                        if !model.requiresMFA {
                            Button { githubLogin() } label: {
                                Text(NSLocalizedString("Continue with GitHub", comment: "")).fontWeight(.semibold)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .background(SpotcodeTheme.background).clipShape(Capsule())
                                    .overlay(Capsule().stroke(SpotcodeTheme.border)).contentShape(Capsule())
                            }.buttonStyle(.plain).disabled(busy || !agreed)
                            HStack(spacing: 12) {
                                Rectangle().fill(SpotcodeTheme.border).frame(height: 1)
                                Text(NSLocalizedString("or", comment: "")).spotcodeFont(12, fallback: .caption).foregroundColor(SpotcodeTheme.muted)
                                Rectangle().fill(SpotcodeTheme.border).frame(height: 1)
                            }
                                .padding(.vertical, 8)
                        }
                        Text(LocalizedStringKey(model.requiresMFA ? NSLocalizedString("2段階認証", comment: "") : (signup ? NSLocalizedString("Sign up", comment: "") : NSLocalizedString("Log in", comment: ""))))
                            .spotcodeFont(18, weight: .bold, fallback: .headline).padding(.top, 6)
                        if model.requiresMFA {
                            TextField("123456", text: $code).textContentType(.oneTimeCode).spotcodeField()
                                .onChange(of: code) { code = String($0.filter(\.isNumber).prefix(6)) }
                        } else {
                            if signup {
                                field("signup.name") { TextField("", text: $name).textContentType(.name) }
                                field("signup.handle") { TextField("", text: $handle).textInputAutocapitalization(.never).autocorrectionDisabled() }
                            }
                            field(signup ? "signup.email" : NSLocalizedString("メールまたはログイン名", comment: "")) {
                                TextField("", text: $email).textContentType(.username)
                                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                            }
                            field(NSLocalizedString("パスワード", comment: "")) {
                                HStack {
                                    Group {
                                        if visiblePassword { TextField("", text: $password) }
                                        else { SecureField("", text: $password) }
                                    }.textContentType(signup ? .newPassword : .password)
                                    Button { visiblePassword.toggle() } label: {
                                        Image(systemName: visiblePassword ? "eye.slash" : "eye")
                                            .frame(width: 32, height: 28)
                                    }.buttonStyle(.plain).foregroundColor(SpotcodeTheme.accent)
                                        .accessibilityLabel(NSLocalizedString("パスワードを表示", comment: ""))
                                }
                            }
                        }
                        Button { submit() } label: {
                            Text(LocalizedStringKey(busy ? NSLocalizedString("確認中…", comment: "") : (model.requiresMFA ? NSLocalizedString("確認してログイン", comment: "") : (signup ? NSLocalizedString("Sign up", comment: "") : NSLocalizedString("Log in", comment: "")))))
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
        .modifier(AppAppearancePreference()).macTextSizePreference().spotcodeFont(14, fallback: .body)
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
    @Environment(\.appColorTheme) private var appColorTheme
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
        let _ = appColorTheme

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
        }.modifier(AppAppearancePreference())
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
    @Environment(\.appColorTheme) private var appColorTheme
    let title: String; let icon: String
    var body: some View {
        let _ = appColorTheme
         VStack(spacing: 12) { Image(systemName: icon).spotcodeFont(34, weight: .regular, fallback: .largeTitle); Text(LocalizedStringKey(title)).multilineTextAlignment(.center) }.foregroundColor(SpotcodeTheme.muted).padding() }
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
    if seconds < 60 { return String(format: NSLocalizedString("%d秒前", comment: ""), seconds) }
    if seconds < 3_600 { return String(format: NSLocalizedString("%d分前", comment: ""), seconds / 60) }
    if seconds < 86_400 { return String(format: NSLocalizedString("%d時間前", comment: ""), seconds / 3_600) }
    return String(format: NSLocalizedString("%d日前", comment: ""), seconds / 86_400)
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

private func businessCardColor(_ hex: String?) -> Color {
    guard let hex, hex.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil,
          let value = UInt32(hex.dropFirst(), radix: 16) else { return .white }
    return Color(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
}

struct BusinessCardOutline: Shape {
    let radius: CGFloat
    let style: String
    func path(in rect: CGRect) -> Path {
        let corners: UIRectCorner = style == "diagonal" ? [.topLeft, .bottomRight]
            : style == "diagonalReverse" ? [.topRight, .bottomLeft] : .allCorners
        return Path(UIBezierPath(roundedRect: rect, byRoundingCorners: corners,
                                 cornerRadii: CGSize(width: style == "square" ? 0 : radius,
                                                     height: style == "square" ? 0 : radius)).cgPath)
    }
}

private struct CardHorizontalScroll: UIViewRepresentable {
    let flip: () -> Void
    func makeUIView(context: Context) -> ScrollView { ScrollView() }
    func updateUIView(_ view: ScrollView, context: Context) { view.flip = flip }
    static func dismantleUIView(_ view: ScrollView, coordinator: ()) { view.pan.view?.removeGestureRecognizer(view.pan) }
    final class ScrollView: UIView, UIGestureRecognizerDelegate {
        var flip: (() -> Void)?
        lazy var pan: UIPanGestureRecognizer = {
            let pan = UIPanGestureRecognizer(target: self, action: #selector(scrolled(_:)))
            pan.allowedScrollTypesMask = .continuous
            pan.allowedTouchTypes = []
            pan.cancelsTouchesInView = false
            pan.delegate = self
            return pan
        }()
        override func didMoveToWindow() {
            super.didMoveToWindow()
            pan.view?.removeGestureRecognizer(pan)
            window?.addGestureRecognizer(pan)
        }
        override func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard window != nil, bounds.contains(gestureRecognizer.location(in: self)) else { return false }
            let velocity = pan.velocity(in: self)
            return abs(velocity.x) > abs(velocity.y) * 2
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
        @objc private func scrolled(_ pan: UIPanGestureRecognizer) {
            let delta = pan.translation(in: self)
            if pan.state == .ended && abs(delta.x) > 60 && abs(delta.x) > abs(delta.y) * 2 { flip?() }
        }
    }
}

private struct BusinessCardPreview: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let card: BusinessCard
    var actualSize = false
    @AppStorage("spotcode.card.physicalScale") private var physicalScale = 1.0
    @State private var flipped = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var d: BusinessCardDesign { (card.design ?? BusinessCardDesign()).resolved(theme: card.effectiveTheme, layout: card.layout) }
    private var fontDesign: Font.Design { d.font == "serif" ? .serif : d.font == "mono" ? .monospaced : .default }
    private var displayScale: Double { actualSize ? min(2, max(0.5, physicalScale)) : 0.85 }
    var body: some View {
        let _ = appColorTheme

        ZStack {
            face(back: false).opacity(flipped ? 0 : 1).accessibilityHidden(flipped).allowsHitTesting(!flipped)
            face(back: true).rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0)).opacity(flipped ? 1 : 0).accessibilityHidden(!flipped).allowsHitTesting(flipped)
        }
        .rotation3DEffect(.degrees(flipped ? 180 : 0), axis: (x: 0, y: 1, z: 0), perspective: 0.4)
        .frame(width: d.orientation == "portrait" ? 55 * 96 / 25.4 : 91 * 96 / 25.4,
               height: d.orientation == "portrait" ? 91 * 96 / 25.4 : 55 * 96 / 25.4)
        .scaleEffect(displayScale)
        .frame(width: (d.orientation == "portrait" ? 55 : 91) * 96 / 25.4 * displayScale,
               height: (d.orientation == "portrait" ? 91 : 55) * 96 / 25.4 * displayScale)
        .contentShape(Rectangle())
        .onTapGesture { flip() }
        .simultaneousGesture(DragGesture(minimumDistance: 20).onEnded { value in
            if abs(value.translation.width) > 60 && abs(value.translation.width) > abs(value.translation.height) * 2 { flip() }
        })
        #if targetEnvironment(macCatalyst)
        .background(CardHorizontalScroll(flip: flip))
        #endif
        .accessibilityAction(named: NSLocalizedString("名刺を裏返す", comment: ""), flip)
        .accessibilityElement(children: .contain)
    }
    private func flip() { withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.55)) { flipped.toggle() } }
    @ViewBuilder private func face(back: Bool) -> some View {
        if d.layers != nil {
            BusinessCardLayerCanvas(card: card, side: back ? "back" : "front")
                .background(background(back: back))
                .clipShape(BusinessCardOutline(radius: CGFloat(d.radius ?? 18), style: d.cornerStyle ?? "rounded"))
                .overlay(BusinessCardOutline(radius: CGFloat(d.radius ?? 18), style: d.cornerStyle ?? "rounded").stroke(.white.opacity(0.25)))
        } else { automaticFace(back: back) }
    }
    private func automaticFace(back: Bool) -> some View {
        let align = (back ? d.backAlign : d.frontAlign) ?? "classic"
        let horizontal: HorizontalAlignment = align == "right" ? .trailing : align == "centered" ? .center : .leading
        let alignment: Alignment = align == "right" ? .trailing : align == "centered" ? .center : .leading
        let label = (back ? d.backLabel : d.frontLabel) ?? ""
        let radius = CGFloat(d.radius ?? 18)
        let artwork = d.imagePlacement == "artwork" && (card.image_side ?? "front") == (back ? "back" : "front") && !(card.image_url ?? "").isEmpty
        return VStack(alignment: horizontal, spacing: 10) {
            if !label.isEmpty { Text(label).font(.system(size: 9, weight: .medium, design: fontDesign)).tracking(2).foregroundColor(businessCardColor(d.accentColor)) }
            Spacer(minLength: 4)
            HStack(spacing: 14) {
                if (card.image_side ?? "front") == (back ? "back" : "front"), let source = card.image_url, !source.isEmpty {
                    if let destination = BusinessCardLink.webURL(card.image_link ?? "") {
                        Link(destination: destination) { picture(source) }.accessibilityLabel(NSLocalizedString("画像のリンクを開く", comment: ""))
                    } else { picture(source) }
                }
                VStack(alignment: horizontal, spacing: 8) {
                    if back {
                        Text(card.bio.isEmpty ? NSLocalizedString("よろしくお願いします。", comment: "") : card.bio).font(.system(size: 14, design: fontDesign)).minimumScaleFactor(0.6)
                        Text(card.contact).font(.system(size: 12, design: fontDesign)).minimumScaleFactor(0.6)
                    } else {
                        Text(card.name).font(.system(size: CGFloat(d.nameSize ?? 26), weight: .bold, design: fontDesign)).minimumScaleFactor(0.5)
                        Text(card.title).font(.system(size: 14, design: fontDesign)).minimumScaleFactor(0.6)
                    }
                }.frame(maxWidth: .infinity, alignment: alignment)
            }
            if (card.links_side ?? "front") == (back ? "back" : "front") {
                ForEach(Array((card.links ?? []).prefix(3).enumerated()), id: \.offset) { _, link in
                    if let destination = link.destination {
                        Link(destination: destination) { Text((link.label.isEmpty ? link.url : link.label) + " ↗").underline().font(.system(size: 12)).lineLimit(1) }
                            .foregroundColor(businessCardColor(d.textColor))
                    }
                }
            }
            Spacer(minLength: 4)
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
            .multilineTextAlignment(align == "right" ? .trailing : align == "centered" ? .center : .leading)
            .foregroundColor(businessCardColor(d.textColor))
            .opacity(artwork ? 0 : 1).accessibilityHidden(artwork)
            .background(background(back: back))
            .overlay {
                if artwork {
                    GeometryReader { geometry in
                        ZStack(alignment: .bottomTrailing) {
                            DataURLImage(value: card.image_url ?? "", fit: true)
                                .frame(width: geometry.size.width, height: geometry.size.height)
                                .accessibilityLabel(NSLocalizedString("名刺画像", comment: ""))
                        }
                    }
                }
            }
            .clipShape(BusinessCardOutline(radius: radius, style: d.cornerStyle ?? "rounded"))
            .overlay(BusinessCardOutline(radius: radius, style: d.cornerStyle ?? "rounded").stroke(.white.opacity(0.25)))
            .shadow(color: .black.opacity(0.2), radius: 12, y: 8)
    }
    private func picture(_ source: String) -> some View {
        let size = CGFloat(min(100, max(48, card.image_size ?? 64)))
        return DataURLImage(value: source).frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: card.image_shape == "round" ? size / 2 : 8))
            .accessibilityLabel(String(format: NSLocalizedString("%@ の名刺画像", comment: ""), card.name))
    }
    private func background(back: Bool) -> some View {
        BusinessCardLayerBackground(card: card, back: back)
    }

}

private struct BusinessCardTemplateDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.svg] }
    var data: Data
    init(design: BusinessCardDesign) {
        let width = design.orientation == "portrait" ? 1000 : 1650
        let height = design.orientation == "portrait" ? 1650 : 1000
        func color(_ value: String?, fallback: String) -> String {
            guard let value, value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else { return fallback }
            return value
        }
        let background = color(design.frontColor, fallback: "#ffffff")
        let text = color(design.textColor, fallback: "#000000")
        data = Data("""
        <svg xmlns="http://www.w3.org/2000/svg" width="\(width)" height="\(height)" viewBox="0 0 \(width) \(height)">
        <rect width="100%" height="100%" fill="\(background)"/>
        <text x="80" y="200" font-family="sans-serif" font-size="72" fill="\(text)">\(NSLocalizedString("YOUR NAME", comment: ""))</text>
        <text x="80" y="300" font-family="sans-serif" font-size="36" fill="\(text)">\(NSLocalizedString("Title / Organization", comment: ""))</text>
        </svg>
        """.utf8)
    }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

private struct FullscreenBusinessCardView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    let card: BusinessCard
    let dismiss: () -> Void
    @AppStorage("spotcode.card.physicalScale") private var physicalScale = 1.0
    var body: some View {
        let _ = appColorTheme

        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button { dismiss() } label: {
                    Label(NSLocalizedString("閉じる", comment: ""), systemImage: "xmark").padding(8)
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.cancelAction)
            }.padding(.horizontal, 16).padding(.top, 8)
            GeometryReader { viewport in
                ScrollView([.horizontal, .vertical]) {
                    BusinessCardPreview(card: card, actualSize: true)
                        .padding(16)
                        .frame(minWidth: viewport.size.width, minHeight: viewport.size.height)
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            DisclosureGroup(NSLocalizedString("実寸調整（91 × 55 mm）", comment: "")) {
                Text(NSLocalizedString("定規を当て、長辺が91mmになるよう調整してください。画面や表示倍率を変えた場合は調整し直してください。", comment: ""))
                    .font(.caption)
                Slider(value: $physicalScale, in: 0.5...2, step: 0.005)
                    .accessibilityLabel(NSLocalizedString("実寸の補正倍率", comment: ""))
                Button(NSLocalizedString("補正をリセット", comment: "")) { physicalScale = 1 }
            }
            .padding(16).frame(maxWidth: 440).background(Color.black)
        }
        .background(Color.black.ignoresSafeArea())
    }
}

// Present from the window hierarchy so Catalyst also covers the SNS split-view chrome.
private struct BusinessCardFullscreenPresenter: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    let card: BusinessCard
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIViewController(context: Context) -> UIViewController {
        let controller = UIViewController()
        controller.view.backgroundColor = .clear
        return controller
    }
    func updateUIViewController(_ controller: UIViewController, context: Context) {
        let coordinator = context.coordinator
        coordinator.wantsPresentation = isPresented
        DispatchQueue.main.async {
            guard coordinator.active else { return }
            if !coordinator.wantsPresentation {
                coordinator.dismiss()
                return
            }
            guard coordinator.host == nil, var presenter = controller.view.window?.rootViewController else { return }
            while let presented = presenter.presentedViewController { presenter = presented }
            guard !presenter.isBeingDismissed else { return }
            let host = UIHostingController(rootView: FullscreenBusinessCardView(card: card) { [weak coordinator] in
                // Full-screen UIKit presentation can suspend updates to the
                // covered SwiftUI presenter. Close UIKit immediately instead
                // of waiting for updateUIViewController to observe the binding.
                coordinator?.dismiss()
                isPresented = false
            })
            // Keep the underlying card alive so nearby discovery continues.
            host.modalPresentationStyle = .overFullScreen
            host.view.backgroundColor = .black
            host.isModalInPresentation = true
            coordinator.host = host
            presenter.present(host, animated: false)
        }
    }
    static func dismantleUIViewController(_ controller: UIViewController, coordinator: Coordinator) {
        coordinator.active = false
        coordinator.dismiss()
    }
    final class Coordinator {
        var active = true
        var wantsPresentation = false
        var host: UIViewController?

        func dismiss() {
            // Clear intent before UIKit dismissal: a queued presentation must
            // not reopen the card after Close, including repeated taps.
            wantsPresentation = false
            let presented = host
            host = nil
            presented?.dismiss(animated: false)
        }
    }
}

private struct BusinessCardView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    @State private var fullscreenCard = false
    @State private var restricted = false
    @State private var loadedCard: BusinessCard?
    @State private var syncing = false
    let profile: Profile
    @State private var draft = BusinessCard(owner_id: UUID(), name: "")
    @State private var published = false
    @State private var loading = true
    @State private var busy = false
    @State private var message = ""
    @State private var failed = false
    @State private var sharing = false
    @State private var confirmingUnpublish = false
    @State private var pickingCardImage = false
    @State private var pickingCardImageFile = false
    @State private var cardImageURL = ""
    @State private var exportingTemplate = false
    @State private var editingCard = false
    private var own: Bool { profile.id != nil && profile.id == model.session?.user.id }
    private var link: URL { URL(string: "https://hrmcngs.github.io/spotcode-sns/#/\(profile.handle)/card")! }
    var body: some View {
        let _ = appColorTheme

        GeometryReader { viewport in
        ScrollView {
            VStack(spacing: 0) {
                if loading { ProgressView() }
                else if failed { Button(NSLocalizedString("再読み込み", comment: "")) { Task { await load() } } }
                else if restricted {
                    Text(NSLocalizedString("コレクションに保存した相手の名刺だけ閲覧できます。", comment: "")).padding()
                    if model.session != nil {
                        Button(NSLocalizedString("コレクションに保存", comment: "")) { collect() }.disabled(busy)
                    } else {
                        Text(NSLocalizedString("保存するにはログインしてください。", comment: "")).padding()
                    }
                }
                else if published || own {
                    if editingCard && own {
                        BusinessCardLayerEditor(card: $draft)
                            .padding(24).frame(maxWidth: 600).disabled(busy)
                    } else {
                    BusinessCardPreview(card: draft)
                        .frame(width: viewport.size.width, height: ((draft.design?.orientation == "portrait" ? 91.0 : 55.0) * 96 / 25.4 * 0.85) + 160)
                        .overlay(alignment: .topTrailing) {
                            Button { fullscreenCard = true } label: {
                                Label(NSLocalizedString("全画面", comment: ""), systemImage: "arrow.up.left.and.arrow.down.right")
                            }
                            .buttonStyle(.bordered).padding(16)
                        }
                        .overlay(alignment: .bottom) {
                            if own && published, let id = profile.id {
                                NearbyBusinessCardExchangeView(ownerID: id, handle: profile.handle, enabled: !editingCard)
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 20) {
                    if published {
                        HStack {
                            if own {
                                Button(NSLocalizedString("名刺を共有", comment: "")) { sharing = true }.buttonStyle(.borderedProminent)
                            }
                            Button(NSLocalizedString("リンクをコピー", comment: "")) { UIPasteboard.general.url = link; message = NSLocalizedString("リンクをコピーしました。", comment: "") }.buttonStyle(.bordered)
                        }
                        Text(NSLocalizedString("共有メニューのAirDropから名刺リンクを送れます。相手にも名刺を送り返してもらうと交換できます。", comment: ""))
                            .font(.caption).foregroundColor(.secondary)
                        if !own {
                            Button(NSLocalizedString("コレクションに保存", comment: "")) { collect() }.buttonStyle(.borderedProminent).disabled(busy || model.session == nil)
                            if model.session == nil { Text(NSLocalizedString("保存するにはログインしてください。", comment: "")).font(.caption) }
                        }
                    }
                    if own {
                        Button(editingCard ? NSLocalizedString("編集を閉じる", comment: "") : NSLocalizedString("名刺を編集", comment: "")) { editingCard.toggle() }
                            .buttonStyle(.borderedProminent)
                        if editingCard { editor }
                    }
                    }.padding(24).frame(maxWidth: 600)
                } else { Text(NSLocalizedString("このユーザーはまだ名刺を公開していません。", comment: "")) }
                if !message.isEmpty { Text(message).font(.callout).accessibilityAddTraits(.updatesFrequently) }
                if own { NavigationLink(NSLocalizedString("名刺コレクション", comment: ""), destination: BusinessCardCollectionView()) }
            }.frame(maxWidth: .infinity)
        }.navigationTitle("")
            .task(id: model.session?.user.id) { await load() }
            .onChange(of: scenePhase) { phase in
                if phase == .active { Task { await syncCard() } }
            }
            .background(BusinessCardFullscreenPresenter(isPresented: $fullscreenCard, card: draft))
            .sheet(isPresented: $sharing) { ActivityShareSheet(items: [link]) }
            .sheet(isPresented: $pickingCardImage) { ProfileImagePicker(image: $draft.image_url, maxSide: 1650) }
            .fileExporter(isPresented: $exportingTemplate,
                          document: BusinessCardTemplateDocument(design: (draft.design ?? BusinessCardDesign()).resolved(theme: draft.effectiveTheme, layout: draft.layout)),
                          contentType: .svg, defaultFilename: "spotcode-card-template") { result in
                if case .failure = result { message = NSLocalizedString("テンプレートを保存できませんでした。", comment: "") }
            }
            .fileImporter(isPresented: $pickingCardImageFile, allowedContentTypes: [.image]) { result in
                do {
                    let url = try result.get()
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size <= 8 * 1024 * 1024 else { message = NSLocalizedString("8MB以下の画像を選んでください。", comment: ""); return }
                    let data = try Data(contentsOf: url)
                    guard data.count <= 8 * 1024 * 1024, let image = UIImage(data: data),
                          let resized = image.resizedForPost(maxSide: 1650).jpegData(compressionQuality: 0.85) else {
                        message = NSLocalizedString("画像を読み込めませんでした。別の画像を選んでください。", comment: ""); return
                    }
                    draft.image_url = "data:image/jpeg;base64," + resized.base64EncodedString()
                } catch {
                    if (error as NSError).code != NSUserCancelledError { message = NSLocalizedString("画像ファイルを開けませんでした。", comment: "") }
                }
            }
            .confirmationDialog(NSLocalizedString("名刺の公開を停止すると、相手のコレクションからも削除されます。", comment: ""), isPresented: $confirmingUnpublish, titleVisibility: .visible) {
                Button(NSLocalizedString("公開を停止", comment: ""), role: .destructive) { unpublish() }
            }
        }
    }
    private var editor: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(NSLocalizedString("自分の名刺をデザイン", comment: "")).font(.headline)
            Text(NSLocalizedString("保存するとリンクを知っている人が閲覧できます。掲載する情報だけを入力してください。", comment: "")).font(.caption).foregroundColor(.secondary)
            BusinessCardTextField(placeholder: NSLocalizedString("名前（表・60文字まで）", comment: ""), text: $draft.name).frame(height: 44)
            BusinessCardTextField(placeholder: NSLocalizedString("肩書き・組織（表・100文字まで）", comment: ""), text: $draft.title).frame(height: 44)
            Text(NSLocalizedString("自己紹介（裏・280文字まで）", comment: "")).font(.caption)
            TextEditor(text: $draft.bio).frame(minHeight: 80).modifier(BusinessCardInputStyle()).accessibilityLabel(NSLocalizedString("自己紹介（裏）", comment: ""))
            BusinessCardTextField(placeholder: NSLocalizedString("連絡先・リンク（裏・160文字まで）", comment: ""), text: $draft.contact).frame(height: 44)
            Picker(NSLocalizedString("テーマ", comment: ""), selection: Binding(get: { draft.design?.pattern == "solid" ? "solid" : draft.effectiveTheme }, set: { theme in
                if theme == "solid" {
                    var design = (draft.design ?? BusinessCardDesign()).resolved(theme: draft.effectiveTheme, layout: draft.layout)
                    design.pattern = "solid"
                    design.backColor = design.frontColor
                    draft.design = design
                    return
                }
                draft.theme = BusinessCardDesign.extraThemes.contains(theme) ? "midnight" : theme
                let palette = BusinessCardDesign.preset(theme)
                var design = draft.design ?? BusinessCardDesign()
                design.frontColor = palette.frontColor; design.backColor = palette.backColor
                design.textColor = palette.textColor; design.accentColor = palette.accentColor
                design.pattern = "gradient"
                design.themeVariant = BusinessCardDesign.extraThemes.contains(theme) ? theme : nil
                design.font = theme == "mono" ? "mono" : "sans"
                draft.design = design
            })) {
                Text(NSLocalizedString("ミッドナイト", comment: "")).tag("midnight"); Text(NSLocalizedString("ペーパー", comment: "")).tag("paper"); Text(NSLocalizedString("オーロラ", comment: "")).tag("aurora")
                Text(NSLocalizedString("Mono", comment: "")).tag("mono"); Text(NSLocalizedString("Ghost", comment: "")).tag("ghost")
                Text(NSLocalizedString("春", comment: "")).tag("spring"); Text(NSLocalizedString("夏", comment: "")).tag("summer"); Text(NSLocalizedString("秋", comment: "")).tag("autumn"); Text(NSLocalizedString("冬", comment: "")).tag("winter")
                Text(NSLocalizedString("単色", comment: "")).tag("solid")
            }
            Picker(NSLocalizedString("レイアウト", comment: ""), selection: Binding(get: { draft.layout }, set: { layout in
                draft.layout = layout
                var design = draft.design ?? BusinessCardDesign()
                design.frontAlign = layout; design.backAlign = layout; draft.design = design
            })) {
                Text(NSLocalizedString("左揃え", comment: "")).tag("classic"); Text(NSLocalizedString("中央揃え", comment: "")).tag("centered")
            }
            BusinessCardBaseColorPicker(design: Binding(get: {
                (draft.design ?? BusinessCardDesign()).resolved(theme: draft.effectiveTheme, layout: draft.layout)
            }, set: { draft.design = $0 }), theme: draft.effectiveTheme)
            mediaEditor
            BusinessCardDesignEditor(design: Binding(get: {
                (draft.design ?? BusinessCardDesign()).resolved(theme: draft.effectiveTheme, layout: draft.layout)
            }, set: { draft.design = $0 }))
            Button(NSLocalizedString("保存して公開", comment: "")) { save() }.buttonStyle(.borderedProminent).disabled(busy)
            if published { Button(NSLocalizedString("公開を停止", comment: ""), role: .destructive) { confirmingUnpublish = true }.disabled(busy) }
        }.textFieldStyle(.plain).disabled(busy)

    }
    private var mediaEditor: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button(NSLocalizedString("デザイン用テンプレートをダウンロード（SVG）", comment: "")) { exportingTemplate = true }
            Text(NSLocalizedString("テンプレートを編集後、PNG/JPEGで書き出して取り込めます。実物の名刺は周囲を切り抜いた写真・スキャン画像を選んでください。画像は表または裏の1面に使えます。", comment: ""))
                .font(.caption).foregroundColor(.secondary)
            Picker(NSLocalizedString("画像の使い方", comment: ""), selection: Binding(get: { draft.design?.imagePlacement ?? "inline" }, set: { value in
                var design = draft.design ?? BusinessCardDesign()
                design.imagePlacement = value; draft.design = design
            })) {
                Text(NSLocalizedString("画像を差し込む", comment: "")).tag("inline")
                Text(NSLocalizedString("名刺の1面として使う", comment: "")).tag("artwork")
            }
            Text(NSLocalizedString("画像を差し込む", comment: "")).font(.headline)
            HStack {
                Button(NSLocalizedString("写真から選択", comment: "")) { pickingCardImage = true }
                Button(NSLocalizedString("ファイルから選択", comment: "")) { pickingCardImageFile = true }
                if !(draft.image_url ?? "").isEmpty {
                    Button(NSLocalizedString("画像を取り除く", comment: ""), role: .destructive) { draft.image_url = ""; cardImageURL = "" }
                }
            }
            BusinessCardTextField(placeholder: NSLocalizedString("画像URL（https://…）", comment: ""), text: $cardImageURL).frame(height: 44)
            Button(NSLocalizedString("このURLの画像を使う", comment: "")) {
                guard let url = BusinessCardLink.webURL(cardImageURL) else { message = NSLocalizedString("http(s)形式の画像URLを入力してください。", comment: ""); return }
                draft.image_url = url.absoluteString
            }
            Picker(NSLocalizedString("表示する面", comment: ""), selection: Binding(get: { draft.image_side ?? "front" }, set: { draft.image_side = $0 })) {
                Text(NSLocalizedString("表", comment: "")).tag("front"); Text(NSLocalizedString("裏", comment: "")).tag("back")
            }
            Picker(NSLocalizedString("画像の形", comment: ""), selection: Binding(get: { draft.image_shape ?? "square" }, set: { draft.image_shape = $0 })) {
                Text(NSLocalizedString("角丸", comment: "")).tag("square"); Text(NSLocalizedString("丸", comment: "")).tag("round")
            }
            Stepper(String(format: NSLocalizedString("画像の大きさ: %dpx", comment: ""), draft.image_size ?? 64), value: Binding(get: { draft.image_size ?? 64 }, set: { draft.image_size = $0 }), in: 48...100)
            BusinessCardTextField(placeholder: NSLocalizedString("画像を押したときのURL", comment: ""), text: Binding(get: { draft.image_link ?? "" }, set: { draft.image_link = $0 })).frame(height: 44)
            Text(NSLocalizedString("名刺に載せるリンク（3件まで）", comment: "")).font(.headline)
            Picker(NSLocalizedString("リンクを表示する面", comment: ""), selection: Binding(get: { draft.links_side ?? "front" }, set: { draft.links_side = $0 })) {
                Text(NSLocalizedString("表", comment: "")).tag("front"); Text(NSLocalizedString("裏", comment: "")).tag("back")
            }
            ForEach(0..<3) { index in
                BusinessCardTextField(placeholder: String(format: NSLocalizedString("リンク%dの表示名", comment: ""), index + 1), text: linkBinding(index, label: true)).frame(height: 44)
                BusinessCardTextField(placeholder: String(format: NSLocalizedString("リンク%dのURL（https://…）", comment: ""), index + 1), text: linkBinding(index, label: false)).frame(height: 44)
            }
        }
    }
    private func linkBinding(_ index: Int, label: Bool) -> Binding<String> {
        Binding(get: {
            guard let links = draft.links, links.indices.contains(index) else { return "" }
            return label ? links[index].label : links[index].url
        }, set: { value in
            var links = Array((draft.links ?? []).prefix(3))
            while links.count <= index { links.append(BusinessCardLink(label: "", url: "")) }
            if label { links[index].label = String(value.prefix(40)) } else { links[index].url = String(value.prefix(2048)) }
            draft.links = links
        })
    }
    private func load() async {
        loading = true; failed = false; restricted = false; published = false; fullscreenCard = false; message = ""
        defer { loading = false }
        guard let id = profile.id else { failed = true; message = NSLocalizedString("プロフィールが見つかりません。", comment: ""); return }
        do {
            let viewer = model.session?.user.id
            let card: BusinessCard?
            if viewer != nil {
                card = try await model.withRefreshedSession { token in
                    try await SupabaseService.shared.businessCard(ownerID: id, viewerID: viewer, token: token)
                }
            } else { throw BusinessCardAccessError.notCollected }
            guard !Task.isCancelled, model.session?.user.id == viewer else { return }
            draft = card ?? BusinessCard(owner_id: id, name: profile.name)
            loadedCard = draft
            cardImageURL = draft.image_url?.hasPrefix("data:") == false ? draft.image_url! : ""
            restricted = false
            published = card != nil
        } catch is CancellationError { return
        } catch BusinessCardAccessError.notCollected {
            guard !Task.isCancelled else { return }
            restricted = true; published = false; fullscreenCard = false
            draft = BusinessCard(owner_id: id, name: profile.name); loadedCard = draft
        } catch { failed = true; message = NSLocalizedString("名刺を読み込めませんでした。接続を確認して再試行してください。", comment: "") }
    }
    private func syncCard() async {
        guard let id = profile.id, !loading, !syncing, !busy, !editingCard, draft == loadedCard else { return }
        syncing = true
        defer { syncing = false }
        do {
            let viewer = model.session?.user.id
            let card: BusinessCard?
            if viewer != nil {
                card = try await model.withRefreshedSession { token in
                    try await SupabaseService.shared.businessCard(ownerID: id, viewerID: viewer, token: token)
                }
            } else { throw BusinessCardAccessError.notCollected }
            guard !Task.isCancelled, model.session?.user.id == viewer else { return }
            guard !Task.isCancelled, !busy, !editingCard, draft == loadedCard else { return }
            draft = card ?? BusinessCard(owner_id: id, name: profile.name)
            loadedCard = draft
            cardImageURL = draft.image_url?.hasPrefix("data:") == false ? draft.image_url! : ""
            restricted = false
            published = card != nil
        } catch is CancellationError { return
        } catch BusinessCardAccessError.notCollected {
            guard !Task.isCancelled else { return }
            restricted = true; published = false; fullscreenCard = false
            draft = BusinessCard(owner_id: id, name: profile.name); loadedCard = draft
        } catch { message = NSLocalizedString("最新の名刺を取得できませんでした。接続を確認してください。", comment: "") }
    }
    private func save() {
        guard model.session != nil, own, !busy else { return }
        draft.name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !draft.name.isEmpty, draft.name.unicodeScalars.count <= 60, draft.title.unicodeScalars.count <= 100,
              draft.bio.unicodeScalars.count <= 280, draft.contact.unicodeScalars.count <= 160 else {
            message = NSLocalizedString("名前を入力し、各項目の文字数上限以内にしてください。", comment: ""); return
        }
        let links = (draft.links ?? []).filter { !$0.url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard links.allSatisfy({ $0.destination != nil }),
              (draft.image_link ?? "").isEmpty || BusinessCardLink.webURL(draft.image_link ?? "") != nil else {
            message = NSLocalizedString("リンクは http:// または https:// から始まるURLを入力してください。", comment: ""); return
        }
        guard (draft.image_url ?? "").utf8.count <= 1_000_000 else { message = NSLocalizedString("画像が大きすぎます。小さい画像を選んでください。", comment: ""); return }
        draft.links = links
        let submitted = draft
        busy = true
        Task {
            defer { busy = false }
            do {
                let session = try await model.validSession()
                guard session.user.id == submitted.owner_id else { return }
                try await SupabaseService.shared.saveBusinessCard(submitted, token: session.accessToken)
                guard model.session?.user.id == submitted.owner_id else { return }
                loadedCard = submitted
                published = true
                message = NSLocalizedString("名刺を保存しました。同じアカウントのWeb版・アプリ版に反映されます。", comment: "")
            }
            catch { message = NSLocalizedString("保存できませんでした。接続を確認して再試行してください。", comment: "") }
        }
    }
    private func collect() {
        guard let session = model.session, let id = profile.id, !own, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await model.withRefreshedSession { token in
                try await SupabaseService.shared.collectBusinessCard(ownerID: id, collectorID: session.user.id, token: token)
            }; await load(); message = NSLocalizedString("コレクションに保存しました。自分の名刺も共有しましょう。", comment: "") }
            catch { message = NSLocalizedString("保存できませんでした。再試行してください。", comment: "") }
        }
    }
    private func unpublish() {
        guard let session = model.session, let id = profile.id, own, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do { try await SupabaseService.shared.unpublishBusinessCard(ownerID: id, token: session.accessToken); published = false; message = NSLocalizedString("公開を停止しました。", comment: "") }
            catch { message = NSLocalizedString("公開を停止できませんでした。再試行してください。", comment: "") }
        }
    }
}

private struct BusinessCardCollectionView: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @EnvironmentObject private var model: AppModel
    @State private var cards: [CollectedBusinessCard] = []
    @State private var loading = true
    @State private var message = ""
    @State private var busy = false
    var body: some View {
        let _ = appColorTheme

        ScrollView {
            VStack(spacing: 24) {
                if loading { ProgressView() }
                else if cards.isEmpty { Text(NSLocalizedString("まだ名刺がありません。相手の名刺を開いて保存しましょう。", comment: "")) }
                Text(String(format: NSLocalizedString("保存した名刺 %d 枚", comment: ""), cards.count)).font(.headline)
                ForEach(cards) { row in
                    VStack(alignment: .leading) {
                        BusinessCardPreview(card: row.card)
                        Text(String(format: NSLocalizedString("%@ に保存", comment: ""), String(row.collected_at.prefix(10)))).font(.caption).foregroundColor(.secondary)
                        Button(NSLocalizedString("コレクションから取り除く", comment: ""), role: .destructive) { remove(row) }.disabled(busy)
                    }
                }
                if !message.isEmpty { Text(message); Button(NSLocalizedString("再読み込み", comment: "")) { Task { await load() } } }
            }.padding(24).frame(maxWidth: 600)
        }.navigationTitle(NSLocalizedString("名刺コレクション", comment: "")).task { await load() }
    }
    private func load() async {
        defer { loading = false }
        guard let session = model.session else { cards = []; message = NSLocalizedString("ログインしてください。", comment: ""); return }
        loading = true
        do { cards = try await SupabaseService.shared.businessCardCollection(collectorID: session.user.id, token: session.accessToken); message = "" }
        catch { message = NSLocalizedString("コレクションを読み込めませんでした。", comment: "") }
    }
    private func remove(_ row: CollectedBusinessCard) {
        guard let session = model.session, !busy else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await SupabaseService.shared.removeBusinessCard(ownerID: row.id, collectorID: session.user.id, token: session.accessToken)
                cards.removeAll { $0.id == row.id }
            } catch { message = NSLocalizedString("名刺を取り除けませんでした。", comment: "") }
        }
    }
}

private struct BusinessCardDesignEditor: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @Binding var design: BusinessCardDesign
    var body: some View {
        let _ = appColorTheme

        DisclosureGroup(NSLocalizedString("細かくデザイン", comment: "")) {
            VStack(alignment: .leading, spacing: 16) {
                ColorPicker(NSLocalizedString("表の背景", comment: ""), selection: color(\.frontColor), supportsOpacity: false)
                ColorPicker(NSLocalizedString("裏の背景", comment: ""), selection: color(\.backColor), supportsOpacity: false)
                ColorPicker(NSLocalizedString("文字色", comment: ""), selection: color(\.textColor), supportsOpacity: false)
                ColorPicker(NSLocalizedString("見出しの色", comment: ""), selection: color(\.accentColor), supportsOpacity: false)
                Picker(NSLocalizedString("書体", comment: ""), selection: text(\.font)) {
                    Text(NSLocalizedString("ゴシック", comment: "")).tag("sans"); Text(NSLocalizedString("明朝", comment: "")).tag("serif"); Text(NSLocalizedString("等幅", comment: "")).tag("mono")
                }
                Picker(NSLocalizedString("背景の装飾", comment: ""), selection: text(\.pattern)) {
                    Text(NSLocalizedString("単色", comment: "")).tag("solid"); Text(NSLocalizedString("グラデーション", comment: "")).tag("gradient"); Text(NSLocalizedString("ストライプ", comment: "")).tag("stripe")
                }
                alignment(NSLocalizedString("表の文字揃え", comment: ""), key: \.frontAlign)
                alignment(NSLocalizedString("裏の文字揃え", comment: ""), key: \.backAlign)
                Picker(NSLocalizedString("名刺の向き", comment: ""), selection: text(\.orientation)) {
                    Text(NSLocalizedString("横向き", comment: "")).tag("landscape"); Text(NSLocalizedString("縦向き", comment: "")).tag("portrait")
                }
                Picker(NSLocalizedString("角の形", comment: ""), selection: text(\.cornerStyle)) {
                    Text(NSLocalizedString("すべて丸い", comment: "")).tag("rounded"); Text(NSLocalizedString("すべて直角", comment: "")).tag("square")
                    Text(NSLocalizedString("左上・右下が丸い", comment: "")).tag("diagonal")
                    Text(NSLocalizedString("右上・左下が丸い", comment: "")).tag("diagonalReverse")
                }
                Stepper(String(format: NSLocalizedString("名前の大きさ: %dpx", comment: ""), design.nameSize ?? 26), value: Binding(get: { design.nameSize ?? 26 }, set: { design.nameSize = $0 }), in: 18...36)
                Stepper(String(format: NSLocalizedString("角丸: %dpx", comment: ""), design.radius ?? 18), value: Binding(get: { design.radius ?? 18 }, set: { design.radius = $0 }), in: 0...28)
                BusinessCardTextField(placeholder: NSLocalizedString("表の見出し（空欄で非表示）", comment: ""), text: text(\.frontLabel)).frame(height: 44)
                BusinessCardTextField(placeholder: NSLocalizedString("裏の見出し（空欄で非表示）", comment: ""), text: text(\.backLabel)).frame(height: 44)
            }.padding(.vertical, 12)
        }
    }
    private func alignment(_ title: String, key: WritableKeyPath<BusinessCardDesign, String?>) -> some View {
        Picker(title, selection: text(key)) { Text(NSLocalizedString("左揃え", comment: "")).tag("classic"); Text(NSLocalizedString("中央揃え", comment: "")).tag("centered"); Text(NSLocalizedString("右揃え", comment: "")).tag("right") }
    }
    private func text(_ key: WritableKeyPath<BusinessCardDesign, String?>) -> Binding<String> {
        Binding(get: { design[keyPath: key] ?? "" }, set: { design[keyPath: key] = String($0.prefix(40)) })
    }
    private func color(_ key: WritableKeyPath<BusinessCardDesign, String?>) -> Binding<Color> {
        Binding(get: { businessCardColor(design[keyPath: key]) }, set: { value in
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            guard UIColor(value).getRed(&r, green: &g, blue: &b, alpha: &a) else { return }
            design[keyPath: key] = String(format: "#%02x%02x%02x", Int(r * 255), Int(g * 255), Int(b * 255))
        })
    }
}

// Keep keyboard focus visible without Catalyst's large blue focus halo.
private struct BusinessCardInputStyle: ViewModifier {
    @FocusState private var focused: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if #available(iOS 17.0, macCatalyst 17.0, *) {
            field(content).focusEffectDisabled()
        } else {
            field(content)
        }
    }
    private func field(_ content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .focused($focused)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(SpotcodeTheme.surface2)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8)
                .stroke(focused ? SpotcodeTheme.muted : SpotcodeTheme.border, lineWidth: 1))
    }
}

// Own the field's background and border together, so Catalyst cannot inset a
// second, pill-shaped focus halo inside the rectangular input background.
private final class BusinessCardNativeTextField: UITextField {
    override var focusEffect: UIFocusEffect? {
        get { nil }
        set { /* This field draws its own focus border. */ }
    }
    override func textRect(forBounds bounds: CGRect) -> CGRect { bounds.insetBy(dx: 12, dy: 8) }
    override func editingRect(forBounds bounds: CGRect) -> CGRect { textRect(forBounds: bounds) }
    override func placeholderRect(forBounds bounds: CGRect) -> CGRect { textRect(forBounds: bounds) }
}

private struct BusinessCardTextField: UIViewRepresentable {
    let placeholder: String
    @Binding var text: String
    @Environment(\.isEnabled) private var enabled

    func makeUIView(context: Context) -> BusinessCardNativeTextField {
        let field = BusinessCardNativeTextField()
        field.borderStyle = .none
        field.backgroundColor = .black
        field.textColor = .white
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.layer.cornerRadius = 8
        field.layer.borderWidth = 1
        field.layer.borderColor = UIColor.darkGray.cgColor
        field.clipsToBounds = true
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        return field
    }
    func updateUIView(_ field: BusinessCardNativeTextField, context: Context) {
        context.coordinator.parent = self
        // Do not replace a Japanese IME's in-progress marked text.
        if field.markedTextRange == nil && field.text != text { field.text = text }
        field.attributedPlaceholder = NSAttributedString(string: placeholder, attributes: [.foregroundColor: UIColor.gray])
        field.accessibilityLabel = placeholder
        field.isEnabled = enabled
        field.alpha = enabled ? 1 : 0.5
    }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: BusinessCardTextField
        init(_ parent: BusinessCardTextField) { self.parent = parent }
        @objc func changed(_ field: UITextField) {
            guard field.markedTextRange == nil else { return }
            parent.text = field.text ?? ""
        }
        func textFieldDidBeginEditing(_ field: UITextField) { field.layer.borderColor = UIColor.gray.cgColor }
        func textFieldDidEndEditing(_ field: UITextField) {
            parent.text = field.text ?? ""
            field.layer.borderColor = UIColor.darkGray.cgColor
        }
        func textFieldShouldReturn(_ field: UITextField) -> Bool { field.resignFirstResponder(); return true }
    }
}

private struct BusinessCardColorPalette: UIViewControllerRepresentable {
    @Binding var color: Color
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> UIColorPickerViewController {
        let picker = UIColorPickerViewController()
        picker.supportsAlpha = false
        picker.selectedColor = UIColor(color)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ picker: UIColorPickerViewController, context: Context) {
        context.coordinator.parent = self
        let current = UIColor(color)
        if picker.selectedColor != current { picker.selectedColor = current }
    }
    final class Coordinator: NSObject, UIColorPickerViewControllerDelegate {
        var parent: BusinessCardColorPalette
        init(_ parent: BusinessCardColorPalette) { self.parent = parent }
        func colorPickerViewControllerDidSelectColor(_ viewController: UIColorPickerViewController) {
            parent.color = Color(uiColor: viewController.selectedColor)
        }
    }
}

private struct BusinessCardBaseColorPicker: View {
    @Environment(\.appColorTheme) private var appColorTheme
    @Binding var design: BusinessCardDesign
    var theme: String = "midnight"
    @State private var showingPalette = false
    private var baseColor: Binding<Color> { Binding(get: {
                businessCardColor(design.frontColor)
            }, set: { color in
                var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                guard UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a) else { return }
                design.applyBaseColor(String(format: "#%02x%02x%02x", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded())), theme: theme)
            }) }
    var body: some View {
        let _ = appColorTheme

        VStack(alignment: .leading, spacing: 14) {
            Text(NSLocalizedString("ベースカラー", comment: "")).font(.headline)
            Button { showingPalette = true } label: {
                HStack {
                    Circle().fill(businessCardColor(design.frontColor)).frame(width: 28, height: 28)
                    Label(NSLocalizedString("カラーパレットを開く", comment: ""), systemImage: "paintpalette")
                }.padding(8)
            }.buttonStyle(.bordered)
            .sheet(isPresented: $showingPalette) {
                VStack(spacing: 0) {
                    HStack { Text(NSLocalizedString("ベースカラー", comment: "")).font(.headline); Spacer(); Button(NSLocalizedString("完了", comment: "")) { showingPalette = false } }.padding()
                    BusinessCardColorPalette(color: baseColor)
                }.frame(minWidth: 300, minHeight: 420)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 40, maximum: 44), spacing: 12)], alignment: .leading, spacing: 12) {
                ForEach(BusinessCardDesign.baseColors, id: \.0) { hex, name in
                    let selected = design.frontColor?.lowercased() == hex
                    Button { design.applyBaseColor(hex, theme: theme) } label: {
                        Circle().fill(businessCardColor(hex)).frame(width: 36, height: 36)
                            .overlay(Circle().stroke(Color.gray.opacity(0.5), lineWidth: 1))
                            .overlay(Group {
                                if selected { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundColor(.white).padding(4).background(Color.black).clipShape(Circle()) }
                            })
                            .padding(4)
                            .overlay(Circle().stroke(selected ? SpotcodeTheme.text : .clear, lineWidth: 2))
                    }.buttonStyle(.plain).accessibilityLabel(name)
                     .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            Text(NSLocalizedString("選んだ色をもとに表・裏・文字色をまとめて設定します。細かい色は後から調整できます。", comment: ""))
                .font(.caption).foregroundColor(.secondary)
        }.padding(.vertical, 8)
    }
}
