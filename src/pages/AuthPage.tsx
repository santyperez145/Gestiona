import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { LogIn, UserPlus } from 'lucide-react';

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        await signIn(email, password);
        toast.success('¡Bienvenido de vuelta!');
      } else {
        await signUp(email, password, name);
        toast.success('Cuenta creada. Revisá tu email para confirmar.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Error de autenticación');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-primary tracking-wide mb-2">
            ✦ Exentry Imports
          </h1>
          <p className="text-muted-foreground">Sistema de Gestión Integral</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6 shadow-card">
          <div className="flex mb-6 bg-muted rounded-lg p-1">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${isLogin ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}
            >
              Iniciar Sesión
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${!isLogin ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}
            >
              Registrarse
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="text-sm text-muted-foreground">Nombre</label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" className="bg-muted border-border mt-1" />
              </div>
            )}
            <div>
              <label className="text-sm text-muted-foreground">Email</label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" required className="bg-muted border-border mt-1" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Contraseña</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required minLength={6} className="bg-muted border-border mt-1" />
            </div>
            <Button type="submit" disabled={loading} className="w-full gradient-gold text-primary-foreground font-semibold shadow-gold">
              {loading ? 'Cargando...' : isLogin ? (
                <><LogIn className="w-4 h-4 mr-2" />Ingresar</>
              ) : (
                <><UserPlus className="w-4 h-4 mr-2" />Crear Cuenta</>
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Exentry Imports © 2025 · Todos los derechos reservados
        </p>
      </div>
    </div>
  );
}
