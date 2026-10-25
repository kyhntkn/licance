const { contextBridge, ipcRenderer } = require('electron');
const call = n => (...a) => ipcRenderer.invoke(n, ...a);
contextBridge.exposeInMainWorld('api', {
  keys: call('keys'), gen: call('gen'), pickZip: call('pickZip'), inject: call('inject'),
  create: call('create'), saveLic: call('saveLic'), copy: call('copy'), log: call('log'), products: call('products'), backup: call('backup'), restore: call('restore')
});
