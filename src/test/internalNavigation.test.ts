import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = process.cwd();
const SRC = resolve(ROOT, "src");
const INTERNAL_FULL_PAGE_NAV =
  /(?:window\.)?location\.(?:href\s*=\s*|assign\(\s*|replace\(\s*)["'`]\/(?!\/)/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe("navegación interna sin recargar la aplicación", () => {
  it("no usa location para destinos internos", () => {
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return INTERNAL_FULL_PAGE_NAV.test(source)
        ? [relative(ROOT, path).replaceAll("\\", "/")]
        : [];
    });

    expect(offenders).toEqual([]);
  });
});
