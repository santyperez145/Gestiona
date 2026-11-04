import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { avisoDePasoGuardado, pasosDelArmado } from '@/lib/storeFirstPublish';
import { evaluateStoreReadiness } from '@/lib/storeReadiness';
import { storeFormDesdeFila } from '@/lib/storeDraft';

const STORE = readFileSync(resolve(__dirname, '../pages/EcommerceStorePage.tsx'), 'utf8');

/** Una tienda recién creada: producto cargado, cobro por transferencia, retiro sin dirección. */
const FILA = {
  id: 't1',
  name: 'Mi Tienda',
  slug: 'mi-tienda',
  is_active: false,
  payment_methods: ['transferencia'],
  shipping_mode: 'zones',
  pickup_enabled: true,
  pickup_address: null,
  pickup_instructions: null,
};

const SENALES = {
  publishedProducts: 1,
  productsWithoutWeight: 1,
  shippingZones: 6,
  zonesWithRates: 0,
  coveredProvinces: 0,
  paymentConnected: false,
  legalPages: { missingOrTemplate: 2, drafts: 0 },
};

/** Lo mismo que hace `readinessDe` en la página, con lo que se le pase. */
function pasosDe(
  form: ReturnType<typeof storeFormDesdeFila>,
  bank: { ready: boolean; bank_cbu: string; bank_alias: string },
) {
  const r = evaluateStoreReadiness({
    store: {
      is_active: form.is_active,
      slug: form.slug,
      name: form.name,
      payment_methods: form.payment_methods,
      shipping_mode: form.shipping_mode,
      pickup_enabled: form.pickup_enabled,
      pickup_address: form.pickup_address || null,
      pickup_instructions: form.pickup_instructions || null,
    },
    bankTransferReady: bank.ready,
    bank_cbu: bank.bank_cbu,
    bank_alias: bank.bank_alias,
    ...SENALES,
  });
  const pasos = pasosDelArmado({ storeExists: true, storeActive: false, fromWizard: false, checks: r.checks });
  return Object.fromEntries(pasos.map(p => [p.id, p.done]));
}

