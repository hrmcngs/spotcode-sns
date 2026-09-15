import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const source = fs.readFileSync('ios/App/App/NativeViews.swift', 'utf8');
const presenter = source.slice(source.indexOf('private struct BusinessCardFullscreenPresenter'), source.indexOf('private struct BusinessCardView:'));
assert.match(presenter, /FullscreenBusinessCardView\(card: card\) \{ \[weak coordinator\] in[\s\S]*?coordinator\?\.dismiss\(\)\s*isPresented = false/);
const coordinator = presenter.slice(presenter.indexOf('    final class Coordinator'), presenter.lastIndexOf('\n}'));
const swift = `
import Foundation
class UIViewController {
 var dismissals = 0
 var onDismiss: (() -> Void)?
 func dismiss(animated: Bool) { dismissals += 1; onDismiss?() }
}
${coordinator}
let coordinator = Coordinator()
let host = UIViewController()
coordinator.host = host
coordinator.wantsPresentation = true
host.onDismiss = {
 precondition(!coordinator.wantsPresentation, "Queued updates must see closed intent")
 precondition(coordinator.host == nil, "Release the host before dismissal reenters UI updates")
}
coordinator.dismiss()
precondition(host.dismissals == 1, "Close must dismiss without any SwiftUI update")
coordinator.dismiss()
precondition(host.dismissals == 1, "Repeated Close must be safe")
let second = UIViewController()
coordinator.host = second
coordinator.wantsPresentation = true
coordinator.dismiss()
precondition(second.dismissals == 1, "Opening and closing again must work")
print("PASS immediate fullscreen dismissal, cleared intent, repeated Close, reopen and close")
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-card-close-'));
try {
 const file = path.join(dir, 'Checks.swift'); fs.writeFileSync(file, swift);
 execFileSync('swift', ['-module-cache-path', path.join(dir, 'cache'), file], { stdio: 'inherit' });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
