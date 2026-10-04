# Apps nativas de Nerqia

**Estado:** arquitectura implementada; distribución no certificada.  
**Revisión:** 2026-10-03. **Owner:** Producto / Ingeniería.

## 1. Decisión

Nerqia usa **Tauri 2** como shell compartido para escritorio y mobile. No se
mantiene un segundo frontend: el mismo React/Vite, Router, identidad, permisos y
Business Graph se empaquetan como assets locales. Esto reduce divergencias sin
convertir la app en un navegador remoto: cada release contiene una versión
inmutable del frontend y sólo consume las APIs HTTPS autorizadas.

La PWA continúa siendo el canal web instalable. Durante un build Tauri se
desactiva el service worker: el binario ya versiona sus assets y no debe mezclar
un shell nuevo con caché web anterior.

## 2. Implementado

- shell Tauri 2.12.1 con identificador `app.nerqia`;
- marca Nerqia generada para Windows, macOS, iOS y Android;
- ventana desktop con tamaño mínimo operativo y CSP explícita;
- una sola instancia desktop, restaurada y enfocada ante un deep link;
- protocolo `nerqia://` registrado en desktop y mobile;
- OAuth de Google en navegador del sistema, nunca dentro del WebView;
- callback PKCE, magic link y recuperación de clave recibidos en arranque frío
  o con la app abierta;
- allowlist estricta de callback y destinos internos, más mensajes de cliente;
- permisos Tauri mínimos: eventos, lectura de deep link y apertura acotada a
  endpoints HTTPS de Supabase;
- scripts reproducibles para desarrollo, Windows y Android;
- tests unitarios del límite de confianza y build frontend nativo sin PWA.

## 3. Autenticación y seguridad

El navegador del sistema abre el endpoint OAuth de Supabase y vuelve a
`nerqia://auth/callback`. El cliente acepta únicamente protocolo `nerqia:`, host
`auth` y ruta `/callback`; después intercambia el código PKCE en el mismo perfil
local que creó el verificador. Un `next` externo se descarta.

Supabase debe incluir `nerqia://auth/callback` en **Additional Redirect URLs**.
Sin esa configuración Google, magic links y recuperación seguirán funcionando
en web, pero el proveedor rechazará la vuelta a la app nativa. Email/contraseña
y OTP digitado no dependen de ese redirect.

No se agregaron secretos al binario. Las claves `VITE_*` publicables conservan
el mismo alcance que en web; autoridad real continúa en RLS, RPC y Edge
Functions. Tokens privados de firma y publicación pertenecen a CI/environments.

## 4. Matriz de entrega

| Canal | Código | Evidencia actual | Gate para distribuir |
|---|---|---|---|
| Web/PWA | Operativo | Build/CI y producción | Gates normales de release. |
| Windows | Shell y auth implementados | assets nativos compilan; Rust instalado; `cargo check` bloqueado localmente por falta de MSVC | CI Windows verde, certificado de firma, instalador firmado, SmartScreen y prueba en equipo limpio. |
| Android | Configuración/íconos/scripts | Android SDK detectado; proyecto Gradle todavía no inicializado | JDK 17+, NDK, `tauri android init`, keystore, AAB firmado, OAuth redirect permitido y device test. |
| macOS/iOS | Configuración portable | íconos y código común presentes | runner macOS, Xcode, Apple Developer, signing/notarización, universal/deep link y device test. |

Un `.exe`, APK o AAB sin firma sirve como artefacto de ingeniería; no es una
release confiable para clientes. iOS no se puede compilar ni firmar desde
Windows.

## 5. Operación local

```bash
npm ci
npm run native:info
npm run native:dev
npm run native:build:windows
```

Android, después de instalar JDK/NDK y declarar `JAVA_HOME`, `ANDROID_HOME` y
`NDK_HOME`:

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi \
  i686-linux-android x86_64-linux-android
npm run native:android:init
npm run native:android:dev
npm run native:android:build
```

## 6. Siguiente cierre

1. compilar NSIS en Windows CI y conservar artefacto **unsigned** sólo para QA;
2. configurar redirect nativo en Supabase y probar Google/magic/recovery;
3. adaptar navegación externa, impresión, descargas, cámara y códigos de barra
   por capacidad, sin permisos globales;
4. inicializar Android y probar POS/stock en un dispositivo real;
5. habilitar actualización firmada recién con canal, manifiesto y rollback;
6. firmar, instalar en equipo limpio, validar desinstalación y recién publicar.

Fuentes de implementación: [Tauri 2](https://v2.tauri.app/start/),
[prerrequisitos](https://v2.tauri.app/start/prerequisites/),
[deep links](https://v2.tauri.app/plugin/deep-linking/) y
[deep linking nativo de Supabase](https://supabase.com/docs/guides/auth/native-mobile-deep-linking).

