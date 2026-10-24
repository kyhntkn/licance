const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lic', {
  info: () => ipcRenderer.invoke('lic:info'),
  apply: t => ipcRenderer.invoke('lic:apply', t),
  pick: () => ipcRenderer.invoke('lic:pick'),
  trial: () => ipcRenderer.invoke('lic:trial'),
  copy: t => ipcRenderer.invoke('lic:copy', t)
});
