import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("campanita de notificaciones", () => {
  it("marcar y borrar miran el error antes de cambiar la pantalla", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/shared/NotificationBell.tsx"), "utf8");
    expect(src.match(/const \{ error \} = await supabase\.from\('notifications'\)/g)?.length).toBe(3);
    expect(src).not.toMatch(/^\s*await supabase\.from\('notifications'\)\.(update|delete)/m);
  });
});
