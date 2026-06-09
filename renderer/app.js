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

const views = ['dashboard', 'drives', 'duplicates', 'search'];

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    switchView(view);
  });
});

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'duplicates') loadDuplicates();
  if (name === 'drives') loadDrivesView();
  if (name === 'search') document.getElementById('search-input').focus();
}

// ── Stats + Dashboard ─────────────────────────────────────────────────────────

async function loadDashboard() {
  const [stats, drives] = await Promise.all([
    window.api.getStats(),
    window.api.getDrives()
  ]);

  document.getElementById('stat-drives').textContent = formatNum(stats.driveCount);
  document.getElementById('stat-size').textContent = formatBytes(stats.totalSize);
  document.getElementById('stat-dups').textContent = formatNum(stats.dupCount);

  document.getElementById('drives-badge').textContent = stats.driveCount || '';
  document.getElementById('dup-badge').textContent = stats.dupCount || '';

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
    const label = d.label || d.name;
    return `
      <div class="drive-card" data-drive-id="${d.id}" style="--card-color: ${d.color}" onclick="openDriveModal(${d.id})">
        <button class="drive-card-edit" onclick="event.stopPropagation(); openEditModal(${d.id})" title="Edit drive">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <div class="drive-card-badges">
          <div class="drive-status-badge ${d.connected ? 'status-connected' : 'status-offline'}">
            <span class="status-dot"></span>${d.connected ? 'Connected' : 'Offline'}
          </div>
          ${!d.dup_scanned_at ? `<div class="dup-pending-badge" onclick="event.stopPropagation(); startDupScan(${d.id})">No dup scan</div>` : ''}
        </div>
        <div class="drive-card-name">${label}</div>
        <div class="drive-card-path">${d.path}</div>
        ${d.description ? `<div class="drive-card-desc">${d.description}</div>` : ''}
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

async function startDupScan(driveId) {
  resetScanModal();
  document.getElementById('scan-status').textContent = 'Starting duplicate scan…';
  document.getElementById('scan-overlay').classList.remove('hidden');

  window.api.onScanProgress((msg) => {
    document.getElementById('scan-status').textContent = msg;
  });

  await window.api.scanDuplicates(driveId);
  window.api.removeScanProgress();

  document.getElementById('scan-spinner').classList.add('hidden');
  document.getElementById('scan-status').textContent = '';
  document.getElementById('scan-result').innerHTML = `
    <div class="scan-result-icon">✓</div>
    <div class="scan-result-title">Duplicate scan complete</div>
  `;
  document.getElementById('scan-result').classList.remove('hidden');
  document.getElementById('scan-done-btn').classList.remove('hidden');

  await loadDashboard();
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
    const label = d.label || d.name;
    const scanned = new Date(d.scanned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return `
      <div class="drive-row">
        <div class="drive-row-dot" style="background: ${d.color}"></div>
        <div class="drive-row-info">
          <div class="drive-row-name">
            ${label}
            <span class="drive-status-badge ${d.connected ? 'status-connected' : 'status-offline'}">
              <span class="status-dot"></span>${d.connected ? 'Connected' : 'Offline'}
            </span>
          </div>
          <div class="drive-row-meta">${d.path} · Scanned ${scanned}</div>
          ${d.description ? `<div class="drive-row-desc">${d.description}</div>` : ''}
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
          <button class="btn-ghost" onclick="openEditModal(${d.id})">Edit</button>
          <button class="btn-ghost" onclick="openDriveModal(${d.id})">Browse</button>
          <button class="btn-ghost danger" onclick="deleteDrive(${d.id}, '${label.replace(/'/g, "\\'")}')">Remove</button>
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

// ── Duplicates view ───────────────────────────────────────────────────────────

let _dupFolderGroups = [];

