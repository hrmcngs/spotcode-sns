let app = CommandLine.arguments[1]
var language = "en"
func NSLocalizedString(_ key: String, comment: String) -> String {
    Bundle(path: app + "/" + language + ".lproj")!.localizedString(forKey: key, value: nil, table: nil)
}

func matches(_ pattern: String, _ value: String) throws -> [String] {
    let regex = try NSRegularExpression(pattern: pattern)
    return regex.matches(in: value, range: NSRange(value.startIndex..., in: value)).map {
        String(value[Range($0.range, in: value)!])
    }
}
let stringPattern = #""(?:[^"\\\n]|\\.)*""#
func dictionary(_ language: String) throws -> [String: String] {
    let source = try String(contentsOfFile: app + "/" + language + ".lproj/Localizable.strings", encoding: .utf8)
    let entries = try matches(stringPattern + #"\s*=\s*"# + stringPattern + #"\s*;"#, source)
    var result: [String: String] = [:]
    for entry in entries {
        let parts = try matches(stringPattern, entry)
        let key = try JSONDecoder().decode(String.self, from: Data(parts[0].utf8))
        let value = try JSONDecoder().decode(String.self, from: Data(parts[1].utf8))
        precondition(result[key] == nil, "Duplicate \(language) key: \(key)")
        result[key] = value
    }
    precondition(!result.isEmpty, "No translations parsed")
    return result
}
let en = try dictionary("en"), ja = try dictionary("ja")
for filename in ["AppModel.swift", "SupabaseService.swift", "NativeViews.swift", "NativeModels.swift"] {
    let source = try String(contentsOfFile: app + "/" + filename, encoding: .utf8)
    for line in source.components(separatedBy: .newlines) {
        if line.trimmingCharacters(in: .whitespaces).hasPrefix("//") { continue }
        for token in try matches(stringPattern, line) {
            let hasJapanese = token.range(of: "[ぁ-んァ-ヶ一-龠]", options: .regularExpression) != nil
            // NativeModels includes Japanese search patterns rather than UI strings.
            guard (hasJapanese && filename != "NativeModels.swift") || token.hasPrefix("\"signup.") else { continue }
            precondition(!token.contains(#"\("#), "Use a stable format key: \(token)")
            let key = try JSONDecoder().decode(String.self, from: Data(token.utf8))
            guard let english = en[key], ja[key] != nil else { fatalError("Missing translation: \(key)") }
            precondition(english.range(of: "[ぁ-んァ-ヶ一-龠]", options: .regularExpression) == nil, "Japanese in English: \(key)")
            let format = #"%(?:\d+\$)?(?:lld|ld|d|@)"#
            let original = try matches(format, key), translated = try matches(format, english)
            precondition(original == translated, "Format mismatch: \(key)")
        }
    }
}
print("Native translation coverage and format checks passed.")

for lang in ["en", "ja"] {
    language = lang
    let expected = NSLocalizedString("メールアドレス／ログイン名、またはパスワードが正しくありません。", comment: "")
    for code in [400, 401] {
        for message in ["Invalid login credentials", "{\"message\":\"Invalid login credentials\"}"] {
            let error = NSError(domain: "Supabase", code: code, userInfo: [NSLocalizedDescriptionKey: message])
            precondition(authenticationMessage(for: error) == expected)
        }
    }
    precondition(authenticationMessage(for: URLError(.timedOut)) == NSLocalizedString("ログイン処理がタイムアウトしました。もう一度お試しください。", comment: ""))
    precondition(authenticationMessage(for: URLError(.notConnectedToInternet)) == NSLocalizedString("サーバーに接続できません。通信状態を確認して、もう一度お試しください。", comment: ""))
    let title = String(format: NSLocalizedString("%@さんが%@で投稿しました", comment: ""), "Alice", "Tokyo")
    precondition(title == (lang == "en" ? "Alice posted in Tokyo" : "AliceさんがTokyoで投稿しました"))
    let due = String(format: NSLocalizedString("あと%lld日", comment: ""), Int64(3))
    precondition(due == (lang == "en" ? "3 days left" : "あと3日"))
}
print("Native localization: English/Japanese authentication, notifications, and deadline checks passed.")
