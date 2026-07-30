// Autenticación para funciones que cuestan dinero.
//
// `verify_jwt` en el gateway de Supabase NO alcanza: la clave anónima es un JWT
// firmado y válido, y viaja en el bundle del navegador. O sea que cualquier
// visitante puede llamar una función "protegida" sólo por verify_jwt.
//
// Para cualquier función que consuma crédito de un proveedor externo (Anthropic,
// Twilio, Resend) eso es abuso de costo directo: alguien con el bundle abierto
// puede vaciar el presupuesto. Estas funciones necesitan un usuario REAL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export interface AuthedUser {
  id: string;
  email: string | null;
}

/**
 * Devuelve el usuario autenticado, o `null` si el request no trae una sesión de
 * usuario real (la clave anónima sola no cuenta).
 *
 * Se valida contra `auth.getUser()`, que verifica el token contra la base: un
 * JWT anónimo no resuelve a ningún usuario y da null.
 */
export async function getAuthedUser(req: Request): Promise<AuthedUser | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;

  try {
    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user?.id) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

/**
 * Corta el request con 401 si no hay usuario real. Se usa como primera línea
 * del handler:
 *
 *   const auth = await requireUser(req, corsHeaders);
 *   if (auth.response) return auth.response;
 *   // auth.user está garantizado de acá para abajo
 */
export async function requireUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<{ user: AuthedUser; response: null } | { user: null; response: Response }> {
  const user = await getAuthedUser(req);
  if (!user) {
    return {
      user: null,
      response: new Response(
        JSON.stringify({ error: "Necesitás iniciar sesión para usar esta función" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }
  return { user, response: null };
}
