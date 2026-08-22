import { describe, expect, it } from 'vitest';
import {
  detectFinanceDocumentMime,
  findActivePdfFeature,
  sha256Hex,
} from '../../supabase/functions/_shared/financeDocumentInspection';

describe('finance document byte inspection', () => {
  it('detects supported types from magic bytes instead of browser metadata', () => {
    expect(detectFinanceDocumentMime(new TextEncoder().encode('%PDF-1.7\n'))).toBe('application/pdf');
    expect(detectFinanceDocumentMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectFinanceDocumentMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectFinanceDocumentMime(new TextEncoder().encode('RIFF1234WEBP'))).toBe('image/webp');
    expect(detectFinanceDocumentMime(new TextEncoder().encode('<script>'))).toBeNull();
  });

  it('quarantines active PDF capabilities before invoking antivirus', () => {
    expect(findActivePdfFeature(new TextEncoder().encode('%PDF-1.7\n/JavaScript 1 0 R'))).toBe('/JavaScript');
    expect(findActivePdfFeature(new TextEncoder().encode('%PDF-1.7\n/EmbeddedFile 2 0 R'))).toBe('/EmbeddedFile');
    expect(findActivePdfFeature(new TextEncoder().encode('%PDF-1.7\n1 0 obj'))).toBeNull();
  });

  it('recalculates a deterministic SHA-256 over the actual bytes', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
