# DriveVault

An Electron desktop app for cataloguing external drives and SSDs. Scan a drive once, then browse its files, search across all indexed drives, and export the catalog — even when the drive is unplugged.

---

## What it does

- **Offline catalog** — scans a drive and stores every file and folder into a local SQLite database. Once indexed, the catalog is fully browsable without the drive connected.
- **Connection status** — drive cards show Connected / Offline and refresh automatically every 10 seconds.
- **Search** — find files and folders by name across all indexed drives from the dashboard or the Search view. Folder results expand inline to show their contents.
- **Reveal in Explorer** — when a drive is connected, jump directly to any file or folder in Windows Explorer from the file tree or search results.
- **Drive identification** — uses the Windows volume serial number to distinguish different physical drives that share the same drive letter, so rescanning one drive never overwrites another.
- **Rescan** — update any drive's catalog from the Drives view without needing to remove and re-add it.
- **Drive management** — rename drives, assign a colour, add a description, or remove a drive from the index.
- **Export** — export the full catalog as CSV (opens in Excel), JSON, or a self-contained HTML report from Settings.
- **Database management** — choose where the database file lives, move it to a new location, import an existing `.db` file, or clear all data. All configurable from Settings.

---

## Project structure

```
drivevault/
├── main.js              # Electron main process: DB setup, IPC handlers, scan orchestration
├── scanner.js           # Pure Node.js: directory walk, no Electron dependency
├── preload.js           # Context bridge: exposes safe IPC calls to the renderer
├── renderer/
│   ├── index.html       # App shell and modals
│   ├── app.js           # All UI logic: dashboard, drives, search, settings, scan flow
│   └── style.css        # Dark theme styles
├── tests/
│   └── scanner.test.js  # Jest tests for scanner.js
├── assets/
│   └── favicon.ico      # App icon (256×256+)
├── .github/
│   └── workflows/
│       └── build.yml    # GitHub Actions: build and publish Windows EXEs on tag push
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
        └── sql.js      ──▶  drivevault.db  (configurable location)
```

The renderer has no direct Node.js or filesystem access. Everything goes through the context bridge defined in `preload.js`, which maps friendly method names to `ipcRenderer.invoke` calls. The main process owns the database and filesystem.

### Database

A single SQLite file (`drivevault.db`) managed by `sql.js`. Its location is configurable — the chosen path is stored in `drivevault-config.json` in Electron's `userData` folder. Defaults to `userData/drivevault.db` if no config exists.

Three tables:

| Table | Purpose |
|---|---|
| `drives` | One row per indexed drive. Stores name, label, path, colour, size stats, scan timestamp, and `volume_serial` for physical drive identification. |
| `files` | One row per file. Stores name, path, size, extension, and modified date. |
| `folders` | One row per directory. Stores name and path. Used by folder search. |

`files` and `folders` both have a `drive_id` foreign key with `ON DELETE CASCADE`, so removing a drive cleans up all its records.

### Scanning

`scanner.js` walks the directory tree using `fs.readdirSync` and `fs.statSync`. It collects file name, size, extension, and modified date — but never reads file contents. All files are saved to the DB. The scan completes in seconds even on large drives.

`scanner.js` exports one function:

- **`scanDirectory(dirPath, driveId, sendProgress)`** — recursive walk. Returns `{ files, folders, folderCount }`. Skips dot-prefixed entries. Caps recursion at depth 20. All filesystem errors are caught per-entry so a disconnected drive cannot abort the scan.

When a scan finishes, the result is compared against the previous catalog and a diff (added / removed file count) is shown in the UI. If the scanned path is a bare drive letter (e.g. `E:\`), the user is prompted to give the drive a name.

### Drive identification

Before each scan, `main.js` calls `vol <letter>:` (Windows) via `execSync` to read the volume serial number. When looking up whether a previous catalog exists for the same path, the serial number is compared. If the serials differ, the drive is treated as a new entry rather than an update — preventing different physical drives that share the same letter from overwriting each other's catalog.

### Connection status

`get-drives` calls `fs.existsSync(drive.path)` for each drive before returning. The renderer polls this every 10 seconds and updates only the status badge on each card — no full re-render.

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
npm run build:win    # Windows — NSIS installer + portable EXE
npm run build:mac    # macOS DMG
npm run build:linux  # Linux AppImage
```

Output goes to `dist/`.

### Automated releases (GitHub Actions)

Pushing a version tag triggers the build workflow, which builds the Windows EXEs and attaches them to a GitHub Release automatically:

```bash
git tag v1.0.10
git push origin master --tags
```

The workflow file is at [.github/workflows/build.yml](.github/workflows/build.yml).

---

## Testing

Tests live in `tests/scanner.test.js` and cover `scanner.js` in isolation using Jest's `fs` mock — no real filesystem, no Electron.

```
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
  ✓ never calls readFileSync — hashing is deferred to the caller
  ✓ does not crash on deeply nested disconnects
  ✓ enforces the depth=20 safety cap and does not recurse forever

scanDirectory — no hash field
  ✓ returned files have no hash property
```

---

## IPC API reference

All calls go through `window.api` (exposed by `preload.js`).

| Method | Arguments | Returns |
|---|---|---|
| `getDrives()` | — | Array of drive objects, each with a `connected` boolean |
| `getDriveFiles(driveId)` | `driveId: number` | Array of file objects for that drive |
| `deleteDrive(driveId)` | `driveId: number` | `{ ok: true }` |
| `updateDriveLabel(driveId, label, color, description)` | — | `{ ok: true }` |
| `updateDriveName(driveId, name)` | — | `{ ok: true }` |
| `searchFiles(query)` | `query: string` | `{ files, folders }` — name-only match |
| `getFolderFiles(driveId, folderPath)` | — | Array of files under `folderPath` |
| `getStats()` | — | `{ driveCount, fileCount, totalSize }` |
| `scanFolder()` | — | `{ ok, isUpdate, driveName, fileCount, driveId, added?, removed? }` |
| `rescanDrive(driveId)` | `driveId: number` | `{ ok, driveName, fileCount, added, removed }` |
| `exportCsv()` | — | `{ ok, filePath }` or `{ canceled: true }` |
| `exportJson()` | — | `{ ok, filePath }` or `{ canceled: true }` |
| `exportHtml()` | — | `{ ok, filePath }` or `{ canceled: true }` |
| `getDbPath()` | — | Absolute path string of the current database file |
| `changeDbLocation(copyExisting)` | `copyExisting: boolean` | `{ ok, dbPath }` or `{ canceled: true }` |
| `importDb()` | — | `{ ok }` or `{ canceled: true }` |
| `clearDatabase()` | — | `{ ok: true }` |
| `showItemInFolder(path)` | `path: string` | Opens Explorer with the file highlighted |
| `onScanProgress(cb)` | `cb: (msg: string) => void` | Registers a scan progress listener |
| `removeScanProgress()` | — | Removes all scan progress listeners |

---

## Known limitations

- **Folder search requires a re-scan** on drives indexed before folder records were introduced. Re-scanning populates them.
- **No Windows UNC path support.** Paths like `\\server\share` are untested.
- **Volume serial detection is Windows-only.** The drive deduplication logic falls back gracefully on other platforms but does not yet use a Mac/Linux equivalent.
