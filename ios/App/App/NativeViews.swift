import SwiftUI
import MapKit
import CoreLocation
import PhotosUI

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
        .tint(SpotcodeTheme.accent)
        .task {
            if model.session == nil { showLogin = true }
            await model.bootstrap()
        }
        .sheet(isPresented: $showLogin) { LoginView(isPresented: $showLogin) }
        .sheet(isPresented: $composing) { ComposeView(isPresented: $composing) }
        .alert("エラー", isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) { Button("OK") {} } message: { Text(model.errorMessage ?? "") }
    }

    @ViewBuilder private var sectionView: some View {
        switch section {
        case .home: TimelineView(repositoryComposeURL: $repositoryComposeURL)
        case .repos: RepositoriesView { url in
            repositoryComposeURL = url.absoluteString
            section = .home
            navigationReset = UUID()
        }
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
                    Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 25, height: 25)
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
            } label: { AvatarView(profile: model.me, size: 34) }
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
            if model.session != nil && (model.me?.isAdmin == true || model.me?.isOperator == true) {
                HStack(spacing: 12) {
                    ZStack { LinearGradient(colors: [SpotcodeTheme.accent, .green], startPoint: .topLeading, endPoint: .bottomTrailing); Text("S").font(.title2).fontWeight(.bold) }.frame(width: 44, height: 44).clipShape(Circle())
                    VStack(alignment: .leading) { HStack { Text("spotcode").fontWeight(.bold); Text("公式").font(.caption.weight(.bold)).foregroundColor(.yellow).padding(4).background(Color.yellow.opacity(0.15)).clipShape(RoundedRectangle(cornerRadius: 5)) }; Text("@spotcode_official").foregroundColor(SpotcodeTheme.muted) }
                }.padding(.horizontal, 12)
            }
            Rectangle().fill(SpotcodeTheme.border).frame(height: 1)
            Button { model.signOut(); isPresented = false; showLogin = true } label: { Label("Log out", systemImage: "arrow.right").foregroundColor(Color(red: 248/255, green: 81/255, blue: 73/255)).font(.title3) }
        }
        .padding(15).background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(SpotcodeTheme.border)).clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

struct TimelineView: View {
    @EnvironmentObject private var model: AppModel
    @Binding var repositoryComposeURL: String?
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
    @AppStorage("spotcode.native.draft") private var draft = ""
    @State private var githubLink = ""
    @State private var eventURL = ""
    @State private var sending = false
    @State private var showLink = false
    @State private var showEvent = false
    @State private var isIdea = false
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
            AvatarView(profile: model.me, size: 42)
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
         .onChange(of: repositoryComposeURL) { applyRepositoryRequest($0) }
         .sheet(isPresented: $showLocationPicker) {
             LocationPickerSheet(spot: $selectedSpot, isPresented: $showLocationPicker)
         }
         .sheet(isPresented: $showPhotoPicker) { PhotoLibraryPicker(images: $photos) }
         .sheet(isPresented: $showPollEditor) { PollEditorSheet(poll: $poll, isPresented: $showPollEditor) }
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

    private var locationChip: some View {
        Button { showLocationPicker = true } label: {
            ComposerChip(icon: "mappin", title: selectedSpot?.label ?? "場所を追加", active: selectedSpot != nil)
        }
    }
    private var linkChip: some View { Button { showLink.toggle() } label: { ComposerChip(icon: "link", title: "リンクを追加", active: showLink) } }
    private var eventChip: some View { Button { showEvent.toggle() } label: { ComposerChip(icon: "calendar", title: "イベントを追加", active: showEvent) } }
    private var ideaChip: some View { Button { isIdea.toggle() } label: { ComposerChip(icon: "sparkles", title: "アイデア", active: isIdea) } }
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
            if await model.publish(body: draft.trimmingCharacters(in: .whitespacesAndNewlines), githubLink: githubLink.isEmpty ? nil : githubLink, eventURL: eventURL.isEmpty ? nil : eventURL, spot: selectedSpot, kind: isIdea ? "idea" : nil, visibility: visibility, photos: photos.isEmpty ? nil : photos, poll: poll) {
                draft = ""; githubLink = ""; eventURL = ""; showLink = false; showEvent = false
                isIdea = false; visibility = "public"; selectedSpot = nil
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
        Button { visibility = value } label: { if visibility == value { Label(title, systemImage: "checkmark") } else { Text(title) } }
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
        showLink = true
        editorFocused = true
        repositoryComposeURL = nil
    }
}

