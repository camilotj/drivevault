// ── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];

// ── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

function formatNum(n) {
  return Number(n || 0).toLocaleString();
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function extIcon(ext) {
  const e = (ext || '').toLowerCase();
  const vid = ['mp4','mov','avi','mkv','prores','r3d','braw','mxf','wmv','webm'];
  const img = ['jpg','jpeg','png','gif','webp','tiff','tif','raw','arw','cr2','cr3','nef','dng','heic','svg'];
  const aud = ['mp3','wav','aiff','flac','aac','m4a','ogg'];
  const doc = ['pdf','doc','docx','txt','md','rtf','pages','xls','xlsx','ppt','pptx','csv'];
  const zip = ['zip','rar','7z','tar','gz','dmg','iso'];
  const code = ['js','ts','py','java','c','cpp','h','go','rs','rb','php','html','css','json','xml','sh'];

  if (vid.includes(e)) return { icon: '▶', cls: 'ext-vid' };
  if (img.includes(e)) return { icon: '⬛', cls: 'ext-img' };  // replaced with SVG below
  if (aud.includes(e)) return { icon: '♪', cls: 'ext-aud' };
  if (doc.includes(e)) return { icon: '≡', cls: 'ext-doc' };
  if (zip.includes(e)) return { icon: '◈', cls: 'ext-zip' };
  if (code.includes(e)) return { icon: '</>', cls: 'ext-code' };
  return { icon: '·', cls: '' };
}

// ── Navigation ────────────────────────────────────────────────────────────────

const views = ['dashboard', 'drives', 'search', 'settings'];

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    switchView(view);
  });
});

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'drives') loadDrivesView();
  if (name === 'search') document.getElementById('search-input').focus();
  if (name === 'settings') loadSettings();
}

// ── Stats + Dashboard ─────────────────────────────────────────────────────────

