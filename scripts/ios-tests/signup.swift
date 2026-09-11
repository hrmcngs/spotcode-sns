func rejects(email: String = "person@example.com", password: String = "password123", handle: String = "person", name: String = "Person") {
    do { _ = try SignupInput(email: email, password: password, handle: handle, name: name); fatalError("Invalid signup was accepted") }
    catch {}
}
rejects(email: "person")
rejects(email: "person @example.com")
rejects(email: "dev.test.account@spotcode-sns.local")
rejects(password: "short")
rejects(handle: "a")
rejects(handle: "-person")
rejects(handle: "not a handle")
rejects(handle: String(repeating: "a", count: 21))
rejects(name: "   ")
rejects(name: String(repeating: "a", count: 41))
let input = try SignupInput(email: " Person@Example.com \n", password: " password ", handle: " User_123 ", name: " Person ")
let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as! [String: Any]
precondition(object["email"] as? String == "person@example.com")
precondition(object["password"] as? String == " password ")
let metadata = object["data"] as! [String: String]
precondition(metadata == ["handle": "user_123", "name": "Person"])
precondition(Set(object.keys) == ["email", "password", "data"])
let id = "11111111-1111-1111-1111-111111111111"
let confirmed = Data("{\"access_token\":\"access\",\"refresh_token\":\"refresh\",\"user\":{\"id\":\"\(id)\",\"email\":\"person@example.com\"}}".utf8)
let immediate = try JSONDecoder().decode(SignupResponse.self, from: confirmed)
precondition(immediate.session?.accessToken == "access")
precondition(immediate.session?.user.id.uuidString.lowercased() == id)
for value in ["{\"id\":\"\(id)\",\"email\":\"person@example.com\"}", "{\"user\":{\"id\":\"\(id)\"},\"access_token\":null,\"refresh_token\":null}"] {
    let pending = try JSONDecoder().decode(SignupResponse.self, from: Data(value.utf8))
    precondition(pending.session == nil)
    precondition(pending.id != nil || pending.user != nil)
}
print("Signup validation, normalized metadata, password preservation, and email-confirmation/session decoding passed.")
