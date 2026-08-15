import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  announcementLifecycle,
  isInternalAnnouncementPath,
  toAnnouncementDateTimeInput,
  toAnnouncementIso,
} from "@/lib/platformAnnouncements";

const base = {
  published_at: "2026-08-15T12:00:00.000Z",
  archived_at: null,
  starts_at: "2026-08-15T12:00:00.000Z",
  ends_at: null,
};

describe("anuncios de plataforma", () => {
  it("distingue borrador, programación, publicación, vencimiento y archivo sin inventar estados", () => {
    const now = new Date("2026-08-15T13:00:00.000Z");
    expect(announcementLifecycle({ ...base, published_at: null }, now)).toBe("draft");
    expect(announcementLifecycle({ ...base, starts_at: "2026-08-16T12:00:00.000Z" }, now)).toBe("scheduled");
    expect(announcementLifecycle(base, now)).toBe("published");
    expect(announcementLifecycle({ ...base, ends_at: "2026-08-15T12:30:00.000Z" }, now)).toBe("expired");
    expect(announcementLifecycle({ ...base, archived_at: "2026-08-15T12:15:00.000Z" }, now)).toBe("archived");
  });

  it("acepta sólo rutas internas para evitar que una CTA operativa abra un tercero", () => {
    expect(isInternalAnnouncementPath("/estado")).toBe(true);
    expect(isInternalAnnouncementPath("/ajustes?tab=seguridad")).toBe(true);
    expect(isInternalAnnouncementPath("https://otro-sitio.example")).toBe(false);
    expect(isInternalAnnouncementPath("//otro-sitio.example")).toBe(false);
    expect(isInternalAnnouncementPath("javascript:alert(1)")).toBe(false);
  });

  it("convierte la fecha del control sin serializar una entrada inválida", () => {
    expect(toAnnouncementDateTimeInput("not-a-date")).toBe("");
    expect(toAnnouncementIso("")).toBeNull();
    expect(toAnnouncementIso("not-a-date")).toBeNull();
    expect(toAnnouncementIso("2026-08-15T10:30")).toMatch(/^2026-08-15T/);
  });

  it("mantiene tablas privadas y expone sólo RPCs con alcance explícito", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260815000011_platform_announcements.sql"), "utf8");
    const appLayout = readFileSync(resolve(process.cwd(), "src/components/AppLayout.tsx"), "utf8");
    const platformPage = readFileSync(resolve(process.cwd(), "src/pages/PlatformAnnouncementsPage.tsx"), "utf8");

    expect(migration).toContain("REVOKE ALL ON TABLE public.platform_announcements FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_my_platform_announcements() FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_my_platform_announcements()");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.dismiss_platform_announcement");
    expect(migration).toContain("public.has_platform_role(ARRAY['superadmin']");
    expect(appLayout).toContain("<PlatformAnnouncementBanner enabled={Boolean(activeOrg)} />");
    expect(platformPage).toContain('supabase.rpc("list_platform_announcements")');
    expect(platformPage).not.toContain(".from(\"platform_announcements\")");
  });
});
