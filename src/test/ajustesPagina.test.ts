import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Lo que se arregló en Ajustes el 2026-10-09 y no tiene que volver.
 */
const pagina = readFileSync(resolve(process.cwd(), 'src/pages/SettingsPage.tsx'), 'utf8');

describe('Ajustes', () => {
  it('guarda desde una sola barra, en cualquier pestaña', () => {
    // El único «Guardar» vivía en Finanzas: Tienda e Impuestos no tenían con
    // qué guardar y el encabezado decía «Cambios guardados por sección».
    expect(pagina).not.toContain('Cambios guardados por sección');
    expect(pagina).not.toContain('Guardar Configuración');
    expect(pagina).not.toContain('handleSavePricing');
    expect(pagina.match(/onClick=\{\(\) => void handleSave\(\)\}/g)).toHaveLength(1);
    expect(pagina).toContain('aria-label="Cambios sin guardar"');
  });

  it('manda sólo lo que cambió', () => {
    // Mandar el formulario entero pisaba lo guardado desde otra computadora.
    expect(pagina).toContain('soloCambios(borrador, cambios)');
  });

  it('cada panel se monta sólo en su pestaña', () => {
    const paneles = pagina.match(/className="settings-panel settings-panel--/g) ?? [];
    const condicionados = pagina.match(/\{settingsSection === "\w+" && \(\n\s*<div[^>]*className="settings-panel settings-panel--/g) ?? [];
    expect(paneles.length).toBeGreaterThan(15);
    expect(condicionados.length).toBe(paneles.length);
  });

  it('no muestra estados que no chequea', () => {
    // «IA: Activo ✓» y «Versión: 8.5» eran texto fijo.
    expect(pagina).not.toMatch(/>IA:<\/span>/);
    expect(pagina).not.toMatch(/>Auditoría:<\/span>/);
    expect(pagina).not.toMatch(/>Versión:<\/span>/);
  });

  it('no tiene restos de un rubro ni acciones masivas sin confirmación', () => {
    // Decants es fraccionar perfume; el «Recalcular» reescribía el precio de
    // todo el catálogo, sumaba la aduana dos veces (ver C28.1 en Productos) y
    // le ponía un 20 % de descuento permanente a cada producto.
    expect(pagina).not.toMatch(/Decants/i);
    expect(pagina).not.toContain('handleRecalculate');
    expect(pagina).not.toContain('Aduana y traslado');
  });

  it('una carga fallida se puede reintentar', () => {
    expect(pagina).toContain('if (errorCarga) return (');
    expect(pagina).toContain('onClick={() => void cargar()}');
  });
});
