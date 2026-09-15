import SwiftUI
import MultipeerConnectivity

// Only public card IDs cross the encrypted peer session. Published content is
// fetched from the server after both people agree to exchange.
struct NearbyCardMessage: Codable {
    let version: Int
    let kind: String
    let ownerID: UUID
    static func decode(_ data: Data) -> Self? {
        guard data.count <= 1024,
              let value = try? JSONDecoder().decode(Self.self, from: data),
              value.version == 1, ["card", "saved"].contains(value.kind) else { return nil }
        return value
    }
}

final class NearbyCardExchange: NSObject, ObservableObject {
    @Published private(set) var peers: [MCPeerID] = []
    @Published private(set) var invitationName: String?
    @Published private(set) var receivedOwnerID: UUID?
    @Published private(set) var status = NSLocalizedString("近くで名刺画面を開いている相手を探しています。", comment: "")
    @Published private(set) var busy = false
    @Published private(set) var peerSaved = false
    private var ownerID: UUID?
    private var session: MCSession?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var browser: MCNearbyServiceBrowser?
    private var expectedPeer: MCPeerID?
    private var invitation: ((Bool, MCSession?) -> Void)?
    private var deadline: DispatchWorkItem?
    private var sent = false
    private let service = "spotcode-card"

    func start(ownerID: UUID, handle: String) {
        guard session == nil else { return }
        self.ownerID = ownerID
        let peer = MCPeerID(displayName: String(handle.prefix(40)))
        let session = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
        session.delegate = self
        self.session = session
        let advertiser = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: ["version":"1"], serviceType: service)
        let browser = MCNearbyServiceBrowser(peer: peer, serviceType: service)
        advertiser.delegate = self; browser.delegate = self
        self.advertiser = advertiser; self.browser = browser
        status = NSLocalizedString("近くで名刺画面を開いている相手を探しています。", comment: "")
        advertiser.startAdvertisingPeer(); browser.startBrowsingForPeers()
    }
    func stop() {
        deadline?.cancel(); deadline = nil
        invitation?(false, nil); invitation = nil; invitationName = nil
        advertiser?.stopAdvertisingPeer(); browser?.stopBrowsingForPeers()
        advertiser?.delegate = nil; browser?.delegate = nil
        advertiser = nil; browser = nil
        session?.delegate = nil; session?.disconnect(); session = nil
        ownerID = nil; expectedPeer = nil; peers = []; busy = false
        receivedOwnerID = nil; peerSaved = false; sent = false
    }
    func invite(_ peer: MCPeerID) {
        guard !busy, peers.contains(peer), let session else { return }
        expectedPeer = peer; busy = true; sent = false; peerSaved = false; receivedOwnerID = nil
        browser?.invitePeer(peer, to: session, withContext: Data("spotcode-card-v1".utf8), timeout: 30)
        status = NSLocalizedString("相手の確認を待っています。", comment: "")
        armTimeout(session)
    }
    func respond(accept: Bool) {
        let handler = invitation; invitation = nil; invitationName = nil
        handler?(accept, accept ? session : nil)
        if accept, let session { status = NSLocalizedString("接続しています。", comment: ""); armTimeout(session) }
        else { expectedPeer = nil; busy = false; deadline?.cancel() }
    }
    func saved(_ ownerID: UUID) {
        guard ownerID == receivedOwnerID else { return }
        send(kind: "saved", ownerID: ownerID)
    }
    private func send(kind: String, ownerID: UUID) {
        guard let session, let peer = expectedPeer, session.connectedPeers.contains(peer),
              let data = try? JSONEncoder().encode(NearbyCardMessage(version: 1, kind: kind, ownerID: ownerID)) else { return }
        do { try session.send(data, toPeers: [peer], with: .reliable) }
        catch { status = NSLocalizedString("送信できませんでした。画面を閉じて再試行してください。", comment: "") }
    }
    private func armTimeout(_ session: MCSession) {
        deadline?.cancel()
        let task = DispatchWorkItem { [weak self, weak session] in
            guard let self, let session, self.session === session, self.receivedOwnerID == nil else { return }
            self.invitation?(false, nil); self.invitation = nil; self.invitationName = nil
            session.disconnect(); self.expectedPeer = nil; self.busy = false
            self.status = NSLocalizedString("接続が完了しませんでした。相手を選んで再試行してください。", comment: "")
        }
        deadline = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 35, execute: task)
    }
}

extension NearbyCardExchange: MCNearbyServiceBrowserDelegate, MCNearbyServiceAdvertiserDelegate {
    func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String : String]?) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.browser === browser, info?["version"] == "1", !self.peers.contains(peerID) else { return }
            self.peers.append(peerID)
        }
    }
    func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.browser === browser else { return }
            self.peers.removeAll { $0 == peerID }
        }
    }
    func browser(_ browser: MCNearbyServiceBrowser, didNotStartBrowsingForPeers error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard self?.browser === browser else { return }
            self?.status = NSLocalizedString("相手を検索できません。ローカルネットワークの許可とWi-Fiを確認してください。", comment: "")
        }
    }
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didNotStartAdvertisingPeer error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard self?.advertiser === advertiser else { return }
            self?.status = NSLocalizedString("交換待機を開始できません。ローカルネットワークの許可を確認してください。", comment: "")
        }
    }
    func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID,
                    withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.advertiser === advertiser, !self.busy,
                  context == Data("spotcode-card-v1".utf8), let session = self.session else { invitationHandler(false, nil); return }
            self.expectedPeer = peerID; self.busy = true; self.sent = false; self.peerSaved = false; self.receivedOwnerID = nil
            self.invitation = invitationHandler; self.invitationName = peerID.displayName
            self.armTimeout(session)
        }
    }
}

