import { describe, expect, it, beforeEach } from "vitest";
import { orgViewKey, readPersistedValue, writePersistedValue } from "@/hooks/usePersistedState";

describe("usePersistedState helpers", () => {
  beforeEach(() => localStorage.clear());

  it("separa las preferencias por organizacion", () => {
    expect(orgViewKey("dashboard.section", "org-a")).toBe("gestiona.view.dashboard.section.org-a");
    expect(orgViewKey("dashboard.section", null)).toBe("gestiona.view.dashboard.section.default");
  });

  it("serializa y recupera valores estructurados", () => {
    writePersistedValue("gestiona.view.test", { tab: "ventas", filter: "critical" });
    expect(readPersistedValue("gestiona.view.test", { tab: "inicio" })).toEqual({ tab: "ventas", filter: "critical" });
  });

  it("usa el valor inicial cuando el almacenamiento esta corrupto", () => {
    localStorage.setItem("gestiona.view.test", "no-json");
    expect(readPersistedValue("gestiona.view.test", "inicio")).toBe("inicio");
  });
});
