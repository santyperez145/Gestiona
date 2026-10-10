import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULTS_RECOMENDADOR, erroresInventarioIA, loteOptimoDeEjemplo } from '@/lib/inventarioIA';

const vacio = {
  costoPorPedido: '', costoAlmacenamientoPct: '', stockDormidoDias: '',
  maxSobrestock: '', maxDescuentoIa: '', tonoIa: '',
};

describe('ajustes de reposición e IA', () => {
  it('vacío es válido: es «no lo cargué», no cero', () => {
    expect(erroresInventarioIA(vacio)).toEqual([]);
  });

  it('acepta coma decimal, como se escribe en Argentina', () => {
    expect(erroresInventarioIA({ ...vacio, costoAlmacenamientoPct: '22,5' })).toEqual([]);
  });

  it('rechaza lo que el consumidor no puede usar', () => {
    const errores = erroresInventarioIA({
      costoPorPedido: '-1',
      costoAlmacenamientoPct: '0',
      stockDormidoDias: '7.5',
      maxSobrestock: 'muchos',
      maxDescuentoIa: '95',
      tonoIa: 'x'.repeat(121),
    });
    expect(errores).toHaveLength(6);
  });

  it('el ejemplo usa la fórmula de run_abc_analysis: √(2·D·S / (C·i/100))', () => {
    // 100/mes → 1.200/año, S = 15.000, C = 1.000, i = 20 % → √(2·1200·15000/200) = √180000 ≈ 424,3 → 425
    expect(loteOptimoDeEjemplo(15000, 20)).toBe(425);
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260806000020_metricas_de_stock.sql'), 'utf8');
    expect(sql).toContain('ceil(sqrt((2 * (f.por_dia * 365) * v_costo_pedido)');
    expect(sql).toContain('/ (f.costo_unitario * v_costo_alm_pct / 100)');
  });

  it('con un solo dato no hay lote óptimo, igual que en la base', () => {
    expect(loteOptimoDeEjemplo(15000, 0)).toBeNull();
    expect(loteOptimoDeEjemplo(0, 20)).toBeNull();
    expect(loteOptimoDeEjemplo(NaN, 20)).toBeNull();
  });

  it('los placeholders son los defaults reales del recomendador', () => {
    const fn = readFileSync(resolve(process.cwd(), 'supabase/functions/ai-offer-recommender/index.ts'), 'utf8');
    expect(fn).toContain(`settings.stock_dormido_days ?? ${DEFAULTS_RECOMENDADOR.stockDormidoDias}`);
    expect(fn).toContain(`settings.max_overstock_units ?? ${DEFAULTS_RECOMENDADOR.maxSobrestock}`);
    expect(fn).toContain(`settings.max_ai_discount_percent ?? ${DEFAULTS_RECOMENDADOR.maxDescuentoIa}`);
    expect(fn).toContain(`settings.ai_tone || "${DEFAULTS_RECOMENDADOR.tono}"`);
  });
});
