import Foundation
import Security

enum KeychainStore {
    private static let service = "computer.ngs.hrmc.Spotcode"

    private static func query(account: String, legacy: Bool = false) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        #if targetEnvironment(macCatalyst)
        // Use the entitlement-based store rather than a binary-specific legacy
        // macOS ACL. Existing legacy items are migrated on successful reads.
        if !legacy { query[kSecUseDataProtectionKeychain as String] = true }
        #endif
        if !legacy, let group = Bundle.main.object(forInfoDictionaryKey: "SpotcodeKeychainAccessGroup") as? String,
           !group.isEmpty, !group.contains("$(") {
            query[kSecAttrAccessGroup as String] = group
        }
        return query
    }

    static func save(_ data: Data, account: String) throws {
        let query = query(account: account)
        let updates = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, updates as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw failure(status) }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecDuplicateItem { status = SecItemUpdate(query as CFDictionary, updates as CFDictionary) }
        guard status == errSecSuccess else { throw failure(status) }
    }

    // nil means only "not found". Locked/denied reads must remain retryable.
    static func read(account: String) throws -> Data? {
        if let data = try readQuery(query(account: account)) { return data }
        #if targetEnvironment(macCatalyst)
        if let legacy = try readQuery(query(account: account, legacy: true)) {
            try save(legacy, account: account)
            return legacy
        }
        #endif
        return nil
    }

    private static func readQuery(_ query: [String: Any]) throws -> Data? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw failure(status) }
        guard let data = result as? Data else { throw failure(errSecDecode) }
        return data
    }

    static func load(account: String) -> Data? { try? read(account: account) }

    static func delete(account: String) {
        SecItemDelete(query(account: account) as CFDictionary)
        #if targetEnvironment(macCatalyst)
        // Explicit logout must also remove the migration source.
        SecItemDelete(query(account: account, legacy: true) as CFDictionary)
        #endif
    }

    private static func failure(_ status: OSStatus) -> NSError {
        NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
}
