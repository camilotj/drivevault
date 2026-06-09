# DriveVault

An Electron desktop app for cataloguing external drives and SSDs. Scan a drive once, then browse its files, search across all indexed drives, and find duplicates — even when the drive is unplugged.

---

## What it does

- **Offline catalog** — scans a drive and stores every file and folder into a local SQLite database. Once indexed, the catalog is fully browsable without the drive connected.
- **Connection status** — the dashboard shows which drives are currently plugged in and which are offline.
- **Search** — find files and folders by name across all indexed drives. Folder results are expandable to show their contents inline.
- **Duplicate detection** — finds files with identical content (by MD5 hash) across all drives, grouped for review.
- **Drive management** — rename drives, assign a colour, add a description, re-scan to refresh the catalog, or remove a drive from the index.

---

## Project structure

```
drivevault/
├── main.js           # Electron main process: DB setup, IPC handlers, scan orchestration
├── scanner.js        # Pure Node.js: directory walk + file hashing (no Electron dependency)
├── preload.js        # Context bridge: exposes safe IPC calls to the renderer
├── renderer/
│   ├── index.html    # App shell and modals
│   ├── app.js        # All UI logic: dashboard, drives, search, duplicates, scan flow
│   └── style.css     # Dark theme styles
├── tests/
│   └── scanner.test.js  # Jest tests for scanner.js
└── package.json
```

---

## Architecture

```
Renderer (index.html + app.js)
        │  contextBridge (preload.js)
        ▼
Main process (main.js)
        │
        ├── scanner.js  ──▶  fs (Node.js)
        └── sql.js      ──▶  drivevault.db  (userData directory)
```

The renderer has no direct Node.js or filesystem access. Everything goes through the context bridge defined in `preload.js`, which maps friendly method names to `ipcRenderer.invoke` calls. The main process owns the database and filesystem.

### Database

A single SQLite file (`drivevault.db`) stored in Electron's `userData` directory. Three tables:

| Table | Purpose |
|---|---|
| `drives` | One row per indexed drive. Stores name, label, path, colour, size stats, scan timestamp. |
| `files` | One row per file found during a scan. Stores name, path, size, extension, modified date, MD5 hash. |
| `folders` | One row per directory found during a scan. Stores name and path. Used by folder search. |

`files` and `folders` both have a `drive_id` foreign key with `ON DELETE CASCADE`, so removing a drive cleans up all its records.

### Scanning

`scanner.js` exports two functions:

- **`hashFile(filePath)`** — reads a file and returns its MD5 hex digest, or `null` on any read error.
- **`scanDirectory(dirPath, driveId, sendProgress)`** — recursive directory walk. Returns `{ files, folders, folderCount }`. Skips dot-prefixed entries. Skips hashing files ≥ 500 MB. Caps recursion at depth 20. All filesystem errors are caught per-entry so a single unreadable file or a mid-scan drive disconnect cannot abort the whole scan.

The `scan-folder` IPC handler in `main.js` orchestrates the full flow:
1. Opens a directory picker dialog.
2. Reads disk usage via `fs.statfsSync`.
3. Checks if the path was previously scanned (re-scan vs. new drive).
4. Calls `scanDirectory` and writes results to the DB in a single transaction.
5. Streams progress messages back to the renderer via `webContents.send`.

### Connection status

`get-drives` calls `fs.existsSync(drive.path)` for each drive before returning results. This is fast (single stat per drive) and gives an accurate connected/offline flag at load time.

---

## Getting started

**Prerequisites:** Node.js 18+ and npm.

```bash
# Install dependencies
npm install

# Run in development
npm start

# Run tests
npm test
```

### Building a distributable

```bash
npm run build:win    # Windows NSIS installer
npm run build:mac    # macOS DMG
npm run build:linux  # Linux AppImage
```

Output goes to `dist/`.

---

## Testing

Tests live in `tests/scanner.test.js` and cover `scanner.js` in isolation using Jest's `fs` mock — no real filesystem access, no Electron.

```
Tests: 15 passing

hashFile
  ✓ returns an md5 hex string for a readable file
  ✓ returns null when the file cannot be read

scanDirectory — normal operation
  ✓ returns all files and correct folder count
  ✓ returns folder entries with name, path, and drive_id
  ✓ folder count matches folders array length
  ✓ skips hidden files and dot-prefixed entries
  ✓ skips hidden directories
  ✓ calls sendProgress every 100 files

scanDirectory — drive disconnects mid-scan
  ✓ returns empty result when root directory is gone before scan starts
  ✓ returns partial results when drive disconnects partway through
  ✓ skips a file whose stat throws (file disappears between readdir and stat)
  ✓ still records a file when hashing fails
  ✓ does not crash on deeply nested disconnects
  ✓ enforces the depth=20 safety cap and does not recurse forever

scanDirectory — large file skips hash
  ✓ does not hash files >= 500 MB
```

The IPC handlers in `main.js` are not unit-tested — they depend on `sql.js` and Electron and are best covered by manual smoke testing or an Electron integration test framework (e.g. Playwright with `electron` driver).

---

## IPC API reference

All calls go through `window.api` (exposed by `preload.js`).

| Method | Arguments | Returns |
|---|---|---|
| `getDrives()` | — | Array of drive objects, each with a `connected` boolean |
| `getDriveFiles(driveId)` | `driveId: number` | Array of file objects for that drive |
| `deleteDrive(driveId)` | `driveId: number` | `{ ok: true }` |
| `updateDriveLabel(driveId, label, color, description)` | — | `{ ok: true }` |
| `getDuplicates()` | — | Array of groups; each group is an array of files sharing an MD5 hash |
| `searchFiles(query)` | `query: string` | `{ files: [...], folders: [...] }` — name-only match, no path matching |
| `getFolderFiles(driveId, folderPath)` | — | Array of files whose path starts with `folderPath` |
| `getStats()` | — | `{ driveCount, fileCount, totalSize, dupCount }` |
| `scanFolder()` | — | `{ ok, isUpdate, driveName, fileCount, added?, removed? }` or `{ canceled: true }` |
| `onScanProgress(cb)` | `cb: (msg: string) => void` | Registers a listener for scan progress messages |
| `removeScanProgress()` | — | Removes all scan progress listeners |

---

## Known limitations

- **Folder search requires a re-scan.** Drives indexed before folder search was introduced do not have folder records. Re-scanning a drive populates them.
- **Connection status is checked at load time only.** Plugging in a drive while the app is open will not update the status badge until the dashboard reloads.
- **Hashing skips files ≥ 500 MB.** Large files (disk images, video exports) will not be included in duplicate detection.
- **No Windows UNC path support.** Paths like `\\server\share` are untested.
