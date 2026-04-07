import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

export type AppRole = 'admin' | 'vendedor' | 'viewer';

export function useUserRole() {
  const { user } = useAuth();
  const [role, setRole] = useState<AppRole>('viewer');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setRole('viewer'); setLoading(false); return; }
    
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setRole(data[0].role as AppRole);
        } else {
          setRole('viewer');
        }
        setLoading(false);
      });
  }, [user]);

  return { role, loading, isAdmin: role === 'admin', isVendedor: role === 'vendedor', isViewer: role === 'viewer' };
}
