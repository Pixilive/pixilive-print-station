const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getJobs: () => ipcRenderer.invoke('get-jobs'),
  quit: () => ipcRenderer.invoke('quit'),
  onJobsUpdated: (callback) => ipcRenderer.on('jobs-updated', (_, jobs) => callback(jobs)),
  importMask: (orientation) => ipcRenderer.invoke('import-mask', orientation),
  selectHotfolder: () => ipcRenderer.invoke('select-hotfolder'),
  getLogs: () => ipcRenderer.invoke('get-logs'),
  onLogsUpdated: (callback) => ipcRenderer.on('logs-updated', (_, logs) => callback(logs)),
  getPaper: () => ipcRenderer.invoke('get-paper'),
  onPaperUpdated: (callback) => ipcRenderer.on('paper-updated', (_, paper) => callback(paper)),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  getLanguage: () => ipcRenderer.invoke('get-language'),
  onLanguageChanged: (callback) => ipcRenderer.on('language-changed', (_, lang) => callback(lang))
})