jest.mock('child_process');
const { execSync } = require('child_process');

const { getDriveSerial, getDriveName } = require('../utils');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── getDriveSerial ────────────────────────────────────────────────────────────

describe('getDriveSerial', () => {
  it('extracts the serial number from valid vol output', () => {
    execSync.mockReturnValue(
      ' Volume in drive E is Sony T5\r\n Volume Serial Number is AB12-CD34\r\n'
    );
    expect(getDriveSerial('E:\\')).toBe('AB12-CD34');
  });

  it('is case-insensitive when matching the serial line', () => {
    execSync.mockReturnValue(
      ' Volume Serial number is 1A2B-3C4D\r\n'
    );
    expect(getDriveSerial('E:\\')).toBe('1A2B-3C4D');
  });

  it('returns null when the output has no serial number line', () => {
    execSync.mockReturnValue('Some unexpected output\r\n');
    expect(getDriveSerial('E:\\')).toBeNull();
  });

  it('returns null when execSync throws (drive letter does not exist)', () => {
    execSync.mockImplementation(() => { throw new Error('Command failed'); });
    expect(getDriveSerial('E:\\')).toBeNull();
  });

  it('returns null for a path with no root (relative path)', () => {
    expect(getDriveSerial('some/relative/path')).toBeNull();
    expect(execSync).not.toHaveBeenCalled();
  });
});

// ── getDriveName ──────────────────────────────────────────────────────────────

describe('getDriveName', () => {
  it('returns the folder name for a normal nested path', () => {
    expect(getDriveName('E:\\Projects\\Work')).toBe('Work');
  });

  it('returns the drive letter for a root Windows path', () => {
    expect(getDriveName('E:\\')).toBe('E:');
  });

  it('handles forward-slash root paths', () => {
    expect(getDriveName('E:/')).toBe('E:');
  });

  it('returns the last segment for a Mac-style Volumes path', () => {
    expect(getDriveName('/Volumes/SonyT5')).toBe('SonyT5');
  });

  it('falls back to the full path if both basename and root are empty', () => {
    expect(getDriveName('')).toBe('');
  });
});
