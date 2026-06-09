const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { hashFile, scanDirectory } = require('./scanner');

let mainWindow;
let db;
let SQL;

// ── Database setup ──────────────────────────────────────────────────────────

let DB_PATH;

async function initDB() {
  DB_PATH = path.join(app.getPath('userData'), 'drivevault.db');
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const filebuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(filebuffer);
  } else {
    db = new SQL.Database();
  }

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
  try { db.run('ALTER TABLE drives ADD COLUMN dup_scanned_at TEXT DEFAULT NULL'); } catch {}

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

  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-drives', () => {
  const stmt = db.prepare('SELECT * FROM drives ORDER BY scanned_at DESC');
  const drives = [];
  while (stmt.step()) {
    const drive = stmt.getAsObject();
    drive.connected = fs.existsSync(drive.path) ? 1 : 0;
    drives.push(drive);
  }
  stmt.free();
  return drives;
});

ipcMain.handle('get-drive-files', (_, driveId) => {
  const stmt = db.prepare('SELECT * FROM files WHERE drive_id = ? ORDER BY path ASC');
  stmt.bind([driveId]);
  const files = [];
  while (stmt.step()) files.push(stmt.getAsObject());
  stmt.free();
  return files;
});

ipcMain.handle('delete-drive', (_, driveId) => {
  db.run('DELETE FROM files WHERE drive_id = ?', [driveId]);
  db.run('DELETE FROM folders WHERE drive_id = ?', [driveId]);
  db.run('DELETE FROM drives WHERE id = ?', [driveId]);
  saveDB();
  return { ok: true };
});

ipcMain.handle('update-drive-label', (_, { driveId, label, color, description }) => {
  db.run('UPDATE drives SET label = ?, color = ?, description = ? WHERE id = ?', [label, color, description ?? '', driveId]);
  saveDB();
  return { ok: true };
});

ipcMain.handle('get-duplicates', () => {
  const stmt = db.prepare(`
    SELECT f.hash, f.name, f.size, f.path, f.modified_at, f.drive_id,
           d.name as drive_name, d.label as drive_label, d.color as drive_color
    FROM files f
    JOIN drives d ON f.drive_id = d.id
    WHERE f.hash IS NOT NULL
      AND f.hash IN (
        SELECT hash FROM files WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1
      )
    ORDER BY f.hash, f.drive_id
  `);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();

  const hashGroups = {};
  for (const row of rows) {
    if (!hashGroups[row.hash]) hashGroups[row.hash] = [];
    hashGroups[row.hash].push(row);
  }
  const fileGroups = Object.values(hashGroups);

  // ── Folder-level grouping ─────────────────────────────────────────────────
  // Build a map of (driveId, parentDir) → { hashes, dupFileCount, driveInfo }
  const sep = path.sep;
  const dirMap = {};
  for (const group of fileGroups) {
    for (const file of group) {
      const parentDir = path.dirname(file.path);
      const key = `${file.drive_id}::${parentDir}`;
      if (!dirMap[key]) {
        dirMap[key] = {
          driveId: file.drive_id,
          dirPath: parentDir,
          dirName: path.basename(parentDir),
          driveName: file.drive_name,
          driveLabel: file.drive_label,
          driveColor: file.drive_color,
          hashes: new Set(),
          dupFileCount: 0
        };
      }
      dirMap[key].hashes.add(file.hash);
      dirMap[key].dupFileCount++;
    }
  }

  // Identify fully-duplicated dirs: every direct child is in a dup group
  const fullyDupKeys = new Set();
  for (const [key, info] of Object.entries(dirMap)) {
    const prefix = info.dirPath + sep;
    // Count direct children: match prefix + something, but no additional separator
    const countStmt = db.prepare(
      `SELECT COUNT(*) as c FROM files WHERE drive_id = ? AND path LIKE ? AND path NOT LIKE ?`
    );
    countStmt.bind([info.driveId, prefix + '%', prefix + '%' + sep + '%']);
    countStmt.step();
    const directCount = countStmt.getAsObject().c;
    countStmt.free();
    if (directCount > 0 && directCount === info.dupFileCount) {
      fullyDupKeys.add(key);
    }
  }

  // Group fully-dup dirs by their hash signature — matching dirs have the same set of hashes
  const bySig = {};
  for (const key of fullyDupKeys) {
    const info = dirMap[key];
    const sig = [...info.hashes].sort().join(',');
    if (!bySig[sig]) bySig[sig] = [];
    bySig[sig].push(info);
  }

  const folderGroups = [];
  const coveredHashes = new Set();

  for (const dirs of Object.values(bySig)) {
    if (dirs.length < 2) continue;
    const hashes = dirs[0].hashes;
    folderGroups.push({
      fileCount: hashes.size,
      dirs: dirs.map(d => ({
        driveId: d.driveId,
        dirPath: d.dirPath,
        dirName: d.dirName,
        driveName: d.driveName,
        driveLabel: d.driveLabel,
        driveColor: d.driveColor
      }))
    });
    for (const h of hashes) coveredHashes.add(h);
  }

  // Only return file groups not already covered by a folder group
  const remainingFileGroups = fileGroups.filter(g => !coveredHashes.has(g[0].hash));

  return { fileGroups: remainingFileGroups, folderGroups };
});

