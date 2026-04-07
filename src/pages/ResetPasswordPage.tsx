import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { KeyRound, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if we have a recovery token in the URL hash
    const hash = window.location.hash;
    if (hash.includes('type=recovery')) {
      setIsRecovery(true);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error('La contraseña debe tener al menos 6 caracteres'); return; }
    if (password !== confirm) { toast.error('Las contraseñas no coinciden'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      toast.success('Contraseña actualizada correctamente');
      setTimeout(() => navigate('/'), 2000);
    } catch (err: any) {
      toast.error(err.message || 'Error al actualizar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <KeyRound className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-xl font-display font-bold mb-2">Enlace inválido</h1>
          <p className="text-muted-foreground text-sm mb-4">Este enlace de recuperación no es válido o expiró.</p>
          <Button onClick={() => navigate('/')} variant="outline">Volver al inicio</Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="text-center">
          <CheckCircle className="w-12 h-12 mx-auto mb-4 text-success" />
          <h1 className="text-xl font-display font-bold mb-2">¡Contraseña actualizada!</h1>
          <p className="text-muted-foreground text-sm">Redirigiendo al sistema...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-2xl font-bold text-primary mb-2">Restablecer Contraseña</h1>
          <p className="text-muted-foreground text-sm">Ingresá tu nueva contraseña</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Nueva contraseña</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Confirmar contraseña</label>
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" required minLength={6} className="bg-muted border-border mt-1" />
            </div>
            <Button type="submit" disabled={loading} className="w-full gradient-gold text-primary-foreground font-semibold">
              {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
