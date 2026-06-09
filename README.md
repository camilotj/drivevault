# DriveVault

An Electron desktop app for cataloguing external drives and SSDs. Scan a drive once, then browse its files, search across all indexed drives, and find duplicates — even when the drive is unplugged.

---

## What it does

- **Offline catalog** — scans a drive and stores every file and folder into a local SQLite database. Once indexed, the catalog is fully browsable without the drive connected.
- **Two-phase scanning** — a fast metadata scan runs first (names, sizes, dates). You are then asked whether to run a separate duplicate scan that reads file contents. Both phases show live progress.
- **Connection status** — drive cards show Connected / Offline and refresh automatically every 10 seconds.
- **Duplicate detection** — finds files with identical content (MD5 hash) across all drives. Fully-duplicated folders are shown as a single collapsed group rather than a long list of individual files.
- **Search** — find files and folders by name across all indexed drives. Folder results expand inline to show their contents.
- **Drive management** — rename drives, assign a colour, add a description, re-scan to refresh the catalog, or remove a drive from the index.
- **Export** — export the full catalog as CSV (opens in Excel), JSON, or a self-contained HTML report.
- **Database management** — choose where the database file is saved, move it to a new location, or import an existing `.db` file. All configurable from the Settings view.

---

## Project structure

```
drivevault/
├── main.js              # Electron main process: DB setup, IPC handlers, scan orchestration
├── scanner.js           # Pure Node.js: directory walk, no Electron dependency
├── preload.js           # Context bridge: exposes safe IPC calls to the renderer
├── renderer/
│   ├── index.html       # App shell and modals
│   ├── app.js           # All UI logic: dashboard, drives, search, duplicates, settings, scan flow
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
| `drives` | One row per indexed drive. Stores name, label, path, colour, size stats, scan timestamp, and `dup_scanned_at` (null until duplicate scan is run). |
| `files` | One row per file. Stores name, path, size, extension, modified date, and MD5 hash (null until duplicate scan runs for that drive). |
| `folders` | One row per directory. Stores name and path. Used by folder search. |

`files` and `folders` both have a `drive_id` foreign key with `ON DELETE CASCADE`, so removing a drive cleans up all its records.

### Scanning — two phases

**Phase 1 — Metadata scan (always runs, fast)**

`scanner.js` walks the directory tree using `fs.readdirSync` and `fs.statSync`. It collects file name, size, extension, and modified date — but never reads file contents. All files are saved to the DB with `hash: null`. This phase completes in seconds even on large drives.

`scanner.js` exports two functions:
- **`scanDirectory(dirPath, driveId, sendProgress)`** — recursive walk. Returns `{ files, folders, folderCount }`. Skips dot-prefixed entries. Caps recursion at depth 20. All filesystem errors are caught per-entry so a disconnected drive cannot abort the scan.
- **`hashFile(filePath)`** — reads a file and returns its MD5 hex digest, or `null` on error. Called by the main process during Phase 2, not by the scanner itself.

**Phase 2 — Duplicate scan (optional, user-prompted)**

After the metadata scan completes, the user is asked whether to run a duplicate scan. If they choose yes (or click the "No dup scan" badge on a drive card later):

1. All file sizes for the target drive are loaded from the DB.
2. A size-frequency map is built for the current drive's files, and a set of sizes already present on other drives is queried from the DB.
3. Only files whose size appears more than once — either within this drive or on another drive — are candidates. Files with a globally unique size cannot be duplicates and are never read.
4. Candidate files are read and MD5-hashed. The DB is updated with each hash. Progress is streamed to the UI.
5. `dup_scanned_at` is set on the drive record.

Drives that have not had a duplicate scan show an amber "No dup scan" badge on their dashboard card. Clicking the badge starts the duplicate scan immediately without needing a full re-scan.

### Connection status

`get-drives` calls `fs.existsSync(drive.path)` for each drive before returning. The renderer polls this every 10 seconds and updates only the status badge on each card — no full re-render.

### Duplicate detection

`get-duplicates` queries for all files that share a hash with at least one other file. Before returning, it identifies fully-duplicated directories: a directory is fully duplicated if every one of its direct children appears in a duplicate group. Matching directories on different drives are surfaced as a single folder group. Files already covered by a folder group are excluded from the individual file groups, keeping the list concise.

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
git tag v1.0.0
git push origin v1.0.0
```

The workflow file is at [.github/workflows/build.yml](.github/workflows/build.yml).

---

## Testing

Tests live in `tests/scanner.test.js` and cover `scanner.js` in isolation using Jest's `fs` mock — no real filesystem, no Electron.

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
  ✓ never calls readFileSync — hashing is deferred to the caller
  ✓ does not crash on deeply nested disconnects
  ✓ enforces the depth=20 safety cap and does not recurse forever

scanDirectory — hash is always null
  ✓ all returned files have hash: null regardless of size
```

---

## IPC API reference

All calls go through `window.api` (exposed by `preload.js`).

| Method | Arguments | Returns |
|---|---|---|
| `getDrives()` | — | Array of drive objects, each with a `connected` boolean and `dup_scanned_at` |
| `getDriveFiles(driveId)` | `driveId: number` | Array of file objects for that drive |
| `deleteDrive(driveId)` | `driveId: number` | `{ ok: true }` |
| `updateDriveLabel(driveId, label, color, description)` | — | `{ ok: true }` |
| `getDuplicates()` | — | `{ fileGroups, folderGroups }` |
| `searchFiles(query)` | `query: string` | `{ files, folders }` — name-only match |
| `getFolderFiles(driveId, folderPath)` | — | Array of files under `folderPath` |
| `getStats()` | — | `{ driveCount, fileCount, totalSize, dupCount }` |
| `scanFolder()` | — | `{ ok, isUpdate, driveName, fileCount, driveId, added?, removed? }` |
| `scanDuplicates(driveId)` | `driveId: number` | `{ ok, candidateCount }` |
| `exportCsv()` | — | `{ ok, filePath }` or `{ canceled: true }` |
| `exportJson()` | — | `{ ok, filePath }` or `{ canceled: true }` |
| `exportHtml()` | — | `{ ok, filePath }` or `{ canceled: true }` |
| `getDbPath()` | — | Absolute path string of the current database file |
| `changeDbLocation(copyExisting)` | `copyExisting: boolean` | `{ ok, dbPath }` or `{ canceled: true }` |
| `importDb()` | — | `{ ok }` or `{ canceled: true }` |
| `showItemInFolder(path)` | `path: string` | Opens Explorer with the file highlighted |
| `onScanProgress(cb)` | `cb: (msg: string) => void` | Registers a scan progress listener |
| `removeScanProgress()` | — | Removes all scan progress listeners |

---

## Known limitations

- **Folder search requires a re-scan** on drives indexed before folder records were introduced. Re-scanning populates them.
- **Duplicate detection requires a dup scan on each drive.** Cross-drive duplicates only appear once both drives have had their duplicate scan run.
- **Files ≥ 500 MB are not hashed.** Large files (disk images, raw video) are excluded from duplicate detection.
- **No Windows UNC path support.** Paths like `\\server\share` are untested.
