import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const onboarding = readFileSync(resolve(ROOT, "src/pages/OnboardingPage.tsx"), "utf8");
const migracion = readFileSync(
  resolve(ROOT, "supabase/migrations/20260825000001_rubro_sin_default.sql"),
  "utf8",
);

/**
 * El rubro no se adivina.
 *
 * `settings.industry_code` nació con `DEFAULT 'perfumes'` cuando esto era la app
 * de un solo negocio, y el onboarding lo repetía en dos lugares: el `useState`
 * inicial y una reselección después de cargar los presets. Un comercio que no
 * tocaba el paso quedaba archivado como perfumería — y el rubro no es una
 * etiqueta: siembra tipos de producto y atributos en su catálogo.
 */
describe("el onboarding no elige el rubro por el comercio", () => {
  it("no arranca con un rubro puesto", () => {
    expect(onboarding).toContain("useState('')");
    expect(onboarding).not.toContain("useState('perfumes')");
  });

  it("cargar los presets no es elegir uno", () => {
    // Esta línea reponía el default aunque el useState estuviera vacío.
    expect(onboarding).not.toContain("rows.find((row) => row.code === 'perfumes')");
  });

  it("no se puede avanzar sin elegir", () => {
    // Sin la puerta, un rubro vacío llegaría a completeBusinessOnboarding.
    expect(onboarding).toContain("disabled={!rubroCode}");
  });

  it("si los rubros no cargan, ofrece reintentar en vez de prometer que siga", () => {
    // El servidor rechaza un código vacío (`Business profile not found or
    // inactive`), así que "continuá y corregilo en Ajustes" haría fallar el
    // último paso después de tres pantallas.
    expect(onboarding).toContain("onClick={cargarRubros}");
    expect(onboarding).not.toContain("Podés continuar y corregirlo en Ajustes");
  });

  it("el color inicial no es el dorado de la perfumería", () => {
    // El dorado es branding de un comercio puntual; CONTRIBUTING.md lo excluye como
    // color del workspace.
    expect(onboarding).not.toContain("useState('#D4A843')");
  });

  it("el ejemplo del nombre no es una perfumería", () => {
    expect(onboarding).not.toContain("Perfumería Andrea");
    expect(onboarding).toContain('placeholder="Ej: Mi negocio"');
  });

  it("la base tampoco pone un rubro por default", () => {
    expect(migracion).toContain("ALTER COLUMN industry_code DROP DEFAULT");
  });

  it("y no backfillea las filas existentes", () => {
    // Una de las dos filas en 'perfumes' es la perfumería de verdad. Reescribir
    // datos reales para que un reporte dé limpio está prohibido en este repo.
    expect(migracion).not.toMatch(/UPDATE\s+public\.settings\s+SET\s+industry_code/i);
  });
});
