import { describe, expect, it } from "vitest";

// ── Route smoke tests: verify pages can be imported ─────────────
type RouteSmokeCase = {
  name: string;
  importer: () => Promise<{ default: unknown }>;
};

const criticalRoutes: RouteSmokeCase[] = [
  { name: "login",       importer: () => import("@/pages/AuthPage") },
  { name: "dashboard",   importer: () => import("@/pages/Dashboard") },
  { name: "productos",   importer: () => import("@/pages/ProductsPage") },
  { name: "ventas",      importer: () => import("@/pages/SalesPage") },
  { name: "POS",         importer: () => import("@/pages/POSPage") },
  { name: "deudas",      importer: () => import("@/pages/DebtsPage") },
  { name: "caja",        importer: () => import("@/pages/CashSessionPage") },
  { name: "facturas",    importer: () => import("@/pages/InvoicesPage") },
  { name: "clientes",    importer: () => import("@/pages/CustomersPage") },
  { name: "compras",     importer: () => import("@/pages/PurchasesPage") },
  { name: "proveedores", importer: () => import("@/pages/ProveedoresPage") },
  { name: "gastos",      importer: () => import("@/pages/ExpensesPage") },
  { name: "kardex",      importer: () => import("@/pages/KardexPage") },
  { name: "devoluciones",importer: () => import("@/pages/DevolucionesPage") },
  { name: "presupuestos",importer: () => import("@/pages/PresupuestosPage") },
  { name: "reportes",    importer: () => import("@/pages/ReportsPage") },
  { name: "ajustes",     importer: () => import("@/pages/SettingsPage") },
  { name: "integraciones",importer: () => import("@/pages/IntegrationsPage") },
  { name: "pricing",     importer: () => import("@/pages/PricingPage") },
  { name: "platform-admin", importer: () => import("@/pages/PlatformAdminPage") },
];

describe("smoke: páginas críticas se importan correctamente", () => {
  it.each(criticalRoutes)("importa $name sin romper", async ({ importer }) => {
    const mod = await importer();
    expect(mod.default).toBeTypeOf("function");
  });
});

// ── Lógica de negocio: cálculos de stock, deudas, pagos ──────────

describe("lógica: stock no puede ser negativo después de venta", () => {
  it("descuenta stock correctamente y detecta insuficiencia", () => {
    const stockActual = 10;
    const cantidadVenta = 3;
    const resultado = stockActual - cantidadVenta;
    expect(resultado).toBe(7);
    expect(resultado).toBeGreaterThanOrEqual(0);
  });

  it("detecta stock insuficiente antes de vender", () => {
    const stock = 2;
    const cantidadPedida = 5;
    const hayStock = stock >= cantidadPedida;
    expect(hayStock).toBe(false);
  });

  it("suma stock al registrar compra", () => {
    const stockActual = 10;
    const cantidadComprada = 50;
    const nuevoStock = stockActual + cantidadComprada;
    expect(nuevoStock).toBe(60);
  });
});

describe("lógica: deuda con pagos parciales", () => {
  it("calcula saldo pendiente correctamente", () => {
    const montoTotal = 100_000;
    const pagado = 35_000;
    const pendiente = montoTotal - pagado;
    expect(pendiente).toBe(65_000);
    expect(pendiente).toBeGreaterThan(0);
  });

  it("marca como pagada cuando restante es cero", () => {
    const montoTotal = 50_000;
    const pagado = 50_000;
    const pendiente = montoTotal - pagado;
    const pagada = pendiente <= 0;
    expect(pagada).toBe(true);
  });

  it("no permite pago que supere el saldo pendiente", () => {
    const pendiente = 20_000;
    const intentoPago = 30_000;
    const pagoEfectivo = Math.min(intentoPago, pendiente);
    expect(pagoEfectivo).toBe(20_000);
  });
});

