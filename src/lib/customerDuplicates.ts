import { normalizeIdentityEmail, normalizeIdentityPhone, normalizeIdentityText } from "./recordIdentity";

export interface CustomerCandidate {
  id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp_number?: string | null;
  totalSpent?: number;
  purchaseCount?: number;
}

export interface DuplicateCluster {
  id: string;
  reason: "email" | "phone" | "name";
  matchValue: string;
  customers: CustomerCandidate[];
  suggestedPrimaryId: string | null;
}

/**
 * Detecta duplicados proactivamente analizando email, teléfono y nombre normalizado.
 * Sugiere como cliente principal al que tenga ID persistido en `customers` y mayor historial de compras.
 */
export function findCustomerDuplicates(list: CustomerCandidate[]): DuplicateCluster[] {
  const clusters: DuplicateCluster[] = [];
  const processedPairs = new Set<string>();

  // 1. Agrupar por Email normalizado
  const emailMap = new Map<string, CustomerCandidate[]>();
  for (const c of list) {
    const normEmail = normalizeIdentityEmail(c.email);
    if (normEmail) {
      const arr = emailMap.get(normEmail) || [];
      arr.push(c);
      emailMap.set(normEmail, arr);
    }
  }

  emailMap.forEach((candidates, email) => {
    if (candidates.length > 1) {
      const ids = candidates.map(c => c.id || c.name).sort().join("|");
      if (!processedPairs.has(ids)) {
        processedPairs.add(ids);
        clusters.push({
          id: `email-${email}`,
          reason: "email",
          matchValue: email,
          customers: candidates,
          suggestedPrimaryId: pickPrimaryCustomer(candidates),
        });
      }
    }
  });

  // 2. Agrupar por Teléfono normalizado (últimos 10 dígitos para ignorar prefijos de país/área)
  const phoneMap = new Map<string, CustomerCandidate[]>();
  for (const c of list) {
    const rawPhone = c.phone || c.whatsapp_number;
    let normPhone = normalizeIdentityPhone(rawPhone);
    if (normPhone && normPhone.length >= 8) {
      // Tomar los últimos 10 dígitos para comparar (descarta prefijo internacional +54 9, etc.)
      if (normPhone.length > 10) normPhone = normPhone.slice(-10);
      const arr = phoneMap.get(normPhone) || [];
      arr.push(c);
      phoneMap.set(normPhone, arr);
    }
  }

  phoneMap.forEach((candidates, phone) => {
    if (candidates.length > 1) {
      const ids = candidates.map(c => c.id || c.name).sort().join("|");
      if (!processedPairs.has(ids)) {
        processedPairs.add(ids);
        clusters.push({
          id: `phone-${phone}`,
          reason: "phone",
          matchValue: phone,
          customers: candidates,
          suggestedPrimaryId: pickPrimaryCustomer(candidates),
        });
      }
    }
  });

  // 3. Agrupar por Nombre idéntico normalizado (cuando tienen IDs diferentes)
  const nameMap = new Map<string, CustomerCandidate[]>();
  for (const c of list) {
    const normName = normalizeIdentityText(c.name);
    if (normName && normName.length >= 3) {
      const arr = nameMap.get(normName) || [];
      arr.push(c);
      nameMap.set(normName, arr);
    }
  }

  nameMap.forEach((candidates, name) => {
    // Solo si son al menos 2 registros distintos con IDs diferentes o uno con ID y otro sin ID
    if (candidates.length > 1) {
      const uniqueIds = new Set(candidates.map(c => c.id || c.name));
      if (uniqueIds.size > 1) {
        const ids = candidates.map(c => c.id || c.name).sort().join("|");
        if (!processedPairs.has(ids)) {
          processedPairs.add(ids);
          clusters.push({
            id: `name-${name}`,
            reason: "name",
            matchValue: candidates[0].name,
            customers: candidates,
            suggestedPrimaryId: pickPrimaryCustomer(candidates),
          });
        }
      }
    }
  });

  return clusters;
}

/**
 * Elige como registro principal prioritario:
 * 1. El que tenga ID en DB (no efímero).
 * 2. Entre ellos, el que tenga mayor facturación o cantidad de compras.
 */
function pickPrimaryCustomer(candidates: CustomerCandidate[]): string | null {
  const withId = candidates.filter(c => Boolean(c.id));
  if (withId.length === 0) return null;
  if (withId.length === 1) return withId[0].id!;

  // Desempate por mayor totalSpent o purchaseCount
  return withId.slice().sort((a, b) => {
    const spentA = a.totalSpent ?? 0;
    const spentB = b.totalSpent ?? 0;
    if (spentB !== spentA) return spentB - spentA;
    return (b.purchaseCount ?? 0) - (a.purchaseCount ?? 0);
  })[0].id!;
}
