const path = require('path');

jest.mock('fs');
const fs = require('fs');

const { scanDirectory } = require('../scanner');

function makeFile(name) {
  return { name, isDirectory: () => false, isFile: () => true };
}
function makeDir(name) {
  return { name, isDirectory: () => true, isFile: () => false };
}

const noop = () => {};

const ROOT = path.join('/drive');
const SUB  = path.join('/drive', 'sub');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── scanDirectory — normal operation ───────────────────────────────────────

describe('scanDirectory — normal operation', () => {
  beforeEach(() => {
    fs.readdirSync.mockImplementation((p) => {
      if (p === ROOT) return [makeFile('a.txt'), makeDir('sub')];
      if (p === SUB)  return [makeFile('b.jpg')];
      return [];
    });
    fs.statSync.mockReturnValue({ size: 100, mtime: new Date('2024-01-01') });
    fs.readFileSync.mockReturnValue(Buffer.from('data'));
  });

  it('returns all files and correct folder count', () => {
    const { files, folderCount } = scanDirectory(ROOT, 1, noop);
    expect(files).toHaveLength(2);
    expect(folderCount).toBe(1);
  });

  it('returns folder entries with name, path, and drive_id', () => {
    const { folders } = scanDirectory(ROOT, 1, noop);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({
      drive_id: 1,
      name: 'sub',
      path: SUB,
    });
  });

  it('folder count matches folders array length', () => {
    const { folders, folderCount } = scanDirectory(ROOT, 1, noop);
    expect(folders).toHaveLength(folderCount);
  });

  it('skips hidden files and dot-prefixed entries', () => {
    fs.readdirSync.mockReturnValue([makeFile('.DS_Store'), makeFile('visible.txt')]);
    const { files } = scanDirectory(ROOT, 1, noop);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('visible.txt');
  });

  it('skips hidden directories', () => {
    fs.readdirSync.mockImplementation((p) => {
      if (p === ROOT) return [makeDir('.hidden'), makeDir('visible')];
      return [];
    });
    const { folders } = scanDirectory(ROOT, 1, noop);
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('visible');
  });

  it('calls sendProgress every 100 files', () => {
    const entries = Array.from({ length: 200 }, (_, i) => makeFile(`f${i}.txt`));
    fs.readdirSync.mockReturnValue(entries);
    const spy = jest.fn();
    scanDirectory(ROOT, 1, spy);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── scanDirectory — drive disconnects mid-scan ──────────────────────────────

describe('scanDirectory — drive disconnects mid-scan', () => {
  it('returns empty result when root directory is gone before scan starts', () => {
    fs.readdirSync.mockImplementation(() => { throw new Error('ENOENT: no such file'); });
    const { files, folders, folderCount } = scanDirectory(ROOT, 1, noop);
    expect(files).toHaveLength(0);
    expect(folders).toHaveLength(0);
    expect(folderCount).toBe(0);
  });

  it('returns partial results when drive disconnects partway through (subdirectory fails)', () => {
    fs.readdirSync.mockImplementation((p) => {
      if (p === ROOT) return [makeFile('a.txt'), makeDir('sub')];
      throw new Error('EIO: i/o error');
    });
    fs.statSync.mockReturnValue({ size: 50, mtime: new Date('2024-01-01') });
    fs.readFileSync.mockReturnValue(Buffer.from('x'));

    const { files, folders, folderCount } = scanDirectory(ROOT, 1, noop);
    // a.txt captured; sub's contents lost, but sub itself was recorded before failing
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('a.txt');
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('sub');
    expect(folderCount).toBe(1);
  });

  it('skips a file whose stat throws (file disappears between readdir and stat)', () => {
    fs.readdirSync.mockReturnValue([makeFile('present.txt'), makeFile('vanished.txt')]);
    fs.statSync.mockImplementation((p) => {
      if (p.endsWith('vanished.txt')) throw new Error('ENOENT');
      return { size: 10, mtime: new Date('2024-01-01') };
    });
    fs.readFileSync.mockReturnValue(Buffer.from('ok'));

    const { files } = scanDirectory(ROOT, 1, noop);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('present.txt');
  });

  it('never calls readFileSync — hashing is deferred to the caller', () => {
    fs.readdirSync.mockImplementation((p) => {
      if (p === ROOT) return [makeFile('a.txt'), makeDir('sub')];
      if (p === SUB)  return [makeFile('b.jpg')];
      return [];
    });
    fs.statSync.mockReturnValue({ size: 100, mtime: new Date('2024-01-01') });

    scanDirectory(ROOT, 1, noop);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('does not crash on deeply nested disconnects', () => {
    let callCount = 0;
    fs.readdirSync.mockImplementation(() => {
      callCount++;
      if (callCount > 3) throw new Error('EIO');
      return [makeDir('sub')];
    });

    expect(() => scanDirectory(ROOT, 1, noop)).not.toThrow();
  });

  it('enforces the depth=20 safety cap and does not recurse forever', () => {
    fs.readdirSync.mockReturnValue([makeDir('sub')]);

    const { folders, folderCount } = scanDirectory(ROOT, 1, noop);
    // depth 0..20 → 21 readdirSync calls; depth 21 hits the guard and returns
    expect(fs.readdirSync).toHaveBeenCalledTimes(21);
    expect(folderCount).toBe(21);
    expect(folders).toHaveLength(21);
  });
});

// ── scanDirectory — no hash field ─────────────────────────────────────────

describe('scanDirectory — no hash field', () => {
  it('returned files have no hash property', () => {
    fs.readdirSync.mockReturnValue([makeFile('small.txt'), makeFile('bigfile.iso')]);
    fs.statSync
      .mockReturnValueOnce({ size: 100, mtime: new Date('2024-01-01') })
      .mockReturnValueOnce({ size: 600 * 1024 * 1024, mtime: new Date('2024-01-01') });

    const { files } = scanDirectory(ROOT, 1, noop);
    expect(files).toHaveLength(2);
    expect(files.every(f => !('hash' in f))).toBe(true);
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });
});