async function loadDashboard() {
  const [stats, drives] = await Promise.all([
    window.api.getStats(),
    window.api.getDrives()
  ]);

  document.getElementById('stat-drives').textContent = formatNum(stats.driveCount);
  document.getElementById('stat-size').textContent = formatBytes(stats.totalSize);
  document.getElementById('drives-badge').textContent = stats.driveCount || '';

  const container = document.getElementById('drive-cards');
  const empty = document.getElementById('empty-state');

  if (!drives.length) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  container.innerHTML = drives.map(d => {
    const usedPct = d.total_size > 0 ? Math.round((d.used_size / d.total_size) * 100) : 0;
    const label = d.label || d.name || d.path.split(/[\\/]/).filter(Boolean).pop() || d.path;
    return `
      <div class="drive-card" data-drive-id="${d.id}" style="--card-color: ${d.color}" onclick="openDriveModal(${d.id})">
        <button class="drive-card-edit" onclick="event.stopPropagation(); openEditModal(${d.id})" title="Edit drive">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <div class="drive-card-badges">
          <div class="drive-status-badge ${d.connected ? 'status-connected' : 'status-offline'}">
            <span class="status-dot"></span>${d.connected ? 'Connected' : 'Offline'}
          </div>
        </div>
        <div class="drive-card-name">${esc(label)}</div>
        <div class="drive-card-path">${esc(d.path)}</div>
        ${d.description ? `<div class="drive-card-desc">${esc(d.description)}</div>` : ''}
        <div class="drive-card-stats">
          <div class="drive-card-stat">
            <strong>${formatBytes(d.used_size)}${d.total_size > 0 ? ` / ${formatBytes(d.total_size)}` : ''}</strong>
            used
          </div>
        </div>
        ${d.total_size > 0 ? `
          <div class="usage-bar">
            <div class="usage-fill" style="width: ${usedPct}%"></div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}


// ── Drives view ───────────────────────────────────────────────────────────────

async function loadDrivesView() {
  const drives = await window.api.getDrives();
  const container = document.getElementById('drives-list');

  if (!drives.length) {
    container.innerHTML = '<p style="color: var(--text3); padding: 20px 0;">No drives indexed yet. Click "Add Drive" to get started.</p>';
    return;
  }

  container.innerHTML = drives.map(d => {
    const label = d.label || d.name || d.path.split(/[\\/]/).filter(Boolean).pop() || d.path;
    const scanned = new Date(d.scanned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `
      <div class="drive-row" data-drive-id="${d.id}">
        <div class="drive-row-dot" style="background: ${d.color}"></div>
        <div class="drive-row-info">
          <div class="drive-row-name">
            ${esc(label)}
            <span class="drive-status-badge ${d.connected ? 'status-connected' : 'status-offline'}">
              <span class="status-dot"></span>${d.connected ? 'Connected' : 'Offline'}
            </span>
          </div>
          <div class="drive-row-meta">${esc(d.path)} · Scanned ${scanned}</div>
          ${d.description ? `<div class="drive-row-desc">${esc(d.description)}</div>` : ''}
        </div>
        <div class="drive-row-stats">
          <div class="drive-row-stat">
            <strong>${formatNum(d.file_count)}</strong>
            files
          </div>
          <div class="drive-row-stat">
            <strong>${formatBytes(d.used_size)}${d.total_size > 0 ? ` / ${formatBytes(d.total_size)}` : ''}</strong>
            used
          </div>
        </div>
        <div class="drive-row-actions">
          ${d.connected ? `<button class="btn-ghost" onclick="rescanDrive(${d.id})">Rescan</button>` : ''}
          <button class="btn-ghost" onclick="openEditModal(${d.id})">Edit</button>
          <button class="btn-ghost" onclick="openDriveModal(${d.id})">Browse</button>
          <button class="btn-ghost danger" data-delete-id="${d.id}" data-delete-name="${esc(label)}">Remove</button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteDrive(id, name) {
  if (!confirm(`Remove "${name}" from DriveVault?\n\nThis only removes the catalog entry — it won't delete any files from your drive.`)) return;
  await window.api.deleteDrive(id);
  await Promise.all([loadDashboard(), loadDrivesView()]);
}

document.getElementById('drives-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-delete-id]');
  if (btn) deleteDrive(Number(btn.dataset.deleteId), btn.dataset.deleteName);
});

async function rescanDrive(driveId) {
  resetScanModal();
  document.getElementById('scan-overlay').classList.remove('hidden');

  window.api.onScanProgress((msg) => {
    document.getElementById('scan-status').textContent = msg;
  });

  const result = await window.api.rescanDrive(driveId);
  window.api.removeScanProgress();

  if (!result || result.busy) {
    document.getElementById('scan-overlay').classList.add('hidden');
    if (result?.busy) showToast('A scan is already in progress.');
    return;
  }
  if (!result.ok) {
    document.getElementById('scan-overlay').classList.add('hidden');
    return;
  }

  await loadDashboard();
  loadDrivesView();
  showScanResultSummary(result);
  document.getElementById('scan-done-btn').classList.remove('hidden');
}

// ── Drive detail modal ────────────────────────────────────────────────────────

async function openDriveModal(driveId) {
  const drive = await window.api.getDrive(driveId);
  if (!drive) return;

  document.getElementById('drive-modal-title').textContent = drive.label || drive.name;
  document.getElementById('drive-modal-meta').innerHTML = `
    <span><strong>${formatNum(drive.file_count)}</strong> files</span>
    <span><strong>${formatNum(drive.folder_count)}</strong> folders</span>
    <span><strong>${formatBytes(drive.used_size)}${drive.total_size > 0 ? ` / ${formatBytes(drive.total_size)}` : ''}</strong> used</span>
    <span>Path: <strong>${esc(drive.path)}</strong></span>
  `;
  const descEl = document.getElementById('drive-modal-desc');
  if (drive.description) {
    descEl.textContent = drive.description;
    descEl.classList.remove('hidden');
  } else {
    descEl.classList.add('hidden');
  }

  document.getElementById('file-tree').innerHTML = '<div style="color:var(--text3);padding:20px 0">Loading…</div>';
  document.getElementById('drive-modal').classList.remove('hidden');

  const { files, truncated } = await window.api.getDriveFiles(driveId);
  renderFileTree(files, drive.path, drive.connected, truncated);
}

document.getElementById('drive-modal-close').addEventListener('click', () => {
  document.getElementById('drive-modal').classList.add('hidden');
});

document.getElementById('drive-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('drive-modal')) {
    document.getElementById('drive-modal').classList.add('hidden');
  }
});

function renderFileTree(files, rootPath, connected, truncated = false) {
  // Build tree structure
  const tree = {};

  for (const f of files) {
    let relative = f.path.replace(rootPath, '').replace(/^[/\\]/, '');
    const parts = relative.split(/[/\\]/);
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!node[part]) node[part] = { __files: [] };
      node = node[part];
    }
    const fileName = parts[parts.length - 1];
    if (!node.__files) node.__files = [];
    node.__files.push({ name: fileName, size: f.size, ext: f.ext, path: f.path });
  }

  function renderNode(node, depth = 0) {
    if (depth > 20) return '';
    let html = '';

    // Folders first
    const folderKeys = Object.keys(node).filter(k => k !== '__files' && k !== '__folders');
    for (const key of folderKeys.sort()) {
      const child = node[key];
      const fileCount = countFiles(child);
      html += `
        <div class="tree-folder">
          <div class="tree-folder-name" onclick="this.parentElement.querySelector('.tree-folder-children').classList.toggle('hidden')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text3)"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            ${esc(key)}
            <span style="color:var(--text3);font-size:12px;font-weight:400;margin-left:4px">${fileCount} files</span>
          </div>
          <div class="tree-folder-children hidden">
            ${renderNode(child, depth + 1)}
          </div>
        </div>
      `;
    }

    // Files
    const ffiles = node.__files || [];
    for (const f of ffiles.sort((a, b) => a.name.localeCompare(b.name))) {
      const { cls } = extIcon(f.ext);
      const revealBtn = connected && f.path
        ? `<button class="tree-file-reveal" title="Show in Explorer" data-path="${esc(f.path)}" onclick="event.stopPropagation(); revealFile(this)">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
           </button>`
        : '';
      html += `
        <div class="tree-file">
          <span class="${cls}" style="font-size:13px;width:20px;text-align:center">${esc(f.ext || '?')}</span>
          <span>${esc(f.name)}</span>
          <span class="tree-file-size">${formatBytes(f.size)}</span>
          ${revealBtn}
        </div>
      `;
    }

    return html;
  }

  function countFiles(node) {
    let n = (node.__files || []).length;
    for (const k of Object.keys(node).filter(k => k !== '__files' && k !== '__folders')) {
      n += countFiles(node[k]);
    }
    return n;
  }

  let html = renderNode(tree);
  if (truncated) {
    html += `<div style="color:var(--text3);font-size:12px;padding:14px 0 4px">Showing first 10,000 files — use Search to find files beyond this limit.</div>`;
  }
  document.getElementById('file-tree').innerHTML = html;
}

