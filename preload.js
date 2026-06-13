const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getDrives: () => ipcRenderer.invoke('get-drives'),
  getDrive: (driveId) => ipcRenderer.invoke('get-drive', driveId),
  getDriveFiles: (driveId) => ipcRenderer.invoke('get-drive-files', driveId),
  deleteDrive: (driveId) => ipcRenderer.invoke('delete-drive', driveId),
  updateDriveLabel: (driveId, label, color, description) => ipcRenderer.invoke('update-drive-label', { driveId, label, color, description }),
  updateDriveName: (driveId, name) => ipcRenderer.invoke('update-drive-name', { driveId, name }),
  searchFiles: (query) => ipcRenderer.invoke('search-files', query),
  getFolderFiles: (driveId, folderPath) => ipcRenderer.invoke('get-folder-files', { driveId, folderPath }),
  getStats: () => ipcRenderer.invoke('get-stats'),
  rescanDrive: (driveId) => ipcRenderer.invoke('rescan-drive', driveId),
  scanFolder: () => ipcRenderer.invoke('scan-folder'),
  exportCsv:  () => ipcRenderer.invoke('export-csv'),
  exportJson: () => ipcRenderer.invoke('export-json'),
  exportHtml: () => ipcRenderer.invoke('export-html'),
  onScanProgress: (cb) => ipcRenderer.on('scan-progress', (_, msg) => cb(msg)),
  removeScanProgress: () => ipcRenderer.removeAllListeners('scan-progress'),
  clearDatabase: () => ipcRenderer.invoke('clear-database'),
  getDbPath: () => ipcRenderer.invoke('get-db-path'),
  showItemInFolder: (p) => ipcRenderer.invoke('show-item-in-folder', p),
  changeDbLocation: (copyExisting) => ipcRenderer.invoke('change-db-location', { copyExisting }),
  importDb: () => ipcRenderer.invoke('import-db')
});