async function loadDuplicates() {
  const { fileGroups, folderGroups } = await window.api.getDuplicates();
  _dupFolderGroups = folderGroups;
  const drives = await window.api.getDrives();
  const driveMap = Object.fromEntries(drives.map(d => [d.id, d]));

  const container = document.getElementById('duplicates-list');
  const empty = document.getElementById('dup-empty');
  const label = document.getElementById('dup-count-label');

  const totalGroups = fileGroups.length + folderGroups.length;
  if (!totalGroups) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    label.textContent = '';
    return;
  }

  empty.classList.add('hidden');
  const parts = [];
  if (folderGroups.length) parts.push(`${folderGroups.length} folder${folderGroups.length === 1 ? '' : 's'}`);
  if (fileGroups.length)   parts.push(`${fileGroups.length} file group${fileGroups.length === 1 ? '' : 's'}`);
  label.textContent = parts.join(' · ');

  let html = '';

  // ── Folder groups ────────────────────────────────────────────────────────
  folderGroups.forEach((fg, i) => {
    const dirName = fg.dirs[0].dirName || 'folder';
    html += `
      <div class="dup-group dup-folder-group">
        <div class="dup-group-header" onclick="toggleDupFolder(${i})">
          <div class="dup-folder-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          </div>
          <div class="dup-group-name">${dirName}/</div>
          <div class="dup-group-size">${formatNum(fg.fileCount)} files</div>
          <div class="dup-group-count">${fg.dirs.length} copies</div>
          <div class="dup-folder-chevron" id="dup-folder-chevron-${i}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
        ${fg.dirs.map(d => `
          <div class="dup-file">
            <div class="dup-drive-dot" style="background: ${d.driveColor || '#666'}"></div>
            <div class="dup-drive-name">${d.driveLabel || d.driveName}</div>
            <div class="dup-file-path">${d.dirPath}</div>
          </div>
        `).join('')}
        <div class="dup-folder-contents hidden" id="dup-folder-contents-${i}">
          <div class="dup-folder-contents-inner"></div>
        </div>
      </div>
    `;
  });

  // ── File groups ──────────────────────────────────────────────────────────
  fileGroups.forEach((group, i) => {
    const first = group[0];
    html += `
      <div class="dup-group">
        <div class="dup-group-header" onclick="toggleDupFileDetail(${folderGroups.length + i})">
          <div class="dup-group-name">${first.name}</div>
          <div class="dup-group-size">${formatBytes(first.size)}</div>
          <div class="dup-group-count">${group.length} copies</div>
        </div>
        ${group.map(f => {
          const d = driveMap[f.drive_id] || {};
          const mod = f.modified_at ? new Date(f.modified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
          return `
            <div class="dup-file">
              <div class="dup-drive-dot" style="background: ${d.color || '#666'}"></div>
              <div class="dup-drive-name">${d.label || d.name || 'Unknown'}</div>
              <div class="dup-file-path">${f.path}</div>
              <div class="dup-file-detail hidden">
                <span class="dup-detail-item">Modified ${mod}</span>
                <span class="dup-detail-item dup-hash">${f.hash}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  });

  container.innerHTML = html;
}

async function toggleDupFolder(index) {
  const contents = document.getElementById(`dup-folder-contents-${index}`);
  const chevron  = document.getElementById(`dup-folder-chevron-${index}`);
  const isHidden = contents.classList.contains('hidden');

  chevron.classList.toggle('rotated', isHidden);
  contents.classList.toggle('hidden', !isHidden);

  if (!isHidden || contents.dataset.loaded) return;
  contents.dataset.loaded = '1';

  const fg = _dupFolderGroups[index];
  if (!fg) return;

  const inner = contents.querySelector('.dup-folder-contents-inner');
  inner.innerHTML = '<div class="dup-folder-loading">Loading…</div>';

  const files = await window.api.getFolderFiles(fg.dirs[0].driveId, fg.dirs[0].dirPath);

  if (!files.length) {
    inner.innerHTML = '<div class="dup-folder-loading">No files found.</div>';
    return;
  }

  inner.innerHTML = files.map(f => {
    const { cls } = extIcon(f.ext);
    return `
      <div class="dup-folder-file">
        <span class="search-result-icon ${cls}" style="font-size:11px;width:24px;height:24px;flex-shrink:0">${f.ext || '?'}</span>
        <span class="dup-folder-file-name">${f.name}</span>
        <span class="dup-folder-file-size">${formatBytes(f.size)}</span>
      </div>
    `;
  }).join('');
}

