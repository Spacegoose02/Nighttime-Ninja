// Windows/macOS/Linux desktop wrapper. It shows the launcher (pick your server), then opens your server's web app.
const { app, BrowserWindow, Menu, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = path.join(__dirname, 'launcher', 'index.html');

// The server picked in the launcher, remembered so the camera (barcode scanning) can work with it.
const SERVER_FILE = path.join(app.getPath('userData'), 'server.json');

function savedServer() {
  try { return JSON.parse(fs.readFileSync(SERVER_FILE, 'utf8')).origin || null; } catch { return null; }
}

// Chromium only lets pages use the camera on https. Most home servers are plain http on the LAN, so treat the one
// server this app talks to as secure. This has to be set before the app starts, hence the one-time restart below.
const trusted = savedServer();
if (trusted?.startsWith('http://')) app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', trusted);

const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 600,
    title: 'Nighttime Ninja',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // Links that open a new window (recipe sources, store sites, videos) go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Remember the server once the launcher opens it (only then, so a recipe site opened in the window can't take its
  // place). A new plain-http server needs one restart to get the camera.
  let fromLauncher = false;
  win.webContents.on('will-navigate', (_event, url) => {
    fromLauncher = win.webContents.getURL().startsWith('file:') && /^https?:/.test(url);
  });
  win.webContents.on('did-navigate', (_event, url) => {
    // Where the launcher's jump ended up, after any redirect (http to https, say).
    const origin = originOf(url);
    const picked = fromLauncher;
    fromLauncher = false;
    if (!picked || !origin || !/^https?:/.test(origin) || origin === savedServer()) return;
    try {
      fs.mkdirSync(path.dirname(SERVER_FILE), { recursive: true });
      fs.writeFileSync(SERVER_FILE, JSON.stringify({ origin }));
    } catch {
      return;
    }
    if (origin.startsWith('http://') && origin !== trusted) {
      app.relaunch();
      app.exit(0);
    }
  });

  // Google blocks sign-in inside embedded browsers, so send it to the real browser and suggest pairing.
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('https://accounts.google.com')) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Nighttime Ninja',
      submenu: [
        { label: 'Home', accelerator: 'Alt+Home', click: () => win.webContents.executeJavaScript("location.pathname = '/'").catch(() => {}) },
        { label: 'Change server…', click: () => win.loadFile(LAUNCHER, { search: 'change' }) },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
  ]));

  void win.loadFile(LAUNCHER);
}

/**
 * The installed (Setup) version updates itself from GitHub releases: it downloads in the background and installs
 * when you quit. The portable EXE can't replace itself, so it skips this.
 */
function checkForUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    // Keep checking while the app stays open on a kitchen PC.
    setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 6 * 3600e3);
  } catch {
    // Updates are a nice-to-have; never block the app over them.
  }
}

app.whenReady().then(() => {
  // Camera and microphone only for your own server, never for other sites a link might open. Everything else
  // keeps Electron's default (allowed), as before.
  const mediaAllowed = (url) => originOf(url) === savedServer();
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permission !== 'media' || mediaAllowed(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => (
    permission !== 'media' || originOf(requestingOrigin) === savedServer()
  ));
  createWindow();
  checkForUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
