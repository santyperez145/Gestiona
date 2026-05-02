import { useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useOrg } from '@/lib/orgContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import { User, Lock, Building2, Camera, Save, Crown, ShieldCheck } from 'lucide-react';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dueño', admin: 'Administrador', vendedor: 'Vendedor', viewer: 'Viewer',
};
const ROLE_COLOR: Record<string, string> = {
  owner: 'bg-primary/15 text-primary border-primary/20',
  admin: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  vendedor: 'bg-green-500/15 text-green-400 border-green-500/20',
  viewer: 'bg-muted text-muted-foreground border-border',
};

export default function ProfilePage() {
  const { user } = useAuth();
  const { memberships, isPlatformAdmin } = useOrg();

  const [name, setName] = useState(user?.user_metadata?.full_name || user?.user_metadata?.name || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.user_metadata?.avatar_url || null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials = (name || user?.email || '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // ── Save display name ─────────────────────────────────────────────────────

  const handleSaveProfile = async () => {
    if (!name.trim()) return;
    setSavingProfile(true);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
    if (error) toast.error(error.message);
    else toast.success('Nombre actualizado');
    setSavingProfile(false);
  };

  // ── Change password ───────────────────────────────────────────────────────

  const handleChangePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) toast.error(error.message);
    else {
      toast.success('Contraseña actualizada');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setSavingPassword(false);
  };

  // ── Upload avatar ─────────────────────────────────────────────────────────

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('La imagen debe ser menor a 2MB');
      return;
    }
    setUploadingAvatar(true);
    const ext = file.name.split('.').pop();
    const path = `avatars/${user.id}.${ext}`;
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (upErr) {
      toast.error(upErr.message);
      setUploadingAvatar(false);
      return;
    }
    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = urlData.publicUrl + `?t=${Date.now()}`;
    const { error: metaErr } = await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
    if (metaErr) toast.error(metaErr.message);
    else { setAvatarUrl(publicUrl); toast.success('Avatar actualizado'); }
    setUploadingAvatar(false);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold flex items-center gap-2">
          <User className="w-5 h-5" /> Mi Perfil
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Administrá tu información personal y seguridad.</p>
      </div>

      {/* Avatar + Name */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Información personal</h2>

        {/* Avatar */}
        <div className="flex items-center gap-5">
          <div className="relative">
            <Avatar className="w-20 h-20 ring-2 ring-border">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="text-2xl font-bold bg-primary/10 text-primary">{initials}</AvatarFallback>
            </Avatar>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors"
              title="Cambiar foto"
            >
              {uploadingAvatar
                ? <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                : <Camera className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
          </div>
          <div>
            <p className="font-medium">{name || '(sin nombre)'}</p>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
            <div className="flex items-center gap-2 mt-1.5">
              {isPlatformAdmin && (
                <Badge variant="outline" className="text-xs gap-1 text-primary border-primary/30">
                  <Crown className="w-2.5 h-2.5" /> Platform Admin
                </Badge>
              )}
              <Badge variant="outline" className="text-xs gap-1 text-muted-foreground">
                <ShieldCheck className="w-2.5 h-2.5" />
                {user?.email_confirmed_at ? 'Email verificado' : 'Email sin verificar'}
              </Badge>
            </div>
          </div>
        </div>

        {/* Name field */}
        <div className="space-y-1.5">
          <Label>Nombre visible</Label>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Tu nombre completo"
              className="h-9 flex-1"
              onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
            />
            <Button size="sm" onClick={handleSaveProfile} disabled={savingProfile || !name.trim()} className="shrink-0">
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {savingProfile ? 'Guardando...' : 'Guardar'}
            </Button>
          </div>
        </div>

        {/* Email (read-only) */}
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={user?.email || ''} readOnly className="h-9 bg-muted cursor-not-allowed" />
          <p className="text-xs text-muted-foreground">El email no se puede cambiar desde aquí.</p>
        </div>
      </div>

      {/* Password change */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Lock className="w-3.5 h-3.5" /> Cambiar contraseña
        </h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nueva contraseña</Label>
            <Input
              type="password" value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirmar contraseña</Label>
            <Input
              type="password" value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Repetí la contraseña"
              className="h-9"
              onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
            />
          </div>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-destructive">Las contraseñas no coinciden</p>
          )}
        </div>
        <Button
          onClick={handleChangePassword}
          disabled={savingPassword || !newPassword || newPassword !== confirmPassword}
          size="sm"
        >
          <Lock className="w-3.5 h-3.5 mr-1.5" />
          {savingPassword ? 'Actualizando...' : 'Actualizar contraseña'}
        </Button>
      </div>

      {/* Memberships */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5" /> Mis organizaciones
        </h2>
        {memberships.length === 0
          ? <p className="text-sm text-muted-foreground">No pertenecés a ninguna organización.</p>
          : (
            <div className="space-y-2">
              {memberships.map(m => (
                <div key={m.org_id} className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{m.organization.name}</p>
                      <p className="text-xs text-muted-foreground">/{m.organization.slug}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-xs ${ROLE_COLOR[m.role] || ROLE_COLOR.viewer}`}>
                    {ROLE_LABEL[m.role] || m.role}
                  </Badge>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Account info */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-3">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Información de cuenta</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">ID de usuario</span>
            <span className="font-mono text-xs text-muted-foreground truncate max-w-[200px]">{user?.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cuenta creada</span>
            <span className="text-muted-foreground text-xs">
              {user?.created_at ? new Date(user.created_at).toLocaleDateString('es-AR', { dateStyle: 'long' }) : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Último acceso</span>
            <span className="text-muted-foreground text-xs">
              {user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
