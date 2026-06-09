const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDrives: () => ipcRenderer.invoke('get-drives'),
  getDriveFiles: (driveId) => ipcRenderer.invoke('get-drive-files', driveId),
  deleteDrive: (driveId) => ipcRenderer.invoke('delete-drive', driveId),
  updateDriveLabel: (driveId, label, color, description) => ipcRenderer.invoke('update-drive-label', { driveId, label, color, description }),
  getDuplicates: () => ipcRenderer.invoke('get-duplicates'),
  searchFiles: (query) => ipcRenderer.invoke('search-files', query),
  getFolderFiles: (driveId, folderPath) => ipcRenderer.invoke('get-folder-files', { driveId, folderPath }),
  getStats: () => ipcRenderer.invoke('get-stats'),
  scanFolder: () => ipcRenderer.invoke('scan-folder'),
  scanDuplicates: (driveId) => ipcRenderer.invoke('scan-duplicates', driveId),
  exportCsv:  () => ipcRenderer.invoke('export-csv'),
  exportJson: () => ipcRenderer.invoke('export-json'),
  exportHtml: () => ipcRenderer.invoke('export-html'),
  onScanProgress: (cb) => ipcRenderer.on('scan-progress', (_, msg) => cb(msg)),
  removeScanProgress: () => ipcRenderer.removeAllListeners('scan-progress')
});
