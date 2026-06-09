const fs = require('fs');
const path = require('path');

function scanDirectory(dirPath, driveId, sendProgress) {
  const files = [];
  const folders = [];
  let folderCount = 0;

  function walk(currentPath, depth = 0) {
    if (depth > 20) return;
    let entries;
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        folderCount++;
        folders.push({ drive_id: driveId, name: entry.name, path: fullPath });
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          const ext = path.extname(entry.name).toLowerCase().replace('.', '') || 'file';

          files.push({
            drive_id: driveId,
            name: entry.name,
            path: fullPath,
            size: stat.size,
            ext,
            modified_at: stat.mtime.toISOString()
          });

          if (files.length % 100 === 0) {
            sendProgress(`Scanning… ${files.length} files found`);
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(dirPath);
  return { files, folders, folderCount };
}

module.exports = { scanDirectory };
