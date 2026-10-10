import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertEnabledPoint, puntosHabilitadosCae } from '../../supabase/functions/_shared/wsfeRespuesta';
import { tipoEmisorDesdePadron } from '@/lib/emisorPadron';

const soap = (body: string) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><FEParamGetPtosVentaResponse><FEParamGetPtosVentaResult>${body}</FEParamGetPtosVentaResult></FEParamGetPtosVentaResponse></s:Body></s:Envelope>`;
const punto = (nro: string, tipo = 'CAE', bloqueado = 'N', baja = '') =>
  `<PtoVenta><Nro>${nro}</Nro><EmisionTipo>${tipo}</EmisionTipo><Bloqueado>${bloqueado}</Bloqueado><FchBaja>${baja}</FchBaja></PtoVenta>`;

describe('detección de puntos de venta para CAE', () => {
  it('devuelve sólo los habilitados, ordenados', () => {
    const xml = soap(`<ResultGet>${punto('5')}${punto('2', 'CAEA')}${punto('3', 'CAE', 'S')}${punto('1')}${punto('7', 'CAE', 'N', '20250101')}</ResultGet>`);
    expect(puntosHabilitadosCae(xml)).toEqual([1, 5]);
  });

  it('el error dice cuáles sí sirven', () => {
    const xml = soap(`<ResultGet>${punto('3')}${punto('5')}</ResultGet>`);
    expect(() => assertEnabledPoint(xml, 1)).toThrow(/Los habilitados para CAE son: 3, 5/);
    expect(() => assertEnabledPoint(soap(`<ResultGet>${punto('4')}</ResultGet>`), 1)).toThrow(/El que tenés habilitado para CAE es el 4/);
  });

  it('sin ninguno habilitado, dice dónde darlo de alta', () => {
    expect(() => assertEnabledPoint(soap('<ResultGet></ResultGet>'), 1)).toThrow(/Administración de puntos de venta/);
  });

  it('la verificación devuelve los puntos al cliente, también cuando falla', () => {
    const fn = readFileSync(resolve(process.cwd(), 'supabase/functions/afip-authorize/index.ts'), 'utf8');
    expect(fn).toContain('puntosCae = puntosHabilitadosCae(points);');
    expect(fn).toContain('return ok({ ok: false, code, error: detalle, puntos_habilitados: puntosCae });');
  });
});

describe('padrón del emisor', () => {
  it('deduce la letra que factura sin adivinar', () => {
    expect(tipoEmisorDesdePadron({ condicionIva: 'monotributo' })).toBe('monotributo');
    expect(tipoEmisorDesdePadron({ condicionIva: 'responsable_inscripto' })).toBe('responsable_inscripto');
    expect(tipoEmisorDesdePadron({ condicionIva: 'exento' })).toBe('exento');
    // Sin inscripción, no se elige por el comercio: un RI marcado como
    // monotributista emite Factura C sin IVA discriminado.
    expect(tipoEmisorDesdePadron({ condicionIva: 'consumidor_final' })).toBeNull();
  });

  it('el formulario ofrece completar con ARCA y no guarda solo', () => {
    const form = readFileSync(resolve(process.cwd(), 'src/components/afip/AfipConfigForm.tsx'), 'utf8');
    expect(form).toContain('Completar con ARCA');
    const accion = form.slice(form.indexOf('const completarConArca = async'), form.indexOf('};', form.indexOf('const completarConArca = async')));
    expect(accion).not.toMatch(/supabase\.from|\.update\(|\.upsert\(/);
  });
});