private struct ComposerChip: View {
    let icon: String; let title: String
    var strong = false
    var active = false
    var body: some View {
        Label(title, systemImage: icon).font(.caption.weight(.semibold)).foregroundColor(active ? SpotcodeTheme.accent : (strong ? SpotcodeTheme.text : SpotcodeTheme.muted))
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
                    CurrentLocationMap(coordinate: $coordinate, currentCoordinate: currentCoordinate, region: $mapRegion, adjustmentDenied: $adjustmentDenied)
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
            if distance <= 300 {
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
    let post: Post
    var opensDetail = true
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
                if post.spot != nil || post.kind == "idea" || (post.visibility ?? "public") != "public" {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            if let label = post.spot?.label { PostMetadataBadge(icon: "mappin", text: label, color: SpotcodeTheme.accent) }
                            if post.kind == "idea" { PostMetadataBadge(icon: "sparkles", text: "アイデア", color: SpotcodeTheme.warning) }
                            if let visibility = post.visibility, visibility != "public" {
                                PostMetadataBadge(icon: visibilityBadge(visibility).icon, text: visibilityBadge(visibility).text, color: SpotcodeTheme.muted)
                            }
                        }
                    }
                }
                Text(post.body).foregroundColor(SpotcodeTheme.text).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let photos = post.photos, !photos.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) { ForEach(photos, id: \.self) { DataURLImage(value: $0).frame(width: 180, height: 140).clipShape(RoundedRectangle(cornerRadius: 10)) } }
                    }
                }
                if let poll = post.poll {
                    VStack(alignment: .leading, spacing: 8) {
                        Label(poll.question, systemImage: "chart.bar").font(.subheadline.weight(.bold))
                        ForEach(poll.options, id: \.self) { option in
                            Text(option).padding(.horizontal, 12).padding(.vertical, 9).frame(maxWidth: .infinity, alignment: .leading)
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
                        }
                    }.padding(10).background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 10))
                }
                if let link = post.githubLink, let url = URL(string: link) {
                    Link(destination: url) {
                        HStack(spacing: 5) {
                            Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13)
                            Text(githubLinkLabel(link)).lineLimit(1)
                        }.font(.caption).frame(maxWidth: .infinity, alignment: .leading)
                    }.foregroundColor(SpotcodeTheme.accent)
                }
                if let link = post.eventURL, let url = URL(string: link) {
                    Link(destination: url) {
                        Label("イベントを開く", systemImage: "calendar")
                            .font(.caption).frame(maxWidth: .infinity, alignment: .leading)
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
        .overlay {
            if opensDetail {
                HStack(spacing: 0) {
                    Color.clear.frame(width: 70).allowsHitTesting(false)
                    NavigationLink(destination: PostDetailView(post: post)) {
                        Color.clear.contentShape(Rectangle())
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    private func visibilityBadge(_ value: String) -> (icon: String, text: String) {
        switch value {
        case "mutuals": return ("arrow.2.squarepath", "相互フォロー")
        case "following": return ("person.badge.plus", "フォロー中")
        case "friends": return ("heart", "親しい友達")
        case "org": return ("building.2", "同じ組織")
        default: return ("lock", "限定公開")
        }
    }
}

private struct PostMetadataBadge: View {
    let icon: String
    let text: String
    let color: Color
    var body: some View {
        Label(text, systemImage: icon).font(.caption2.weight(.semibold)).foregroundColor(color)
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
            Text(String(profile?.name.first ?? "?")).foregroundColor(.white).fontWeight(.bold)
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
    @State private var sending = false
    @State private var editorFocused = false

    init(isPresented: Binding<Bool>, initialGitHubLink: String = "") {
        _isPresented = isPresented
        _githubLink = State(initialValue: initialGitHubLink)
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    AvatarView(profile: model.me, size: 42)
                    ComposerTextView(text: $bodyText, isFocused: $editorFocused).frame(minHeight: 160)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(editorFocused ? SpotcodeTheme.accent : SpotcodeTheme.border, lineWidth: 2))
                }
                HStack { Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 16, height: 16); TextField("https://github.com/…", text: $githubLink).textInputAutocapitalization(.never).keyboardType(.URL) }
                    .padding(11).background(SpotcodeTheme.inputSurface).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
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
    @State private var region = MKCoordinateRegion(center: .init(latitude: 35.681236, longitude: 139.767125), span: .init(latitudeDelta: 0.006, longitudeDelta: 0.006))
    @State private var selectedPost: Post?
    @State private var loading = false
    @StateObject private var location = ComposerLocationProvider()
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
        }
        .onChange(of: location.spot) { value in
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
    var subtitle: String? { post.body }
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
                    Image(systemName: "shippingbox").font(.title2).foregroundColor(SpotcodeTheme.accent)
                    Text("Repos").font(.title3).fontWeight(.bold)
                    Text("GitHub と紐づくリポジトリ単位で動きを見る。")
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
                        Image(systemName: "shippingbox").font(.caption)
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
        var handles = [handle]
        if let session = model.session, let userID = model.me?.id,
           let following = try? await SupabaseService.shared.followingProfiles(userID: userID, token: session.accessToken) {
            handles += following.compactMap(\.githubHandle)
        }
        var loaded: [Repository] = []
        await withTaskGroup(of: [Repository].self) { group in
            for value in Array(Set(handles)) { group.addTask { (try? await SupabaseService.shared.repositories(handle: value)) ?? [] } }
            for await values in group { loaded += values }
        }
        repositories = Dictionary(grouping: loaded, by: \.fullName).compactMap(\.value.first)
            .sorted { ($0.pushedAt ?? "") > ($1.pushedAt ?? "") }
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
        .task {
            guard !handle.isEmpty else { loading = false; return }
            if model.me?.handle.caseInsensitiveCompare(handle) == .orderedSame { profile = model.me }
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
    @State private var contributions: [GitHubContribution] = []
    @State private var issueSearch: GitHubIssueSearchResponse?
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                if let profile {
                    VStack(spacing: 0) {
                        ProfileHero(profile: profile, counts: counts, repositories: repositories, contributions: contributions, issueSearch: issueSearch, isOwn: profile.id == model.me?.id)
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
            async let loadedRepos = SupabaseService.shared.repositories(handle: handle)
            async let loadedContributions = SupabaseService.shared.githubContributions(handle: handle)
            async let loadedIssues = SupabaseService.shared.githubOpenIssues(handle: handle)
            repositories = (try? await loadedRepos) ?? []
            contributions = (try? await loadedContributions) ?? []
            issueSearch = try? await loadedIssues
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
    let contributions: [GitHubContribution]
    let issueSearch: GitHubIssueSearchResponse?
    let isOwn: Bool
    @State private var editing = false
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
                    }
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
                if let handle = profile.githubHandle, let url = URL(string: "https://github.com/\(handle)") {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 15, height: 15)
                            Text("@\(handle)")
                        }
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
                    OpenIssuesCard(handle: profile.githubHandle ?? "", result: issueSearch)
                }
            }.padding(.horizontal, 18).padding(.bottom, 20)
        }.overlay(RoundedRectangle(cornerRadius: 12).stroke(SpotcodeTheme.border))
         .sheet(isPresented: $editing) { EditProfileView(profile: profile, isPresented: $editing).environmentObject(model) }
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
              }.padding()
            }.background(SpotcodeTheme.surface).foregroundColor(SpotcodeTheme.text)
                .navigationTitle("Edit profile").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(saving ? "保存中…" : "保存") { saving = true; Task { if await model.updateProfile(name: name, bio: bio, location: location, avatarURL: avatarURL, avatarShape: avatarShape) { isPresented = false }; saving = false } }.disabled(name.isEmpty || saving)
                    }
                }
                .onAppear { name = profile.name; bio = profile.bio ?? ""; location = profile.location ?? ""; avatarURL = profile.avatarURL; avatarShape = profile.avatarShape ?? "round" }
                .sheet(isPresented: $showingImagePicker) { ProfileImagePicker(image: $avatarURL) }
        }.preferredColorScheme(.dark)
    }

    private var previewProfile: Profile {
        Profile(id: profile.id, handle: profile.handle, name: name.isEmpty ? profile.name : name, avatarURL: avatarURL, bio: profile.bio, location: profile.location, githubHandle: profile.githubHandle, createdAt: profile.createdAt, avatarShape: avatarShape, isAdmin: profile.isAdmin, isOperator: profile.isOperator)
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

private struct OpenIssuesCard: View {
    let handle: String
    let result: GitHubIssueSearchResponse?
    @State private var listExpanded = false
    @State private var expandedIssues: Set<Int> = []
    private var total: Int { result?.totalCount ?? 0 }
    private var issueGroups: [(key: String, value: [GitHubIssue])] {
        Array(Dictionary(grouping: result?.items ?? [], by: \.repositoryName).sorted { $0.key < $1.key }.prefix(8))
    }
    private var visibleIssues: [GitHubIssue] {
        Array((result?.items ?? []).sorted { left, right in
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
            HStack { Image("GitHubMark").renderingMode(.template).resizable().scaledToFit().frame(width: 13, height: 13).foregroundColor(SpotcodeTheme.muted); Text("Open issues"); Text("\(total)").fontWeight(.bold); Text("公開リポの未クローズ issue (task)").font(.caption).foregroundColor(SpotcodeTheme.muted); Spacer()
                if result?.items.isEmpty == false {
                    Button(listExpanded ? "閉じる" : "リストを表示") { withAnimation { listExpanded.toggle() } }.font(.caption.weight(.semibold))
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    Link(destination: URL(string: "https://github.com/issues?q=is%3Aopen+user%3A\(handle)")!) { Text("All \(total)").issuePill() }
                    ForEach(issueGroups, id: \.key) { entry in
                        Text("\(entry.key.split(separator: "/").last.map(String.init) ?? entry.key) \(entry.value.count)").issuePill()
                    }
                }.foregroundColor(SpotcodeTheme.text)
            }
            if result == nil {
                ProgressView("Issueを読み込み中…").font(.caption).foregroundColor(SpotcodeTheme.muted)
            } else if result?.items.isEmpty == true {
                Text("未クローズのIssueはありません").font(.caption).foregroundColor(SpotcodeTheme.muted)
            } else if listExpanded {
                ForEach(visibleIssues) { issue in
                    VStack(alignment: .leading, spacing: 7) {
                        Button {
                            withAnimation {
                                if expandedIssues.contains(issue.id) { expandedIssues.remove(issue.id) }
                                else { expandedIssues.insert(issue.id) }
                            }
                        } label: {
                          HStack(spacing: 8) {
                            Image(systemName: expandedIssues.contains(issue.id) ? "chevron.down" : "chevron.right").font(.caption)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(issue.title).lineLimit(1).foregroundColor(SpotcodeTheme.text)
                                HStack(spacing: 6) {
                                    Text(issue.repositoryName)
                                    if issue.isTemplateTask { Text("task").foregroundColor(SpotcodeTheme.accent) }
                                    if let due = issue.dueDate { Text(dueLabel(due)).foregroundColor(due < Date() ? .red : (due.timeIntervalSinceNow < 259_200 ? SpotcodeTheme.warning : SpotcodeTheme.muted)) }
                                }.font(.caption).foregroundColor(SpotcodeTheme.muted)
                            }
                            Spacer()
                          }.contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        if expandedIssues.contains(issue.id) {
                            if let body = issue.body, !body.isEmpty {
                                Text(cleanIssueBody(body)).font(.caption).foregroundColor(SpotcodeTheme.text)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                                    .background(SpotcodeTheme.surface2).clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            Link(destination: issue.htmlURL) { Label("GitHubで開く · #\(issue.number)", systemImage: "arrow.up.right") }
                                .font(.caption).foregroundColor(SpotcodeTheme.accent)
                        }
                    }.padding(.vertical, 5).overlay(alignment: .bottom) { Rectangle().fill(SpotcodeTheme.border).frame(height: 1) }
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

    private func cleanIssueBody(_ body: String) -> String {
        body.replacingOccurrences(of: "<!--(?:.|\\n)*?-->", with: "", options: .regularExpression)
            .replacingOccurrences(of: "**", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func collapseAll() {
        listExpanded = false
        expandedIssues.removeAll()
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
    @State private var showAddAccount = false
    var body: some View {
        VStack(spacing: 18) {
            SettingsCard("アカウント") {
                Text("この端末にログイン済みのアカウントを切り替えられます。アカウント自体は削除されません。").foregroundColor(SpotcodeTheme.muted)
                if let me = model.me {
                    HStack { AvatarView(profile: me, size: 42); VStack(alignment: .leading) { Text(me.name).fontWeight(.bold); Text("@\(me.handle) · 現在").font(.caption).foregroundColor(SpotcodeTheme.muted) }; Spacer(); Image(systemName: "xmark").foregroundColor(SpotcodeTheme.muted) }
                        .padding(12).background(Color(red: 23/255, green: 40/255, blue: 54/255)).clipShape(RoundedRectangle(cornerRadius: 9))
                }
                Button("＋ 別のアカウントでログイン") { showAddAccount = true }.buttonStyle(OutlineButtonStyle())
            }
            SettingsCard("役割") {
                Label(roleTitle, systemImage: model.me?.isAdmin == true ? "sparkles" : (model.me?.isOperator == true ? "flag" : "person")).foregroundColor(SpotcodeTheme.accent)
                Text(roleDescription).foregroundColor(SpotcodeTheme.muted)
            }
            SettingsCard("アカウントの種類") {
                Text("個人アカウント").fontWeight(.semibold)
                Text("プロフィール表示が変わるだけで、投稿の公開範囲やフォローの挙動は変わりません。").foregroundColor(SpotcodeTheme.muted)
            }
        }.sheet(isPresented: $showAddAccount) { LoginView(isPresented: $showAddAccount).environmentObject(model) }
    }
    private var roleTitle: String { model.me?.isAdmin == true ? "管理者" : (model.me?.isOperator == true ? "運営者" : "一般ユーザー") }
    private var roleDescription: String {
        if model.me?.isAdmin == true { return "すべての管理権限を持ちます。" }
        if model.me?.isOperator == true { return "通報対応・投稿管理・ピン管理を行えます。" }
        return "通常の投稿・フォロー・スポット機能を利用できます。"
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
    @State private var signing = false
    var body: some View {
        NavigationView {
            VStack(spacing: 14) {
                Image(systemName: "chevron.left.forwardslash.chevron.right").font(.largeTitle)
                TextField("メールまたはログイン名", text: $email).textInputAutocapitalization(.never).keyboardType(.emailAddress).spotcodeField()
                SecureField("パスワード", text: $password).spotcodeField()
                Button(signing ? "ログイン中…" : "ログイン") {
                    signing = true
                    Task {
                        let succeeded = await model.signIn(emailOrAlias: email, password: password)
                        signing = false
                        if succeeded { isPresented = false }
                    }
                }.font(.body.weight(.bold)).frame(maxWidth: .infinity).padding(13).background(SpotcodeTheme.accent).foregroundColor(.white).clipShape(Capsule())
                 .disabled(email.isEmpty || password.isEmpty || signing)
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
    func spotcodeURLField() -> some View {
        self.padding(12).background(SpotcodeTheme.inputSurface).overlay(RoundedRectangle(cornerRadius: 8).stroke(SpotcodeTheme.border))
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

private func githubLinkLabel(_ value: String) -> String {
    guard let url = URL(string: value),
          let host = url.host?.lowercased(), host == "github.com" || host == "www.github.com" else {
        return value
    }
    let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return path.isEmpty ? "github.com" : path
}