function revealFile(btn) {
  window.api.showItemInFolder(btn.dataset.path);
}

// ── Edit Drive modal ──────────────────────────────────────────────────────────

let editingDriveId = null;
let editingColor = COLORS[0];

function renderColorPicker(selected) {
  document.getElementById('edit-colors').innerHTML = COLORS.map(c =>
    `<button class="color-swatch${c === selected ? ' selected' : ''}" style="background:${c}" onclick="selectColor('${c}')"></button>`
  ).join('');
}

function selectColor(color) {
  editingColor = color;
  renderColorPicker(color);
}

async function openEditModal(driveId) {
  const drives = await window.api.getDrives();
  const drive = drives.find(d => d.id === driveId);
  if (!drive) return;
  editingDriveId = driveId;
  editingColor = drive.color || COLORS[0];
  document.getElementById('edit-name').value = drive.label || drive.name;
  document.getElementById('edit-description').value = drive.description || '';
  renderColorPicker(editingColor);
  document.getElementById('edit-modal').classList.remove('hidden');
  document.getElementById('edit-name').focus();
}

document.getElementById('edit-modal-close').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
});

document.getElementById('edit-cancel').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
});

document.getElementById('edit-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('edit-modal')) {
    document.getElementById('edit-modal').classList.add('hidden');
  }
});

