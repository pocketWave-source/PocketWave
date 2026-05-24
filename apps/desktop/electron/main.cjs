const { app, BrowserWindow, globalShortcut, screen } = require("electron");

let win;
let clickThrough = false;
let minimalMode = false;

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  win = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: false,
    focusable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: __dirname + "/preload.cjs",
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.loadURL("http://localhost:5173");

  globalShortcut.register("CommandOrControl+Shift+H", () => {
    if (!win) return;
    win.isVisible() ? win.hide() : win.show();
  });

  globalShortcut.register("CommandOrControl+Shift+T", () => {
    if (!win) return;

    clickThrough = !clickThrough;
    win.setIgnoreMouseEvents(clickThrough, { forward: true });
    win.webContents.send("overlay-click-through", clickThrough);
  });

  globalShortcut.register("CommandOrControl+Shift+M", () => {
    if (!win) return;

    minimalMode = !minimalMode;
    win.webContents.send("overlay-minimal-mode", minimalMode);
  });

  globalShortcut.register("CommandOrControl+Shift+R", () => {
  if (!win) return;

  win.webContents.send("toggle-listening");
});
}

app.whenReady().then(createWindow);

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  app.quit();
});