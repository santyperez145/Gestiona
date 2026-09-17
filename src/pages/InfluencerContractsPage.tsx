import { useState, useEffect } from "react";
import { FileText, Shield, CheckCircle, AlertCircle, CalendarDays } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listInfluencerContracts, createContract, signContract, deleteContract, type InfluencerContract } from "@/lib/influencersDB";
import { listInfluencers } from "@/lib/influencersDB";

/**
 * Contratos con Influencers — Gestión completa, sin mocks.
 */
export default function InfluencerContractsPage() {
  const [contracts, setContracts] = useState<InfluencerContract[]>([]);
  const [influencers, setInfluencers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      const [c, inf] = await Promise.all([listInfluencerContracts(), listInfluencers()]);
      setContracts(c);
      setInfluencers(inf);
    } catch {
      setContracts([]);
      setInfluencers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const filtered = contracts.filter((c) => {
    const q = search.toLowerCase();
    return (c.influencer_name || "").toLowerCase().includes(q) || (c.contract_type || "").toLowerCase().includes(q);
  });

  const handleSign = async (id: string) => {
    await signContract(id);
    await reload();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Eliminar contrato?")) return;
    await deleteContract(id);
    await reload();
  };

  const activeContracts = contracts.filter((c) => c.status === "active");
  const signedContracts = contracts.filter((c) => c.is_signed);
  const totalAmount = contracts.reduce((s, c) => s + Number(c.contract_amount || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-semibold">Contratos</h2>
          <p className="text-sm text-muted-foreground">Acuerdos con influencers — datos reales del Core</p>
        </div>
        <Input placeholder="Buscar contrato…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 w-64 text-sm" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Contratos Activos</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-display font-bold">{activeContracts.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Firmados</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-display font-bold">{signedContracts.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Monto Total</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-display font-bold">${totalAmount.toLocaleString("es-AR")}</p></CardContent>
        </Card>
      </div>

      {loading && contracts.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">Cargando contratos desde el Core…</div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display font-semibold">Lista de Contratos</CardTitle>
            <CardDescription>Contratos registrados y firmados — sin inventos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Influencer</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tipo</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Monto</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Firmado</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Vigente</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Estado</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-muted">
                      <td className="px-4 py-3 text-sm font-medium">{c.influencer_name || "—"}</td>
                      <td className="px-4 py-3 text-sm"><Badge variant={c.contract_type === "fixed" ? "secondary" : "outline"}>{c.contract_type}</Badge></td>
                      <td className="px-4 py-3 text-sm">${Number(c.contract_amount || 0).toLocaleString("es-AR")}</td>
                      <td className="px-4 py-3 text-sm"><Badge variant={c.is_signed ? "secondary" : "default"}>{c.is_signed ? "Firmado" : "Pendiente"}</Badge></td>
                      <td className="px-4 py-3 text-sm">{c.valid_until ? new Date(c.valid_until).toLocaleDateString("es-AR") : "—"}</td>
                      <td className="px-4 py-3 text-sm"><Badge variant={c.status === "active" ? "secondary" : "outline"}>{c.status}</Badge></td>
                      <td className="px-4 py-3 text-sm flex gap-2">
                        {!c.is_signed && (
                          <Button size="sm" variant="outline" onClick={() => handleSign(c.id)}><Shield className="w-3 h-3 mr-1" />Firmar</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(c.id)}>Eliminar</Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-muted-foreground">No hay contratos registrados aún.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}