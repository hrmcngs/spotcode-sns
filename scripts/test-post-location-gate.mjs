import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Exercise the production gate with real CoreLocation distances and a fake GPS.
const source = readFileSync(new URL('../ios/App/App/NativeViews.swift', import.meta.url), 'utf8');
const gate = source.slice(source.indexOf('private final class PostLocationGate:'), source.indexOf('private struct PhotoLibraryPicker'))
  .replaceAll('CLLocationManagerDelegate', 'FakeLocationDelegate')
  .replaceAll('CLLocationManager', 'FakeLocationManager');
const runner = `
import Foundation
import Combine
import CoreLocation
enum FakeAuthorizationStatus { case notDetermined, authorizedWhenInUse, authorizedAlways, denied, restricted }
protocol FakeLocationDelegate: AnyObject {}
final class FakeLocationManager {
    static var last: FakeLocationManager!
    weak var delegate: FakeLocationDelegate?
    var desiredAccuracy: Double = 0
    var distanceFilter: Double = 0
    var authorizationStatus: FakeAuthorizationStatus = .authorizedWhenInUse
    var starts = 0
    var stops = 0
    init() { Self.last = self }
    func requestWhenInUseAuthorization() {}
    func startUpdatingLocation() { starts += 1 }
    func stopUpdatingLocation() { stops += 1 }
}
struct Spot { let lat: Double; let lng: Double }
${gate}
private let gate = PostLocationGate.shared
let manager = FakeLocationManager.last!
let first = UUID(), second = UUID()
let spot = Spot(lat: 35, lng: 139)
func fix(_ lat: Double, accuracy: Double = 5, age: Double = 0) -> CLLocation {
    CLLocation(coordinate: .init(latitude: lat, longitude: 139), altitude: 0,
               horizontalAccuracy: accuracy, verticalAccuracy: 5, timestamp: Date().addingTimeInterval(-age))
}
func update(_ location: CLLocation) { gate.locationManager(manager, didUpdateLocations: [location]) }
gate.observe(first)
gate.observe(second)
assert(manager.starts == 1, "Rows must share one GPS subscription")
update(fix(35.002))
assert(!gate.isNear(spot), "Outside 100m stays locked")
update(fix(35.0001))
assert(gate.isNear(spot), "Walking into range must unlock without restart")
update(fix(35.002))
assert(!gate.isNear(spot), "Walking away must relock")
gate.locationManager(manager, didFailWithError: CLError(.locationUnknown))
assert(gate.location == nil && gate.errorMessage != nil)
update(fix(35))
assert(gate.isNear(spot) && gate.errorMessage == nil, "Transient GPS errors recover")
gate.setActive(false)
update(fix(35))
assert(!gate.isNear(spot), "Background callbacks must not restore a fix")
gate.setActive(true)
assert(manager.starts == 2)
update(fix(35, age: 121))
update(fix(35, accuracy: -1))
assert(!gate.isNear(spot), "Old and invalid fixes must not unlock")
manager.authorizationStatus = .denied
gate.locationManagerDidChangeAuthorization(manager)
assert(gate.errorMessage != nil && !gate.isNear(spot))
manager.authorizationStatus = .authorizedWhenInUse
gate.locationManagerDidChangeAuthorization(manager)
update(fix(35))
assert(gate.isNear(spot), "Restoring permission must recover")
gate.locationManager(manager, didFailWithError: CLError(.network))
gate.request()
update(fix(35))
assert(gate.isNear(spot), "Retry must recover a stopped request")
let stops = manager.stops
gate.removeObserver(first)
assert(manager.stops == stops, "Another visible reader still needs GPS")
gate.removeObserver(second)
assert(manager.stops == stops + 1 && gate.location == nil)
print("Post location gate regression tests passed")
`;
const dir = mkdtempSync(join(tmpdir(), 'spotcode-location-'));
try {
  writeFileSync(join(dir, 'main.swift'), runner);
  execFileSync('swift', ['-module-cache-path', join(dir, 'cache'), join(dir, 'main.swift')], { stdio: 'inherit' });
} finally { rmSync(dir, { recursive: true, force: true }); }
