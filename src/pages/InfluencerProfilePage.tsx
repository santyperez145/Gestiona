import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Instagram, MapPin, Mail, Calendar, Star, TrendingUp, Users, Target, Award } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type InfluencerPublicProfile = {
  id: string;
  name: string;
  instagram: string;
  tiktok?: string;
  email: string;
  category: string;
  bio?: string;
  followers_ig: number;
  followers_tiktok: number;
  engagement_rate: number;
  tier: 'nano' | 'micro' | 'medio' | 'macro';
  status: 'active' | 'inactive' | 'pending';
  verified: boolean;
  avatar_url?: string;
  created_at: string;
  total_campaigns: number;
  total_earnings_ars: number;
  avg_delivery_days: number;
  rating: number;
};

export default function InfluencerProfilePage() {
  const { token } = useParams<{ token: string }>();
  const [profile, setProfile] = useState<InfluencerPublicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    (async () => {
      try {
        const { data, error } = await (supabase as any).rpc("get_influencer_public_profile", { p_token: token });
        if (error || !data) { setProfile(null); } else { setProfile(data as InfluencerPublicProfile); }
      } catch { setProfile(null); }
      finally { setLoading(false); }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-9 h-9 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-card text-foreground">
        <div className="text-center max-w-sm">
          <h1 className="text-2xl font-display font-bold">Perfil no encontrado</h1>
          <p className="text-muted-foreground mt-2">Este creador no existe o su enlace ha expirado.</p>
        </div>
      </div>
    );
  }

  const tierLabel = { nano: "Nano", micro: "Micro", medio: "Medio", macro: "Macro" }[profile.tier];
  const isActive = profile.status === 'active';

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50/40 to-card text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
          <div className="flex items-start gap-6">
            <div className="w-20 h-20 rounded-2xl bg-primary/12 border border-primary/25 flex items-center justify-center shrink-0">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt={profile.name} className="w-full h-full rounded-2xl object-cover" />
              ) : (
                <Users className="w-10 h-10 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-display font-bold">{profile.name}</h1>
                {profile.verified && <Badge variant="success"><Award className="w-3 h-3 mr-1" />Verificado</Badge>}
                <Badge variant={isActive ? "default" : "secondary"}>{tierLabel}</Badge>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><Instagram className="w-4 h-4" />{profile.instagram}</span>
                {profile.tiktok && <span className="flex items-center gap-1"><Instagram className="w-4 h-4" />{profile.tiktok}</span>}
                <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />Argentina</span>
                <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />Registrado {new Date(profile.created_at).toLocaleDateString('es-AR')}</span>
              </div>
            </div>
          </div>
          {profile.bio && <p className="mt-4 text-sm text-foreground/80">{profile.bio}</p>}
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Seguidores IG", value: profile.followers_ig.toLocaleString('es-AR'), icon: Users, color: "text-primary" },
            { label: "Tasa de engagement", value: `${profile.engagement_rate}%`, icon: TrendingUp, color: "text-emerald-600" },
            { label: "Campañas completadas", value: String(profile.total_campaigns), icon: Target, color: "text-amber-700" },
            { label: "Rating", value: `${profile.rating}/5`, icon: Star, color: "text-yellow-600" },
          ].map(kpi => (
            <Card key={kpi.label} className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs"><kpi.icon className="w-4 h-4" />{kpi.label}</div>
                <p className="text-xl font-bold mt-1">{kpi.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs: Portafolio / Reviews */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="font-display">Portafolio y Reviews</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="portfolio" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="portfolio">Portafolio</TabsTrigger>
                <TabsTrigger value="reviews">Reviews ({profile.rating.toFixed(1)})</TabsTrigger>
              </TabsList>
              <TabsContent value="portfolio">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="aspect-video rounded-xl bg-muted border border-border flex items-center justify-center text-muted-foreground text-sm">
                      Contenido {i} — {profile.instagram}
                    </div>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="reviews">
                <div className="space-y-4">
                  {[
                    { name: "Marca Zara", rating: 5, text: "Excelente entrega y puntualidad", date: "2026-08-15" },
                    { name: "Marca Nike", rating: 4, text: "Muy buena calidad de contenido", date: "2026-07-22" },
                  ].map((r, i) => (
                    <div key={i} className="flex gap-3 p-4 rounded-xl bg-muted/30 border border-border/50">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map(s => (
                          <Star key={s} className={`w-4 h-4 ${s <= r.rating ? 'text-yellow-500 fill-yellow-500' : 'text-border'}`} />
                        ))}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{r.text}</p>
                        <p className="text-xs text-muted-foreground mt-1">{r.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
