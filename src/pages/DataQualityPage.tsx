import { Database, ScanSearch, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import IdentityHealthPanel from "@/components/shared/IdentityHealthPanel";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import { useOrg } from "@/lib/orgContext";

export default function DataQualityPage() {
  usePageTitle("Calidad de datos");
  const navigate = useNavigate();
  const { activeOrg } = useOrg();
  const [section, setSection] = usePersistedState(
    orgViewKey("data-quality.section", activeOrg?.id),
    "products",
  );

  if (!activeOrg?.id) return null;

  return (
    <div className="workspace-page space-y-6 pb-12">
      <PageHeader
        icon={ScanSearch}
        title="Calidad de datos"
        description="Un centro operativo para mantener productos y clientes confiables entre POS, tienda y canales."
        badge={{ label: "Operación central", variant: "default" }}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-primary" />Las llaves fuertes mandan</span>
        <span className="inline-flex items-center gap-1.5"><Database className="h-3.5 w-3.5 text-primary" />La base sigue siendo la fuente de verdad</span>
        <span className="text-muted-foreground/70">Sin fusiones automáticas ni datos inventados</span>
      </div>

      <Tabs value={section} onValueChange={setSection} className="w-full">
        <TabsList>
          <TabsTrigger value="products" className="gap-2"><span>Catálogo</span></TabsTrigger>
          <TabsTrigger value="customers" className="gap-2"><span>Clientes</span></TabsTrigger>
        </TabsList>
        <TabsContent value="products">
          <IdentityHealthPanel
            entity="products"
            orgId={activeOrg.id}
            onOpenProduct={id => navigate(`/productos?identity=${encodeURIComponent(id)}`)}
          />
        </TabsContent>
        <TabsContent value="customers">
          <IdentityHealthPanel
            entity="customers"
            orgId={activeOrg.id}
            onOpenCustomer={id => navigate(`/clientes?identity=${encodeURIComponent(id)}`)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
