import { describe, expect, it } from "vitest";
import {
  groupPosOfflineTickets,
  posOfflineAgeLabel,
  summarizePosOfflineQueue,
} from "@/lib/posOfflineQueue";

describe("cola offline del POS", () => {
  const now = Date.parse("2026-08-29T18:00:00.000Z");
  const lines = [
    { id: "a", offline_transaction_id: "ticket-1", date: "2026-08-29T17:30:00Z", quantity: 2, total_ars: 2_000 },
    { id: "b", offline_transaction_id: "ticket-1", date: "2026-08-29T17:30:00Z", quantity: 1, total_ars: 1_500 },
    { id: "c", offline_transaction_id: "ticket-2", date: "2026-08-29T17:50:00Z", quantity: 4, total_ars: 8_000 },
  ];

  it("cuenta tickets y no confunde sus líneas con ventas", () => {
    const tickets = groupPosOfflineTickets(lines);

    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toMatchObject({
      key: "ticket-1",
      lineCount: 2,
      units: 3,
      totalARS: 3_500,
      createdAt: "2026-08-29T17:30:00.000Z",
    });
  });

  it("resume cantidad, unidades, monto y antigüedad de la cola", () => {
    expect(summarizePosOfflineQueue(lines, now)).toEqual({
      ticketCount: 2,
      lineCount: 3,
      units: 7,
      totalARS: 11_500,
      oldestAt: "2026-08-29T17:30:00.000Z",
      oldestAgeMinutes: 30,
    });
  });

  it("mantiene cada línea heredada como ticket cuando no existe id de operación", () => {
    const tickets = groupPosOfflineTickets([
      { id: "legacy-a", quantity: 1, total_ars: 100 },
      { id: "legacy-b", quantity: 1, total_ars: 200 },
      { quantity: 1, total_ars: 300 },
    ]);

    expect(tickets.map(ticket => ticket.key)).toEqual(["legacy-a", "legacy-b", "legacy-line-2"]);
  });

  it("no deja que valores inválidos inventen unidades o dinero", () => {
    const summary = summarizePosOfflineQueue([
      { id: "bad", quantity: -2, total_ars: Number.NaN, date: "sin-fecha" },
    ], now);

    expect(summary).toMatchObject({ ticketCount: 1, units: 0, totalARS: 0, oldestAt: null, oldestAgeMinutes: null });
  });

  it("explica la edad con una escala legible para la operación", () => {
    expect(posOfflineAgeLabel(null)).toBeNull();
    expect(posOfflineAgeLabel(0)).toBe("desde hace menos de 1 min");
    expect(posOfflineAgeLabel(45)).toBe("desde hace 45 min");
    expect(posOfflineAgeLabel(125)).toBe("desde hace 2 h");
    expect(posOfflineAgeLabel(3_000)).toBe("desde hace 2 d");
  });
});
