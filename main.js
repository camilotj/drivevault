const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { scanDirectory } = require('./scanner');
const { getDriveSerial, getDriveName } = require('./utils');

let mainWindow;
let db;
let SQL;
let isScanning = false;

// ── Database setup ──────────────────────────────────────────────────────────

let DB_PATH;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'drivevault-config.json');
}

function resolveDbPath() {
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    if (config.dbPath) return config.dbPath;
  } catch {}
  return path.join(app.getPath('userData'), 'drivevault.db');
}

function saveDbConfig(dbPath) {
  fs.writeFileSync(getConfigPath(), JSON.stringify({ dbPath }, null, 2));
}

function runMigrations() {
  db.run(`
    CREATE TABLE IF NOT EXISTS drives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      label TEXT,
      description TEXT,
      path TEXT NOT NULL,
      total_size INTEGER,
      used_size INTEGER,
      file_count INTEGER,
      folder_count INTEGER,
      scanned_at TEXT NOT NULL,
      color TEXT
    )
  `);
  try { db.run('ALTER TABLE drives ADD COLUMN description TEXT DEFAULT ""'); } catch {}
  try { db.run('ALTER TABLE drives ADD COLUMN volume_serial TEXT DEFAULT NULL'); } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drive_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER,
      ext TEXT,
      modified_at TEXT,
      hash TEXT,
      FOREIGN KEY (drive_id) REFERENCES drives(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_files_drive ON files(drive_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drive_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      FOREIGN KEY (drive_id) REFERENCES drives(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_folders_drive ON folders(drive_id)`);
}

function loadDatabase(dbPath) {
  DB_PATH = dbPath;
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }
  runMigrations();
  saveDB();
}

async function initDB() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  loadDatabase(resolveDbPath());
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Shared helper ─────────────────────────────────────────────────────────────

function driveWithConnected(drive) {
  const pathExists = fs.existsSync(drive.path);
  if (pathExists && drive.volume_serial) {
    const currentSerial = getDriveSerial(drive.path);
    drive.connected = (currentSerial === drive.volume_serial) ? 1 : 0;
  } else {
    drive.connected = pathExists ? 1 : 0;
  }
  return drive;
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-drives', () => {
  try {
    const stmt = db.prepare('SELECT * FROM drives ORDER BY scanned_at DESC');
    const drives = [];
    while (stmt.step()) drives.push(driveWithConnected(stmt.getAsObject()));
    stmt.free();
    return drives;
  } catch (e) { return []; }
});

// Fix 8: single-drive lookup so openDriveModal doesn't fetch all drives
ipcMain.handle('get-drive', (_, driveId) => {
  try {
    const stmt = db.prepare('SELECT * FROM drives WHERE id = ?');
    stmt.bind([driveId]);
    if (!stmt.step()) { stmt.free(); return null; }
    const drive = driveWithConnected(stmt.getAsObject());
    stmt.free();
    return drive;
  } catch (e) { return null; }
});

// Fix 3: cap result at 10 000 files, return truncated flag
ipcMain.handle('get-drive-files', (_, driveId) => {
  try {
    const LIMIT = 10000;
    const stmt = db.prepare('SELECT * FROM files WHERE drive_id = ? ORDER BY path ASC LIMIT ?');
    stmt.bind([driveId, LIMIT + 1]);
    const files = [];
    while (stmt.step()) files.push(stmt.getAsObject());
    stmt.free();
    const truncated = files.length > LIMIT;
    if (truncated) files.pop();
    return { files, truncated };
  } catch (e) { return { files: [], truncated: false }; }
});

ipcMain.handle('delete-drive', (_, driveId) => {
  try {
    db.run('DELETE FROM files WHERE drive_id = ?', [driveId]);
    db.run('DELETE FROM folders WHERE drive_id = ?', [driveId]);
    db.run('DELETE FROM drives WHERE id = ?', [driveId]);
    saveDB();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('update-drive-label', (_, { driveId, label, color, description }) => {
  try {
    db.run('UPDATE drives SET label = ?, color = ?, description = ? WHERE id = ?', [label, color, description ?? '', driveId]);
    saveDB();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Fix 9: escape LIKE special chars so % and _ are treated as literals
ipcMain.handle('search-files', (_, query) => {
  try {
    const escaped = query.replace(/[%_|]/g, '|$&');
    const like = `%${escaped}%`;

    const fileStmt = db.prepare(`
      SELECT f.*, d.name as drive_name, d.label as drive_label, d.color as drive_color
      FROM files f
      JOIN drives d ON f.drive_id = d.id
      WHERE f.name LIKE ? ESCAPE '|'
      ORDER BY f.name ASC
      LIMIT 200
    `);
    fileStmt.bind([like]);
    const files = [];
    while (fileStmt.step()) files.push(fileStmt.getAsObject());
    fileStmt.free();

    const folderStmt = db.prepare(`
      SELECT fo.id, fo.drive_id, fo.name, fo.path,
             d.name as drive_name, d.label as drive_label, d.color as drive_color
      FROM folders fo
      JOIN drives d ON fo.drive_id = d.id
      WHERE fo.name LIKE ? ESCAPE '|'
      ORDER BY fo.name ASC
      LIMIT 100
    `);
    folderStmt.bind([like]);
    const folders = [];
    while (folderStmt.step()) folders.push(folderStmt.getAsObject());
    folderStmt.free();

    return { files, folders };
  } catch (e) { return { files: [], folders: [] }; }
});

// Fix 4: escape LIKE special chars in folder path
ipcMain.handle('get-folder-files', (_, { driveId, folderPath }) => {
  try {
    const escapedFolder = folderPath.replace(/[%_|]/g, '|$&');
    const pattern = escapedFolder + path.sep + '%';
    const stmt = db.prepare(`
      SELECT name, path, size, ext
      FROM files
      WHERE drive_id = ? AND path LIKE ? ESCAPE '|'
      ORDER BY path ASC
      LIMIT 500
    `);
    stmt.bind([driveId, pattern]);
    const files = [];
    while (stmt.step()) files.push(stmt.getAsObject());
    stmt.free();
    return files;
  } catch (e) { return []; }
});

ipcMain.handle('get-stats', () => {
  try {
    const driveCount = db.exec('SELECT COUNT(*) as c FROM drives')[0]?.values[0][0] || 0;
    const fileCount = db.exec('SELECT COUNT(*) as c FROM files')[0]?.values[0][0] || 0;
    const totalSize = db.exec('SELECT SUM(size) as s FROM files')[0]?.values[0][0] || 0;
    return { driveCount, fileCount, totalSize };
  } catch (e) { return { driveCount: 0, fileCount: 0, totalSize: 0 }; }
});

// Fixes 1, 2, 7, 10: transaction, concurrency guard, serial backfill, error handling
ipcMain.handle('rescan-drive', async (event, driveId) => {
  if (isScanning) return { busy: true };
  isScanning = true;

  const sendProgress = (msg) => mainWindow.webContents.send('scan-progress', msg);

  try {
    const driveStmt = db.prepare('SELECT * FROM drives WHERE id = ?');
    driveStmt.bind([driveId]);
    if (!driveStmt.step()) { driveStmt.free(); return { ok: false }; }
    const drive = driveStmt.getAsObject();
    driveStmt.free();

    const folderPath = drive.path;
    const driveName = drive.label || drive.name;
    const volumeSerial = getDriveSerial(folderPath); // Fix 7: backfill serial on rescan

    let totalSize = 0, usedSize = 0;
    try {
      const stat = fs.statfsSync(folderPath);
      totalSize = stat.bsize * stat.blocks;
      usedSize = stat.bsize * (stat.blocks - stat.bfree);
    } catch {}

    sendProgress('Loading previous catalog…');
    const oldStmt = db.prepare('SELECT path FROM files WHERE drive_id = ?');
    oldStmt.bind([driveId]);
    const oldPaths = new Set();
    while (oldStmt.step()) oldPaths.add(oldStmt.getAsObject().path);
    oldStmt.free();

    // Scan happens outside the transaction — filesystem read only
    const { files, folders, folderCount } = scanDirectory(folderPath, driveId, sendProgress);

    sendProgress('Comparing with previous catalog…');
    const newPaths = new Set(files.map(f => f.path));
    const added = [...newPaths].filter(p => !oldPaths.has(p)).length;
    const removed = [...oldPaths].filter(p => !newPaths.has(p)).length;

    sendProgress(`Saving ${files.length} files to database…`);

    // Fix 1: atomic replace — if anything throws, ROLLBACK restores the old catalog
    db.run('BEGIN');
    try {
      db.run('DELETE FROM files WHERE drive_id = ?', [driveId]);
      db.run('DELETE FROM folders WHERE drive_id = ?', [driveId]);

      const insert = db.prepare('INSERT INTO files (drive_id, name, path, size, ext, modified_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const f of files) insert.run([f.drive_id, f.name, f.path, f.size, f.ext, f.modified_at]);
      insert.free();

      const folderInsert = db.prepare('INSERT INTO folders (drive_id, name, path) VALUES (?, ?, ?)');
      for (const fo of folders) folderInsert.run([fo.drive_id, fo.name, fo.path]);
      folderInsert.free();

      db.run(
        'UPDATE drives SET file_count = ?, folder_count = ?, used_size = ?, total_size = ?, scanned_at = ?, volume_serial = COALESCE(volume_serial, ?), name = CASE WHEN (name IS NULL OR name = "") THEN ? ELSE name END, label = CASE WHEN (label IS NULL OR label = "") THEN ? ELSE label END WHERE id = ?',
        [files.length, folderCount, usedSize, totalSize, new Date().toISOString(), volumeSerial, driveName, driveName, driveId]
      );

      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }

    saveDB();
    sendProgress('Done!');
    return { ok: true, isUpdate: true, driveName, fileCount: files.length, added, removed, driveId };
  } catch (e) {
    sendProgress('Scan failed.');
    return { ok: false, error: e.message };
  } finally {
    isScanning = false;
  }
});

// Fixes 1, 2, 10: transaction, concurrency guard, error handling
ipcMain.handle('scan-folder', async (event) => {
  // Dialog can open freely; guard kicks in only once a folder is chosen
  const dialogResult = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    message: 'Select the root folder of your external SSD'
  });

  if (dialogResult.canceled || !dialogResult.filePaths.length) return { canceled: true };

  if (isScanning) return { busy: true };
  isScanning = true;

  const folderPath = dialogResult.filePaths[0];
  const driveName = getDriveName(folderPath);
  const volumeSerial = getDriveSerial(folderPath);
  const sendProgress = (msg) => mainWindow.webContents.send('scan-progress', msg);

  try {
    sendProgress(`Starting scan of "${driveName}"...`);

    let totalSize = 0, usedSize = 0;
    try {
      const stat = fs.statfsSync(folderPath);
      totalSize = stat.bsize * stat.blocks;
      usedSize = stat.bsize * (stat.blocks - stat.bfree);
    } catch {}

    const existStmt = db.prepare('SELECT id, volume_serial FROM drives WHERE path = ?');
    existStmt.bind([folderPath]);
    const existingRow = existStmt.step() ? existStmt.getAsObject() : null;
    existStmt.free();

    const existingDriveId = (existingRow && (!volumeSerial || !existingRow.volume_serial || volumeSerial === existingRow.volume_serial))
      ? existingRow.id
      : null;

    if (existingDriveId !== null) {
      sendProgress('Loading previous catalog…');
      const oldStmt = db.prepare('SELECT path FROM files WHERE drive_id = ?');
      oldStmt.bind([existingDriveId]);
      const oldPaths = new Set();
      while (oldStmt.step()) oldPaths.add(oldStmt.getAsObject().path);
      oldStmt.free();

      const { files, folders, folderCount } = scanDirectory(folderPath, existingDriveId, sendProgress);

      sendProgress('Comparing with previous catalog…');
      const newPaths = new Set(files.map(f => f.path));
      const added = [...newPaths].filter(p => !oldPaths.has(p)).length;
      const removed = [...oldPaths].filter(p => !newPaths.has(p)).length;

      sendProgress(`Saving ${files.length} files to database…`);

      db.run('BEGIN');
      try {
        db.run('DELETE FROM files WHERE drive_id = ?', [existingDriveId]);
        db.run('DELETE FROM folders WHERE drive_id = ?', [existingDriveId]);

        const insert = db.prepare('INSERT INTO files (drive_id, name, path, size, ext, modified_at) VALUES (?, ?, ?, ?, ?, ?)');
        for (const f of files) insert.run([f.drive_id, f.name, f.path, f.size, f.ext, f.modified_at]);
        insert.free();

        const folderInsert = db.prepare('INSERT INTO folders (drive_id, name, path) VALUES (?, ?, ?)');
        for (const fo of folders) folderInsert.run([fo.drive_id, fo.name, fo.path]);
        folderInsert.free();

        db.run(
          'UPDATE drives SET file_count = ?, folder_count = ?, used_size = ?, total_size = ?, scanned_at = ?, volume_serial = COALESCE(volume_serial, ?), name = CASE WHEN (name IS NULL OR name = "") THEN ? ELSE name END, label = CASE WHEN (label IS NULL OR label = "") THEN ? ELSE label END WHERE id = ?',
          [files.length, folderCount, usedSize, totalSize, new Date().toISOString(), volumeSerial, driveName, driveName, existingDriveId]
        );

        db.run('COMMIT');
      } catch (e) {
        db.run('ROLLBACK');
        throw e;
      }

      saveDB();
      sendProgress('Done!');
      return { ok: true, isUpdate: true, driveName, fileCount: files.length, added, removed, driveId: existingDriveId };
    }

    // ── New drive — scan before INSERT so we can wrap everything in one transaction
    const { files, folders, folderCount } = scanDirectory(folderPath, 0, sendProgress);

    sendProgress(`Saving ${files.length} files to database…`);

    let driveId;
    db.run('BEGIN');
    try {
      db.run(
        `INSERT INTO drives (name, label, path, total_size, used_size, file_count, folder_count, scanned_at, color, volume_serial)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        [driveName, driveName, folderPath, totalSize, usedSize, new Date().toISOString(), randomColor(), volumeSerial]
      );

      driveId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

      const insert = db.prepare('INSERT INTO files (drive_id, name, path, size, ext, modified_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const f of files) insert.run([driveId, f.name, f.path, f.size, f.ext, f.modified_at]);
      insert.free();

      const folderInsert = db.prepare('INSERT INTO folders (drive_id, name, path) VALUES (?, ?, ?)');
      for (const fo of folders) folderInsert.run([driveId, fo.name, fo.path]);
      folderInsert.free();

      db.run('UPDATE drives SET file_count = ?, folder_count = ?, used_size = ? WHERE id = ?',
        [files.length, folderCount, usedSize, driveId]);

      db.run('COMMIT');
    } catch (e) {
      db.run('ROLLBACK');
      throw e;
    }

    saveDB();
    sendProgress('Done!');
    return { ok: true, isUpdate: false, driveName, fileCount: files.length, driveId };
  } catch (e) {
    mainWindow.webContents.send('scan-progress', 'Scan failed.');
    return { ok: false, error: e.message };
  } finally {
    isScanning = false;
  }
});

