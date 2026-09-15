import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const model = fs.readFileSync('ios/App/App/AppModel.swift', 'utf8');
const views = fs.readFileSync('ios/App/App/NativeViews.swift', 'utf8');
const cache = model.slice(model.indexOf('enum TimelinePreviewCache'), model.indexOf('@MainActor'));
const images = views.slice(views.indexOf('private let inlineImageCache'), views.indexOf('private struct ProfileImagePicker'));
// Run the production ImageIO decoder on macOS, replacing only UIKit's wrapper.
const source = `
import Foundation
import ImageIO
import CoreGraphics
final class UIImage: NSObject {
    let cgImage: CGImage
    init(cgImage: CGImage) { self.cgImage = cgImage }
}
${cache}
${images}
struct Row: Codable, Equatable { let id: Int; let body: String }
let rows = (0..<100).map { Row(id: $0, body: "投稿, \\\"text\\\"\\n") }
let saved = TimelinePreviewCache.encode(rows)
precondition(try! JSONDecoder().decode([Row].self, from: saved) == Array(rows.prefix(24)))
let large = (0..<24).map { Row(id: $0, body: String(repeating: "x", count: 300_000)) }
let limited = TimelinePreviewCache.encode(large)
precondition(limited.count <= TimelinePreviewCache.maxBytes)
let restored = try! JSONDecoder().decode([Row].self, from: limited)
precondition(restored.count > 0 && restored.count < 24)
precondition(restored == Array(large.prefix(restored.count)))
let oversized = [Row(id: 1, body: String(repeating: "x", count: TimelinePreviewCache.maxBytes)), rows[0]]
precondition(String(data: TimelinePreviewCache.encode(oversized), encoding: .utf8) == "[]")
precondition(String(data: TimelinePreviewCache.encode([Row]()), encoding: .utf8) == "[]")
let context = CGContext(data: nil, width: 3000, height: 1500, bitsPerComponent: 8,
    bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
let bytes = NSMutableData()
let destination = CGImageDestinationCreateWithData(bytes, "public.png" as CFString, 1, nil)!
CGImageDestinationAddImage(destination, context.makeImage()!, nil)
precondition(CGImageDestinationFinalize(destination))
let url = "data:image/png;base64," + (bytes as Data).base64EncodedString()
let avatar = decodedDataURLImage(url, maxPixelSize: 126)!
precondition(avatar.cgImage.width == 126 && avatar.cgImage.height == 63)
precondition(decodedDataURLImage(url, maxPixelSize: 126) === avatar)
let photo = decodedDataURLImage(url)!
precondition(photo.cgImage.width == 1080 && photo.cgImage.height == 540)
precondition(photo !== avatar)
precondition(decodedDataURLImage(nil) == nil)
precondition(decodedDataURLImage("https://example.com/avatar.png") == nil)
precondition(decodedDataURLImage("data:image/png;base64,broken") == nil)
inlineImageCache.removeAllObjects()
precondition(decodedDataURLImage(url, maxPixelSize: 126) !== avatar)
print("PASS bounded preview count/bytes, contiguous rows, oversized/empty posts, image downsampling, reuse, eviction reload, invalid images")
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-performance-'));
try {
  const file = path.join(dir, 'Checks.swift');
  fs.writeFileSync(file, source);
  execFileSync('swiftc', ['-module-cache-path', path.join(dir, 'cache'), file, '-o', path.join(dir, 'checks')], { stdio: 'inherit' });
  execFileSync(path.join(dir, 'checks'), { stdio: 'inherit' });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
