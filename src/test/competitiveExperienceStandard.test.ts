import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const standard = read('docs/ESTANDAR_EXPERIENCIA_COMPETITIVA.md');

describe('estándar integral de experiencia competitiva', () => {
  it('separa evidencia, observación, decisión e hipótesis y prohíbe copiar', () => {
    expect(standard).toContain('✅ Verificado');
    expect(standard).toContain('👁 Observado');
    expect(standard).toContain('📌 Decisión Gestiona');
    expect(standard).toContain('❓ Hipótesis');
    expect(standard).toContain('Traducción, no copia');
  });

  it('define anatomía, arquetipos y estados antes de declarar una pantalla completa', () => {
    expect(standard).toContain('## 4. Anatomía universal de una pantalla');
    expect(standard).toContain('## 5. Arquetipos de pantalla');
    expect(standard).toContain('## 9. Estados completos y recuperación');
    expect(standard).toContain('Empty-filtered');
    expect(standard).toContain('Permission');
    expect(standard).toContain('Partial');
  });

  it('distingue overlay, filtro, vista, segmento, cohorte y cola', () => {
    expect(standard).toContain('## 6. Overlays: modal, sheet, drawer, popover y feedback');
    expect(standard).toContain('## 7. Vistas, filtros, segmentos, cohortes y colas');
    for (const concept of ['| Filtro |', '| Vista guardada |', '| Segmento |', '| Cohorte |', '| Cola |']) {
      expect(standard).toContain(concept);
    }
  });

  it('mantiene el stack y exige una puerta medible antes de adoptar tecnología', () => {
    expect(standard).toContain('### Base aprobada al 2026-08-22');
    expect(standard).toContain('### Puerta para una dependencia nueva');
    expect(standard).toContain('Umbral: 80/100');
    expect(standard).toContain('Rewrite a otro framework/meta-framework');
  });

  it('mantiene referentes regionales para Finance y el ecosistema argentino', () => {
    for (const reference of [
      'Mendel',
      'Clara Global',
      'Rindegastos',
      'SAP Concur Argentina',
      'Tiendanube',
      'Empretienda',
      'Contabilium',
      'Xubio',
      'Colppy',
      'Mercado Libre + Mercado Pago',
    ]) {
      expect(standard, `falta el benchmark regional ${reference}`).toContain(reference);
    }
  });

  it('convierte la comparación en alcance y límites explícitos', () => {
    expect(standard).toContain('📌 **Límite Finance:**');
    expect(standard).toContain('📌 **Paridad local obligatoria:**');
    expect(standard).toContain('Emitir tarjetas o');
    expect(standard).toContain('mover dinero exige demanda');
    expect(standard).toContain('mismo Business Graph');
  });

  it('queda enlazado desde los documentos rectores y las instrucciones del repo', () => {
    const requiredLinks = [
      'ROADMAP.md',
      'DESIGNROADMAP.md',
      'docs/INTERFAZ.md',
      'AGENTS.md',
    ];

    for (const path of requiredLinks) {
      expect(read(path), `${path} dejó de señalar el estándar competitivo`)
        .toContain('ESTANDAR_EXPERIENCIA_COMPETITIVA.md');
    }
  });
});
