import { describe, expect, it } from "vitest";
import { overallServiceState, serviceStateLabel, type PublicServiceStatus } from "@/lib/serviceStatus";

const row = (status: PublicServiceStatus["status"]): PublicServiceStatus => ({
  component: "Aplicación", status, checked_at: "2026-08-15T12:00:00.000Z", detail: "Señal",
});

describe("estado público del servicio", () => {
  it("no deja que una señal operativa esconda una incidencia", () => {
    expect(overallServiceState([row("operational"), row("degraded")])).toBe("degraded");
  });

  it("declara falta de evidencia antes de afirmar que todo está disponible", () => {
    expect(overallServiceState([row("operational"), row("unknown")])).toBe("unknown");
    expect(overallServiceState([])).toBe("unknown");
  });

  it("usa etiquetas entendibles para compradores y comercios", () => {
    expect(serviceStateLabel("operational")).toBe("Operativo");
    expect(serviceStateLabel("not_applicable")).toBe("No aplica");
  });
});
