const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pocketwave", {
  onClickThroughChange: (callback) => {
    ipcRenderer.on("overlay-click-through", (_event, value) => {
      callback(value);
    });
  },

  onMinimalModeChange: (callback) => {
    ipcRenderer.on("overlay-minimal-mode", (_event, value) => {
      callback(value);
    });
  },
});