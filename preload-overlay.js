const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  getState: () => ipcRenderer.invoke('liner:overlayGetState'),
  onState: (cb) => ipcRenderer.on('liner:overlayState', (e, state) => cb(state)),
  sendAction: (action) => ipcRenderer.send('liner:overlayAction', action),
  hide: () => ipcRenderer.invoke('liner:overlayHide'),
});