ipcMain.handle('clear-database', () => {
  try {
    db.run('DELETE FROM files');
    db.run('DELETE FROM folders');
    db.run('DELETE FROM drives');
    saveDB();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('update-drive-name', (_, { driveId, name }) => {
  try {
    db.run('UPDATE drives SET name = ?, label = ? WHERE id = ?', [name, name, driveId]);
    saveDB();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('get-db-path', () => {
  try { return DB_PATH; } catch (e) { return null; }
});

ipcMain.handle('show-item-in-folder', (_, p) => {
  try { shell.showItemInFolder(p); } catch {}
});

ipcMain.handle('change-db-location', async (_, { copyExisting }) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Choose folder for DriveVault database'
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };

    const newPath = path.join(result.filePaths[0], 'drivevault.db');

    if (copyExisting && DB_PATH !== newPath && fs.existsSync(DB_PATH)) {
      fs.copyFileSync(DB_PATH, newPath);
    }

    saveDbConfig(newPath);
    loadDatabase(newPath);
    return { ok: true, dbPath: newPath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('import-db', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      title: 'Import DriveVault database',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }]
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };

    fs.copyFileSync(result.filePaths[0], DB_PATH);
    loadDatabase(DB_PATH);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

function randomColor() {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Export handlers ───────────────────────────────────────────────────────────

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function htmlEsc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

ipcMain.handle('export-csv', async () => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export as CSV',
      defaultPath: `drivevault-${dateStamp()}.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });
    if (canceled || !filePath) return { canceled: true };

    const stmt = db.prepare(`
      SELECT d.label as drive_label, d.name as drive_name, d.path as drive_path,
             f.name, f.path, f.size, f.ext, f.modified_at, f.hash
      FROM files f
      JOIN drives d ON f.drive_id = d.id
      ORDER BY d.name ASC, f.path ASC
    `);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    const cols = ['drive_label', 'drive_name', 'drive_path', 'name', 'path', 'size', 'ext', 'modified_at', 'hash'];
    const esc = v => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
    const lines = [cols.join(','), ...rows.map(r => cols.map(h => esc(r[h])).join(','))];

    fs.writeFileSync(filePath, lines.join('\r\n'), 'utf8');
    return { ok: true, filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('export-json', async () => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export as JSON',
      defaultPath: `drivevault-${dateStamp()}.json`,
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });
    if (canceled || !filePath) return { canceled: true };

    const driveStmt = db.prepare('SELECT * FROM drives ORDER BY scanned_at DESC');
    const drives = [];
    while (driveStmt.step()) drives.push(driveStmt.getAsObject());
    driveStmt.free();

    for (const drive of drives) {
      const fileStmt = db.prepare(
        'SELECT name, path, size, ext, modified_at, hash FROM files WHERE drive_id = ? ORDER BY path ASC'
      );
      fileStmt.bind([drive.id]);
      drive.files = [];
      while (fileStmt.step()) drive.files.push(fileStmt.getAsObject());
      fileStmt.free();
      delete drive.id;
    }

    const payload = {
      exported_at: new Date().toISOString(),
      drive_count: drives.length,
      file_count: drives.reduce((s, d) => s + d.files.length, 0),
      drives
    };

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('export-html', async () => {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export as HTML Report',
      defaultPath: `drivevault-report-${dateStamp()}.html`,
      filters: [{ name: 'HTML Files', extensions: ['html'] }]
    });
    if (canceled || !filePath) return { canceled: true };

    const driveStmt = db.prepare('SELECT * FROM drives ORDER BY scanned_at DESC');
    const drives = [];
    while (driveStmt.step()) drives.push(driveStmt.getAsObject());
    driveStmt.free();

    for (const drive of drives) {
      const fileStmt = db.prepare(
        'SELECT name, path, size, ext, modified_at FROM files WHERE drive_id = ? ORDER BY path ASC'
      );
      fileStmt.bind([drive.id]);
      drive.files = [];
      while (fileStmt.step()) drive.files.push(fileStmt.getAsObject());
      fileStmt.free();
    }

    fs.writeFileSync(filePath, buildHtmlReport(drives), 'utf8');
    return { ok: true, filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

function buildHtmlReport(drives) {
  const exportedAt = new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
  const totalFiles = drives.reduce((s, d) => s + d.files.length, 0);
  const totalSize  = drives.reduce((s, d) => s + (d.used_size || 0), 0);

  const driveSections = drives.map(d => {
    const label   = htmlEsc(d.label || d.name);
    const scanned = new Date(d.scanned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const usedStr = fmtBytes(d.used_size) + (d.total_size ? ` / ${fmtBytes(d.total_size)}` : '');

    const rows = d.files.map(f => {
      const mod = f.modified_at ? new Date(f.modified_at).toLocaleDateString('en-GB') : '—';
      return `<tr>
        <td>${htmlEsc(f.name)}</td>
        <td class="path">${htmlEsc(f.path)}</td>
        <td class="num">${fmtBytes(f.size)}</td>
        <td>${htmlEsc(f.ext || '—')}</td>
        <td>${mod}</td>
      </tr>`;
    }).join('');

    return `
    <section class="drive">
      <div class="drive-head" style="border-left:4px solid ${d.color || '#6366f1'}">
        <div class="drive-head-info">
          <h2>${label}</h2>
          <div class="meta">${htmlEsc(d.path)} · Scanned ${scanned}</div>
          ${d.description ? `<div class="desc">${htmlEsc(d.description)}</div>` : ''}
        </div>
        <div class="drive-head-stats">
          <div class="stat"><strong>${d.files.length.toLocaleString()}</strong><span>files</span></div>
          <div class="stat"><strong>${usedStr}</strong><span>used</span></div>
        </div>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Path</th><th>Size</th><th>Type</th><th>Modified</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DriveVault Report — ${exportedAt}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;color:#1a1a2e;background:#f5f5f8;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  header{background:#1a1a2e;color:#e8e8f0;padding:24px 40px;display:flex;align-items:center;justify-content:space-between}
  header h1{font-size:20px;font-weight:700;letter-spacing:-.5px}
  header .sub{font-size:12px;color:#8888a0;margin-top:3px}
  .summary{display:flex;gap:16px;padding:24px 40px}
  .summary-card{background:#fff;border-radius:10px;padding:16px 24px;flex:1;border:1px solid #e5e5ee}
  .summary-card strong{display:block;font-size:22px;font-weight:700;color:#1a1a2e}
  .summary-card span{font-size:12px;color:#888}
  .drive{background:#fff;margin:0 40px 24px;border-radius:10px;overflow:hidden;border:1px solid #e5e5ee}
  .drive:first-of-type{margin-top:0}
  .drives-wrap{padding:0 0 40px}
  .drives-title{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#888;padding:24px 40px 12px}
  .drive-head{display:flex;justify-content:space-between;align-items:flex-start;padding:16px 20px;gap:12px;background:#fafafe}
  .drive-head-info h2{font-size:15px;font-weight:600}
  .meta{font-size:11px;color:#888;margin-top:3px}
  .desc{font-size:12px;color:#555;margin-top:4px}
  .drive-head-stats{display:flex;gap:20px;flex-shrink:0}
  .stat{text-align:right}
  .stat strong{display:block;font-size:15px;font-weight:600}
  .stat span{font-size:11px;color:#888}
  table{width:100%;border-collapse:collapse;font-size:12px}
  thead tr{background:#f5f5f8}
  th{text-align:left;padding:8px 12px;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#888;border-bottom:1px solid #e5e5ee}
  td{padding:6px 12px;border-bottom:1px solid #f0f0f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px}
  tbody tr:last-child td{border-bottom:none}
  tbody tr:hover td{background:#fafafe}
  td.path{color:#888;font-size:11px;max-width:420px}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  footer{text-align:center;padding:24px;font-size:11px;color:#aaa}
</style>
</head>
<body>
<header>
  <div>
    <h1>DriveVault</h1>
    <div class="sub">Exported ${exportedAt}</div>
  </div>
</header>
<div class="summary">
  <div class="summary-card"><strong>${drives.length}</strong><span>Drives indexed</span></div>
  <div class="summary-card"><strong>${totalFiles.toLocaleString()}</strong><span>Total files</span></div>
  <div class="summary-card"><strong>${fmtBytes(totalSize)}</strong><span>Total size</span></div>
</div>
<div class="drives-wrap">
  <div class="drives-title">Drives</div>
  ${driveSections}
</div>
<footer>Generated by DriveVault · ${exportedAt}</footer>
</body>
</html>`;
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await initDB();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f0f13',
    icon: path.join(__dirname, 'assets', 'favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
