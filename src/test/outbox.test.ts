import { describe, it, expect } from "vitest";
import {
  esperaDeReintento, textoDeEspera, diagnosticarOutbox, destinoValido,
  tipoDeEventoValido, patronMatchea, type SaludOutbox,
} from "@/lib/outbox";

const salud = (o: Partial<SaludOutbox> = {}): SaludOutbox => ({
  pendientes: 0, en_curso: 0, fallados: 0, descartados: 0, entregados: 0,
  minutos_del_mas_viejo: null, ...o,
});

describe("esperaDeReintento — espejo de outbox_espera", () => {
  // Los mismos números que verificó el bloque SQL contra producción.
  it("arranca en 30 segundos y duplica", () => {
    expect(esperaDeReintento(0)).toBe(30);
    expect(esperaDeReintento(1)).toBe(60);
    expect(esperaDeReintento(2)).toBe(120);
    expect(esperaDeReintento(4)).toBe(480);
  });

  // Sin techo, el intento 15 caería dentro de un año.
  it("tiene techo de una hora", () => {
    expect(esperaDeReintento(8)).toBe(3600);
    expect(esperaDeReintento(20)).toBe(3600);
    expect(esperaDeReintento(999)).toBe(3600);
  });

  it("un intento inválido cuenta como ninguno", () => {
    expect(esperaDeReintento(-5)).toBe(30);
    expect(esperaDeReintento(NaN)).toBe(30);
  });
});

describe("textoDeEspera", () => {
  it("lo dice como lo diría una persona", () => {
    expect(textoDeEspera(30)).toBe("en 30 segundos");
    expect(textoDeEspera(60)).toBe("en 1 minuto");
    expect(textoDeEspera(480)).toBe("en 8 minutos");
    expect(textoDeEspera(3600)).toBe("en 1 hora");
  });
});

describe("diagnosticarOutbox", () => {
  it("sin nada pendiente está al día", () => {
    const d = diagnosticarOutbox(salud());
    expect(d.nivel).toBe("ok");
  });

  // Mil pendientes de hace dos segundos es un pico normal, no un problema.
  it("muchos pendientes recientes no son un incidente", () => {
    expect(diagnosticarOutbox(salud({ pendientes: 1000, minutos_del_mas_viejo: 0.5 })).nivel).toBe("ok");
  });

  // Una sola de hace seis horas sí lo es.
  it("uno solo muy viejo sí lo es", () => {
    const d = diagnosticarOutbox(salud({ pendientes: 1, minutos_del_mas_viejo: 360 }));
    expect(d.nivel).toBe("incidente");
    expect(d.detalle).toContain("360");
  });

  it("entre 5 y 15 minutos es atención, no incidente", () => {
    expect(diagnosticarOutbox(salud({ pendientes: 3, minutos_del_mas_viejo: 7 })).nivel).toBe("atencion");
    expect(diagnosticarOutbox(salud({ pendientes: 3, minutos_del_mas_viejo: 15 })).nivel).toBe("incidente");
  });

  // Un descarte no se resuelve esperando: ya no va a llegar solo.
  it("cualquier descarte es incidente aunque la cola esté vacía", () => {
    const d = diagnosticarOutbox(salud({ descartados: 1 }));
    expect(d.nivel).toBe("incidente");
    expect(d.titulo).toContain("no llegó");
  });

  it("no explota sin datos", () => {
    expect(diagnosticarOutbox(null).nivel).toBe("ok");
    expect(diagnosticarOutbox(undefined).nivel).toBe("ok");
  });
});

describe("destinoValido", () => {
  it("acepta una URL pública", () => {
    expect(destinoValido("https://api.midominio.com/hooks/gestiona").ok).toBe(true);
  });

  it("rechaza lo que no es http", () => {
    expect(destinoValido("javascript:alert(1)").ok).toBe(false);
    expect(destinoValido("ftp://x.com").ok).toBe(false);
    expect(destinoValido("").ok).toBe(false);
    expect(destinoValido("no es una url").ok).toBe(false);
  });

  // Un webhook lo visita el servidor. Apuntarlo adentro convierte la
  // suscripción en una forma de leer la red interna desde afuera.
  it("rechaza direcciones internas", () => {
    for (const u of [
      "http://localhost:3000/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.1/x",
      "http://172.16.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://algo.internal/x",
      "http://impresora.local/x",
    ]) {
      expect(destinoValido(u), u).toMatchObject({ ok: false });
    }
  });

  it("no confunde una IP pública parecida", () => {
    // 172.32 no está en el rango privado, que va de 172.16 a 172.31.
    expect(destinoValido("http://172.32.0.1/x").ok).toBe(true);
    expect(destinoValido("http://11.0.0.1/x").ok).toBe(true);
  });
});

describe("tipoDeEventoValido", () => {
  it("acepta dominio.accion en pasado", () => {
    expect(tipoDeEventoValido("orden.creada")).toBe(true);
    expect(tipoDeEventoValido("stock.movido")).toBe(true);
    expect(tipoDeEventoValido("orden.pago_actualizado")).toBe(true);
  });

  it("rechaza lo que no tiene esa forma", () => {
    expect(tipoDeEventoValido("CrearOrden")).toBe(false);
    expect(tipoDeEventoValido("orden")).toBe(false);
    expect(tipoDeEventoValido("Orden.Creada")).toBe(false);
    expect(tipoDeEventoValido("orden.creada.otra")).toBe(false);
    expect(tipoDeEventoValido("")).toBe(false);
  });
});

describe("patronMatchea — espejo del LIKE", () => {
  it("el comodín agarra la familia entera", () => {
    expect(patronMatchea("orden.%", "orden.creada")).toBe(true);
    expect(patronMatchea("orden.%", "orden.pagada")).toBe(true);
    expect(patronMatchea("orden.%", "stock.movido")).toBe(false);
  });

  it("sin comodín es exacto", () => {
    expect(patronMatchea("orden.pagada", "orden.pagada")).toBe(true);
    expect(patronMatchea("orden.pagada", "orden.creada")).toBe(false);
  });

  it("un patrón vacío no matchea nada", () => {
    expect(patronMatchea("", "orden.creada")).toBe(false);
  });

  // `LIKE '%_iva%'` matcheaba "inactiva" y ya costó una sesión. Acá el guión
  // bajo es parte de la palabra, no un comodín.
  it("el guión bajo es literal, no comodín", () => {
    expect(patronMatchea("orden.pago_actualizado", "orden.pago_actualizado")).toBe(true);
    expect(patronMatchea("orden.pago_actualizado", "orden.pagoXactualizado")).toBe(false);
  });

  it("el punto no es comodín", () => {
    expect(patronMatchea("orden.creada", "ordenXcreada")).toBe(false);
  });
});
