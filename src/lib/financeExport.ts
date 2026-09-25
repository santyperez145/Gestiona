/**
 * F5.3 — Exportación contable auditada (lado cliente).
 *
 * Toda la autoridad vive en la base: `finance_export_create` genera el lote
 * desde el libro real, `finance_export_batch_csv` devuelve el CSV y
 * `finance_export_mark_exported` deja la traza de que salió. Acá sólo se
 * orquesta: rango → lote → CSV descargable con BOM UTF-8 para Excel.
 */

export interface FinanceExportBatch {
  id: string;
  fecha_desde: string;
  fecha_hasta: string;
  status: 'preparado' | 'listo' | 'exportado' | 'error';
  row_count: number;
  total_debe: number;
  total_haber: number;
  created_at: string;
  exported_at: string | null;
}

/** Descarga un texto como archivo con BOM UTF-8 para que Excel no rompa acentos. */
export function descargarCsvContable(nombreArchivo: string, contenido: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + contenido], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Nombre de archivo estable: libro-diario_2026-09-01_2026-09-30.csv */
export function nombreArchivoExport(desde: string, hasta: string): string {
  return `libro-diario_${desde}_${hasta}.csv`;
}