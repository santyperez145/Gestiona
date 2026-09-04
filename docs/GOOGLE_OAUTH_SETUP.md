# Configuración de Google OAuth para Nerqia

**Estado:** runbook vigente. **Revisado:** 2026-09-04.

Si al apretar "Ingresar con Google" recibís un error tipo *"provider is not enabled"*, *"unsupported provider"* o un redirect que falla — es porque falta esta configuración. Es de una sola vez, ~5 minutos.

## Paso 1 — Crear credenciales OAuth en Google Cloud Console

1. Andá a https://console.cloud.google.com/
2. Creá un proyecto nuevo (o usá uno existente). Nombre sugerido: **Nerqia Auth**.
3. En el menú lateral: **APIs & Services → OAuth consent screen**
   - User Type: **External**
   - App name: **Nerqia**
   - User support email: tu email
   - Developer contact: tu email
   - Guardar.
4. En **APIs & Services → Credentials**, hacé **Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: **Nerqia Supabase**
   - **Authorized JavaScript origins**:
     - `http://localhost:8080` (desarrollo)
     - `https://tudominio.com` (producción)
   - **Authorized redirect URIs**: copiá el callback URL que te da Supabase en el paso 2 (es algo como `https://hummeopatkniwkyrrhwc.supabase.co/auth/v1/callback`)
5. Guardá y anotá el **Client ID** y **Client Secret** que te muestra.

## Paso 2 — Habilitar Google en Supabase

1. Abrí https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/auth/providers
2. Buscá **Google** y activá el switch.
3. Pegá:
   - **Client ID for OAuth** (del paso 1)
   - **Client Secret for OAuth** (del paso 1)
4. Copiá el **Callback URL (for OAuth)** que muestra Supabase (algo como `https://hummeopatkniwkyrrhwc.supabase.co/auth/v1/callback`).
5. Volvé al paso 1.4 y pegá ese callback URL en **Authorized redirect URIs** de Google. Guardá en ambos lados.

## Paso 3 — Configurar las URLs de tu app en Supabase

1. Abrí https://supabase.com/dashboard/project/hummeopatkniwkyrrhwc/auth/url-configuration
2. **Site URL**: `https://nerqia.app` en producción (o `http://localhost:8080` en desarrollo)
3. **Redirect URLs** (agregá todas; sin esto fallan Google **y** el magic link / OTP de `/login`):
   - `http://localhost:8080/**`
   - `http://localhost:8080/`
   - `https://nerqia.app/**`
   - `https://nerqia.app/`
   - `https://tudominio.com/**` (si hay dominio propio)
4. Guardá.

El login por email sin contraseña (`signInWithOtp` + `verifyOtp`) redirige a
`/` tras el enlace del correo. Si esa URL no está en la lista, el usuario
confirma el mail y cae en un error de redirect — no es un bug de la app.

## Paso 4 — Probar

1. Abrí tu app, andá a `/auth` y apretá **Ingresar con Google**.
2. Deberías ver el selector de cuenta de Google → consentimiento → vuelta a tu app autenticado.
3. Al primer login, el trigger `handle_new_user_create_org` se dispara automáticamente y crea:
   - Una organización (Workspace) con el nombre del usuario
   - El usuario como `owner`
   - Una suscripción `trialing` de 14 días
   - Settings por defecto

## Errores comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `Provider Google is not enabled` | Paso 2 no hecho | Habilitar Google en Supabase |
| `redirect_uri_mismatch` (Google) | Callback URL no coincide | Verificar que el URL en Google y en Supabase sean idénticos |
| Llega al dashboard pero `org` viene null | Trigger no ejecutó | Verificar logs en Supabase → Database → Logs |
| `Database error saving new user` | Trigger falla | Aplicar la última versión de `handle_new_user_create_org` desde `migration_bundle.sql` |

## Notas técnicas

- Google envía `full_name` en `raw_user_meta_data`. El trigger lo usa para nombrar la org como *"<Nombre> Workspace"*.
- Si el usuario ya existe (por email), Supabase **no** crea uno nuevo — vincula la sesión con el existente.
- Los usuarios de Google no tienen password. Si quieren agregarle uno luego, pueden usar "Olvidé mi contraseña" para setearlo.