document.getElementById('edit-save').addEventListener('click', async () => {
  const name = document.getElementById('edit-name').value.trim();
  const description = document.getElementById('edit-description').value.trim();
  if (!name) { document.getElementById('edit-name').focus(); return; }
  await window.api.updateDriveLabel(editingDriveId, name, editingColor, description);
  document.getElementById('edit-modal').classList.add('hidden');
  await loadDashboard();
  loadDrivesView();
});

// ── Search ────────────────────────────────────────────────────────────────────

document.getElementById('dashboard-search-input').addEventListener('input', (e) => {
  const q = e.target.value;
  const searchInput = document.getElementById('search-input');
  searchInput.value = q;
  switchView('search');
  searchInput.dispatchEvent(new Event('input'));
});

let searchTimeout;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (!q) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }
  searchTimeout = setTimeout(() => runSearch(q), 250);
});

async function runSearch(query) {
  const [{ files, folders }, drives] = await Promise.all([
    window.api.searchFiles(query),
    window.api.getDrives()
  ]);
  const connectedDrives = new Set(drives.filter(d => d.connected).map(d => d.id));
  const container = document.getElementById('search-results');

  if (!files.length && !folders.length) {
    container.innerHTML = `<p style="color:var(--text3);padding:16px 0">No results for "${esc(query)}"</p>`;
    return;
  }

  const revealBtn = (path) =>
    `<button class="search-result-reveal" title="Show in Explorer" data-path="${esc(path)}" onclick="event.stopPropagation(); revealFile(this)">
       <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
     </button>`;

  let html = '';

  if (folders.length) {
    html += `<div class="search-section-label">Folders <span class="search-count">${folders.length}</span></div>`;
    html += folders.map((fo, i) => `
      <div class="search-result search-result-folder" data-folder-idx="${i}" data-drive-id="${fo.drive_id}" data-folder-path="${esc(fo.path)}">
        <div class="search-result-icon search-icon-folder">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
        <div class="search-result-info">
          <div class="search-result-name">${esc(fo.name)}</div>
          <div class="search-result-path">${esc(fo.path)}</div>
          <div class="drive-chip">
            <div class="drive-chip-dot" style="background:${fo.drive_color || '#666'}"></div>
            ${esc(fo.drive_label || fo.drive_name)}
          </div>
        </div>
        ${connectedDrives.has(fo.drive_id) ? revealBtn(fo.path) : ''}
        <div class="folder-chevron">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
      <div class="folder-contents hidden" id="folder-contents-${i}"></div>
    `).join('');
  }

  if (files.length) {
    html += `<div class="search-section-label">Files <span class="search-count">${files.length}</span></div>`;
    html += files.map(f => {
      const { cls } = extIcon(f.ext);
      return `
        <div class="search-result">
          <div class="search-result-icon ${cls}">${esc(f.ext || '?')}</div>
          <div class="search-result-info">
            <div class="search-result-name">${esc(f.name)}</div>
            <div class="search-result-path">${esc(f.path)}</div>
            <div class="drive-chip">
              <div class="drive-chip-dot" style="background:${f.drive_color || '#666'}"></div>
              ${esc(f.drive_label || f.drive_name)}
            </div>
          </div>
          <div class="search-result-meta">${formatBytes(f.size)}</div>
          ${connectedDrives.has(f.drive_id) ? revealBtn(f.path) : ''}
        </div>
      `;
    }).join('');
  }

  container.innerHTML = html;
}

