const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');

// electron-updater is a runtime dep, but it's only meaningful for
// PACKAGED builds — in `npm run start:electron` (dev) it would just
// log "Skip checkForUpdatesAndNotify because application is not
// packed" and bail. Guard the require so dev runs don't crash when
// the dep isn't installed yet on a clean clone.
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (_) { /* not installed yet — `npm install` will fix */ }

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    backgroundColor: '#0d0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  return win;
}

function wireAutoUpdater(win) {
  if (!autoUpdater) return;
  // Source: GitHub Releases of this repo. Bumping `version` in
  // package.json + running `npm run release` publishes a new dmg/zip
  // up there; installed apps notice on next launch.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    // Surface a native dialog so the user knows something is coming.
    // Download runs in the background; we don't block them.
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'アップデートがあります',
      message: 'spotcode-sns v' + info.version + ' が公開されました。',
      detail: 'バックグラウンドでダウンロードします。完了したら再起動でインストールします。',
      buttons: ['OK'],
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'アップデート準備完了',
      message: 'v' + info.version + ' のダウンロードが完了しました。',
      detail: '今すぐ再起動してインストールしますか?',
      buttons: ['今すぐ再起動', '後で'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    // Don't pop a dialog for transient network errors — just log.
    // The user can always re-launch later to retry.
    console.warn('autoUpdater error', err && err.message);
  });

  // checkForUpdatesAndNotify is a no-op in dev / unpacked runs, so
  // calling it unconditionally on every launch is fine.
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
}

app.whenReady().then(() => {
  const win = createWindow();
  wireAutoUpdater(win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
