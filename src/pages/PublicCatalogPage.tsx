import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import CatalogPage from "./CatalogPage";

export default function PublicCatalogPage() {
  const { userId } = useParams<{ userId: string }>();
  const [valid, setValid] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId) { setValid(false); return; }
    // Verify user exists by checking if they have settings
    supabase.from('settings').select('id').eq('user_id', userId).maybeSingle()
      .then(({ data }) => setValid(!!data));
  }, [userId]);

  if (valid === null) return (
    <div className="min-h-screen flex items-center justify-center bg-[#1A1A2E]">
      <div className="w-8 h-8 border-2 border-[#D4A843] border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!valid) return (
    <div className="min-h-screen flex items-center justify-center bg-[#1A1A2E] text-white">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Catálogo no encontrado</h1>
        <p className="text-gray-400">El enlace no es válido o el negocio no existe.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#1A1A2E] text-white p-4 md:p-8">
      <CatalogPage isPublic publicUserId={userId} />
    </div>
  );
}
