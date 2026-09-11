let fixture = """
[
 {"id":"11111111-1111-1111-1111-111111111111","author_id":"22222222-2222-2222-2222-222222222222","body":"Example","spot":{"lat":35.0,"lng":139.0,"label":"Example","addressDetails":{"city":"Example city","full":"Example address","road":"Example road","ward":"Example ward","chome":"1","postcode":"1000000","prefecture":"Example prefecture","houseNumber":"","missingHouseNumber":true}}},
 {"id":"33333333-3333-3333-3333-333333333333","author_id":"22222222-2222-2222-2222-222222222222","body":"No spot","spot":null}
]
"""
let posts = try JSONDecoder().decode([Post].self, from: Data(fixture.utf8))
precondition(posts.count == 2)
let encoded = try JSONEncoder().encode(posts)
let roundTrip = try JSONSerialization.jsonObject(with: encoded) as! [[String: Any]]
let spot = roundTrip[0]["spot"] as! [String: Any]
let details = spot["addressDetails"] as! [String: Any]
precondition(details["missingHouseNumber"] as? Bool == true)
precondition(details["city"] as? String == "Example city")
precondition(details["road"] as? String == "Example road")
for value in ["{\"city\":\"Native city\"}", "{\"missingHouseNumber\":false}", "null"] {
    let data = Data("{\"lat\":35,\"lng\":139,\"addressDetails\":\(value)}".utf8)
    _ = try JSONDecoder().decode(Spot.self, from: data)
}
_ = try JSONDecoder().decode(Spot.self, from: Data("{\"lat\":35,\"lng\":139}".utf8))
if CommandLine.arguments.count > 1 {
    let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    let live = try JSONDecoder().decode([Post].self, from: data)
    print("Decoded \(live.count) public API posts successfully.")
}
print("Web/native spot decoding and boolean-preserving round trip passed.")
