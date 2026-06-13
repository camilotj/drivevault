const path = require('path');
const { execSync } = require('child_process');

function getDriveSerial(folderPath) {
  try {
    const root = path.parse(folderPath).root;
    if (!root) return null;
    const letter = root.replace(/[\\/]/g, '');
    const output = execSync(`vol ${letter}`, { encoding: 'utf8', timeout: 2000 });
    const match = output.match(/Serial Number is ([A-F0-9-]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getDriveName(folderPath) {
  return path.basename(folderPath) || path.parse(folderPath).root.replace(/[\\/]/g, '') || folderPath;
}

module.exports = { getDriveSerial, getDriveName };
