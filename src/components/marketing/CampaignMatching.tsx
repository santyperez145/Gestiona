import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { getProductsDB } from "@/lib/supabaseStore";
import { listInfluencers } from "@/lib/influencersDB";
import { getMarketingPostsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, TrendingUp, DollarSign, Users, Target, Sparkles, BarChart3, ArrowRight, Eye, Coffee, Calendar, Plus } from "lucide-react";
import { toast } from "sonner";

export default function CampaignMatching() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [products, setProducts] = useState<any[]>([]);
  const [influencers, setInfluencers] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    influencerTier: "",
    campaignType: "",
    minReach: 0,
    maxPrice: 0,
  });
  const calculateMatches = useCallback(() => {
    if (products.length === 0 || influencers.length === 0 || campaigns.length === 0) {
      setMatches([]);
      return;
    }

    const filteredInfluencers = influencers.filter(inf => {
      if (filters.influencerTier && inf.tier !== filters.influencerTier) return false;
      if (filters.minReach > 0 && (inf.reach || 0) < filters.minReach) return false;
      if (filters.maxPrice > 0 && (inf.price || 0) > filters.maxPrice) return false;
      return true;
    });

    const filteredCampaigns = campaigns.filter(camp => {
      if (filters.campaignType && camp.type !== filters.campaignType) return false;
      return true;
    });

    const result: any[] = [];

    filteredInfluencers.forEach(influencer => {
      filteredCampaigns.forEach(campaign => {
        const productMatchScore = calculateProductMatchScore(influencer, campaign, products);
        const budgetMatchScore = calculateBudgetMatchScore(influencer, campaign);
        const audienceMatchScore = calculateAudienceMatchScore(influencer, campaign);
        
        const totalScore = (productMatchScore * 0.4) + (budgetMatchScore * 0.3) + (audienceMatchScore * 0.3);
        
        if (totalScore > 0.6) {
          result.push({
            influencer,
            campaign,
            score: totalScore,
            estimatedReach: Math.round((influencer.reach || 0) * (campaign.engagement_rate || 0.05)),
            estimatedCost: Math.min(
              (influencer.price || 0),
              (campaign.budget_ars || 0) * 0.3
            ),
            rationale: generateMatchRationale(influencer, campaign, productMatchScore, budgetMatchScore, audienceMatchScore)
          });
        }
      });
    });

    setMatches(result.sort((a, b) => b.score - a.score));
  }, [products, influencers, campaigns, filters]);

  useEffect(() => {
    const loadData = async () => {
      if (!user || !activeOrg) return;
      try {
        setLoading(true);
        const [productsData, influencersData, campaignsData] = await Promise.all([
          getProductsDB(user.id),
          listInfluencers(),
          getMarketingPostsDB(user.id),
        ]);
        setProducts(productsData);
        setInfluencers(influencersData);
        setCampaigns(campaignsData);
        calculateMatches();
      } catch (error) {
        console.error("Error loading data:", error);
        toast.error("Error cargando datos");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user, activeOrg?.id, calculateMatches]);

  useEffect(() => {
    calculateMatches();
  }, [products, influencers, campaigns, filters]);

  const calculateProductMatchScore = (influencer: any, campaign: any, products: any[]) => {
    // Simplificado: en una implementación real analizaría el contenido de la campaña y productos
    // Por ahora, basado en categoría y tema
    const campaignContent = (campaign.content || "").toLowerCase();
    const campaignTheme = (campaign.theme || "").toLowerCase();
    
    let score = 0.5; // Base score
    
    // Verificar si hay menciones de productos en el contenido
    products.forEach(product => {
      if (
        product.name?.toLowerCase().includes(campaignContent) ||
        product.brand?.toLowerCase().includes(campaignContent) ||
        product.category?.toLowerCase().includes(campaignContent)
      ) {
        score += 0.3;
      }
      
      if (
        product.name?.toLowerCase().includes(campaignTheme) ||
        product.brand?.toLowerCase().includes(campaignTheme) ||
        product.category?.toLowerCase().includes(campaignTheme)
      ) {
        score += 0.2;
      }
    });
    
    return Math.min(score, 1.0);
  };

  const calculateBudgetMatchScore = (influencer: any, campaign: any) => {
    const influencerPrice = influencer.price || 0;
    const campaignBudget = campaign.budget_ars || 0;
    
    if (campaignBudget === 0) return 0.5;
    
    // Ideal: influencer costo entre 10-30% del presupuesto de campaña
    const ratio = influencerPrice / campaignBudget;
    
    if (ratio >= 0.1 && ratio <= 0.3) return 1.0;
    if (ratio > 0 && ratio < 0.1) return ratio / 0.1; // Linear increase from 0 to 0.1
    if (ratio > 0.3 && ratio <= 0.5) return (0.5 - ratio) / 0.2; // Linear decrease from 0.3 to 0.5
    return 0.1; // Muy bajo score para ratios extremos
  };

  const calculateAudienceMatchScore = (influencer: any, campaign: any) => {
    // Simplificado: basado en engagement rate y reach
    const engagementScore = Math.min((influencer.ctr || 0) / 5, 1.0); // Normalizar CTR asumiendo 5% como excelente
    const reachScore = Math.min((influencer.reach || 0) / 100000, 1.0); // Normalizar reach asumiendo 100k como bueno
    
    return (engagementScore * 0.6) + (reachScore * 0.4);
  };

  const generateMatchRationale = (influencer: any, campaign: any, productScore: number, budgetScore: number, audienceScore: number) => {
    const rationales: string[] = [];
    
    if (productScore > 0.7) rationales.push("Alta relevancia de producto");
    else if (productScore > 0.4) rationales.push("Relevancia moderada de producto");
    
    if (budgetScore > 0.7) rationales.push("Presupuesto bien alineado");
    else if (budgetScore > 0.4) rationales.push("Presupuesto aceptable");
    
    if (audienceScore > 0.7) rationales.push("Audience altamente relevante");
    else if (audienceScore > 0.4) rationales.push("Audience moderadamente relevante");
    
    return rationales.join(", ") || "Match basado en métricas generales";
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <p className="mt-4 text-muted-foreground">Cargando datos de matching...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        icon={Target} 
        title="Matching de Campañas" 
        description="Encuentra las mejores colaboraciones entre influencers y campañas basadas en producto, presupuesto y audiencia"
      />
      
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-3">
          <Label>Tier de Influencer</Label>
          <Select value={filters.influencerTier} onValueChange={(v) => setFilters({...filters, influencerTier: v})}>
            <SelectTrigger><SelectValue placeholder="Todos los tiers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todos</SelectItem>
              <SelectItem value="nano">Nano (10k-50k)</SelectItem>
              <SelectItem value="micro">Micro (50k-100k)</SelectItem>
              <SelectItem value="medio">Medio (100k-500k)</SelectItem>
              <SelectItem value="macro">Macro (500k-2M)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-3">
          <Label>Tipo de Campaña</Label>
          <Select value={filters.campaignType} onValueChange={(v) => setFilters({...filters, campaignType: v})}>
            <SelectTrigger><SelectValue placeholder="Todos los tipos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todos</SelectItem>
              <SelectItem value="post">Publicación estándar</SelectItem>
              <SelectItem value="story">Historia</SelectItem>
              <SelectItem value="reel">Reel</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="live">En vivo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-3">
          <Label>Alcance Mínimo</Label>
          <Input 
            type="number" 
            placeholder="Ej: 50000" 
            value={filters.minReach.toString()} 
            onChange={(e) => {
              const value = parseInt(e.target.value) || 0;
              setFilters({...filters, minReach: value});
            }} 
          />
        </div>
        
        <div className="space-y-3">
          <Label>Precio Máximo (ARS)</Label>
          <Input 
            type="number" 
            placeholder="Ej: 200000" 
            value={filters.maxPrice.toString()} 
            onChange={(e) => {
              const value = parseInt(e.target.value) || 0;
              setFilters({...filters, maxPrice: value});
            }} 
          />
        </div>
        
        <div className="space-y-3">
          <Label>Productos Disponibles</Label>
          <p className="text-sm text-muted-foreground">{products.length} productos activos</p>
        </div>
        
        <div className="space-y-3">
          <label className="flex items-center space-x-2">
            <span>Influencers Disponibles</span>
            <Badge variant="secondary">{influencers.length}</Badge>
          </label>
          <p className="text-xs text-muted-foreground mt-1">{influencers.length} influencers en la red</p>
        </div>
        
        <div className="space-y-3">
          <label className="flex items-center space-x-2">
            <span>Campañas Activas</span>
            <Badge variant="secondary">{campaigns.length}</Badge>
          </label>
          <p className="text-xs text-muted-foreground mt-1">{campaigns.length} campañas para matching</p>
        </div>
      </div>
      
      <div className="divide-y divide-border/60">
        <div className="px-4 py-3 text-sm font-medium text-muted-foreground">
          Coincidencias encontradas: <span className="font-semibold">{matches.length}</span>
        </div>
        
        {matches.length === 0 ? (
          <div className="px-6 py-8 text-center text-muted-foreground">
            <Sparkles className="h-8 w-8 mx-auto mb-4" />
            <p>No se encontraron coincidencias con los filtros actuales</p>
            <p className="mt-2 text-xs">Intenta ajustar los criterios de búsqueda</p>
          </div>
        ) : (
          <div className="space-y-4">
            {matches.slice(0, 10).map((match, index) => (
              <div key={index} className="border border-border/60 rounded-xl p-4 hover:border-primary/50 transition-colors">
                <div className="flex items-start space-x-4">
                  <div className="flex-shrink-0 h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center">
                    <span className="text-primary">{index + 1}</span>
                  </div>
                  
                  <div className="flex-1 space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="font-semibold">{match.influencer.name}</h4>
                        <p className="text-xs text-muted-foreground flex items-center space-x-1">
                          <Badge variant={match.influencer.tier === 'nano' ? 'outline' : match.influencer.tier === 'micro' ? 'secondary' : match.influencer.tier === 'medio' ? 'default' : 'destructive'}>
                            {match.influencer.tier}
                          </Badge>
                          <span className="ml-1">@{match.influencer.username || match.influencer.instagram || ''}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {match.influencer.reach?.toLocaleString('es-AR')} alcance • 
                          {(match.influencer.ctr || 0).toFixed(1)}% CTR
                        </p>
                      </div>
                      
                      <div className="text-right text-xs space-x-2">
                        <Badge variant="secondary">
                          Score: {(match.score * 100).toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-3 text-xs">
                      <div className="flex-1">
                        <p className="font-medium">Campaña: {match.campaign.title || match.campaign.name}</p>
                        <p className="text-muted-foreground">{match.campaign.theme || ''} • {match.campaign.postType || ''}</p>
                      </div>
                      
                      <div className="space-x-2">
                        <div className="flex flex-col items-center">
                          <span className="font-medium">${match.estimatedCost.toLocaleString('es-AR')}</span>
                          <span className="text-xs text-muted-foreground">Costo est.</span>
                        </div>
                      </div>
                      
                      <div className="space-x-2">
                        <div className="flex flex-col items-center">
                          <span className="font-medium">{match.estimatedReach.toLocaleString('es-AR')}</span>
                          <span className="text-xs text-muted-foreground">Alcance est.</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-border/60 mt-3 pt-3">
                      <p className="text-xs text-muted-foreground italic">
                        {match.rationale}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {matches.length > 10 && (
          <div className="px-6 py-4 text-center text-sm text-muted-foreground">
            y {matches.length - 10} más coincidencias...
          </div>
        )}
      </div>
    </div>
  );
}

// Componentes auxiliares necesarios

function PageHeader({ icon: Icon, title, description, className }: { 
  icon: any; 
  title: string; 
  description: string; 
  className?: string 
}) {
  return (
    <div className={cn("mb-6", className)}>
      <div className="flex items-center gap-3 mb-2">
        <div className="h-4 w-4 flex items-center justify-center">
          {typeof Icon === 'function' ? <Icon className="h-4 w-4" /> : <span className="text-xs">{String(Icon)}</span>}
        </div>
        <h2 className="font-display text-lg">{title}</h2>
      </div>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}