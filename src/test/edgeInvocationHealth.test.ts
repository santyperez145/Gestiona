import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateEdgeInvocationMetrics,
  calculateCronHealthMetrics,
  type PlatformEdgeInvocationRow,
  type PlatformCronHealthRow,
} from "@/lib/platformMetrics";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const instrumentacion = leer("supabase/migrations/20260826000170_resultado_real_de_la_invocacion.sql");
const timeouts = leer("supabase/migrations/20260826000180_un_timeout_tambien_es_una_falla.sql");
const cronSalud = leer("supabase/migrations/20260826000190_saludable_deja_de_ser_mentira.sql");

const fila = (o: Partial<PlatformEdgeInvocationRow> = {}): PlatformEdgeInvocationRow => ({
  function_name: "send-drip-emails",
  invocaciones_24h: 10,
  errores_24h: 0,
  timeouts_24h: 0,
  sin_despachar_24h: 0,
  invocaciones_7d: 70,
  errores_7d: 0,
  p95_seg_24h: 0.3,
  ultima_invocacion: "2026-08-26T14:00:00.000Z",
  ultimo_status: 200,
  ultimo_error: null,
  ...o,
});

/**
 * El éxito de un cron que llama una Edge Function prueba que pg_net **encoló**
 * el request, no que la función respondiera: `net.http_post` es asíncrono y el
 * job termina en ~0,2 s sin esperar nada.
 *
 * Medido el 2026-08-26: los 20 jobs en verde con 0 fallas en 7 días, y al mismo
 * tiempo 4 respuestas con error y 1 timeout sobre 42 en la ventana de retención
 * de pg_net. ~10% fallando, 0% visible.
 */
describe("error rate de las invocaciones", () => {
  it("cuenta el error rate sobre lo que sí se invocó", () => {
    const m = calculateEdgeInvocationMetrics([
      fila({ invocaciones_24h: 8, errores_24h: 1 }),
      fila({ function_name: "notify-back-in-stock", invocaciones_24h: 12, errores_24h: 1 }),
    ]);
    expect(m.invocaciones24h).toBe(20);
    expect(m.errores24h).toBe(2);
    expect(m.errorRate24h).toBe(10);
  });

  it("sin invocaciones el error rate es null, no 0%", () => {
    // 0% diría "no falló nada"; lo cierto es "no se sabe". Confundir las dos
    // cosas es el bug que este módulo existe para evitar.
    const m = calculateEdgeInvocationMetrics([fila({ invocaciones_24h: 0, errores_24h: 0 })]);
    expect(m.errorRate24h).toBeNull();
  });

  it("una lista vacía tampoco inventa un 0%", () => {
    expect(calculateEdgeInvocationMetrics([]).errorRate24h).toBeNull();
  });

  it("separa timeout de error HTTP: son problemas distintos", () => {
    // Un 500 se arregla en el código de la función; un timeout puede ser una
    // función lenta y sana. Meterlos en la misma bolsa borra la pista.
    const m = calculateEdgeInvocationMetrics([
      fila({ invocaciones_24h: 4, errores_24h: 2, timeouts_24h: 1 }),
    ]);
    expect(m.errores24h).toBe(2);
    expect(m.timeouts24h).toBe(1);
  });

  it("una invocación que nunca se despachó se cuenta aparte", () => {
    // request_id NULL = ni salió. Es el caso del vault sin secretos.
    const m = calculateEdgeInvocationMetrics([fila({ sin_despachar_24h: 3 })]);
    expect(m.sinDespachar24h).toBe(3);
    expect(m.funcionesConError).toHaveLength(1);
  });
});

describe("P95", () => {
  it("toma el peor, no el promedio de percentiles", () => {
    // Promediar P95 entre funciones no significa nada: un percentil no se
    // promedia. Lo que sirve es cuál es la peor y cuánto.
    const m = calculateEdgeInvocationMetrics([
      fila({ function_name: "rapida", p95_seg_24h: 0.2 }),
      fila({ function_name: "lenta", p95_seg_24h: 4.5 }),
      fila({ function_name: "media", p95_seg_24h: 1.1 }),
    ]);
    expect(m.peorP95).toEqual({ funcion: "lenta", segundos: 4.5 });
  });

  it("si ninguna respondió, no hay P95 que mostrar", () => {
    const m = calculateEdgeInvocationMetrics([fila({ p95_seg_24h: null })]);
    expect(m.peorP95).toBeNull();
  });

  it("ordena poniendo primero lo que falla", () => {
    const m = calculateEdgeInvocationMetrics([
      fila({ function_name: "sana", errores_24h: 0 }),
      fila({ function_name: "rota", errores_24h: 5 }),
    ]);
    expect(m.rows[0].function_name).toBe("rota");
  });
});

