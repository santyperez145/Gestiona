import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAV_ITEMS, NIVEL_DE_DESTINO, PERFILES_MENU, apareceEnPerfil, esPerfilMenu } from '@/lib/navigation';

const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), 'utf8');

describe('perfil del menú', () => {
  it('cada destino del menú tiene su nivel declarado', () => {
    // Una pantalla nueva tiene que decidir en qué perfil aparece.
    const sinNivel = NAV_ITEMS.map(i => i.to).filter(to => !(to in NIVEL_DE_DESTINO));
    expect(sinNivel).toEqual([]);
  });

  it('el emprendedor ve lo esencial, no las ~50 entradas', () => {
    const vendedorAdmin = NAV_ITEMS.filter(i => i.roles.includes('admin'));
    const emprendedor = vendedorAdmin.filter(i => apareceEnPerfil(i.to, 'emprendedor'));
    expect(emprendedor.length).toBeLessThanOrEqual(20);
    for (const esencial of ['/', '/caja', '/productos', '/clientes', '/facturas', '/ajustes']) {
      expect(emprendedor.map(i => i.to)).toContain(esencial);
    }
    expect(emprendedor.map(i => i.to)).not.toContain('/cheques');
  });

  it('los perfiles son acumulativos', () => {
    for (const { to } of NAV_ITEMS) {
      if (apareceEnPerfil(to, 'emprendedor')) expect(apareceEnPerfil(to, 'establecido')).toBe(true);
      if (apareceEnPerfil(to, 'establecido')) expect(apareceEnPerfil(to, 'avanzado')).toBe(true);
    }
  });

  it('sin perfil elegido se ve todo: nadie pierde lo que usa', () => {
    expect(NAV_ITEMS.every(i => apareceEnPerfil(i.to, null))).toBe(true);
    expect(NAV_ITEMS.every(i => apareceEnPerfil(i.to, 'avanzado'))).toBe(true);
  });

  it('valida los valores que llegan de la base', () => {
    expect(PERFILES_MENU.map(p => p.id).every(esPerfilMenu)).toBe(true);
    expect(esPerfilMenu('experto')).toBe(false);
    expect(esPerfilMenu(null)).toBe(false);
  });

  it('el menú manda lo oculto a «Más herramientas» y siempre muestra la página actual', () => {
    const layout = leer('src/components/AppLayout.tsx');
    expect(layout).toContain('item.to === pathname || apareceEnPerfil(item.to, config.perfilMenu)');
    expect(layout).toContain("label: `Más herramientas (${masHerramientas.length})`");
  });

  it('la base acepta sólo los tres perfiles y NULL', () => {
    const sql = leer('supabase/migrations/20261010001400_perfil_del_menu.sql');
    expect(sql).toContain("CHECK (perfil_menu IS NULL OR perfil_menu IN ('emprendedor', 'establecido', 'avanzado'))");
  });
});
