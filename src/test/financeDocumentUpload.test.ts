import { describe, expect, it } from 'vitest';
import { validateFinanceDocumentFile } from '@/lib/financeDocumentUpload';

describe('finance document upload rules', () => {
  it('accepts supported documents under the storage limit', () => {
    expect(validateFinanceDocumentFile({ name: 'factura.pdf', type: 'application/pdf', size: 2048 })).toBeNull();
    expect(validateFinanceDocumentFile({ name: 'ticket.webp', type: 'image/webp', size: 1024 })).toBeNull();
  });

  it('rejects unsupported mime types, empty files and oversized files', () => {
    expect(validateFinanceDocumentFile({ name: 'factura.csv', type: 'text/csv', size: 2048 })).toContain('PDF');
    expect(validateFinanceDocumentFile({ name: 'vacío.pdf', type: 'application/pdf', size: 0 })).toContain('entre 1 byte');
    expect(validateFinanceDocumentFile({ name: 'grande.pdf', type: 'application/pdf', size: 10 * 1024 * 1024 + 1 })).toContain('10 MB');
  });
});
