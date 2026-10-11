import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("lista de contratos de Creators", () => {
  it("no ordena por una columna que la vista no tiene", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/influencersDB.ts"), "utf8");
    const i = src.indexOf(".from('influencer_contract_status')");
    const consulta = src.slice(i, i + 600);
    expect(consulta).not.toContain(".order('created_at'");
    expect(consulta).toContain(".order('valid_from', { ascending: false, nullsFirst: false })");
  });
});
