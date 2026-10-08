import { afterEach, describe, expect, it, vi } from "vitest";
import { posAutoPrintKey, posReceiptHtml, printReceiptHtml, printPosReceiptById } from "@/lib/posReceiptPrint";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
const receipt = () => ({ id: "ZZ-ticket", date: "2026-10-07T15:00:00Z", businessName: "ZZ Ferretería",
  customer: "ZZ Cliente", paid: true, lines: [{ name: "Tornillos", quantity: 2, total: 180, method: "qr" }] });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.querySelectorAll("iframe").forEach((frame) => frame.remove()); });

describe("canonical POS receipts", () => {
  it("escapes every customer controlled text; includes immutable ticket ID and fiscal distinction", () => {
    const html = posReceiptHtml({ ...receipt(), businessName: "<img onerror='bad'>", customer: "<script>bad</script>",
      lines: [{ name: "<iframe>bad</iframe>", quantity: 1, total: 180, method: "<svg>" }] });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("&lt;svg&gt;");
    expect(html).toContain("POS-ZZ-ticket");
    expect(html).toContain("No es un comprobante fiscal");
  });
  it("never labels partial/debt payments as paid", () => {
    const html = posReceiptHtml({ ...receipt(), paid: false });
    expect(html).toContain("PAGO PENDIENTE O PARCIAL");
    expect(html).not.toContain("COBRO REGISTRADO");
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid quantity %s", (quantity) => {
    expect(() => posReceiptHtml({ ...receipt(), lines: [{ ...receipt().lines[0], quantity }] })).toThrow();
  });
  it("uses stored final line totals, not cart price or a second discount", () => {
    expect(posReceiptHtml(receipt())).toContain("180,00");
    expect(posReceiptHtml(receipt())).not.toContain("360,00");
    expect(posReceiptHtml(receipt())).toContain("QR Mercado Pago");
  });
  it("sums centavos and refuses unsafe totals rather than printing imprecise money", () => {
    expect(posReceiptHtml({ ...receipt(), lines: [0.1, 0.2].map(total => ({ name: "ZZ", quantity: 1, total, method: "efectivo" })) })).toContain("0,30");
    expect(() => posReceiptHtml({ ...receipt(), lines: [{ ...receipt().lines[0], total: Number.MAX_SAFE_INTEGER }] })).toThrow("total");
  });
  it("isolates device preference by organization and user without retaining receipt data", () => {
    expect(posAutoPrintKey("org1", "user1")).not.toBe(posAutoPrintKey("org2", "user1"));
    expect(posAutoPrintKey("org1", "user1")).not.toBe(posAutoPrintKey("org1", "user2"));
  });
  it("prints in a sandbox without popups, retaining the frame until afterprint", async () => {
    vi.useFakeTimers();
    const task = printReceiptHtml(posReceiptHtml(receipt()));
    const frame = document.querySelector("iframe")!;
    const print = vi.fn();
    Object.defineProperty(frame.contentWindow, "print", { value: print });
    Object.defineProperty(frame.contentWindow, "focus", { value: vi.fn() });
    frame.dispatchEvent(new Event("load"));
    await task;
    expect(print).toHaveBeenCalledOnce();
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin allow-modals");
    expect(document.contains(frame)).toBe(true);
    frame.contentWindow!.dispatchEvent(new Event("afterprint"));
    expect(document.contains(frame)).toBe(false);
  });
  it("fails cleanly on a stalled print document", async () => {
    vi.useFakeTimers();
    // Do not attach: jsdom otherwise dispatches its about:blank load event.
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    const task = printReceiptHtml("<!doctype html><p>ZZ</p>");
    const assertion = expect(task).rejects.toThrow("sin repetir la venta");
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("queries both relations by tenant and canonical ticket; no fallback to local cart", async () => {
    const eq = vi.fn();
    const query = { select: vi.fn(), eq, maybeSingle: vi.fn(), order: vi.fn(), limit: vi.fn() };
    query.select.mockReturnValue(query); eq.mockReturnValue(query); query.order.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: { id: "ZZ-ticket", source: "pos", occurred_at: receipt().date } });
    query.limit.mockResolvedValue({ data: [{ product_name: "Tornillos", quantity: 1, total_ars: 180, paid: false, payment_method: "fiado" }] });
    mocks.from.mockReturnValue(query);
    await expect(printPosReceiptById("ZZ-org", "ZZ-ticket", "Ferretería", true)).rejects.toThrow("cobro completo");
    expect(eq).toHaveBeenCalledWith("org_id", "ZZ-org");
    expect(eq).toHaveBeenCalledWith("sale_transaction_id", "ZZ-ticket");
    expect(document.querySelector("iframe")).toBeNull();
  });
});
