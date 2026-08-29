/**
 * Cola local del POS.
 *
 * La base persiste una fila por producto vendido, pero el cajero opera tickets.
 * Contar filas como "ventas" exagera la cola y vuelve imposible saber si una
 * sincronización parcial dejó un ticket entero o sólo una línea. Esta capa
 * agrupa por `offline_transaction_id` y conserva compatibilidad con registros
 * viejos que sólo tenían el id de la línea.
 */

export type PosOfflineLine = {
  id?: unknown;
  offline_transaction_id?: unknown;
  date?: unknown;
  quantity?: unknown;
  total_ars?: unknown;
};

export type PosOfflineTicket<T extends PosOfflineLine = PosOfflineLine> = {
  key: string;
  lines: T[];
  lineCount: number;
  units: number;
  totalARS: number;
  createdAt: string | null;
};

export type PosOfflineQueueSummary = {
  ticketCount: number;
  lineCount: number;
  units: number;
  totalARS: number;
  oldestAt: string | null;
  oldestAgeMinutes: number | null;
};

function usableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function validDate(value: unknown) {
  const raw = usableString(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function groupPosOfflineTickets<T extends PosOfflineLine>(lines: readonly T[]): PosOfflineTicket<T>[] {
  const grouped = new Map<string, T[]>();

  lines.forEach((line, index) => {
    const key = usableString(line.offline_transaction_id)
      ?? usableString(line.id)
      ?? `legacy-line-${index}`;
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  });

  return Array.from(grouped, ([key, ticketLines]) => {
    const dates = ticketLines
      .map(line => validDate(line.date))
      .filter((date): date is string => date !== null)
      .sort();

    return {
      key,
      lines: ticketLines,
      lineCount: ticketLines.length,
      units: ticketLines.reduce((sum, line) => sum + nonNegativeNumber(line.quantity), 0),
      totalARS: ticketLines.reduce((sum, line) => sum + nonNegativeNumber(line.total_ars), 0),
      createdAt: dates[0] ?? null,
    };
  });
}

export function summarizePosOfflineQueue(
  lines: readonly PosOfflineLine[],
  nowMs = Date.now(),
): PosOfflineQueueSummary {
  const tickets = groupPosOfflineTickets(lines);
  const dated = tickets
    .map(ticket => ticket.createdAt)
    .filter((date): date is string => date !== null)
    .sort();
  const oldestAt = dated[0] ?? null;
  const oldestTimestamp = oldestAt ? Date.parse(oldestAt) : Number.NaN;

  return {
    ticketCount: tickets.length,
    lineCount: lines.length,
    units: tickets.reduce((sum, ticket) => sum + ticket.units, 0),
    totalARS: tickets.reduce((sum, ticket) => sum + ticket.totalARS, 0),
    oldestAt,
    oldestAgeMinutes: Number.isFinite(oldestTimestamp)
      ? Math.max(0, Math.floor((nowMs - oldestTimestamp) / 60_000))
      : null,
  };
}

export function posOfflineAgeLabel(minutes: number | null) {
  if (minutes === null) return null;
  if (minutes < 1) return "desde hace menos de 1 min";
  if (minutes < 60) return `desde hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `desde hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `desde hace ${days} d`;
}
