import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { navRoutes } from "@/app/routeManifest";

const root = resolve(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = read("supabase/migrations/20260906000020_platform_support_chat.sql");
const service = read("src/lib/platformSupport.ts");
const workspace = read("src/components/support/SupportWorkspace.tsx");
const app = read("src/App.tsx");

describe("chat de soporte comercio-plataforma", () => {
  it("no mezcla el soporte de Nerqia con los tickets de compradores", () => {
    expect(migration).toContain("No reutiliza portal_tickets");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.platform_support_threads");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.platform_support_messages");
    expect(migration).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.portal_ticket/);
  });

  it("el navegador sólo muta mediante RPC autorizadas", () => {
    expect(service).toContain('supabase.rpc("create_platform_support_thread"');
    expect(service).toContain('supabase.rpc("send_platform_support_message"');
    expect(service).toContain('supabase.rpc("update_platform_support_thread"');
    expect(service).not.toMatch(/\.from\(["']platform_support_(?:threads|messages)["']\)\s*\.(?:insert|update|delete)/);
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE public.platform_support_threads FROM authenticated");
    expect(migration).toContain("REVOKE INSERT, UPDATE, DELETE ON TABLE public.platform_support_messages FROM authenticated");
  });

  it("la base deriva tenant y rol de la sesión", () => {
    const create = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.create_platform_support_thread"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.list_platform_support_threads"),
    );
    const send = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.send_platform_support_message"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.update_platform_support_thread"),
    );
    expect(create).toContain("auth.uid()");
    expect(create).toContain("FROM public.memberships");
    expect(create).toContain("public.exigir_permiso(p_org_id, 'support', 'create'");
    expect(send).toContain("public.has_platform_role(ARRAY['support']");
    expect(send).toContain("public.has_permission(v_org, 'support', 'create')");
    expect(send).not.toContain("p_sender_kind");
  });

  it("Platform restringe la bandeja a support y superadmin", () => {
    expect(app).toContain('platformRole === "superadmin" || platformRole === "support"');
    expect(migration).toContain("public.has_platform_role(ARRAY['support']::text[])");
    expect(migration).not.toContain("ARRAY['support', 'finance']");
  });

  it("la UI ofrece bandeja, conversación, estados y tiempo real", () => {
    expect(workspace).toContain('audience: "merchant" | "platform"');
    expect(workspace).toContain('table: "platform_support_threads"');
    expect(workspace).toContain('table: "platform_support_messages"');
    expect(workspace).toContain("Tomar caso");
    expect(workspace).toContain("Enviar mensaje");
    expect(workspace).toContain("No compartas contraseñas ni claves privadas");
  });

  it("/soporte es una única ruta canónica con permiso propio", () => {
    const support = navRoutes().filter(route => route.path === "/soporte");
    expect(support).toHaveLength(1);
    expect(support[0].module).toBe("support");
    expect(support[0].nav?.label).toBe("Soporte");
  });
});
