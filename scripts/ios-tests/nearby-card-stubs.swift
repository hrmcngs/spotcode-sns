import Foundation
@propertyWrapper struct Published<Value> { var wrappedValue: Value }
protocol ObservableObject {}
protocol MCSessionDelegate {}
protocol MCNearbyServiceBrowserDelegate {}
protocol MCNearbyServiceAdvertiserDelegate {}
final class MCPeerID: NSObject { let displayName: String; init(displayName: String) { self.displayName = displayName } }
enum MCSessionState { case connected, connecting, notConnected }
enum Encryption { case required }
enum Reliability { case reliable }
final class MCSession: NSObject {
    weak var delegate: AnyObject?
    var connectedPeers: [MCPeerID] = []
    var sent: [(Data, [MCPeerID])] = []
    init(peer: MCPeerID, securityIdentity: [Any]?, encryptionPreference: Encryption) { super.init() }
    func send(_ data: Data, toPeers peers: [MCPeerID], with mode: Reliability) throws { sent.append((data, peers)) }
    func disconnect() { connectedPeers = [] }
}
final class MCNearbyServiceAdvertiser: NSObject {
    static var latest: MCNearbyServiceAdvertiser!
    weak var delegate: AnyObject?
    var active = false
    init(peer: MCPeerID, discoveryInfo: [String:String]?, serviceType: String) { super.init(); Self.latest = self }
    func startAdvertisingPeer() { active = true }
    func stopAdvertisingPeer() { active = false }
}
final class MCNearbyServiceBrowser: NSObject {
    static var latest: MCNearbyServiceBrowser!
    weak var delegate: AnyObject?
    var invited: MCPeerID?
    var invitedSession: MCSession?
    var active = false
    init(peer: MCPeerID, serviceType: String) { super.init(); Self.latest = self }
    func startBrowsingForPeers() { active = true }
    func stopBrowsingForPeers() { active = false }
    func invitePeer(_ peer: MCPeerID, to session: MCSession, withContext: Data?, timeout: TimeInterval) { invited = peer; invitedSession = session }
}