function toggleDupFileDetail(groupIndex) {
  const group = document.querySelectorAll('.dup-group')[groupIndex];
  if (!group) return;
  group.querySelectorAll('.dup-file-detail').forEach(el => el.classList.toggle('hidden'));
}

// ── Drive detail modal ────────────────────────────────────────────────────────

async function openDriveModal(driveId) {
  const drives = await window.api.getDrives();
  const drive = drives.find(d => d.id === driveId);
  if (!drive) return;

  document.getElementById('drive-modal-title').textContent = drive.label || drive.name;
  document.getElementById('drive-modal-meta').innerHTML = `
    <span><strong>${formatNum(drive.file_count)}</strong> files</span>
    <span><strong>${formatNum(drive.folder_count)}</strong> folders</span>
    <span><strong>${formatBytes(drive.used_size)}${drive.total_size > 0 ? ` / ${formatBytes(drive.total_size)}` : ''}</strong> used</span>
    <span>Path: <strong>${drive.path}</strong></span>
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

  const files = await window.api.getDriveFiles(driveId);
  renderFileTree(files, drive.path);
}

document.getElementById('drive-modal-close').addEventListener('click', () => {
  document.getElementById('drive-modal').classList.add('hidden');
});

document.getElementById('drive-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('drive-modal')) {
    document.getElementById('drive-modal').classList.add('hidden');
  }
});

function renderFileTree(files, rootPath) {
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
    node.__files.push({ name: fileName, size: f.size, ext: f.ext });
  }

  function renderNode(node, depth = 0) {
    if (depth > 8) return '';
    let html = '';

    // Folders first
    const folderKeys = Object.keys(node).filter(k => k !== '__files' && k !== '__folders');
    for (const key of folderKeys.sort()) {
      const child = node[key];
      const fileCount = countFiles(child);
      html += `
        <div class="tree-folder">
          <div class="tree-folder-name" onclick="this.parentElement.querySelector('.tree-folder-children').classList.toggle('hidden')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text3)"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
            ${key}
            <span style="color:var(--text3);font-size:11px;font-weight:400;margin-left:4px">${fileCount} files</span>
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
      html += `
        <div class="tree-file">
          <span class="${cls}" style="font-size:11px;width:16px;text-align:center">${f.ext || '?'}</span>
          <span>${f.name}</span>
          <span class="tree-file-size">${formatBytes(f.size)}</span>
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

  document.getElementById('file-tree').innerHTML = renderNode(tree);
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
  const { files, folders } = await window.api.searchFiles(query);
  const container = document.getElementById('search-results');

  if (!files.length && !folders.length) {
    container.innerHTML = `<p style="color:var(--text3);padding:16px 0">No results for "${query}"</p>`;
    return;
  }

  let html = '';

  if (folders.length) {
    html += `<div class="search-section-label">Folders <span class="search-count">${folders.length}</span></div>`;
    html += folders.map((fo, i) => `
      <div class="search-result search-result-folder" onclick="toggleFolderContents(${i}, ${fo.drive_id}, ${JSON.stringify(fo.path).replace(/</g, '\\u003c')})">
        <div class="search-result-icon search-icon-folder">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
        <div class="search-result-info">
          <div class="search-result-name">${fo.name}</div>
          <div class="search-result-path">${fo.path}</div>
          <div class="drive-chip">
            <div class="drive-chip-dot" style="background:${fo.drive_color || '#666'}"></div>
            ${fo.drive_label || fo.drive_name}
          </div>
        </div>
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
          <div class="search-result-icon ${cls}">${f.ext || '?'}</div>
          <div class="search-result-info">
            <div class="search-result-name">${f.name}</div>
            <div class="search-result-path">${f.path}</div>
            <div class="drive-chip">
              <div class="drive-chip-dot" style="background:${f.drive_color || '#666'}"></div>
              ${f.drive_label || f.drive_name}
            </div>
          </div>
          <div class="search-result-meta">${formatBytes(f.size)}</div>
        </div>
      `;
    }).join('');
  }

  container.innerHTML = html;
}

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
        <span class="search-result-icon ${cls}" style="font-size:11px;width:26px;height:26px;flex-shrink:0">${f.ext || '?'}</span>
        <span class="folder-contents-name">${f.name}</span>
        <span class="folder-contents-path">${f.path}</span>
        <span class="folder-contents-size">${formatBytes(f.size)}</span>
      </div>
    `;
  }).join('');
}

