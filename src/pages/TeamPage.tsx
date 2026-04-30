import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { useEntitlements } from '@/lib/useEntitlements';
import UpgradePrompt from '@/components/shared/UpgradePrompt';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Mail, Trash2, Users, Copy, Crown } from 'lucide-react';
import type { OrgRole } from '@/lib/orgContext';

interface Member {
  id: string;
  user_id: string;
  role: OrgRole;
  joined_at: string;
  display_name?: string | null;
}
interface Invite {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export default function TeamPage() {
  const { activeOrg, activeRole } = useOrg();
  const { userLimit, plan } = useEntitlements();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('vendedor');
  const [sending, setSending] = useState(false);

  const canManage = activeRole === 'owner' || activeRole === 'admin';

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const [{ data: mems }, { data: invs }] = await Promise.all([
      supabase.from('memberships').select('id, user_id, role, joined_at').eq('org_id', activeOrg.id),
      supabase.from('org_invitations').select('*').eq('org_id', activeOrg.id).is('accepted_at', null).order('created_at', { ascending: false }),
    ]);
    const ids = (mems || []).map(m => m.user_id);
    const profilesMap: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('user_id, display_name').in('user_id', ids);
      (profs || []).forEach(p => { profilesMap[p.user_id] = p.display_name || ''; });
    }
    setMembers((mems || []).map(m => ({ ...m, display_name: profilesMap[m.user_id] })) as Member[]);
    setInvites((invs || []) as Invite[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [activeOrg?.id]);

  const invite = async () => {
    if (!activeOrg || !email.trim()) return;
    setSending(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('org_invitations').insert({
      org_id: activeOrg.id,
      email: email.trim().toLowerCase(),
      role,
      invited_by: user!.id,
    });
    if (error) { toast.error(error.message); }
    else { toast.success('Invitación creada'); setEmail(''); load(); }
    setSending(false);
  };

  const updateRole = async (id: string, newRole: OrgRole) => {
    const { error } = await supabase.from('memberships').update({ role: newRole }).eq('id', id);
    if (error) toast.error(error.message); else { toast.success('Rol actualizado'); load(); }
  };

  const removeMember = async (id: string) => {
    if (!confirm('¿Eliminar este miembro?')) return;
    const { error } = await supabase.from('memberships').delete().eq('id', id);
    if (error) toast.error(error.message); else { toast.success('Miembro eliminado'); load(); }
  };

  const revokeInvite = async (id: string) => {
    const { error } = await supabase.from('org_invitations').delete().eq('id', id);
    if (error) toast.error(error.message); else { toast.success('Invitación revocada'); load(); }
  };

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/invitacion/${token}`;
    navigator.clipboard.writeText(url);
    toast.success('Enlace copiado');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Users className="w-7 h-7 text-primary" />
        <div>
          <h1 className="text-2xl font-display font-bold">Equipo</h1>
          <p className="text-sm text-muted-foreground">Invitá colaboradores y gestioná roles.</p>
        </div>
      </div>

      {canManage && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2"><Mail className="w-4 h-4" /> Invitar miembro</h2>
            {userLimit !== null && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${members.length >= userLimit ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                {members.length}/{userLimit} usuarios
              </span>
            )}
          </div>
          {userLimit !== null && members.length >= userLimit ? (
            <UpgradePrompt
              inline
              title={`Límite de ${userLimit} usuarios alcanzado`}
              description={`El plan ${plan?.name} permite hasta ${userLimit} miembros por organización. Actualizá para agregar más.`}
              currentPlan={plan?.name}
            />
          ) : (
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1">
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input id="email" type="email" placeholder="persona@email.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="md:w-48">
              <Label className="text-xs">Rol</Label>
              <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="vendedor">Vendedor</SelectItem>
                  <SelectItem value="viewer">Solo lectura</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={invite} disabled={sending || !email.trim()}>{sending ? 'Enviando...' : 'Invitar'}</Button>
            </div>
          </div>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-3">Miembros ({members.length})</h2>
        {loading ? <div className="text-sm text-muted-foreground">Cargando...</div> : (
          <div className="divide-y divide-border">
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between py-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                    {(m.display_name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {m.display_name || m.user_id.slice(0, 8)}
                      {m.role === 'owner' && <Crown className="w-3.5 h-3.5 text-primary" />}
                    </div>
                    <div className="text-xs text-muted-foreground">Desde {new Date(m.joined_at).toLocaleDateString('es-AR')}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && m.role !== 'owner' ? (
                    <Select value={m.role} onValueChange={v => updateRole(m.id, v as OrgRole)}>
                      <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="vendedor">Vendedor</SelectItem>
                        <SelectItem value="viewer">Solo lectura</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">{m.role}</Badge>
                  )}
                  {canManage && m.role !== 'owner' && (
                    <Button size="icon" variant="ghost" onClick={() => removeMember(m.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {invites.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-semibold mb-3">Invitaciones pendientes ({invites.length})</h2>
          <div className="divide-y divide-border">
            {invites.map(i => (
              <div key={i.id} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{i.email}</div>
                  <div className="text-xs text-muted-foreground">Rol: {i.role} · Expira {new Date(i.expires_at).toLocaleDateString('es-AR')}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => copyInviteLink(i.token)}><Copy className="w-3.5 h-3.5 mr-1" />Copiar enlace</Button>
                  {canManage && <Button size="icon" variant="ghost" onClick={() => revokeInvite(i.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}