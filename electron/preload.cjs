const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mcServerManager", {
  invoke(command, args) {
    return ipcRenderer.invoke("app-command", command, args);
  },
  openExternalUrl(url) {
    return ipcRenderer.invoke("open-external-url", url);
  },
  windowAction(action) {
    return ipcRenderer.invoke("window-action", action);
  },
  onCloseBehaviorRequested(callback) {
    const listener = () => callback();
    ipcRenderer.on("close-behavior-requested", listener);
    return () =>
      ipcRenderer.removeListener("close-behavior-requested", listener);
  },
});
