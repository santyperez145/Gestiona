import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * 2026-11-04: con sugerencias guardadas y la IA sin configurar, tocar
 * «Regenerar sugerencias» giraba el ícono y no pasaba nada. Ahora el botón
 * se va y queda dicho, sin caja roja, que se muestran las últimas.
 */
const llamarIA = vi.fn();
vi.mock("@/lib/ia", () => ({ llamarIA: (...a: unknown[]) => llamarIA(...a) }));

import AIProactiveWidget from "@/components/dashboard/AIProactiveWidget";

const MENSAJE = "El asistente no está disponible en este momento. Probá más tarde.";
const ORG = "org-ia-test";

describe("sugerencias IA sin IA configurada", () => {
  beforeEach(() => {
    llamarIA.mockReset();
    localStorage.setItem(
      `gestiona.ai.pulse.v2.${ORG}`,
      JSON.stringify({ bullets: ["Reponer el producto que más se vende esta semana"], ts: Date.now() }),
    );
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("al regenerar a mano avisa que quedan las últimas y saca el botón", async () => {
    llamarIA.mockRejectedValue(new Error(MENSAJE));
    render(<AIProactiveWidget orgId={ORG} hasBusinessData />);
    expect(await screen.findByText(/Reponer el producto/)).toBeTruthy();
    expect(llamarIA).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Regenerar sugerencias" }));
    expect(
      await screen.findByText("Las sugerencias nuevas todavía no están disponibles; te dejamos las últimas."),
    ).toBeTruthy();
    expect(llamarIA).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Regenerar sugerencias" })).toBeNull();
    expect(screen.queryByText(/No pudimos actualizar/)).toBeNull();
    // Las sugerencias guardadas siguen a la vista.
    expect(screen.getByText(/Reponer el producto/)).toBeTruthy();
  });

  it("otra falla pedida a mano sí muestra el error con Reintentar", async () => {
    llamarIA.mockRejectedValue(new Error("Se cortó la conexión"));
    render(<AIProactiveWidget orgId={ORG} hasBusinessData />);
    await screen.findByText(/Reponer el producto/);
    fireEvent.click(screen.getByRole("button", { name: "Regenerar sugerencias" }));
    await waitFor(() => expect(screen.getByText(/No pudimos actualizar: Se cortó la conexión/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Regenerar sugerencias" })).toBeTruthy();
  });
});
