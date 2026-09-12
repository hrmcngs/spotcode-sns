func runParticipationTests() async throws {
    func issue(_ id: Int, pull: Bool = false, hidden: Bool = false) -> [String: Any] {
        var row: [String: Any] = ["id": id, "number": id, "title": "Team task",
            "html_url": "https://github.com/team/project/issues/\(id)",
            "repository_url": "https://api.github.com/repos/team/project", "comments": 0,
            "labels": hidden ? [["name": "spotcode-hidden"]] : [], "user": ["login": "hrmcngs"]]
        if pull { row["pull_request"] = [:] as [String: String] }
        return row
    }
    func event(_ user: String, pull: Bool = true) -> [String: Any] {
        var source: [String: Any] = ["user": ["login": user]]
        if pull { source["pull_request"] = [:] as [String: String] }
        return ["event": "cross-referenced", "actor": ["login": "different-actor"], "source": ["issue": source]]
    }
    func load(contributor: Bool = false, feature: Bool = false, privateRepo: Bool = false,
              includePrivate: Bool = false, events: [Int: [[String: Any]]] = [:],
              fail: Bool = false, repos: [String] = ["team/project"]) async throws -> GitHubIssueSearchResponse {
        try await GitHubTaskLoader.load(handle: "alice", repositories: repos, includePrivate: includePrivate) { url in
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems ?? []
            func value(_ name: String) -> String? { query.first { $0.name == name }?.value }
            let result: Any
            if url.path.hasSuffix("/project") {
                result = ["private": privateRepo, "default_branch": "main"]
            } else if url.path.hasSuffix("/issues") {
                precondition(!privateRepo || includePrivate, "Public mode must not fetch private content")
                result = [issue(1), issue(2), issue(3, pull: true), issue(4, hidden: true)]
            } else if url.path.hasSuffix("/commits") {
                if fail { throw URLError(.badServerResponse) }
                precondition(value("author") == "alice")
                result = contributor || (feature && value("sha") == "feature/test") ? [["sha": "abc"]] : []
            } else if url.path.hasSuffix("/branches") {
                result = [["name": "main"], ["name": "feature/test"]]
            } else if url.path.hasSuffix("/timeline") {
                let number = Int(url.pathComponents[url.pathComponents.count - 2])!
                let rows = events[number] ?? []
                let start = (Int(value("page")!)! - 1) * 100
                result = Array(rows.dropFirst(start).prefix(100))
            } else { fatalError("Unexpected endpoint") }
            return try JSONSerialization.data(withJSONObject: result)
        }
    }
    func ids(_ result: GitHubIssueSearchResponse) -> Set<Int> { Set(result.items.map(\.id)) }
    let committed = try await load(contributor: true)
    precondition(ids(committed) == [1, 2])
    let branch = try await load(feature: true)
    precondition(ids(branch) == [1, 2])
    let linked = try await load(events: [1: [event("ALICE")], 2: [event("bob"), event("alice", pull: false)]])
    precondition(ids(linked) == [1])
    let paged = try await load(events: [1: Array(repeating: event("bob"), count: 100) + [event("alice")]])
    precondition(ids(paged) == [1])
    let unrelated = try await load()
    precondition(unrelated.items.isEmpty)
    let publicOnly = try await load(contributor: true, privateRepo: true)
    precondition(publicOnly.items.isEmpty)
    let privateAllowed = try await load(contributor: true, privateRepo: true, includePrivate: true)
    precondition(ids(privateAllowed) == [1, 2])
    let unselected = try await load(repos: [])
    precondition(unselected.items.isEmpty)
    do { _ = try await load(fail: true); fatalError("Network errors must propagate") }
    catch is URLError {}
    print("Native tasks: commits, branches, linked PR authors, timeline pagination, hidden Issues, private visibility, selection and failures passed.")
}
Task {
    do { try await runParticipationTests(); exit(0) }
    catch { fatalError("Participation test failed: \(error)") }
}
dispatchMain()
