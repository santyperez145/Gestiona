import { describe, expect, it } from "vitest";
import { routeAliasDestination } from "@/lib/routeAliasDestination";

describe("private alias filters", () => {
  it("keeps the Profit civil period without carrying tokens or changing its view", () => {
    expect(routeAliasDestination("/analytics?vista=rentabilidad", "?df=2026-09-01&dt=2026-09-30&token=secret&vista=resumen", ["df", "dt"]))
      .toBe("/analytics?vista=rentabilidad&df=2026-09-01&dt=2026-09-30");
  });
  it("leaves existing aliases unchanged unless they opt in", () => {
    expect(routeAliasDestination("/admin?tab=audit", "?token=secret&df=2026-09-01")).toBe("/admin?tab=audit");
  });
  it("does not override authoritative destination parameters", () => {
    expect(routeAliasDestination("/analytics?vista=rentabilidad&df=2026-09-01", "?df=2020-01-01&dt=2026-09-30", ["df", "dt"]))
      .toBe("/analytics?vista=rentabilidad&df=2026-09-01&dt=2026-09-30");
  });
});
