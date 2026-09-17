import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { llamarIA } from "@/lib/ia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight, CheckCircle2, TrendingUp, DollarSign, Target } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";

interface BriefData {
  productName: string;
  objective: string;
  budgetARS: number;
  channel: string;
  influencerTier: string;
  industry: string;
}

const tierOptions = [
  { value: "nano", label: "Nano (10k-50k)" },
  { value: "micro", label: "Micro (50k-100k)" },
  { value: "medio", label: "Medio (100k-500k)" },
  { value: "macro", label: "Macro (500k-2M)" },
];

const channelOptions = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "twitter", label: "Twitter/X" },
  { value: "facebook", label: "Facebook" },
  { value: "linkedin", label: "LinkedIn" },
];

const objectiveOptions = [
  { value: "brand_awareness", label: "Awareness de marca" },
  { value: "website_traffic", label: "Tráfico al sitio" },
  { value: "app_downloads", label: "Descargas de app" },
  { value: "sales", label: "Ventas directas" },
  { value: "leads", label: "Captación de leads" },
  { value: "email_list", label: "Crecimiento de lista" },
];

const sampleCreators = [
  { id: "c1", name: "María López", username: "maria.lopez", followers: 45000, reach: 120000, ctr: 2.4, price: 50000, tier: "micro" },
  { id: "c2", name: "Carlos Méndez", username: "carlos.mendez", followers: 120000, reach: 380000, ctr: 1.8, price: 120000, tier: "medio" },
  { id: "c3", name: "Ana Torres", username: "ana.torres", followers: 28000, reach: 75000, ctr: 3.2, price: 35000, tier: "nano" },
  { id: "c4", name: "Diego Ramírez", username: "diego.ramirez", followers: 850000, reach: 2400000, ctr: 1.2, price: 450000, tier: "macro" },
];

