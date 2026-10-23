// Windows/macOS/Linux desktop wrapper. It shows the launcher (pick your server), then opens your server's web app.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

const LAUNCHER = path.join(__dirname, 'launcher', 'index.html');

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
  createWindow();
  checkForUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