ipcMain.handle('search-files', (_, query) => {
  const like = `%${query}%`;

  const fileStmt = db.prepare(`
    SELECT f.*, d.name as drive_name, d.label as drive_label, d.color as drive_color
    FROM files f
    JOIN drives d ON f.drive_id = d.id
    WHERE f.name LIKE ?
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
    WHERE fo.name LIKE ?
    ORDER BY fo.name ASC
    LIMIT 100
  `);
  folderStmt.bind([like]);
  const folders = [];
  while (folderStmt.step()) folders.push(folderStmt.getAsObject());
  folderStmt.free();

  return { files, folders };
});

ipcMain.handle('get-folder-files', (_, { driveId, folderPath }) => {
  const pattern = path.join(folderPath, '%');
  const stmt = db.prepare(`
    SELECT name, path, size, ext
    FROM files
    WHERE drive_id = ? AND path LIKE ?
    ORDER BY path ASC
    LIMIT 500
  `);
  stmt.bind([driveId, pattern]);
  const files = [];
  while (stmt.step()) files.push(stmt.getAsObject());
  stmt.free();
  return files;
});

ipcMain.handle('get-stats', () => {
  const driveCount = db.exec('SELECT COUNT(*) as c FROM drives')[0]?.values[0][0] || 0;
  const fileCount = db.exec('SELECT COUNT(*) as c FROM files')[0]?.values[0][0] || 0;
  const totalSize = db.exec('SELECT SUM(size) as s FROM files')[0]?.values[0][0] || 0;
  const dupCount = db.exec(`
    SELECT COUNT(*) FROM files WHERE hash IN (
      SELECT hash FROM files WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1
    )
  `)[0]?.values[0][0] || 0;
  return { driveCount, fileCount, totalSize, dupCount };
});