export default function BriefComposer({ onClose, products, themes }: { onClose: () => void; products: any[]; themes: any[] }) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [step, setStep] = useState(1);
  const [briefData, setBriefData] = useState<BriefData>({ productName: "", objective: "", budgetARS: 0, channel: "", influencerTier: "", industry: "" });
  const [generatedBrief, setGeneratedBrief] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedCreators, setSelectedCreators] = useState<string[]>([]);
  const [campaignData, setCampaignData] = useState<any>(null);

  const handleGenerateBrief = async () => {
    if (!briefData.productName || !briefData.objective || !briefData.budgetARS || !briefData.channel || !briefData.influencerTier) {
      toast.error("Por favor completa todos los campos requeridos");
      return;
    }
    setIsGenerating(true);
    try {
      const data = await llamarIA("ai-brief-generator", {
        body: {
          orgId: activeOrg?.id,
          productName: briefData.productName,
          objective: briefData.objective,
          budgetARS: briefData.budgetARS,
          channel: briefData.channel,
          influencerTier: briefData.influencerTier,
        },
      });
      if (data?.brief) {
        setGeneratedBrief(data);
        setStep(3);
        toast.success("Brief generado exitosamente");
      } else {
        toast.error("No se pudo generar el brief");
      }
    } catch (error: any) {
      console.error("Error generating brief:", error);
      toast.error(error.message || "Error generando brief");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!generatedBrief || !user || !activeOrg) return;
    try {
      const title = generatedBrief.campaignTitle || `Campaña ${briefData.productName}`;
      const { data, error } = await supabase
        .from("social_posts")
        .insert({
          org_id: activeOrg.id,
          created_by: user.id,
          title,
          description: generatedBrief.targetAudience || "",
          content: generatedBrief.scriptHook || "",
          type: "campaign",
          status: "draft",
          theme: briefData.objective,
          post_type: briefData.channel,
          ai_generated: true,
          media_urls: [],
          scheduled_for: null,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      setCampaignData(data);
      setStep(4);
      toast.success("Campaña creada exitosamente");
    } catch (error: any) {
      console.error("Error creating campaign:", error);
      toast.error("Error creando la campaña");
    }
  };

  const handleLaunchCampaign = async () => {
    toast.success("¡Campaña lanzada! Los influencers seleccionados serán notificados.");
    onClose();
  };

  const getTotalCreatorReach = () => selectedCreators.reduce((sum, cId) => sum + (sampleCreators.find((c) => c.id === cId)?.reach || 0), 0);
  const getEstimatedCTR = () => {
    const selected = sampleCreators.filter((c) => selectedCreators.includes(c.id));
    const avgCTR = selected.reduce((sum, c) => sum + (c.ctr || 0), 0) / Math.max(selected.length, 1);
    return ((avgCTR || 0) * 1000).toFixed(2);
  };

  const toggleCreator = (creatorId: string) => {
    if (selectedCreators.includes(creatorId)) {
      setSelectedCreators(selectedCreators.filter((id) => id !== creatorId));
    } else {
      setSelectedCreators([...selectedCreators, creatorId]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        <div className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Sparkles className="w-8 h-8" />
              <h1 className="text-2xl font-bold">Generador Automático de Campañas</h1>
            </div>
            <Badge className="bg-white/20 text-white border-white/30">Paso {step} de 4</Badge>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`h-2 flex-1 rounded-full ${step >= s ? "bg-white" : "bg-white/30"}`} />
            ))}
          </div>
        </div>

        <div className="p-6 max-h-[calc(90vh-80px)] overflow-y-auto">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-4">Información Básica</h2>
                <p className="text-gray-600 mb-6">Define los parámetros básicos para tu campaña</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="productName">Nombre del Producto *</Label>
                  <Input id="productName" value={briefData.productName} onChange={(e) => setBriefData({ ...briefData, productName: e.target.value })} placeholder="Ej: Botella de agua premium" />
                </div>
                <div>
                  <Label htmlFor="industry">Industria</Label>
                  <Select onValueChange={(value) => setBriefData({ ...briefData, industry: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona una industria" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alimentación">Alimentación y bebidas</SelectItem>
                      <SelectItem value="moda">Moda y belleza</SelectItem>
                      <SelectItem value="tecnología">Tecnología</SelectItem>
                      <SelectItem value="salud">Salud y bienestar</SelectItem>
                      <SelectItem value="turismo">Turismo y viajes</SelectItem>
                      <SelectItem value="educación">Educación</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="objective">Objetivo Principal *</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
                  {objectiveOptions.map((option) => (
                    <div
                      key={option.value}
                      className={`cursor-pointer rounded-lg border p-4 transition-all ${briefData.objective === option.value ? "ring-2 ring-purple-500 bg-purple-50" : "hover:bg-gray-50"}`}
                      onClick={() => setBriefData({ ...briefData, objective: option.value })}
                    >
                      <div className="font-medium">{option.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="budget">Presupuesto (ARS) *</Label>
                  <Input id="budget" type="number" value={briefData.budgetARS} onChange={(e) => setBriefData({ ...briefData, budgetARS: Number(e.target.value) })} placeholder="100000" />
                </div>
                <div>
                  <Label htmlFor="channel">Canal Principal *</Label>
                  <Select onValueChange={(value) => setBriefData({ ...briefData, channel: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona un canal" />
                    </SelectTrigger>
                    <SelectContent>
                      {channelOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Tier de Influenciador *</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                  {tierOptions.map((tier) => (
                    <div
                      key={tier.value}
                      className={`cursor-pointer rounded-lg border p-3 text-center transition-all ${briefData.influencerTier === tier.value ? "ring-2 ring-purple-500 bg-purple-50" : "hover:bg-gray-50"}`}
                      onClick={() => setBriefData({ ...briefData, influencerTier: tier.value })}
                    >
                      <Badge>{tier.label}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end pt-4">
                <Button onClick={() => setStep(2)} disabled={!briefData.productName || !briefData.objective || !briefData.budgetARS || !briefData.channel || !briefData.influencerTier} size="lg">
                  Siguiente: Seleccionar Creadores <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-4">Selecciona Creadores</h2>
                <p className="text-gray-600 mb-6">Selecciona los mejores creadores para tu campaña</p>
              </div>
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-purple-600">{selectedCreators.length}</div>
                    <div className="text-sm text-gray-600">Creadores Seleccionados</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-blue-600">${getTotalCreatorReach().toLocaleString("es-AR")}</div>
                    <div className="text-sm text-gray-600">Alcance Total Estimado</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-600">{getEstimatedCTR()}%</div>
                    <div className="text-sm text-gray-600">CTR Promedio</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-orange-600">${(briefData.budgetARS / Math.max(selectedCreators.length, 1)).toLocaleString("es-AR")}</div>
                    <div className="text-sm text-gray-600">Por Creador</div>
                  </div>
                </div>
              </div>

              <CreatorGrid creators={sampleCreators} selectedCreators={selectedCreators} onToggle={toggleCreator} />

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(1)}>Atrás</Button>
                <Button onClick={() => setStep(3)} disabled={selectedCreators.length === 0} size="lg">
                  Ver Brief Generado <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}

          {step === 3 && generatedBrief && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold mb-4">Brief Generado</h2>
                <p className="text-gray-600 mb-6">Revisa y aprueba el brief generado por IA</p>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Target className="w-5 h-5" />Resumen de la Campaña</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="font-semibold text-lg">{generatedBrief.campaignTitle}</div>
                      <div className="text-sm text-muted-foreground">{generatedBrief.targetAudience}</div>
                    </div>
                    <div>
                      <div className="font-medium text-sm">Hook de Contenido:</div>
                      <div className="text-sm text-foreground">{generatedBrief.scriptHook}</div>
                    </div>
                    <div>
                      <div className="font-medium text-sm">Llamado a la Acción:</div>
                      <div className="text-sm text-foreground">{generatedBrief.cta}</div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5" />KPI Targets</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {generatedBrief.kpiTargets?.map((kpi: any, index: number) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                          <span className="text-sm font-medium">{kpi.metric}</span>
                          <span className="text-sm text-muted-foreground">Meta: {kpi.target}</span>
                          <span className="text-xs text-muted-foreground">({kpi.timeframe})</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5" />Asignación de Presupuesto</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {generatedBrief.budgetAllocation?.map((item: any, index: number) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">{item.category}</div>
                          <div className="text-sm text-muted-foreground">{item.rationale}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">${item.amountARS.toLocaleString("es-AR")}</div>
                          <div className="text-sm text-muted-foreground">{item.percentage}%</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep(2)}>Atrás</Button>
                <Button onClick={() => setStep(4)} size="lg">Crear Campaña <ArrowRight className="w-4 h-4 ml-2" /></Button>
              </div>
            </div>
          )}

          {step === 4 && campaignData && (
            <CampaignSuccess campaignData={campaignData} selectedCreators={selectedCreators} briefData={briefData} onLaunch={handleLaunchCampaign} />
          )}
        </div>
      </div>
    </div>
  );
}

function CreatorGrid({ creators, selectedCreators, onToggle }: { creators: any[]; selectedCreators: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {creators.map((creator) => (
        <div
          key={creator.id}
          className={`cursor-pointer rounded-lg border p-4 transition-all ${selectedCreators.includes(creator.id) ? "ring-2 ring-green-500 bg-green-50" : "hover:bg-gray-50"}`}
          onClick={() => onToggle(creator.id)}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-sm font-bold">{creator.name.charAt(0)}</div>
              <div>
                <div className="font-semibold">{creator.name}</div>
                <div className="text-sm text-muted-foreground">@{creator.username}</div>
              </div>
            </div>
            {selectedCreators.includes(creator.id) && <CheckCircle2 className="w-5 h-5 text-green-600" />}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="text-sm"><span className="font-medium">Seguidores:</span> {creator.followers.toLocaleString("es-AR")}</div>
            <div className="text-sm"><span className="font-medium">Alcance:</span> {creator.reach.toLocaleString("es-AR")}</div>
            <div className="text-sm"><span className="font-medium">CTR:</span> {(creator.ctr * 1000).toFixed(1)}%</div>
            <div className="text-sm"><span className="font-medium">Precio:</span> ${creator.price.toLocaleString("es-AR")}</div>
          </div>
          <div className="mt-3">
            <Badge>{creator.tier}</Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

function CampaignSuccess({ campaignData, selectedCreators, briefData, onLaunch }: { campaignData: any; selectedCreators: string[]; briefData: any; onLaunch: () => void }) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold mb-2">¡Campaña Creada Exitosamente!</h2>
        <p className="text-gray-600 mb-6">Tu campaña está lista para ser lanzada</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Resumen de la Campaña</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="font-medium mb-1">Título:</div>
              <div className="text-sm text-foreground">{campaignData.title}</div>
            </div>
            <div>
              <div className="font-medium mb-1">Estado:</div>
              <Badge className="bg-green-100 text-green-800">Activo</Badge>
            </div>
            <div>
              <div className="font-medium mb-1">Creadores:</div>
              <div className="text-sm text-foreground">{selectedCreators.length} creadores seleccionados</div>
            </div>
            <div>
              <div className="font-medium mb-1">Presupuesto:</div>
              <div className="text-sm text-foreground">${campaignData.budget?.toLocaleString("es-AR") || briefData.budgetARS}</div>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-6">
        <h3 className="font-semibold mb-4">Próximos Pasos</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3"><div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center"><span className="text-sm font-bold text-purple-600">1</span></div><div className="text-sm">Los creadores seleccionados serán notificados via WhatsApp y email</div></div>
          <div className="flex items-center gap-3"><div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center"><span className="text-sm font-bold text-purple-600">2</span></div><div className="text-sm">Revisar y aprobar briefs individuales de cada creador</div></div>
          <div className="flex items-center gap-3"><div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center"><span className="text-sm font-bold text-purple-600">3</span></div><div className="text-sm">Monitorear rendimiento en tiempo real</div></div>
        </div>
      </div>
      <div className="flex justify-center pt-4">
        <Button onClick={onLaunch} size="lg" className="px-8">Lanzar Campaña Ahora <ArrowRight className="w-4 h-4 ml-2" /></Button>
      </div>
    </div>
  );
}
