@main struct NearbyCardChecks {
    static func drain() async { try? await Task.sleep(nanoseconds: 20_000_000) }
    static func main() async throws {
        let local = UUID(), remote = UUID(), peer = MCPeerID(displayName: "Remote"), stranger = MCPeerID(displayName: "Stranger")
        let exchange = NearbyCardExchange()
        exchange.start(ownerID: local, handle: "Local")
        let browser = MCNearbyServiceBrowser.latest!, advertiser = MCNearbyServiceAdvertiser.latest!
        exchange.browser(browser, foundPeer: peer, withDiscoveryInfo: ["version":"1"])
        await drain()
        precondition(exchange.peers == [peer])
        var accepted = false
        var acceptedSession: MCSession?
        exchange.advertiser(advertiser, didReceiveInvitationFromPeer: peer, withContext: Data("spotcode-card-v1".utf8)) { answer, session in accepted = answer; acceptedSession = session }
        await drain()
        precondition(!accepted && exchange.invitationName == "Remote")
        exchange.respond(accept: true)
        precondition(accepted)
        let session = acceptedSession!
        session.connectedPeers = [peer]
        exchange.session(session, peer: peer, didChange: .connected)
        await drain()
        precondition(session.sent.count == 1)
        precondition(NearbyCardMessage.decode(session.sent[0].0)?.ownerID == local)
        let data = try JSONEncoder().encode(NearbyCardMessage(version: 1, kind: "card", ownerID: remote))
        exchange.session(session, didReceive: data, fromPeer: stranger)
        await drain()
        precondition(exchange.receivedOwnerID == nil)
        exchange.session(session, didReceive: data, fromPeer: peer)
        await drain()
        precondition(exchange.receivedOwnerID == remote)
        exchange.saved(remote)
        precondition(NearbyCardMessage.decode(session.sent.last!.0)?.kind == "saved")
        let ack = try JSONEncoder().encode(NearbyCardMessage(version: 1, kind: "saved", ownerID: local))
        exchange.session(session, didReceive: ack, fromPeer: peer)
        await drain()
        precondition(exchange.peerSaved)
        precondition(NearbyCardMessage.decode(Data(repeating: 65, count: 1025)) == nil)
        let unsupported = try JSONEncoder().encode(NearbyCardMessage(version: 9, kind: "card", ownerID: remote))
        precondition(NearbyCardMessage.decode(unsupported) == nil)
        exchange.stop()
        precondition(!browser.active && !advertiser.active && exchange.peers.isEmpty)
        exchange.start(ownerID: local, handle: "Local")
        exchange.session(session, didReceive: data, fromPeer: peer)
        exchange.browser(browser, foundPeer: stranger, withDiscoveryInfo: ["version":"1"])
        await drain()
        precondition(exchange.receivedOwnerID == nil && exchange.peers.isEmpty)
        let nextBrowser = MCNearbyServiceBrowser.latest!
        exchange.browser(nextBrowser, foundPeer: peer, withDiscoveryInfo: ["version":"1"])
        await drain()
        exchange.invite(peer)
        precondition(nextBrowser.invited == peer)
        exchange.stop()
        // A failed start must release the stale session so retry starts both services.
        for advertising in [false, true] {
            exchange.start(ownerID: local, handle: "Local")
            let failedBrowser = MCNearbyServiceBrowser.latest!
            let failedAdvertiser = MCNearbyServiceAdvertiser.latest!
            let error = NSError(domain: "test", code: 1)
            if advertising { exchange.advertiser(failedAdvertiser, didNotStartAdvertisingPeer: error) }
            else { exchange.browser(failedBrowser, didNotStartBrowsingForPeers: error) }
            await drain()
            precondition(exchange.discoveryFailed && !failedBrowser.active && !failedAdvertiser.active)
            exchange.start(ownerID: local, handle: "Local")
            precondition(!exchange.discoveryFailed && MCNearbyServiceBrowser.latest !== failedBrowser)
            precondition(MCNearbyServiceBrowser.latest.active && MCNearbyServiceAdvertiser.latest.active)
            exchange.browser(failedBrowser, foundPeer: stranger, withDiscoveryInfo: ["version":"1"])
            await drain()
            precondition(exchange.peers.isEmpty)
            exchange.stop()
        }
        print("PASS nearby exchange: consent before send, expected peer only, card/receipt validation, size/version bounds, stop and stale-session isolation")
    }
}