ipcMain.handle('scan-folder', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    message: 'Select the root folder of your external SSD'
  });

  if (result.canceled || !result.filePaths.length) return { canceled: true };

  const folderPath = result.filePaths[0];
  const driveName = path.basename(folderPath);

  const sendProgress = (msg) => {
    mainWindow.webContents.send('scan-progress', msg);
  };

  sendProgress(`Starting scan of "${driveName}"...`);

  let totalSize = 0, usedSize = 0;
  try {
    const stat = fs.statfsSync(folderPath);
    totalSize = stat.bsize * stat.blocks;
    usedSize = stat.bsize * (stat.blocks - stat.bfree);
  } catch {}

  const existStmt = db.prepare('SELECT id FROM drives WHERE path = ?');
  existStmt.bind([folderPath]);
  const existingDriveId = existStmt.step() ? existStmt.getAsObject().id : null;
  existStmt.free();

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
    db.run('DELETE FROM files WHERE drive_id = ?', [existingDriveId]);
    db.run('DELETE FROM folders WHERE drive_id = ?', [existingDriveId]);

    const insert = db.prepare(
      'INSERT INTO files (drive_id, name, path, size, ext, modified_at, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const f of files) {
      insert.run([f.drive_id, f.name, f.path, f.size, f.ext, f.modified_at, f.hash]);
    }
    insert.free();

    const folderInsert = db.prepare('INSERT INTO folders (drive_id, name, path) VALUES (?, ?, ?)');
    for (const fo of folders) {
      folderInsert.run([fo.drive_id, fo.name, fo.path]);
    }
    folderInsert.free();

    db.run(
      'UPDATE drives SET file_count = ?, folder_count = ?, used_size = ?, total_size = ?, scanned_at = ? WHERE id = ?',
      [files.length, folderCount, usedSize, totalSize, new Date().toISOString(), existingDriveId]
    );

    saveDB();
    sendProgress('Done!');
    return { ok: true, isUpdate: true, driveName, fileCount: files.length, added, removed, driveId: existingDriveId };
  }

  // ── New drive ─────────────────────────────────────────────────────────────
  db.run(
    `INSERT INTO drives (name, label, path, total_size, used_size, file_count, folder_count, scanned_at, color)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    [driveName, driveName, folderPath, totalSize, usedSize, new Date().toISOString(), randomColor()]
  );

  const driveId = db.exec('SELECT last_insert_rowid()')[0].values[0][0];

  const { files, folders, folderCount } = scanDirectory(folderPath, driveId, sendProgress);

  sendProgress(`Saving ${files.length} files to database…`);

  const insert = db.prepare(
    'INSERT INTO files (drive_id, name, path, size, ext, modified_at, hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const f of files) {
    insert.run([f.drive_id, f.name, f.path, f.size, f.ext, f.modified_at, f.hash]);
  }
  insert.free();

  const folderInsert = db.prepare('INSERT INTO folders (drive_id, name, path) VALUES (?, ?, ?)');
  for (const fo of folders) {
    folderInsert.run([fo.drive_id, fo.name, fo.path]);
  }
  folderInsert.free();

  db.run('UPDATE drives SET file_count = ?, folder_count = ?, used_size = ? WHERE id = ?',
    [files.length, folderCount, usedSize, driveId]);

  saveDB();
  sendProgress('Done!');
  return { ok: true, isUpdate: false, driveName, fileCount: files.length, driveId };
});

ipcMain.handle('scan-duplicates', async (event, driveId) => {
  const sendProgress = (msg) => mainWindow.webContents.send('scan-progress', msg);
  const HASH_LIMIT = 500 * 1024 * 1024;

  // Load all files for this drive from the DB
  const fileStmt = db.prepare('SELECT id, path, size FROM files WHERE drive_id = ?');
  fileStmt.bind([driveId]);
  const files = [];
  while (fileStmt.step()) files.push(fileStmt.getAsObject());
  fileStmt.free();

  // Sizes already stored for other drives
  const sizeStmt = db.prepare(
    'SELECT DISTINCT size FROM files WHERE drive_id != ? AND size IS NOT NULL AND size > 0'
  );
  sizeStmt.bind([driveId]);
  const dbSizes = new Set();
  while (sizeStmt.step()) dbSizes.add(sizeStmt.getAsObject().size);
  sizeStmt.free();

  // Intra-drive size frequency
  const scanSizeCount = new Map();
  for (const f of files) {
    if (f.size > 0 && f.size < HASH_LIMIT) {
      scanSizeCount.set(f.size, (scanSizeCount.get(f.size) || 0) + 1);
    }
  }

  const candidates = files.filter(
    f => f.size > 0 && f.size < HASH_LIMIT &&
         (scanSizeCount.get(f.size) > 1 || dbSizes.has(f.size))
  );

  if (candidates.length > 0) {
    sendProgress(`Hashing ${candidates.length} of ${files.length} files…`);
    let done = 0;
    const updateStmt = db.prepare('UPDATE files SET hash = ? WHERE id = ?');
    for (const f of candidates) {
      const hash = hashFile(f.path);
      if (hash !== null) updateStmt.run([hash, f.id]);
      done++;
      if (done % 50 === 0) sendProgress(`Hashing… ${done} / ${candidates.length}`);
    }
    updateStmt.free();
  }

  db.run('UPDATE drives SET dup_scanned_at = ? WHERE id = ?', [new Date().toISOString(), driveId]);
  saveDB();
  return { ok: true, candidateCount: candidates.length };
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
});

ipcMain.handle('export-json', async () => {
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
});

ipcMain.handle('export-html', async () => {
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
    icon: path.join(__dirname, 'assets', 'external-storage(1).ico'),
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
