import SwiftUI
import AVFoundation
import UIKit

/// The serial queue owns capture configuration and lifecycle; UI updates run on main.
final class PostCamera: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "spotcode.post-camera")
    private let output = AVCapturePhotoOutput()
    private var active = false
    private var configured = false
    private var takingPhoto = false
    @Published private(set) var ready = false
    @Published private(set) var image: UIImage?
    @Published private(set) var message: String?
    @Published private(set) var needsSettings = false

    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVCaptureSession.wasInterruptedNotification, object: session)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted), name: AVCaptureSession.runtimeErrorNotification, object: session)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
    @objc private func interrupted() {
        queue.async {
            self.configured = false
            if self.session.isRunning { self.session.stopRunning() }
        }
        fail("カメラの接続が中断されました。再接続して再試行してください。")
    }

    func start() {
        image = nil; message = nil; ready = false; needsSettings = false
        queue.async { self.active = true }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configureAndStart()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                guard let self else { return }
                if allowed { self.configureAndStart() }
                else { self.fail("カメラの使用を許可してください。システム設定から変更できます。", settings: true) }
            }
        default: fail("カメラの使用を許可してください。システム設定から変更できます。", settings: true)
        }
    }
    func stop() {
        ready = false
        queue.async {
            self.active = false
            if self.session.isRunning { self.session.stopRunning() }
        }
    }
    private func fail(_ key: String, settings: Bool = false) {
        DispatchQueue.main.async {
            self.ready = false
            self.message = NSLocalizedString(key, comment: "")
            self.needsSettings = settings
        }
    }
    private func configureAndStart() {
        queue.async {
            guard self.active else { return }
            do {
                if !self.configured {
                    self.session.beginConfiguration()
                    defer { self.session.commitConfiguration() }
                    for input in self.session.inputs { self.session.removeInput(input) }
                    for output in self.session.outputs { self.session.removeOutput(output) }
                    if self.session.canSetSessionPreset(.photo) { self.session.sessionPreset = .photo }
                    let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                        ?? AVCaptureDevice.default(for: .video)
                    guard let device else {
                        self.fail("カメラが見つかりません。カメラを接続するか、写真ライブラリから選択してください。")
                        return
                    }
                    let input = try AVCaptureDeviceInput(device: device)
                    guard self.session.canAddInput(input), self.session.canAddOutput(self.output) else {
                        self.fail("カメラを開始できません。他のアプリでの使用を終了して再試行してください。")
                        return
                    }
                    self.session.addInput(input)
                    self.session.addOutput(self.output)
                    self.configured = true
                }
                self.session.startRunning()
                let running = self.session.isRunning
                DispatchQueue.main.async { self.ready = running }
                if !running { self.fail("カメラを開始できません。他のアプリでの使用を終了して再試行してください。") }
            } catch { self.fail("カメラを開始できません。他のアプリでの使用を終了して再試行してください。") }
        }
    }
    func capture(orientation: AVCaptureVideoOrientation) {
        ready = false
        queue.async {
            guard self.active, self.session.isRunning, !self.takingPhoto else { return }
            guard let connection = self.output.connection(with: .video), connection.isActive, connection.isEnabled else {
                self.fail("カメラの接続が中断されました。再接続して再試行してください。")
                return
            }
            self.takingPhoto = true
            if connection.isVideoOrientationSupported {
                connection.videoOrientation = orientation
            }
            self.output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let image = error == nil ? photo.fileDataRepresentation().flatMap { UIImage(data: $0) } : nil
        queue.async {
            guard self.active else { self.takingPhoto = false; return }
            if let image {
                self.session.stopRunning()
                DispatchQueue.main.async { self.image = image; self.ready = false }
            } else { self.fail("撮影できませんでした。もう一度お試しください。") }
        }
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        queue.async { self.takingPhoto = false }
        if error != nil { fail("撮影できませんでした。もう一度お試しください。") }
    }
}

private final class PostCameraPreviewUIView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    override func layoutSubviews() {
        super.layoutSubviews()
        if let connection = preview.connection, connection.isVideoOrientationSupported {
            connection.videoOrientation = PostCameraSheet.orientation(window?.windowScene?.interfaceOrientation)
        }
    }
}
private struct PostCameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PostCameraPreviewUIView {
        let view = PostCameraPreviewUIView()
        view.preview.session = session
        view.preview.videoGravity = .resizeAspect
        return view
    }
    func updateUIView(_ view: PostCameraPreviewUIView, context: Context) {}
}

struct PostCameraSheet: View {
    let attach: (UIImage) -> Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var camera = PostCamera()
    @State private var attachmentFailed = false
    static func orientation(_ value: UIInterfaceOrientation?) -> AVCaptureVideoOrientation {
        switch value {
        case .landscapeLeft: return .landscapeLeft
        case .landscapeRight: return .landscapeRight
        case .portraitUpsideDown: return .portraitUpsideDown
        default:
            #if targetEnvironment(macCatalyst)
            return .landscapeRight
            #else
            return .portrait
            #endif
        }
    }
    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                if let image = camera.image {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
                    if attachmentFailed { Text(NSLocalizedString("写真を添付できませんでした。添付は4枚までです。", comment: "")) }
                    HStack {
                        Button(NSLocalizedString("撮り直す", comment: "")) { attachmentFailed = false; camera.start() }
                        Button(NSLocalizedString("この写真を添付", comment: "")) {
                            if attach(image) { dismiss() } else { attachmentFailed = true }
                        }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    PostCameraPreview(session: camera.session).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color.black).accessibilityLabel(NSLocalizedString("カメラのプレビュー", comment: ""))
                    if let message = camera.message {
                        Text(message).multilineTextAlignment(.center).accessibilityAddTraits(.updatesFrequently)
                        if camera.needsSettings {
                            Button(NSLocalizedString("カメラの設定を開く", comment: "")) {
                                #if targetEnvironment(macCatalyst)
                                let value = "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
                                #else
                                let value = UIApplication.openSettingsURLString
                                #endif
                                if let url = URL(string: value) { UIApplication.shared.open(url) }
                            }
                        }
                        Button(NSLocalizedString("再試行", comment: "")) { camera.start() }
                    }
                    Button {
                        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
                        camera.capture(orientation: Self.orientation(scene?.interfaceOrientation))
                    } label: { Label(NSLocalizedString("撮影", comment: ""), systemImage: "camera") }
                    .buttonStyle(.borderedProminent).disabled(!camera.ready)
                }
            }.padding()
                .navigationTitle(NSLocalizedString("写真を撮影", comment: ""))
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(NSLocalizedString("Cancel", comment: "")) { dismiss() } } }
        }.navigationViewStyle(.stack)
        #if targetEnvironment(macCatalyst)
        .frame(minWidth: 440, idealWidth: 640, minHeight: 400, idealHeight: 540)
        #endif
        .onAppear { camera.start() }
        .onDisappear { camera.stop() }
        .onChange(of: scenePhase) { phase in
            if phase == .active, camera.image == nil { camera.start() }
            else if phase != .active { camera.stop() }
        }
    }
}