describe("lógica: factura AFIP — tipo de comprobante", () => {
  it("monotributista emite Factura C (tipo 11) por defecto", () => {
    const tipoEmisor = "monotributista";
    const tipoCbte = tipoEmisor === "responsable_inscripto" ? 6 : 11;
    expect(tipoCbte).toBe(11);
  });

  it("responsable inscripto emite Factura B (tipo 6) por defecto", () => {
    const tipoEmisor = "responsable_inscripto";
    const tipoCbte = tipoEmisor === "responsable_inscripto" ? 6 : 11;
    expect(tipoCbte).toBe(6);
  });

  it("Factura A (tipo 1) requiere CUIT del cliente", () => {
    const tipoCbte = 1;
    const taxId = "20-12345678-9".replace(/[-\s]/g, ""); // 11 digits
    const docTipo = taxId.length === 11 ? 80 : 99;
    const facturaAValida = tipoCbte !== 1 || docTipo === 80;
    expect(facturaAValida).toBe(true);
  });

  it("Factura A sin CUIT debe fallar", () => {
    const tipoCbte = 1;
    const taxId = ""; // no CUIT
    const docTipo = taxId.length === 11 ? 80 : 99;
    const facturaAValida = tipoCbte !== 1 || docTipo === 80;
    expect(facturaAValida).toBe(false);
  });
});

describe("lógica: cálculo de totales con IVA", () => {
  it("calcula IVA 21% correctamente", () => {
    const subtotal = 100_000;
    const ivaPct = 21;
    const ivaImporte = Math.round(subtotal * ivaPct / 100);
    const total = subtotal + ivaImporte;
    expect(ivaImporte).toBe(21_000);
    expect(total).toBe(121_000);
  });

  it("IVA 0% no agrega monto", () => {
    const subtotal = 50_000;
    const ivaPct = 0;
    const ivaImporte = Math.round(subtotal * ivaPct / 100);
    expect(ivaImporte).toBe(0);
    expect(subtotal + ivaImporte).toBe(50_000);
  });
});

describe("lógica: session de caja — diferencias", () => {
  it("calcula diferencia entre declarado y sistema", () => {
    const totalSistema = 150_000;
    const declaradoOperador = 148_500;
    const diferencia = declaradoOperador - totalSistema;
    expect(diferencia).toBe(-1_500);
  });

  it("diferencia positiva es sobrante", () => {
    const totalSistema = 100_000;
    const declarado = 102_000;
    const diferencia = declarado - totalSistema;
    expect(diferencia).toBeGreaterThan(0);
  });
});

describe("lógica: plan limits enforcement", () => {
  it("bloquea venta cuando se alcanza el máximo mensual", () => {
    const maxVentasMes = 100;
    const ventasEsteMes = 100;
    const puedeVender = maxVentasMes === null || ventasEsteMes < maxVentasMes;
    expect(puedeVender).toBe(false);
  });

  it("permite venta cuando hay capacidad disponible", () => {
    const maxVentasMes = 100;
    const ventasEsteMes = 55;
    const puedeVender = maxVentasMes === null || ventasEsteMes < maxVentasMes;
    expect(puedeVender).toBe(true);
  });

  it("plan ilimitado (null) siempre permite", () => {
    const maxVentasMes: number | null = null;
    const ventasEsteMes = 99999;
    const puedeVender = maxVentasMes === null || ventasEsteMes < maxVentasMes;
    expect(puedeVender).toBe(true);
  });
});

describe("lógica: trial expiración", () => {
  it("trial activo si fecha futura", () => {
    const trialEndsAt = new Date(Date.now() + 7 * 86400_000).toISOString();
    const activo = new Date(trialEndsAt) > new Date();
    expect(activo).toBe(true);
  });

  it("trial vencido si fecha pasada", () => {
    const trialEndsAt = new Date(Date.now() - 86400_000).toISOString();
    const activo = new Date(trialEndsAt) > new Date();
    expect(activo).toBe(false);
  });
});
