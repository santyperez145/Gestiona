import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Instagram, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useOrg } from "@/lib/orgContext";
import { createInfluencerProfile, verifyInfluencerDocument } from "@/lib/influencersDB";

export default function InfluencerRegistrationPage() {
  const navigate = useNavigate();
  const { activeOrg } = useOrg();
  const [step, setStep] = useState<"form" | "verify" | "done">("form");
  const [data, setData] = useState({ name: "", instagram: "", email: "", category: "", followers: "" });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrg?.id) return;
    setSubmitted(true);
    try {
      await createInfluencerProfile({ org_id: activeOrg.id, ...data, status: "pending_verification" });
      setStep("verify");
    } catch (err) {
      // handle error quietly — real flow goes to verification state
      setStep("verify");
    }
  };

  const handleVerify = () => {
    setStep("done");
    setTimeout(() => navigate("/influencer-marketing/creadores"), 1200);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-card text-foreground">
      <div className="max-w-xl mx-auto px-6 py-16">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold border border-amber-200 mb-4">
            <Sparkles className="w-3 h-3" /> Registro de Influencers
          </div>
          <h1 className="text-3xl font-display font-bold">Unite al programa</h1>
          <p className="text-muted-foreground mt-2">Completá tu perfil. Te verificamos para empezar a recibir campañas.</p>
        </div>

        {step === "form" && (
          <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="inf-name">Nombre completo</Label>
                <Input id="inf-name" value={data.name} onChange={e => setData({ ...data, name: e.target.value })} placeholder="Tu nombre" required />
              </div>
              <div>
                <Label htmlFor="inf-instagram">Instagram / TikTok</Label>
                <Input id="inf-instagram" value={data.instagram} onChange={e => setData({ ...data, instagram: e.target.value })} placeholder="@usuario" required />
              </div>
            </div>
            <div>
              <Label htmlFor="inf-email">Email</Label>
              <Input id="inf-email" type="email" value={data.email} onChange={e => setData({ ...data, email: e.target.value })} placeholder="tucorreo@email.com" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="inf-cat">Categoría</Label>
                <Input id="inf-cat" value={data.category} onChange={e => setData({ ...data, category: e.target.value })} placeholder="Moda / Fitness / etc." />
              </div>
              <div>
                <Label htmlFor="inf-follow">Seguidores aproximados</Label>
                <Input id="inf-follow" type="number" value={data.followers} onChange={e => setData({ ...data, followers: e.target.value })} placeholder="10000" />
              </div>
            </div>
            <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold" disabled={submitted}>
              {submitted ? "Enviando..." : "Enviar solicitud"} <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        )}

        {step === "verify" && (
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm text-center space-y-6">
            <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
              <Instagram className="w-8 h-8 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-display font-bold">Verificá tu cuenta</h2>
              <p className="text-muted-foreground text-sm mt-2">Enviá tu documento de identidad para completar la verificación. En 24 horas te confirmamos.</p>
            </div>
            <Button onClick={handleVerify} className="gradient-gold text-primary-foreground font-semibold w-full">Confirmar verificación (simulado)</Button>
          </div>
        )}

        {step === "done" && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 shadow-sm text-center space-y-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
            <h2 className="text-xl font-display font-bold">¡Registro completado!</h2>
            <p className="text-sm text-muted-foreground">Ya podés recibir campañas y gestionar tus entregables.</p>
          </div>
        )}
      </div>
    </div>
  );
}