// 2026-11-04: la barra tildaba «Entrega» y «Cobro» con lo que el comercio
// estaba tipeando; si salía sin guardar, creía que el paso estaba hecho.
describe('la barra de pasos tilda con lo guardado', () => {
  it('con la fila sin dirección de retiro y el formulario con dirección, «Entrega» no está lista', () => {
    const guardado = storeFormDesdeFila(FILA);
    const tipeado = { ...guardado, pickup_address: 'Alsina 123' };
    // Lo que se tipea sí la tildaría: por eso la barra no puede leer el formulario.
    expect(pasosDe(tipeado, { ready: false, bank_cbu: '', bank_alias: 'mi.alias' }).entrega).toBe(true);
    expect(pasosDe(guardado, { ready: false, bank_cbu: '', bank_alias: '' }).entrega).toBe(false);
  });

  it('el alias tipeado sin guardar no tilda «Cobro»; el guardado sí', () => {
    const guardado = storeFormDesdeFila(FILA);
    // Con CBU y alias vacíos, el estado del banco sale sólo de lo guardado.
    expect(pasosDe(guardado, { ready: false, bank_cbu: '', bank_alias: '' }).cobro).toBe(false);
    expect(pasosDe(guardado, { ready: true, bank_cbu: '', bank_alias: '' }).cobro).toBe(true);
  });

  it('la página le pasa a la barra los pasos de la fila guardada y del banco guardado', () => {
    expect(STORE).toContain('readinessDe(storeFormDesdeFila(filaGuardada, GLOBAL_FULFILLMENT_LOCATION), bankPersistedReady, BANCO_SIN_TIPEAR)');
    expect(STORE).toContain('checks: readinessGuardada.checks');
    expect(STORE).toContain('pasos={pasosGuardados}');
    // La barra ya no se arma con el readiness del formulario.
    expect(STORE).not.toMatch(/<PasosDeLaTienda pasos=\{pasosDelArmado\(\{[\s\S]{0,200}checks: readiness\.checks/);
  });
});

// 2026-11-04: recién creada la tienda, el peor caso inicial (0 productos) se
// leía como dato y el paso de cobro abría con «Cargar el primer producto».
describe('sin las señales de esta tienda no se adivina el catálogo', () => {
  it('los avisos que dependen del surtido esperan las señales de la tienda en pantalla', () => {
    expect(STORE).toContain('const signalsReady = Boolean(store?.id) && signalsStoreId === store?.id;');
    expect(STORE).toContain('const afterCreate = signalsReady && justCreatedStoreId');
    expect(STORE).toContain('const catalogHandoff = !storeMissing && signalsReady && storeShouldShowCatalogHandoff');
    expect(STORE).toContain('const afterCatalog = !storeMissing && signalsReady && storeShouldShowAfterCatalog');
    expect(STORE).toContain('signalsReady && !catalogHandoff ? <StoreReadinessPanel');
    // Una respuesta de la tienda anterior no pisa a la nueva.
    expect(STORE).toContain('if (currentStoreIdRef.current !== storeId) return;');
    expect(STORE).toContain('setSignalsStoreId(storeId);');
  });

  it('si las señales no llegan, se avisa y se ofrece reintentar', () => {
    expect(STORE).toContain('No pudimos leer cuánto le falta a tu tienda.');
    expect(STORE).toContain('setSignalsError(true)');
  });
});

// 2026-11-04: cada paso guiado mostraba «Tienda guardada correctamente» y se
// apilaban dos iguales sin decir qué seguía.
describe('el aviso de cada paso guiado dice qué se guardó y qué sigue', () => {
  const pasos = (hechos: string[]) => ['producto', 'link', 'cobro', 'entrega', 'legales', 'publicar']
    .map(id => ({ id, label: id, done: hechos.includes(id) }));

  it('nombra el primer paso pendiente de la barra', () => {
    expect(avisoDePasoGuardado('Datos para transferir guardados', pasos(['producto', 'link', 'cobro'])))
      .toBe('Datos para transferir guardados. Ahora: decí cómo entregás');
    expect(avisoDePasoGuardado('Retiro guardado', pasos(['producto', 'link', 'cobro', 'entrega'])))
      .toBe('Retiro guardado. Ahora: publicá términos y privacidad');
  });

  it('con todo listo menos publicar, invita a publicar', () => {
    expect(avisoDePasoGuardado('Retiro guardado', pasos(['producto', 'link', 'cobro', 'entrega', 'legales'])))
      .toBe('Retiro guardado. Ya podés publicar la tienda');
  });

  it('sin pasos (tienda publicada o sin señales) sólo dice qué se guardó', () => {
    expect(avisoDePasoGuardado('Email de avisos guardado', null)).toBe('Email de avisos guardado');
    expect(avisoDePasoGuardado('Email de avisos guardado', pasos(['producto', 'link', 'cobro', 'entrega', 'legales', 'publicar'])))
      .toBe('Email de avisos guardado');
  });

  it('la página ya no muestra el aviso genérico y no apila avisos', () => {
    expect(STORE).not.toContain('Tienda guardada correctamente');
    expect(STORE).toContain('{ id: TOAST_GUARDADO }');
    expect(STORE).toContain('saveStore({ mensaje: "Retiro guardado" })');
    expect(STORE).toContain('saveStore({ mensaje: "Datos para transferir guardados" })');
  });
});

// 2026-11-04: la barra esperaba las señales pero no el banco guardado; si
// `settings` llegaba después, «Cobro» se veía pendiente a quien ya tenía alias,
// y si la lectura fallaba quedaba pendiente para siempre sin avisar.
describe('la barra también espera el banco guardado', () => {
  it('se dibuja recién con las señales y el banco leídos', () => {
    expect(STORE).toContain('filaGuardada?.id && !(signalsReady && bankLoaded) ? (');
    expect(STORE).toContain('signalsError || bankLoadError ? (');
    expect(STORE).toContain('setBankLoaded(true);');
    expect(STORE).toContain('setBankLoadError(true);');
  });

  it('«Reintentar» vuelve a pedir también el banco', () => {
    expect(STORE).toContain('if (bankLoadError || !bankLoaded) void loadBankSettings();');
    expect(STORE).toContain('if (signalsError || !signalsReady) void reloadReadinessSignals();');
  });

  it('cambiar de comercio vuelve a esperar el banco y descarta respuestas viejas', () => {
    const carga = STORE.slice(STORE.indexOf('const loadBankSettings = useCallback'));
    expect(carga).toMatch(/setBankLoaded\(false\);[\s\S]{0,900}if \(request !== bankRequestRef\.current\) return;/);
    expect(carga).toContain('}, [orgId]);');
  });

  it('sin haber leído el banco, guardar con el formulario vacío no borra el CBU', () => {
    expect(STORE).toContain('bancoLeido: bankLoadedRef.current,');
    expect(STORE).toContain('const { error: bankError } = escribirBanco\n      ? await supabase.from("settings").update({');
    expect(STORE).not.toContain('bankLoadedRef.current || bancoTipeado');
  });

  // 2026-11-04: al cambiar de comercio el formulario seguía con el CBU de A; si
  // la lectura de B fallaba o tardaba y se guardaba, el CBU de A iba a B.
  it('al cambiar de comercio vacía el banco antes de leer y marca de quién es', () => {
    const carga = STORE.slice(STORE.indexOf('const loadBankSettings = useCallback'));
    expect(carga).toMatch(
      /if \(bankFormOrgRef\.current !== \(orgId \?\? null\)\) \{\s*setBankForm\(\{ bank_cbu: "", bank_alias: "", bank_name: "", bank_holder: "" \}\);\s*setBankPersistedReady\(false\);\s*bankFormOrgRef\.current = orgId \?\? null;\s*\}\s*if \(!orgId\) return;/,
    );
    // El vaciado va antes de pedir `settings`.
    expect(carga.indexOf('setBankForm({ bank_cbu: ""')).toBeLessThan(carga.indexOf('await supabase.from("settings")'));
    expect(STORE).toContain('formOrgId: bankFormOrgRef.current,');
  });
});

// 2026-11-04: el paso «Publicar» de la barra hacía scroll al bloque pero no
// movía el foco; con teclado o lector de pantalla no pasaba nada.
describe('ir a publicar mueve el foco', () => {
  // 2026-11-04: con el aviso de WhatsApp arriba, «el primer botón habilitado»
  // era «Agregar WhatsApp», que saca a otra pestaña. El foco va a la fila de
  // publicar, que tiene marca propia.
  it('el bloque recibe foco y se enfoca el botón de la fila de publicar', () => {
    expect(STORE).toContain('(objetivo ?? bloque).focus({ preventScroll: true });');
    expect(STORE).toContain('irAlBloque("overview", "publicar-tienda", "[data-publicar-accion] button:not([disabled])")');
    expect(STORE).not.toContain('irAlBloque("overview", "publicar-tienda", "button:not([disabled])")');
    expect(STORE).toContain('id="publicar-tienda" tabIndex={-1}');
    // El aviso de WhatsApp queda fuera de la fila marcada.
    const bloque = STORE.slice(STORE.indexOf('id="publicar-tienda"'));
    const fila = bloque.indexOf('<div data-publicar-accion');
    expect(fila).toBeGreaterThan(0);
    expect(bloque.indexOf('{avisoSinWhatsApp.actionLabel}')).toBeLessThan(fila);
    expect(bloque.slice(fila).indexOf('publishCta.label')).toBeGreaterThan(0);
  });
});

describe('crear la tienda no dice «Cambios guardados»', () => {
  it('recién creada avisa que se creó', () => {
    expect(STORE).toContain('isCreatingStore ? "Tienda creada" : "Cambios guardados"');
  });
});
