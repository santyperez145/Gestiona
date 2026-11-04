import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * El inicio justo después de publicar la tienda (recorrido de capturas,
 * 2026-11-04): el «siguiente paso» repetido debajo, la bienvenida flotante
 * tapando el botón, el panel lleno de $0,00, una caja roja de IA que nadie
 * pidió y una tarjeta «Ver tienda publicada» que llevaba al panel.
 */
const leer = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const dashboard = leer('src/pages/Dashboard.tsx');

describe('inicio de una tienda recién publicada', () => {
  it('la ruta no repite el siguiente paso debajo de la caja destacada', () => {
    const checklist = leer('src/components/dashboard/SetupChecklist.tsx');
    expect(checklist).toContain('readiness.needsGoalChoice || item.id !== nextItem?.id');
  });

  it('la bienvenida no flota sobre el inicio y la oferta deja libres las barras del pie', () => {
    const ayuda = leer('src/components/tutorial/TutorialHelp.tsx');
    expect(ayuda).toContain('tutorial.id !== "bienvenida"');
    // 2026-11-04: encima del botón de ayuda, para no tapar las barras fijas
    // de Ajustes («Cambios sin guardar»), Productos y Ventas (selección).
    expect(ayuda).toContain('fixed bottom-20 right-4');
    expect(ayuda).not.toContain('fixed bottom-4 right-20');
  });

  it('sin ninguna venta no se muestran franjas ni indicadores en cero', () => {
    expect(dashboard).toContain('historicalSalesCount: allSalesRaw.length');
    expect(dashboard).toContain('liveStats={sinVentasAun ? undefined : {');
    expect(dashboard).toContain('{!sinVentasAun && <DashboardKPIsSection');
    expect(dashboard).toContain('sinVentas={sinVentasAun}');
    const foco = leer('src/components/dashboard/FocoDelDia.tsx');
    expect(foco).toContain('{!p.sinVentas && <div className="commerce-home-foco__pulse');
  });

  it('la IA proactiva sólo corre con ventas que analizar', () => {
    expect(dashboard).toContain('hasBusinessData={stats.historicalSalesCount > 0}');
  });

  it('la corrida automática de la IA no deja una caja roja que nadie pidió', () => {
    const ia = leer('src/components/dashboard/AIProactiveWidget.tsx');
    // La falla automática va a la consola y no al estado de error.
    expect(ia).toMatch(/if \(!force\) \{\s*console\.warn\("daily_pulse automático falló", cause\);\s*return;\s*\}\s*setError\(/);
    expect(ia).toContain('if (!loading && !bullets.length && !error) return null;');
  });

  it('la tarjeta de la tienda no promete la vidriera y ofrece compartir el link', () => {
    expect(dashboard).not.toContain('Ver tienda publicada');
    expect(dashboard).toContain('label: "Compartí tu tienda", icon: Share2, path: storeFirstSaleSharePath(true)');
    expect(dashboard).toContain('stats.totalProducts === 1 ? "producto" : "productos"');
  });

  // 2026-11-04: sin la clave de IA, ai-analysis tiraba un error (500) y el
  // inicio lo trataba como una falla. Ahora contesta 503 con un código y el
  // widget, al reconocer el mensaje, no muestra nada.
  it('sin IA configurada, ai-analysis contesta 503 con código y el widget calla', () => {
    const edge = leer('supabase/functions/ai-analysis/index.ts');
    const bloque = edge.slice(edge.indexOf('if (!apiKey) {'), edge.indexOf('if (!apiKey) {') + 700);
    expect(bloque).toContain('code: "ia_no_configurada"');
    expect(bloque).toContain('status: 503');
    expect(bloque).not.toContain('throw new Error');
    const mensaje = /error: "([^"]+)",\s*code: "ia_no_configurada"/.exec(bloque)?.[1];
    expect(mensaje, 'no se encontró el mensaje de ia_no_configurada').toBeTruthy();
    const ia = leer('src/components/dashboard/AIProactiveWidget.tsx');
    // El widget reconoce el mensaje exacto que escribe la función.
    expect(ia).toContain(`const IA_NO_CONFIGURADA = "${mensaje}";`);
    expect(ia).toContain('if (noConfigurada && !bullets.length) return null;');
    // 2026-11-04: con sugerencias a la vista, regenerar no puede fallar
    // callado: se saca el botón y se avisa que son las últimas.
    expect(ia).toContain('{!noConfigurada && (');
    expect(ia).toContain('Las sugerencias nuevas todavía no están disponibles; te dejamos las últimas.');
  });

  it('el encabezado no promete abrir la vidriera con una ruta del panel', () => {
    const header = leer('src/components/commerce/CommerceDashboardHeader.tsx');
    expect(header).not.toContain('Abrir tienda');
    expect(header).not.toContain('ExternalLink');
    expect(header).toContain('Administrar tienda');
  });

  it('el Foco sabe si la tienda vende con retiro y si alguna zona cotiza', () => {
    const foco = leer('src/components/dashboard/FocoDelDia.tsx');
    expect(foco).toContain('setRetiroActivo((data ?? []).length > 0)');
    expect(foco).toContain('setZonasConTarifa(filas.length - sinTarifa)');
  });
});
