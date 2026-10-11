import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERFILES_MENU } from "@/lib/navigation";

const tarjeta = readFileSync(resolve(process.cwd(), "src/components/dashboard/ElegirPerfilDelMenu.tsx"), "utf8");

describe("elegir el perfil del menú desde el Inicio", () => {
  it("sólo aparece sin perfil, con los ajustes ya leídos y para dueño o administrador", () => {
    expect(tarjeta).toContain("if (!user || !orgId || !cargado || perfilMenu || oculto || leer(claveSinPerfil(orgId))) return null;");
    expect(tarjeta).toContain('if (activeRole !== "owner" && activeRole !== "admin") return null;');
  });

  it("guarda sólo el perfil y avisa al menú para que cambie sin recargar", () => {
    expect(tarjeta).toContain("await saveSettingsDB(user.id, { perfil_menu: perfil });");
    expect(tarjeta).toContain('window.dispatchEvent(new CustomEvent("nerqia:ajustes-guardados"));');
    expect(tarjeta).toContain("PERFILES_MENU.map(");
    expect(PERFILES_MENU).toHaveLength(3);
  });

  it("está en el Inicio y «Dejar todo» lo esconde sin tocar los ajustes", () => {
    const inicio = readFileSync(resolve(process.cwd(), "src/pages/Dashboard.tsx"), "utf8");
    expect(inicio).toContain("<ElegirPerfilDelMenu />");
    const dejar = tarjeta.slice(tarjeta.indexOf("const dejarTodo"), tarjeta.indexOf("return (", tarjeta.indexOf("const dejarTodo")));
    expect(dejar).not.toContain("saveSettingsDB");
  });
});