document.getElementById('search-results').addEventListener('click', e => {
  const row = e.target.closest('.search-result-folder');
  if (row && !e.target.closest('.search-result-reveal')) {
    toggleFolderContents(
      Number(row.dataset.folderIdx),
      Number(row.dataset.driveId),
      row.dataset.folderPath
    );
  }
});

async function toggleFolderContents(index, driveId, folderPath) {
  const contentsEl = document.getElementById(`folder-contents-${index}`);
  const isHidden = contentsEl.classList.contains('hidden');

  // toggle chevron rotation via sibling folder row
  const folderRow = contentsEl.previousElementSibling;
  folderRow.classList.toggle('expanded', isHidden);
  contentsEl.classList.toggle('hidden', !isHidden);

  if (!isHidden) return;

  if (contentsEl.dataset.loaded) return;
  contentsEl.dataset.loaded = '1';
  contentsEl.innerHTML = '<div class="folder-contents-loading">Loading…</div>';

  const files = await window.api.getFolderFiles(driveId, folderPath);

  if (!files.length) {
    contentsEl.innerHTML = '<div class="folder-contents-empty">No files found in this folder.</div>';
    return;
  }

  contentsEl.innerHTML = files.map(f => {
    const { cls } = extIcon(f.ext);
    return `
      <div class="folder-contents-file">
        <span class="search-result-icon ${cls}" style="font-size:11px;width:26px;height:26px;flex-shrink:0">${esc(f.ext || '?')}</span>
        <span class="folder-contents-name">${esc(f.name)}</span>
        <span class="folder-contents-path">${esc(f.path)}</span>
        <span class="folder-contents-size">${formatBytes(f.size)}</span>
      </div>
    `;
  }).join('');
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const dbPath = await window.api.getDbPath();
  document.getElementById('db-path-display').textContent = dbPath;
}

async function openDbFolder() {
  const dbPath = await window.api.getDbPath();
  window.api.showItemInFolder(dbPath);
}

async function changeDbLocation() {
  const copy = confirm('Move your current database to the new location?\n\nOK = move existing data\nCancel = start with whatever is already at the new location');
  const result = await window.api.changeDbLocation(copy);
  if (result.canceled) return;
  document.getElementById('db-path-display').textContent = result.dbPath;
  showToast('Database location updated');
  await loadDashboard();
  loadDrivesView();
}

async function importDb() {
  if (!confirm('This will replace your current catalog with the imported database. Continue?')) return;
  const result = await window.api.importDb();
  if (result.canceled) return;
  showToast('Database imported successfully');
  await loadDashboard();
  loadDrivesView();
}

async function clearDatabase() {
  if (!confirm('This will permanently delete all drives and files from the catalog. The database file will be kept but emptied. Continue?')) return;
  await window.api.clearDatabase();
  showToast('Database cleared');
  await loadDashboard();
  loadDrivesView();
}

// ── Export ────────────────────────────────────────────────────────────────────

const exportFns = { csv: 'exportCsv', json: 'exportJson', html: 'exportHtml' };

async function runExport(format) {
  const result = await window.api[exportFns[format]]();
  if (result?.ok) showToast(`Exported ${format.toUpperCase()} — ${result.filePath}`);
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden', 'toast-hide');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('toast-hide');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, 3500);
}

// ── Scan flow ─────────────────────────────────────────────────────────────────

let _scanResultDriveId = null;

function resetScanModal() {
  document.getElementById('scan-spinner').classList.remove('hidden');
  document.getElementById('scan-status').textContent = 'Scanning…';
  document.getElementById('scan-result').classList.add('hidden');
  document.getElementById('drive-name-prompt').classList.add('hidden');
  document.getElementById('drive-name-input').value = '';
  document.getElementById('scan-done-btn').classList.add('hidden');
  _scanResultDriveId = null;
}

