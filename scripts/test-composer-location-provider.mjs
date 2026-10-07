import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = readFileSync(new URL('../ios/App/App/NativeViews.swift', import.meta.url), 'utf8');
const provider = source.slice(source.indexOf('private final class ComposerLocationProvider:'), source.indexOf('// Shared reader-location gate'))
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
    var authorizationStatus: FakeAuthorizationStatus = .authorizedWhenInUse
    var location: CLLocation?
    var authorizationRequests = 0
    var starts = 0
    var stops = 0
    init() { Self.last = self }
    func requestWhenInUseAuthorization() { authorizationRequests += 1 }
    func startUpdatingLocation() { starts += 1 }
    func stopUpdatingLocation() { stops += 1 }
}
struct Spot { let lat: Double; let lng: Double; let label: String; let address: String? }

${provider}

func fix(_ lat: Double, accuracy: Double = 35, age: Double = 0) -> CLLocation {
    CLLocation(coordinate: .init(latitude: lat, longitude: 139), altitude: 0,
               horizontalAccuracy: accuracy, verticalAccuracy: 5, timestamp: Date().addingTimeInterval(-age))
}

private let provider = ComposerLocationProvider()
private let manager = FakeLocationManager.last!
manager.authorizationStatus = .notDetermined
provider.request()
assert(provider.isLocating, "Request should make the button visibly busy")
assert(manager.authorizationRequests == 1, "Request should trigger permission prompt")

manager.authorizationStatus = .authorizedWhenInUse
provider.locationManagerDidChangeAuthorization(manager)
assert(manager.starts == 1, "Authorization should start GPS updates")
provider.locationManager(manager, didUpdateLocations: [fix(35.0)])
assert(provider.spot?.lat == 35.0 && !provider.isLocating && manager.stops == 1, "GPS fix should populate the composer spot")

manager.location = fix(36.0)
provider.request()
assert(provider.spot?.lat == 36.0, "A recent cached fix should make Use current location responsive immediately")

manager.location = fix(37.0, age: 121)
provider.request()
assert(provider.spot?.lat == 36.0, "Old cached fixes must not replace the current spot")

manager.authorizationStatus = .denied
provider.request()
assert(provider.errorMessage != nil && !provider.isLocating, "Denied permission should show a retryable error")

print("Composer location provider regression tests passed")
`;

const dir = mkdtempSync(join(tmpdir(), 'spotcode-composer-location-'));
try {
  writeFileSync(join(dir, 'main.swift'), runner);
  execFileSync('swift', ['-module-cache-path', join(dir, 'cache'), join(dir, 'main.swift')], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
