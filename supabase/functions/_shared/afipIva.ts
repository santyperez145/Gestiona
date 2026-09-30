const IVA_ID_BY_RATE: Record<string, number> = {
  "0": 3,
  "2.5": 9,
  "5": 8,
  "10.5": 4,
  "21": 5,
  "27": 6,
};

export function afipIvaId(rate: number): number {
  const id = IVA_ID_BY_RATE[String(rate)];
  if (id === undefined) {
    throw new Error("La alicuota de IVA no esta admitida por esta integracion ARCA");
  }
  return id;
}
