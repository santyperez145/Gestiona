import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const orgContext = readFileSync(resolve(process.cwd(), "src/lib/orgContext.tsx"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

describe("cambio de organización sin recarga", () => {
  it("actualiza el contexto y la autoridad global en memoria", () => {
    expect(orgContext).toContain("setActiveOrg(m.organization)");
    expect(orgContext).toContain("_activeOrgId = m.org_id");
    expect(orgContext).toContain("localStorage.setItem(ACTIVE_ORG_KEY, m.org_id)");
  });

  it("no reinicia el documento para cambiar de tenant", () => {
    expect(orgContext).not.toContain("location.reload");
    expect(orgContext).not.toContain("location.href");
  });

  it("desmonta las rutas anteriores antes de mostrar la nueva organización", () => {
    expect(app).toContain("function OrganizationScope()");
    expect(app).toContain('return <AppLoader label="Cambiando organización..." />');
    expect(app).toContain("<ApplicationRoutes key={readyScope} />");
  });

  it("cancela y retira caches antes de habilitar el scope nuevo", () => {
    expect(app).toContain("client.cancelQueries()");
    expect(app).toContain("client.removeQueries()");
    expect(app.indexOf("client.removeQueries()")).toBeLessThan(app.indexOf("setReadyScope(requestedScope)"));
  });
});