// ── Export ────────────────────────────────────────────────────────────────────

function toggleExportMenu() {
  const menu = document.getElementById('export-menu');
  menu.classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.export-menu-wrap')) {
    document.getElementById('export-menu')?.classList.add('hidden');
  }
});

const exportFns = { csv: 'exportCsv', json: 'exportJson', html: 'exportHtml' };

async function runExport(format) {
  document.getElementById('export-menu').classList.add('hidden');
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

let _pendingDupDriveId = null;

function resetScanModal() {
  document.getElementById('scan-spinner').classList.remove('hidden');
  document.getElementById('scan-status').textContent = 'Scanning…';
  document.getElementById('scan-result').classList.add('hidden');
  document.getElementById('dup-prompt').classList.add('hidden');
  document.getElementById('scan-done-btn').classList.add('hidden');
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
      <div class="scan-result-title">"${result.driveName}" refreshed</div>
      <div class="scan-result-stats">${changeLine}<span class="scan-stat-total">${formatNum(result.fileCount)} files total</span></div>
    `;
  } else {
    resultEl.innerHTML = `
      <div class="scan-result-icon">✓</div>
      <div class="scan-result-title">"${result.driveName}" indexed</div>
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

  if (!result || !result.ok) {
    document.getElementById('scan-overlay').classList.add('hidden');
    return;
  }

  await loadDashboard();
  loadDrivesView();

  showScanResultSummary(result);
  _pendingDupDriveId = result.driveId;
  document.getElementById('dup-prompt').classList.remove('hidden');
});

document.getElementById('dup-scan-btn').addEventListener('click', async () => {
  document.getElementById('dup-prompt').classList.add('hidden');
  document.getElementById('scan-spinner').classList.remove('hidden');
  document.getElementById('scan-status').textContent = 'Starting duplicate scan…';

  window.api.onScanProgress((msg) => {
    document.getElementById('scan-status').textContent = msg;
  });

  await window.api.scanDuplicates(_pendingDupDriveId);
  window.api.removeScanProgress();

  document.getElementById('scan-spinner').classList.add('hidden');
  document.getElementById('scan-status').textContent = '';
  document.getElementById('scan-result').querySelector('.scan-result-title').textContent += ' — duplicates checked';
  await loadDashboard();
  document.getElementById('scan-done-btn').classList.remove('hidden');
});

document.getElementById('dup-skip-btn').addEventListener('click', () => {
  document.getElementById('dup-prompt').classList.add('hidden');
  document.getElementById('scan-done-btn').classList.remove('hidden');
});

document.getElementById('scan-done-btn').addEventListener('click', () => {
  document.getElementById('scan-overlay').classList.add('hidden');
});

// ── Connection status polling ─────────────────────────────────────────────────

async function pollDriveStatus() {
  const drives = await window.api.getDrives();
  drives.forEach(d => {
    const card = document.querySelector(`.drive-card[data-drive-id="${d.id}"]`);
    if (!card) return;
    const badge = card.querySelector('.drive-status-badge');
    if (!badge) return;
    const connected = !!d.connected;
    badge.className = `drive-status-badge ${connected ? 'status-connected' : 'status-offline'}`;
    badge.innerHTML = `<span class="status-dot"></span>${connected ? 'Connected' : 'Offline'}`;
  });
}

setInterval(pollDriveStatus, 10000);

// ── Init ──────────────────────────────────────────────────────────────────────

loadDashboard();
