import { describe, it, expect } from "vitest";
import { findCustomerDuplicates, type CustomerCandidate } from "@/lib/customerDuplicates";

describe("findCustomerDuplicates", () => {
  it("detecta duplicados por email normalizado", () => {
    const list: CustomerCandidate[] = [
      { id: "c1", name: "Juan Pérez", email: "juan@example.com", totalSpent: 1000 },
      { id: "c2", name: "Juan P.", email: "JUAN@example.com ", totalSpent: 5000 },
      { id: "c3", name: "Ana Gomez", email: "ana@example.com", totalSpent: 2000 },
    ];

    const clusters = findCustomerDuplicates(list);
    expect(clusters.length).toBe(1);
    expect(clusters[0].reason).toBe("email");
    expect(clusters[0].matchValue).toBe("juan@example.com");
    expect(clusters[0].customers.length).toBe(2);
    // Sugiere c2 como principal porque gastó más
    expect(clusters[0].suggestedPrimaryId).toBe("c2");
  });

  it("detecta duplicados por teléfono normalizado", () => {
    const list: CustomerCandidate[] = [
      { id: "c1", name: "Carlos Lopez", phone: "+54 9 11 1234-5678", totalSpent: 100 },
      { id: "c2", name: "Carlos", phone: "1112345678", totalSpent: 300 },
    ];

    const clusters = findCustomerDuplicates(list);
    expect(clusters.length).toBe(1);
    expect(clusters[0].reason).toBe("phone");
    expect(clusters[0].customers.length).toBe(2);
    expect(clusters[0].suggestedPrimaryId).toBe("c2");
  });

  it("detecta duplicados por nombre cuando tienen diferente id", () => {
    const list: CustomerCandidate[] = [
      { id: "c1", name: "Mariana Suárez", email: null, totalSpent: 100 },
      { id: "c2", name: "mariana suarez", email: null, totalSpent: 200 },
    ];

    const clusters = findCustomerDuplicates(list);
    expect(clusters.length).toBe(1);
    expect(clusters[0].reason).toBe("name");
    expect(clusters[0].customers.length).toBe(2);
  });

  it("no reporta falsos positivos en clientes sin email ni teléfono distintos", () => {
    const list: CustomerCandidate[] = [
      { id: "c1", name: "Pedro Gomez", email: "p@a.com" },
      { id: "c2", name: "Laura Ramos", email: "l@b.com" },
    ];

    const clusters = findCustomerDuplicates(list);
    expect(clusters.length).toBe(0);
  });
});
