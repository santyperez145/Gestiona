import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import StoreTrackingConsent from "@/storefront/StoreTrackingConsent";
import {
  readStoreTrackingConsent,
  StoreTrackingConsentProvider,
  storeTrackingConsentKey,
  writeStoreTrackingConsent,
} from "@/storefront/trackingConsent";

describe("consentimiento de medición por tienda", () => {
  beforeEach(() => localStorage.clear());

  it("persiste una decisión versionada y aislada por slug", () => {
    expect(readStoreTrackingConsent(localStorage, "tienda-a")).toBeNull();
    expect(writeStoreTrackingConsent(localStorage, "tienda-a", "granted")).toBe(true);
    expect(readStoreTrackingConsent(localStorage, "tienda-a")).toBe("granted");
    expect(readStoreTrackingConsent(localStorage, "tienda-b")).toBeNull();
    expect(storeTrackingConsentKey(" TIENDA-A ")).toContain("tienda-a");
  });

  it("no acepta valores heredados o inventados como consentimiento", () => {
    localStorage.setItem(storeTrackingConsentKey("demo"), "yes");
    expect(readStoreTrackingConsent(localStorage, "demo")).toBeNull();
  });

  it("pide una decisión afirmativa y permite cambiarla desde el footer", () => {
    render(
      <StoreTrackingConsentProvider slug="demo">
        <StoreTrackingConsent enabled />
      </StoreTrackingConsentProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Tu privacidad en esta tienda" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Usar sólo lo esencial" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(readStoreTrackingConsent(localStorage, "demo")).toBe("denied");

    fireEvent.click(screen.getByRole("button", { name: "Preferencias de privacidad" }));
    fireEvent.click(screen.getByRole("button", { name: "Aceptar medición" }));
    expect(readStoreTrackingConsent(localStorage, "demo")).toBe("granted");
  });

  it("no muestra ni persiste consentimiento dentro de una vista previa", () => {
    render(
      <StoreTrackingConsentProvider slug="demo" disabled>
        <StoreTrackingConsent enabled />
      </StoreTrackingConsentProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Preferencias de privacidad" })).toBeNull();
    expect(readStoreTrackingConsent(localStorage, "demo")).toBeNull();
  });
});
