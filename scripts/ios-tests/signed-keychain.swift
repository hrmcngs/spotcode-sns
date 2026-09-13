let account = CommandLine.arguments[2]
let expected = Data([19, 42, 83])
do {
    switch CommandLine.arguments[1] {
    case "write": try KeychainStore.save(expected, account: account)
    case "read":
        guard try KeychainStore.read(account: account) == expected else { fatalError("fixture missing") }
    case "delete": KeychainStore.delete(account: account)
    default: fatalError("unknown probe operation")
    }
    print("Signed probe build \(probeBuild) passed")
} catch {
    print("Keychain probe status: \((error as NSError).code)")
    exit(1)
}
