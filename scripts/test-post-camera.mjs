import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const source = fs.readFileSync('ios/App/App/PostCamera.swift', 'utf8');
const engine = source.slice(source.indexOf('final class PostCamera:'), source.indexOf('private final class PostCameraPreviewUIView'));
const mocks = `
import Foundation
import Combine
class UIImage { init?(data: Data) { if data.isEmpty { return nil } } }
enum AVMediaType { case video }
enum AVCaptureVideoOrientation { case portrait }
protocol AVCapturePhotoCaptureDelegate: AnyObject {
 func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?)
 func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor settings: AVCaptureResolvedPhotoSettings, error: Error?)
}
class AVCaptureDevice {
 enum DeviceType { case builtInWideAngleCamera }; enum Position { case back }
 enum Authorization { case authorized, notDetermined, denied, restricted }
 static var authorization: Authorization = .authorized
 static var available = true
 static var pendingPermission: ((Bool) -> Void)?
 static func authorizationStatus(for type: AVMediaType) -> Authorization { authorization }
 static func requestAccess(for type: AVMediaType, completionHandler: @escaping (Bool) -> Void) { pendingPermission = completionHandler }
 static func \`default\`(_ type: DeviceType, for media: AVMediaType, position: Position) -> AVCaptureDevice? { available ? AVCaptureDevice() : nil }
 static func \`default\`(for media: AVMediaType) -> AVCaptureDevice? { available ? AVCaptureDevice() : nil }
}
class AVCaptureDeviceInput { init(device: AVCaptureDevice) throws {} }
class AVCaptureSession: NSObject {
 enum Preset { case photo }
 static let wasInterruptedNotification = Notification.Name("interrupted")
 static let runtimeErrorNotification = Notification.Name("runtimeError")
 var inputs: [AVCaptureDeviceInput] = []; var outputs: [AVCapturePhotoOutput] = []
 var sessionPreset: Preset = .photo
 var isRunning = false; var starts = 0; var stops = 0; var configuring = false
 func beginConfiguration() { configuring = true }
 func commitConfiguration() { configuring = false }
 func canSetSessionPreset(_ preset: Preset) -> Bool { true }
 func canAddInput(_ input: AVCaptureDeviceInput) -> Bool { true }
 func canAddOutput(_ output: AVCapturePhotoOutput) -> Bool { true }
 func addInput(_ input: AVCaptureDeviceInput) { inputs.append(input) }
 func addOutput(_ output: AVCapturePhotoOutput) { outputs.append(output) }
 func removeInput(_ input: AVCaptureDeviceInput) { inputs.removeAll() }
 func removeOutput(_ output: AVCapturePhotoOutput) { outputs.removeAll() }
 func startRunning() { precondition(!Thread.isMainThread && !configuring); starts += 1; isRunning = true }
 func stopRunning() { precondition(!Thread.isMainThread); stops += 1; isRunning = false }
}
class AVCaptureConnection {
 var isActive = true; var isEnabled = true; var isVideoOrientationSupported = true
 var videoOrientation: AVCaptureVideoOrientation = .portrait
}
class AVCapturePhotoSettings {}
class AVCaptureResolvedPhotoSettings {}
class AVCapturePhoto { func fileDataRepresentation() -> Data? { Data([1]) } }
class AVCapturePhotoOutput {
 let link = AVCaptureConnection()
 var count = 0
 weak var delegate: AVCapturePhotoCaptureDelegate?
 func connection(with media: AVMediaType) -> AVCaptureConnection? { link }
 func capturePhoto(with settings: AVCapturePhotoSettings, delegate: AVCapturePhotoCaptureDelegate) { count += 1; self.delegate = delegate }
 func finish(error: Error? = nil) {
  delegate?.photoOutput(self, didFinishProcessingPhoto: AVCapturePhoto(), error: error)
  delegate?.photoOutput(self, didFinishCaptureFor: AVCaptureResolvedPhotoSettings(), error: error)
 }
}
`;
const tests = `
@main struct Checks {
 @MainActor static func settle() async { try! await Task.sleep(nanoseconds: 80_000_000) }
 @MainActor static func main() async {
  let camera = PostCamera()
  camera.start(); await settle()
  precondition(camera.ready && camera.session.isRunning)
  camera.capture(orientation: .portrait); camera.capture(orientation: .portrait); await settle()
  let output = camera.session.outputs[0]
  precondition(output.count == 1, "Duplicate shutter taps must capture once")
  output.finish(); await settle()
  precondition(camera.image != nil && !camera.session.isRunning, "Review stops the live camera")
  camera.start(); await settle()
  precondition(camera.image == nil && camera.ready, "Retake must restart live capture")
  output.link.isActive = false
  camera.capture(orientation: .portrait); await settle()
  precondition(output.count == 1 && camera.message != nil, "Disconnected camera must not capture")
  camera.stop(); await settle()
  precondition(!camera.session.isRunning)
  AVCaptureDevice.authorization = .denied
  let denied = PostCamera(); denied.start(); await settle()
  precondition(denied.needsSettings && !denied.ready && denied.session.starts == 0)
  denied.stop()
  AVCaptureDevice.authorization = .notDetermined
  let cancelled = PostCamera(); cancelled.start(); cancelled.stop(); await settle()
  AVCaptureDevice.pendingPermission?(true); await settle()
  precondition(cancelled.session.starts == 0, "Permission result after dismissal must not start camera")
  AVCaptureDevice.authorization = .authorized; AVCaptureDevice.available = false
  let missing = PostCamera(); missing.start(); await settle()
  precondition(missing.message != nil && !missing.ready && missing.session.starts == 0)
  AVCaptureDevice.available = true
  missing.start(); await settle()
  precondition(missing.ready)
  missing.capture(orientation: .portrait); await settle()
  missing.session.outputs[0].finish(error: NSError(domain: "camera", code: 1)); await settle()
  precondition(missing.image == nil && missing.message != nil)
  missing.stop(); await settle()
  print("PASS camera permission, dismissal race, missing device, capture failure, review, retake, duplicate shutter, inactive connection, background queue")
 }
}
`;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spotcode-camera-tests-'));
try {
 const file=path.join(dir,'Checks.swift'); fs.writeFileSync(file,mocks+engine+tests);
 execFileSync('swiftc',['-parse-as-library','-module-cache-path',path.join(dir,'cache'),file,'-o',path.join(dir,'checks')],{stdio:'inherit'});
 execFileSync(path.join(dir,'checks'),{stdio:'inherit'});
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
