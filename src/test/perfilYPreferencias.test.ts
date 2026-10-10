import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PLANTILLA_DEUDA_POR_DEFECTO,
  guardarPlantillaDeuda,
  mensajeDeuda,
  plantillaDeuda,
  plantillaDeudaEsPropia,
} from '@/lib/waTemplates';

const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');

describe('plantilla del recordatorio de saldo', () => {
  afterEach(() => window.localStorage.clear());

  it('sin plantilla propia usa la de fábrica', () => {
    expect(plantillaDeuda('org-1')).toBe(PLANTILLA_DEUDA_POR_DEFECTO);
    expect(plantillaDeudaEsPropia('org-1')).toBe(false);
  });

  it('guarda, es por organización, y vacío vuelve a la de fábrica', () => {
    guardarPlantillaDeuda('org-1', 'Hola {{nombre}}, debés {{monto}}');
    expect(plantillaDeuda('org-1')).toBe('Hola {{nombre}}, debés {{monto}}');
    expect(plantillaDeuda('org-2')).toBe(PLANTILLA_DEUDA_POR_DEFECTO);
    guardarPlantillaDeuda('org-1', '   ');
    expect(plantillaDeuda('org-1')).toBe(PLANTILLA_DEUDA_POR_DEFECTO);
  });

  it('no borra lo que hubiera de versiones anteriores', () => {
    window.localStorage.setItem('gestiona.wa_templates.org-1', JSON.stringify({ sale: 'texto viejo' }));
    guardarPlantillaDeuda('org-1', 'nuevo');
    expect(JSON.parse(window.localStorage.getItem('gestiona.wa_templates.org-1')!)).toEqual({ sale: 'texto viejo', debt: 'nuevo' });
  });

  it('arma el mensaje con el primer nombre', () => {
    expect(mensajeDeuda('Hola {{nombre}}: {{monto}}', 'Laura Gómez', '$ 1.000')).toBe('Hola Laura: $ 1.000');
    expect(mensajeDeuda('Hola {{nombre}}', null, '$ 1')).toBe('Hola cliente');
  });

  it('Deudas y Ajustes usan el mismo texto, no cada una el suyo', () => {
    // Deudas tenía su propio default, distinto del que mostraba Ajustes.
    const deudas = leer('src/pages/DebtsPage.tsx');
    expect(deudas).toContain('plantillaDeuda(');
    expect(deudas).not.toContain('DEFAULT_DEBT_TEMPLATE');
    expect(leer('src/pages/SettingsPage.tsx')).not.toContain('DEFAULT_WA_TEMPLATES');
  });
});

describe('lo personal vive en el perfil', () => {
  const ajustes = leer('src/pages/SettingsPage.tsx');
  const perfil = leer('src/pages/ProfilePage.tsx');

  it('las llaves de notificación que nadie leía no volvieron', () => {
    // Se guardaban en `gestiona.notif_prefs.*` y ningún archivo las leía.
    expect(ajustes).not.toContain('notif_prefs');
    expect(ajustes).not.toContain('handlePushToggle');
  });

  it('el perfil tiene sus cuatro grupos y las piezas nuevas', () => {
    for (const id of ['cuenta', 'seguridad', 'preferencias', 'organizaciones']) {
      expect(perfil).toContain(`<h2 id="${id}"`);
    }
    expect(perfil).toContain('<SesionesPerfil');
    expect(perfil).toContain('<AparienciaPerfil />');
    expect(perfil).toContain('<NotificacionesPerfil />');
    expect(perfil).not.toContain("viewer: 'Viewer'");
  });

  it('cerrar sesiones usa la revocación de Supabase, no un logout local', () => {
    const sesiones = leer('src/components/profile/SesionesPerfil.tsx');
    expect(sesiones).toContain('supabase.auth.signOut({ scope })');
    expect(sesiones).toMatch(/"others" \| "global"/);
  });

  it('el tema «según el equipo» está habilitado sin cambiar el default', () => {
    const app = leer('src/App.tsx');
    expect(app).toContain('defaultTheme="light" enableSystem storageKey="gestiona-theme"');
  });
});
