import { describe, expect, it } from 'vitest';

import { fileMatchesAccept } from '@/lib/filePicker';

describe('selección canónica de archivos', () => {
  it('acepta extensiones sin depender de mayúsculas', () => {
    expect(fileMatchesAccept({ name: 'CATALOGO.XLSX', type: '' }, '.xlsx,.xls,.csv')).toBe(true);
  });

  it('acepta un MIME exacto', () => {
    expect(fileMatchesAccept({ name: 'clientes', type: 'text/csv' }, 'text/csv')).toBe(true);
  });

  it('acepta familias MIME', () => {
    expect(fileMatchesAccept({ name: 'foto.webp', type: 'image/webp' }, 'image/*')).toBe(true);
  });

  it('rechaza un archivo fuera del contrato', () => {
    expect(fileMatchesAccept({ name: 'script.exe', type: 'application/octet-stream' }, '.csv,text/csv')).toBe(false);
  });

  it('no restringe cuando accept está vacío', () => {
    expect(fileMatchesAccept({ name: 'cualquier.bin', type: '' }, '')).toBe(true);
  });
});
