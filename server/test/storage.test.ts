import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { Storage, contentDisposition, sanitizeFileName } from '../src/lib/storage.js';
import { versionedName } from '../src/routes/documents.js';

describe('sanitizeFileName', () => {
  it.each([
    ['../../etc/passwd.pdf', 'passwd.pdf'],
    ['C:\\Users\\me\\Spec.docx', 'Spec.docx'],
    ['a<b>c:d"e|f?g*h.pdf', 'abcdefgh.pdf'],
    ['  .hidden.pdf', 'hidden.pdf'],
    ['CON.pdf', '_CON.pdf'],
    ['', 'file'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });
});

describe('Storage.resolve', () => {
  const s = new Storage(path.join(os.tmpdir(), 'qamc-root'));
  it('resolves keys inside the root', () => {
    expect(s.resolve('projects/a/b.pdf')).toBe(path.join(s.root, 'projects', 'a', 'b.pdf'));
  });
  it.each(['../outside.pdf', 'projects/../../x', '/etc/passwd', 'a\0b'])('refuses %s', (key) => {
    expect(() => s.resolve(key)).toThrow(/Invalid storage key/);
  });
});

describe('download naming', () => {
  it('appends version suffix after v1', () => {
    expect(versionedName('Spec.pdf', 1)).toBe('Spec.pdf');
    expect(versionedName('Spec.pdf', 3)).toBe('Spec_v3.pdf');
  });
  it('encodes non-ASCII names safely', () => {
    expect(contentDisposition('Spesifikasi é.pdf')).toContain("filename*=UTF-8''Spesifikasi%20%C3%A9.pdf");
  });
});
