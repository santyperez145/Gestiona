
# Plan: Redesign UX/UI Profesional v8.5

## Filosofía
Elevar la estética "dark luxury" actual con refinamiento profesional: glassmorphism sutil, gradientes más ricos, tipografía mejorada, micro-animaciones, y mejor jerarquía visual. Sin cambiar lógica de negocio.

---

## 1. Design Tokens Mejorados (`index.css`)

- Agregar variables de glassmorphism y profundidad
- Gradientes más sofisticados para cards y sidebar
- Sombras más elegantes con capas
- Nuevo scrollbar estilizado
- Focus rings más visibles
- Transiciones suaves globales

## 2. Sidebar Refinado (`AppLayout.tsx`)

- Logo con brillo sutil dorado
- Nav items con indicador lateral activo (barra dorada a la izquierda)
- Hover states con transición de fondo más suave
- Separadores visuales entre secciones
- Footer con gradiente sutil
- Ícono de campana con animación pulse cuando hay notificaciones

## 3. Dashboard Premium (`Dashboard.tsx`)

- Header con saludo dinámico ("Buenos días, Santiago") + fecha
- KPI cards con borde gradiente sutil al hover
- Gauge charts más grandes y con label mejorado
- Cards de gráficos con header más elegante (línea dorada decorativa)
- Sección de alertas con diseño más limpio
- Espaciado más generoso entre secciones

## 4. Auth Page Elevada (`AuthPage.tsx`)

- Fondo con patrón sutil (radial gradient)
- Card con glassmorphism
- Logo más grande y prominente
- Inputs con focus state dorado
- Animación de entrada staggered

## 5. KPI Cards Mejoradas (`KPICard.tsx`)

- Borde gradiente sutil en hover
- Ícono con fondo circular semitransparente
- Mejor separación visual entre valor y sublabel

## 6. Componentes de Tabla

- Headers con fondo sutil diferenciado
- Hover rows con transición más suave
- Badges con mejor contraste y pill design
- Empty states más visuales

---

## Archivos a modificar

| Archivo | Cambio |
|---|---|
| `src/index.css` | Tokens de glassmorphism, scrollbar, focus, transiciones |
| `src/components/AppLayout.tsx` | Sidebar con indicador activo, hover refinado |
| `src/pages/Dashboard.tsx` | Header con saludo, spacing, decorative elements |
| `src/pages/AuthPage.tsx` | Glassmorphism, pattern background, animaciones |
| `src/components/shared/KPICard.tsx` | Icon background, hover gradient border |
| `src/components/shared/NotificationBell.tsx` | Pulse animation on unread |
| `tailwind.config.ts` | Nuevas animaciones y utilities |
