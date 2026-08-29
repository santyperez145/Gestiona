import { describe, expect, it } from "vitest";
import {
  POS_QR_TERMINAL_STATES,
  POS_QR_RETRYABLE_TERMINAL_STATES,
  posQrFailureCopy,
  posQrRemainingLabel,
  posQrRemainingSeconds,
  posQrRequiresManualReview,
} from "./posQr";

describe("estado de cobro QR del POS", () => {
  it("muestra un vencimiento estable sin tiempos negativos", () => {
    const now = new Date("2026-08-29T12:00:00.000Z").getTime();
    expect(posQrRemainingSeconds("2026-08-29T12:15:00.000Z", now)).toBe(900);
    expect(posQrRemainingLabel(900)).toBe("15:00");
    expect(posQrRemainingSeconds("2026-08-29T11:59:00.000Z", now)).toBe(0);
    expect(posQrRemainingLabel(-20)).toBe("00:00");
  });

  it("distingue estados terminales de un cobro todavía recuperable", () => {
    expect(POS_QR_TERMINAL_STATES.has("completed")).toBe(true);
    expect(POS_QR_TERMINAL_STATES.has("expired")).toBe(true);
    expect(POS_QR_TERMINAL_STATES.has("pending")).toBe(false);
    expect(POS_QR_TERMINAL_STATES.has("finalizing")).toBe(false);
    expect(POS_QR_RETRYABLE_TERMINAL_STATES.has("expired")).toBe(true);
    expect(POS_QR_RETRYABLE_TERMINAL_STATES.has("manual_review")).toBe(false);
  });

  it("explica que un vencimiento no dejó stock tomado", () => {
    expect(posQrFailureCopy({ state: "expired" } as never)).toContain("reserva de stock fue liberada");
    expect(posQrFailureCopy({ state: "manual_review" } as never)).toContain("importe distinto");
    expect(posQrRequiresManualReview({ state: "manual_review" } as never)).toBe(true);
    expect(posQrRequiresManualReview({ state: "failed" } as never)).toBe(false);
  });
});
