import { beforeEach, describe, expect, it } from "vitest";
import { vincularEtiquetas } from "@/lib/etiquetas";

const montar = (html: string) => {
  document.body.innerHTML = html;
  vincularEtiquetas();
};
const etiqueta = (texto: string) =>
  Array.from(document.querySelectorAll("label")).find(l => l.textContent?.trim().startsWith(texto)) as HTMLLabelElement;

describe("etiquetas vinculadas a su campo", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("vincula la etiqueta con el único campo de su bloque", () => {
    montar(`<div><label>CBU</label><input placeholder="000"></div><div><label>Alias</label><input></div>`);
    const cbu = etiqueta("CBU");
    expect(cbu.control).toBe(document.querySelectorAll("input")[0]);
    expect(etiqueta("Alias").control).toBe(document.querySelectorAll("input")[1]);
    expect(document.querySelectorAll("input")[0].getAttribute("aria-labelledby")).toBe(cbu.id);
  });

  it("sube hasta la caja que tiene el campo, sin confundirlo con un interruptor etiquetado", () => {
    montar(`<div>
      <div class="flex"><label>Unidades *</label><label><button role="switch"></button>No lleva stock</label></div>
      <input type="number">
    </div>`);
    expect(etiqueta("Unidades").control).toBe(document.querySelector("input"));
  });

  it("no adivina: con dos campos o dos etiquetas sueltas en el bloque, no toca nada", () => {
    montar(`<div><label>Desde</label><input><input></div>`);
    expect(etiqueta("Desde").htmlFor).toBe("");
    montar(`<div><label>Uno</label><label>Dos</label><input></div>`);
    expect(etiqueta("Uno").htmlFor).toBe("");
    expect(etiqueta("Dos").htmlFor).toBe("");
  });

  it("no toca etiquetas ya vinculadas ni las que envuelven su campo, y el campo debe venir después", () => {
    montar(`<div><label for="x">Con for</label><input id="x"></div><label>Envuelve <input></label><div><input><label>Después</label></div>`);
    expect(etiqueta("Con for").htmlFor).toBe("x");
    expect(etiqueta("Envuelve").htmlFor).toBe("");
    expect(etiqueta("Después").htmlFor).toBe("");
  });

  it("respeta el id y el nombre que el campo ya tenía, y nombra un combobox que no es etiquetable", () => {
    montar(`<div><label>Provincia</label><button role="combobox" id="prov" aria-label="Elegir provincia"></button></div>
      <div><label>Rubro</label><div role="combobox"></div></div>`);
    expect(etiqueta("Provincia").htmlFor).toBe("prov");
    expect(document.getElementById("prov")!.getAttribute("aria-label")).toBe("Elegir provincia");
    expect(document.getElementById("prov")!.hasAttribute("aria-labelledby")).toBe(false);
    const rubro = document.querySelector<HTMLElement>("div[role=combobox]")!;
    expect(rubro.getAttribute("aria-labelledby")).toBe(etiqueta("Rubro").id);
  });
});
