import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const scanner = readFileSync(resolve(root, "src/components/shared/ReceiptScanner.tsx"), "utf8");
const expenses = readFileSync(resolve(root, "src/pages/ExpensesPage.tsx"), "utf8");
const edge = readFileSync(resolve(root, "supabase/functions/extract-receipt/index.ts"), "utf8");
const privacy = readFileSync(resolve(root, "src/pages/PrivacyPage.tsx"), "utf8");

describe("extracción asistida de comprobantes", () => {
  it("el navegador llama al contrato documental y no al chat SSE", () => {
    expect(scanner).toContain('functions.invoke("extract-receipt"');
    expect(scanner).toContain("body: { fileBase64, mediaType, orgId, categorias }");
    expect(scanner).not.toContain('functions.invoke("ai-chat"');
    expect(scanner).not.toContain("Respondé ÚNICAMENTE");
    expect(expenses).toContain("orgId={activeOrg?.id}");
    expect(expenses).toContain("categorias={categories.map((item) => item.value)}");
  });

  it("mantiene el archivo local hasta guardar el gasto", () => {
    expect(scanner).toContain("receiptFile: capturedBlob");
    expect(scanner).not.toContain("getPublicUrl");
    expect(scanner).not.toContain('.from("expense-receipts")');
    expect(expenses).toContain("Se subirá al guardar el gasto");
  });

  it("el servidor valida persona, tenant, plan, configuración y límites antes del proveedor", () => {
    const auth = edge.indexOf("requireUser(req, corsHeaders)");
    const membership = edge.indexOf('.from("memberships")');
    const enabled = edge.indexOf("EXPENSE_RECEIPT_EXTRACTION_ENABLED");
    const entitlement = edge.indexOf('exigirBeneficio(req, org, "ia"');
    const provider = edge.indexOf("anthropic.messages.create");

    expect(auth).toBeGreaterThan(0);
    expect(membership).toBeGreaterThan(auth);
    expect(entitlement).toBeGreaterThan(membership);
    expect(enabled).toBeGreaterThan(entitlement);
    expect(provider).toBeGreaterThan(enabled);
    expect(edge).toContain("MAX_BASE64_CHARS");
    expect(edge).toContain("TIPOS_SOPORTADOS.has(tipo)");
    expect(edge).toContain("UUID.test(org)");
  });

  it("usa salida cerrada, categorías tenant-safe y exige revisión humana", () => {
    expect(edge).toContain('tool_choice: { type: "tool", name: "registrar_comprobante" }');
    expect(edge).toContain("categoria && lista.includes(categoria) ? categoria : null");
    expect(edge).toContain("reviewRequired: true");
    expect(scanner).toContain("Sugerencias listas para revisar");
    expect(scanner).toContain("Aplicar sugerencias");
  });

  it("mide el costo después de la respuesta y transparenta el proveedor", () => {
    expect(edge.indexOf("registrarConsumoIA({")).toBeGreaterThan(edge.indexOf("anthropic.messages.create"));
    expect(scanner).toContain("la imagen se envía a Anthropic");
    expect(privacy).toMatch(/contenido que\s+elegís procesar/);
    expect(privacy).not.toContain("datos anonimizados");
  });

  it("el error real llega al estado visible y conserva alternativa manual", () => {
    expect(scanner).toContain("mensajeDeEdgeFunction(invokeError, data)");
    expect(scanner).toContain('role="alert"');
    expect(edge).toContain("completar el gasto manualmente");
  });
});
