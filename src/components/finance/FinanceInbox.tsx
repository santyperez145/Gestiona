import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { extractDocument, evaluateConfidence, FinanceDocument, DocumentChannel, DocumentStatus, ConfidenceLevel } from "@/lib/financeInbox";

export default function FinanceInbox() {
  const [documents, setDocuments] = useState<FinanceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Simulate fetching documents
    const mockDocs: FinanceDocument[] = [
      {
        id: "1",
        store_slug: "tienda-demo",
        channel: "email",
        original_url: null,
        original_text: "Factura Nº 123 - Monto: $1500,00 - Fecha: 15/09/2026 - Proveedor: ABC S.A.",
        extracted: {
          amount: 1500,
          currency: "ARS",
          date: "15/09/2026",
          vendor: "ABC S.A.",
          category: "Compras",
          payment_method: "transferencia",
          tax_amount: 0,
          confidence: "high",
        },
        status: "extracted",
        owner_id: "user-1",
        reviewer_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    setDocuments(mockDocs);
    setLoading(false);
  }, []);

  if (loading) return <p>Cargando...</p>;
  if (error) return <p className="text-red-600">Error: {error}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Finance Inbox</h2>
      <div className="space-y-2">
        {documents.map((doc) => (
          <div key={doc.id} className="border p-4 rounded-lg">
            <div className="flex justify-between items-start mb-2">
              <span className="font-medium">{doc.vendor || "Sin proveedor"}</span>
              <span className="px-2 py-1 rounded text-sm" 
                style={{ 
                  background: 
                    doc.extracted.confidence === "high" 
                      ? "hsl(var(--st-accent)/0.2)" 
                      : doc.extracted.confidence === "medium" 
                        ? "hsl(var(--st-accent)/0.1)" 
                        : "hsl(var(--st-muted)/0.2)",
                  color: 
                    doc.extracted.confidence === "high" 
                      ? "hsl(var(--st-accent))" 
                      : doc.extracted.confidence === "medium" 
                        ? "hsl(var(--st-accent))" 
                        : "hsl(var(--st-muted))"
                }}>
                {doc.extracted.confidence}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Monto: ${doc.extracted.amount?.toLocaleString()} {doc.extracted.currency} 
              • Fecha: {doc.extracted.date} 
              • Categoría: {doc.extracted.category || "Sin categoría"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Canal: {doc.channel} • Estado: {doc.status}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}