function showScanResultSummary(result) {
  document.getElementById('scan-spinner').classList.add('hidden');
  document.getElementById('scan-status').textContent = '';

  const resultEl = document.getElementById('scan-result');
  if (result.isUpdate) {
    const changeLine = result.added === 0 && result.removed === 0
      ? '<span class="scan-stat-unchanged">No changes detected</span>'
      : `${result.added > 0 ? `<span class="scan-stat-added">+${formatNum(result.added)} added</span>` : ''}
         ${result.removed > 0 ? `<span class="scan-stat-removed">-${formatNum(result.removed)} removed</span>` : ''}`;
    resultEl.innerHTML = `
      <div class="scan-result-icon">✓</div>
      <div class="scan-result-title">"${esc(result.driveName)}" refreshed</div>
      <div class="scan-result-stats">${changeLine}<span class="scan-stat-total">${formatNum(result.fileCount)} files total</span></div>
    `;
  } else {
    resultEl.innerHTML = `
      <div class="scan-result-icon">✓</div>
      <div class="scan-result-title">"${esc(result.driveName)}" indexed</div>
      <div class="scan-result-stats"><span class="scan-stat-total">${formatNum(result.fileCount)} files catalogued</span></div>
    `;
  }
  resultEl.classList.remove('hidden');
}

document.getElementById('scan-btn').addEventListener('click', async () => {
  resetScanModal();
  document.getElementById('scan-overlay').classList.remove('hidden');

  window.api.onScanProgress((msg) => {
    document.getElementById('scan-status').textContent = msg;
  });

  const result = await window.api.scanFolder();
  window.api.removeScanProgress();

  if (!result || result.busy) {
    document.getElementById('scan-overlay').classList.add('hidden');
    if (result?.busy) showToast('A scan is already in progress.');
    return;
  }
  if (!result.ok) {
    document.getElementById('scan-overlay').classList.add('hidden');
    return;
  }

  await loadDashboard();
  loadDrivesView();

  showScanResultSummary(result);
  _scanResultDriveId = result.driveId;

  if (/^[A-Za-z]:$/.test(result.driveName)) {
    document.getElementById('drive-name-prompt').classList.remove('hidden');
    document.getElementById('drive-name-input').focus();
  }

  document.getElementById('scan-done-btn').classList.remove('hidden');
});



document.getElementById('scan-done-btn').addEventListener('click', async () => {
  const name = document.getElementById('drive-name-input').value.trim();
  if (name && _scanResultDriveId) {
    await window.api.updateDriveName(_scanResultDriveId, name);
    await loadDashboard();
    loadDrivesView();
  }
  document.getElementById('scan-overlay').classList.add('hidden');
  switchView('dashboard');
});

// ── Connection status polling ─────────────────────────────────────────────────

async function pollDriveStatus() {
  const drives = await window.api.getDrivesStatus();
  drives.forEach(d => {
    const connected = !!d.connected;
    const cls = `drive-status-badge ${connected ? 'status-connected' : 'status-offline'}`;
    const inner = `<span class="status-dot"></span>${connected ? 'Connected' : 'Offline'}`;

    const card = document.querySelector(`.drive-card[data-drive-id="${d.id}"]`);
    if (card) {
      const badge = card.querySelector('.drive-status-badge');
      if (badge) { badge.className = cls; badge.innerHTML = inner; }
    }

    const row = document.querySelector(`.drive-row[data-drive-id="${d.id}"]`);
    if (row) {
      const badge = row.querySelector('.drive-status-badge');
      if (badge) { badge.className = cls; badge.innerHTML = inner; }
    }
  });
}

setInterval(pollDriveStatus, 10000);

// ── Init ──────────────────────────────────────────────────────────────────────

loadDashboard();
