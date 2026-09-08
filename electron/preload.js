const { contextBridge, ipcRenderer } = require('electron');

// 安全暴露给渲染进程的 API。contextIsolation 下 window.electronAPI 可用。
contextBridge.exposeInMainWorld('electronAPI', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial) => ipcRenderer.invoke('settings:set', partial)
  },
  device: {
    getId: () => ipcRenderer.invoke('app:getDeviceId')
  },
  chat: {
    stream: (payload) => ipcRenderer.invoke('chat:stream', payload),
    abort: () => ipcRenderer.invoke('chat:abort'),
    onDelta: (cb) => ipcRenderer.on('chat:delta', (_e, delta) => cb(delta)),
    onReasoning: (cb) => ipcRenderer.on('chat:reasoning', (_e, delta) => cb(delta)),
    onDone: (cb) => ipcRenderer.on('chat:done', (_e, full) => cb(full)),
    onError: (cb) => ipcRenderer.on('chat:error', (_e, err) => cb(err))
  },
  export: {
    markdown: (payload) => ipcRenderer.invoke('export:markdown', payload)
  }
});