extension NearbyCardExchange: MCSessionDelegate {
    func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.session === session, self.expectedPeer == peerID else { return }
            if state == .connected, !self.sent, let owner = self.ownerID {
                self.sent = true
                self.status = NSLocalizedString("公開済みの名刺を交換しています。", comment: "")
                self.send(kind: "card", ownerID: owner)
            } else if state == .notConnected {
                self.deadline?.cancel(); self.busy = false; self.expectedPeer = nil
                if self.receivedOwnerID == nil { self.status = NSLocalizedString("接続が終了しました。相手を選んで再試行できます。", comment: "") }
            }
        }
    }
    func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        guard let message = NearbyCardMessage.decode(data) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, self.session === session, self.expectedPeer == peerID,
                  session.connectedPeers.contains(peerID) else { return }
            if message.kind == "card", message.ownerID != self.ownerID, self.receivedOwnerID == nil {
                self.deadline?.cancel()
                self.receivedOwnerID = message.ownerID
            } else if message.kind == "saved", message.ownerID == self.ownerID { self.peerSaved = true }
        }
    }
    func session(_ session: MCSession, didReceive stream: InputStream, withName name: String, fromPeer peerID: MCPeerID) { stream.close() }
    func session(_ session: MCSession, didStartReceivingResourceWithName name: String, fromPeer peerID: MCPeerID, with progress: Progress) { progress.cancel() }
    func session(_ session: MCSession, didFinishReceivingResourceWithName name: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

struct NearbyBusinessCardExchangeView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase
    let ownerID: UUID
    let handle: String
    let enabled: Bool
    @StateObject private var exchange = NearbyCardExchange()
    @State private var showingPeers = false
    @State private var savedOwnerID: UUID?
    @State private var saveError: String?
    @State private var retry = 0
    var body: some View {
        Button { showingPeers = true } label: {
            Label(exchange.peers.isEmpty ? NSLocalizedString("近くの相手と交換", comment: "") : String(format: NSLocalizedString("近くの相手と交換（%d）", comment: ""), exchange.peers.count), systemImage: "iphone.radiowaves.left.and.right")
                .font(.callout).padding(10)
        }
        .background(.regularMaterial).clipShape(Capsule()).padding(12)
        .task(id: enabled) { updateDiscovery() }
        .onChange(of: scenePhase) { _ in updateDiscovery() }
        .onDisappear { exchange.stop() }
        .onChange(of: exchange.invitationName) { name in if name != nil { showingPeers = true } }
        .task(id: "\(exchange.receivedOwnerID?.uuidString ?? "none"):\(retry)") { await saveReceivedCard() }
        .sheet(isPresented: $showingPeers) {
            NavigationView {
                List {
                    Text(NSLocalizedString("両方の端末で自分の公開済み名刺を開き、相手を選んでください。交換に同意すると、互いの名刺をコレクションに保存します。近づけた距離は判定しません。保存にはインターネット接続が必要です。", comment: ""))
                        .font(.callout)
                    if let name = exchange.invitationName {
                        Section(NSLocalizedString("交換リクエスト", comment: "")) {
                            Text(String(format: NSLocalizedString("%@ から交換のリクエスト", comment: ""), name))
                            Button(NSLocalizedString("名刺を交換する", comment: "")) { exchange.respond(accept: true) }
                            Button(NSLocalizedString("断る", comment: ""), role: .cancel) { exchange.respond(accept: false) }
                        }
                    } else if !exchange.busy {
                        Section(NSLocalizedString("近くの相手", comment: "")) {
                            ForEach(exchange.peers, id: \.self) { peer in
                                Button(peer.displayName) { exchange.invite(peer) }
                            }
                            if exchange.peers.isEmpty { Text(NSLocalizedString("相手を探しています…", comment: "")) }
                        }
                    }
                    Text(exchange.status).font(.caption)
                    if let received = exchange.receivedOwnerID, received == savedOwnerID {
                        Text(exchange.peerSaved ? NSLocalizedString("互いの名刺の保存を確認しました。", comment: "") : NSLocalizedString("自分のコレクションに保存しました。相手の保存確認を待っています。", comment: ""))
                    }
                    if let saveError { Text(saveError); Button(NSLocalizedString("保存を再試行", comment: "")) { retry += 1 } }
                }
                .navigationTitle(NSLocalizedString("近くの相手と交換", comment: ""))
                .toolbar { ToolbarItem(placement: .confirmationAction) {
                    Button(NSLocalizedString("閉じる", comment: "")) { showingPeers = false; exchange.stop(); savedOwnerID = nil; saveError = nil; updateDiscovery() }
                } }
            }.navigationViewStyle(.stack)
        }
    }
    private func updateDiscovery() {
        if enabled && scenePhase == .active && model.session?.user.id == ownerID {
            exchange.start(ownerID: ownerID, handle: handle)
        } else { exchange.stop() }
    }
    private func saveReceivedCard() async {
        guard let received = exchange.receivedOwnerID, received != ownerID else { return }
        if received == savedOwnerID { exchange.saved(received); return }
        saveError = nil
        do {
            let session = try await model.validSession()
            guard session.user.id == ownerID else { return }
            try Task.checkCancellation()
            guard model.session?.user.id == ownerID, exchange.receivedOwnerID == received else { return }
            try await SupabaseService.shared.collectBusinessCard(ownerID: received, collectorID: ownerID, token: session.accessToken)
            try Task.checkCancellation()
            guard model.session?.user.id == ownerID, exchange.receivedOwnerID == received else { return }
            savedOwnerID = received; exchange.saved(received)
        } catch is CancellationError { }
        catch { saveError = NSLocalizedString("名刺を保存できませんでした。接続を確認して再試行してください。", comment: "") }
    }
}
