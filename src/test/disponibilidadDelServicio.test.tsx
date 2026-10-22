import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { comprobarServicio, MENSAJE_SERVICIO_CAIDO } from "@/lib/disponibilidadDelServicio";
import AvisoServicioNoDisponible from "@/components/shared/AvisoServicioNoDisponible";

const estado = vi.hoisted(() => ({ valor: "disponible" as string }));
vi.mock("@/hooks/useDisponibilidadDelServicio", () => ({
  useDisponibilidadDelServicio: () => ({ estado: estado.valor, reintentar: () => {} }),
}));

const respuesta = (status: number) => new Response(null, { status });
const fetcher = (servidor: Response | Error, sitio: Response | Error) =>
  vi.fn(async (url: string) => {
    const r = String(url).includes("/auth/v1/health") ? servidor : sitio;
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;

// 2026-10-19: con la base caída el ingreso decía «Revisá tu conexión».
describe("¿Nerqia o la conexión?", () => {
  const base = { urlServidor: "https://zz.supabase.co", clave: "zz", timeoutMs: 50 };

  it("si el servidor contesta, anda (un 4xx también es contestar)", async () => {
    expect(await comprobarServicio({ ...base, fetcher: fetcher(respuesta(200), respuesta(200)) })).toBe("disponible");
    expect(await comprobarServicio({ ...base, fetcher: fetcher(respuesta(401), respuesta(200)) })).toBe("disponible");
  });

  it("si el servidor no contesta pero el sitio sí, el problema es de Nerqia", async () => {
    expect(await comprobarServicio({ ...base, fetcher: fetcher(new TypeError("Failed to fetch"), respuesta(200)) })).toBe("caido");
    expect(await comprobarServicio({ ...base, fetcher: fetcher(respuesta(503), respuesta(200)) })).toBe("caido");
  });

  it("si no contesta ninguno, o el navegador está sin red, es la conexión", async () => {
    expect(await comprobarServicio({ ...base, fetcher: fetcher(new TypeError("x"), new TypeError("x")) })).toBe("sin_conexion");
    expect(await comprobarServicio({ ...base, enLinea: false, fetcher: fetcher(respuesta(200), respuesta(200)) })).toBe("sin_conexion");
  });

  it("un servidor que no responde se corta por tiempo", async () => {
    const colgado = vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      if (!String(url).includes("/auth/v1/health")) { resolve(respuesta(200)); return; }
      init?.signal?.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")));
    })) as unknown as typeof fetch;
    expect(await comprobarServicio({ ...base, fetcher: colgado })).toBe("caido");
  });

  it("sin servidor configurado no alarma", async () => {
    expect(await comprobarServicio({ ...base, urlServidor: "", fetcher: fetcher(new TypeError("x"), new TypeError("x")) })).toBe("disponible");
  });
});

describe("aviso de servicio no disponible", () => {
  it("dice que el problema es de Nerqia y que los datos están guardados", () => {
    estado.valor = "caido";
    render(<AvisoServicioNoDisponible />);
    expect(screen.getByRole("alert")).toHaveTextContent(MENSAJE_SERVICIO_CAIDO);
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeEnabled();
  });

  it("en el panel no repite el aviso de falta de internet, y no aparece si anda", () => {
    estado.valor = "sin_conexion";
    const { container, rerender } = render(<AvisoServicioNoDisponible soloCaida />);
    expect(container).toBeEmptyDOMElement();
    estado.valor = "disponible";
    rerender(<AvisoServicioNoDisponible />);
    expect(container).toBeEmptyDOMElement();
  });
});