describe("sin_respuesta es su propio estado", () => {
  const job = (o: Partial<PlatformCronHealthRow> = {}): PlatformCronHealthRow => ({
    jobid: 1, jobname: "recover-abandoned-carts", schedule: "15 * * * *", active: true,
    last_status: "succeeded", last_run_at: "2026-08-26T14:15:00.000Z",
    last_finished_at: "2026-08-26T14:15:00.000Z", last_success_at: "2026-08-26T14:15:00.000Z",
    runs_7d: 168, failed_runs_7d: 0, estado: "sin_respuesta", ...o,
  });

  it("un job que despachó y no obtuvo respuesta no cuenta como sano ni como fallando", () => {
    // El caso real: cron 'succeeded', 0 fallas en 7 días, y la función con
    // `Timeout of 5000 ms reached`.
    const m = calculateCronHealthMetrics([job()]);
    expect(m.noResponseJobs).toBe(1);
    expect(m.failingJobs).toBe(0);
  });

  it("un job que contestó mal sí está fallando", () => {
    const m = calculateCronHealthMetrics([job({ estado: "fallando" })]);
    expect(m.failingJobs).toBe(1);
    expect(m.noResponseJobs).toBe(0);
  });
});

describe("lo que la base tiene que seguir garantizando", () => {
  it("la instrumentación no puede tumbar el trabajo que mide", () => {
    expect(instrumentacion).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(instrumentacion).toMatch(/registrar_invocacion[\s\S]{0,700}RAISE WARNING/);
  });

  it("un vault sin secretos explota en vez de informar éxito", () => {
    // Antes era RAISE WARNING + RETURN NULL: el cron terminaba `succeeded` sin
    // haber despachado nada, que es la peor forma de fallar.
    expect(instrumentacion).toMatch(/faltan SUPABASE_URL o SUPABASE_ANON_KEY[\s\S]{0,40}/);
    expect(instrumentacion).toContain("RAISE EXCEPTION 'invoke_edge_function(%)");
    expect(instrumentacion).not.toMatch(/RAISE WARNING 'invoke_edge_function\(%\)/);
  });

  it("el despacho declara su timeout y no usa el default de 5 s", () => {
    expect(timeouts).toContain("timeout_milliseconds := 30000");
  });

  it("un timeout cuenta como falla en la vista", () => {
    expect(timeouts).toContain("l.timed_out IS TRUE OR l.status_code IS NULL OR l.status_code >= 400");
  });

  it("lo no reconciliado no se cuenta ni como éxito ni como falla", () => {
    expect(timeouts).toContain("l.reconciled_at IS NOT NULL");
  });

  it("las vistas de infraestructura son staff-only", () => {
    expect(timeouts).toContain("public.is_platform_admin(auth.uid())");
    expect(cronSalud).toContain("public.is_platform_admin(auth.uid())");
  });

  it("el cruce job → función sale del comando, no de una lista a mano", () => {
    // El nombre del job y el de la función no coinciden: `stock-alerts-daily`
    // llama a `check-stock-alerts`. Una lista hardcodeada se desincroniza.
    expect(cronSalud).toContain("invoke_edge_function[a-z_]*");
    expect(cronSalud).toContain("sin_respuesta");
  });
});

describe("un error no se destruye al serializarlo", () => {
  const funciones = [
    "supabase/functions/customer-reactivation-alerts/index.ts",
    "supabase/functions/daily-kpi-alert/index.ts",
    "supabase/functions/send-email-campaign/index.ts",
    "supabase/functions/send-scheduled-campaigns/index.ts",
  ];

  it("ninguna cron function usa String(err)", () => {
    // `String(err)` sobre un PostgrestError —un objeto plano— da
    // "[object Object]". Se encontró exactamente ese cuerpo en una respuesta
    // 500 real, con el mensaje, el código y el hint perdidos.
    for (const f of funciones) {
      expect(leer(f)).not.toContain("String(err)");
      expect(leer(f)).toContain("mensajeDeError");
    }
  });

  it("un fallo de consulta no se devuelve como resultado vacío", () => {
    // `if (error || !campaigns?.length) return { sent: 0 }` con 200 hacía
    // indistinguible "falló la base" de "no hay campañas".
    const campañas = leer("supabase/functions/send-scheduled-campaigns/index.ts");
    expect(campañas).not.toContain("if (error || !campaigns?.length)");
    expect(campañas).toMatch(/if \(error\) \{[\s\S]{0,400}status: 500/);
  });

  it("una campaña que falla no queda en 'sending' para siempre", () => {
    // El cron sólo mira las `draft`, así que una campaña trabada en `sending`
    // no se reintenta nunca y no se ve como fallida en ningún lado.
    const campañas = leer("supabase/functions/send-scheduled-campaigns/index.ts");
    expect(campañas).toMatch(/if \(envioError\)[\s\S]{0,400}status: "failed"/);
  });
});
