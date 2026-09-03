# Guía para entender Nerqia desde cero

Esta guía es para alguien que **no programa** o que recién arranca, y quiere
entender qué es esta plataforma, cómo está hecha, y en qué orden estudiarla.

No hace falta leerla entera de una. Está pensada para volver.

---

## Parte 1 — Qué es esto, en criollo

Nerqia es una plataforma de **tres productos que comparten una misma base de
datos**. Esa es la idea que más cuesta al principio y la que más aclara todo lo
demás.

### 1. El sistema de gestión

Es lo que usa el dueño de un comercio todos los días: cargar productos, vender
en el mostrador, ver cuánta plata entró, saber qué se está por acabar, mandarle
un WhatsApp a un cliente que hace tres meses no compra.

En la app es todo lo que cuelga de `/` — Productos, Ventas, Clientes, Caja,
Reportes.

### 2. La tienda online

Es la página pública donde compra cualquiera, sin cuenta: `/tienda/exentryimports`.
Muestra el mismo catálogo que la gestión, pero **saneado**: el comprador ve el
precio de venta, nunca el costo ni el margen.

### 3. El panel de plataforma

Es el que usa el dueño **de Nerqia**, no el del comercio. Ve todas las
organizaciones, cuánto factura cada una, y cobra una comisión por venta. Vive
en `/platform`.

> **La analogía que sirve:** Nerqia es a un comercio lo que Shopify o
> Tiendanube son a una tienda. El comercio alquila el sistema; la plataforma
> cobra el alquiler y una comisión de lo que venda.

### Por qué están separados

Porque los tres tienen **públicos distintos y permisos distintos**. Ser dueño de
la plataforma **no** te da permiso para entrar a la gestión de un comercio. Un
comprador de la tienda **no** es un usuario del sistema. Confundir esos roles es
la fuente de la mitad de los bugs de seguridad de cualquier SaaS.

---

## Parte 2 — De qué está hecho

Toda aplicación web moderna tiene tres partes. Sirve pensarlas como un
restaurante:

| Parte | En el restaurante | Acá |
|---|---|---|
| **Frontend** | El salón: mesas, carta, mozos | React + TypeScript, corriendo en el navegador |
| **Backend** | La cocina | Supabase (Postgres) + Edge Functions |
| **Base de datos** | La heladera y el depósito | PostgreSQL |

### El frontend: React

React es una forma de escribir páginas web armándolas con **piezas
reutilizables** que se llaman componentes. Un componente es una función que
devuelve cómo se ve algo.

Mirá `src/storefront/ProductQuestions.tsx`: es el bloque de "Preguntas y
respuestas" de la ficha de un producto. Se usa escribiendo
`<ProductQuestions productId={...} />` y aparece entero.

**TypeScript** es JavaScript con etiquetas que dicen qué tipo de dato es cada
cosa. Si una función espera un número y le pasás un texto, te avisa **antes** de
que el programa corra. En este proyecto eso lo chequea `npm run typecheck`.

### El backend: Supabase

Supabase es Postgres (una base de datos) con cosas agregadas: usuarios,
permisos, y una API automática. La parte que importa entender es **RLS**.

**RLS (Row Level Security)** significa que la base decide, fila por fila, quién
puede ver qué. No es el programa el que filtra: es la base.

Por qué importa: la clave con la que el navegador habla con la base **viaja
dentro de la página web**. Cualquiera la puede sacar. Si la seguridad estuviera
sólo en el código de la página, cualquiera podría pedirle a la base los datos de
otro comercio. Con RLS, aunque pida, la base devuelve vacío.

Este proyecto arrastraba políticas `USING (true)` —que significa "que lo vea
cualquiera"— y con eso se podían leer los tokens de MercadoPago de **todas** las
organizaciones. Está cerrado y hay tests que fallan si vuelve a pasar.

### La base: PostgreSQL

Los datos viven en **tablas**, que son como planillas: `products`, `sales`,
`customers`.

Tres cosas de Postgres que este proyecto usa mucho y conviene entender:

- **Vista (`VIEW`)**: una consulta guardada con nombre. `store_catalog_products`
  es la tabla de productos pero sin costos ni márgenes — la tienda lee esa, no
  la tabla cruda.
- **Función (`FUNCTION` / RPC)**: código que corre **dentro** de la base.
  `create_store_order` recibe una compra y devuelve la orden creada, con todos
  los cálculos hechos ahí.
- **Trigger**: código que se dispara solo cuando algo pasa.
  `trg_sale_stock_movement` descuenta el stock cada vez que se inserta una
  venta, sin que nadie se lo pida.

---

## Parte 3 — El orden para estudiar, desde cero

Cada etapa asume la anterior. No saltees: la 4 no se entiende sin la 2.

### Etapa 0 — Antes de tocar código (1–2 semanas)

**Aprendé a leer HTML y CSS.** HTML es la estructura (esto es un título, esto un
botón); CSS es cómo se ve (este botón es dorado). No hace falta dominarlo:
alcanza con reconocerlo.

**Aprendé la consola.** `cd` para moverte entre carpetas, `ls` para ver qué hay.
Vas a vivir ahí.

**Aprendé qué es Git.** Es el historial del proyecto: cada cambio queda guardado
con un mensaje que explica por qué se hizo. Probá `git log --oneline -20` en
esta carpeta y vas a ver los últimos veinte cambios.

> **Ejercicio:** abrí la tienda en el navegador, apretá F12, y buscá en el
> "Inspector" el precio de un producto. Estás viendo el HTML que generó React.

### Etapa 1 — JavaScript (3–4 semanas)

Es el lenguaje. Lo mínimo que necesitás:

- Variables (`const`, `let`), tipos (texto, número, booleano)
- Arreglos y objetos — el 80% de la programación es mover listas de cosas
- `map`, `filter`, `reduce`: transformar listas. **Esto es lo más importante.**
- Funciones
- `async` / `await`: cómo se espera algo que tarda (pedirle datos a la base)

> **Ejercicio sobre este proyecto:** abrí `src/lib/crossSell.ts`. Es JavaScript
> puro, sin nada de React ni base de datos: recibe un carrito y una lista de
> productos, y devuelve qué sugerir. Leelo entero. Si entendés ese archivo,
> entendés JavaScript.

### Etapa 2 — TypeScript (1–2 semanas)

No es un lenguaje nuevo: es JavaScript con anotaciones de tipo.

```ts
function pesos(n: number): string { ... }
//              ↑ recibe un número   ↑ devuelve un texto
```

Lo que más se usa acá: `interface` (la forma de un objeto) y `type`.

> **Ejercicio:** en `src/lib/orgHealth.ts`, buscá `interface OrgHealthRow`. Esa
> es la forma exacta de una fila que devuelve la base. Compará con la vista SQL
> `platform_org_health` en `supabase/migrations/20260802000010_*.sql`.

### Etapa 3 — React (4–6 semanas)

- Componentes y props (los parámetros que recibe un componente)
- `useState`: cómo un componente recuerda algo (ej. qué escribiste en el buscador)
- `useEffect`: cómo hace algo cuando aparece en pantalla (ej. pedir datos)
- Listas y `key`

> **Ejercicio:** `src/storefront/SearchBox.tsx` es un componente completo y no
> muy largo: tiene estado, efectos, teclado y una lista. Leelo con la guía de
> arriba al lado.

### Etapa 4 — SQL y bases de datos (3–4 semanas)

- `SELECT`, `WHERE`, `ORDER BY`
- `JOIN`: cruzar dos tablas
- `GROUP BY` y funciones de agregación (`SUM`, `COUNT`)
- Índices: por qué una consulta tarda 2 ms o 2 segundos

> **Ejercicio:** leé `supabase/migrations/20260802000010_salud_por_organizacion.sql`.
> Tiene `WITH`, `JOIN`, `GROUP BY`, `CASE` y comentarios que explican **por qué**
> cada decisión. Es un buen SQL real para estudiar.

### Etapa 5 — Lo propio de este proyecto (permanente)

Recién acá conviene leer `CLAUDE.md` de punta a punta. Es el documento donde está
escrito **por qué** las cosas se hacen como se hacen acá, y casi cada regla salió
de algo que se rompió.

---

## Parte 4 — Los conceptos que definen a este proyecto

Si entendés estos cinco, entendés el 80% de las decisiones del código.

### 1. La base es la autoridad de la plata

El navegador **nunca** decide un precio. El checkout manda ids y cantidades; la
base recalcula precio, stock, cupones, envío y comisiones.

Por qué: el navegador lo controla el comprador. Si el precio viniera de ahí,
cualquiera con la consola abierta compraría un perfume a $1.

Lo que el cliente sí hace es **mostrar** el precio, calculándolo con las mismas
reglas. A eso se le llama un **espejo**, y siempre está declarado en un
comentario: si tocás uno, tocás el otro. Si divergen, el comprador ve un precio
y se le cobra otro — el peor bug posible de una tienda.

### 2. Los descuentos no se suman: gana el mejor

Una oferta del 20% y un descuento por transferencia del 20% **no** dan 36%. Se
cobra el mejor de los dos.

Esto no es una regla técnica, es de negocio, y estuvo mal durante meses: se
cobraba 36% de descuento real sin que nadie lo hubiera configurado. Está en
`src/lib/paymentDiscount.ts` y en `20260806000001_descuento_no_acumula.sql`.

### 3. El stock lo mueve la base, y sólo la base

Nadie escribe la columna `products.stock` a mano. Hay un trigger que la mueve
cuando se inserta una venta o una compra.

Por qué: se rompió dos veces por lo mismo. La segunda fue peor — el código
ajustaba el stock **después** de insertar la venta, que ya había disparado el
trigger, así que **vender 3 unidades bajaba 6**. Estuvo así meses.

**La regla:** antes de tocar stock o totales, buscá si ya hay un trigger.

### 4. Una vista nueva convive con la vieja, no la reemplaza

Cuando la tienda necesitó ver productos sin stock, no se cambió
`catalog_products`: se creó `store_catalog_products` al lado.

Por qué: esa vista la usaban el catálogo de WhatsApp y la página pública.
Cambiarle el filtro por abajo las habría roto sin que nadie se entere.

### 5. Verificar contra la base real, no imaginar

No hay entorno de prueba. Lo que se hace: un bloque de SQL que crea datos falsos
con prefijo `ZZ`, ejecuta el camino real, guarda los resultados, y **borra todo
antes de terminar**. La última línea cuenta los restos y tiene que dar `0`.

Así aparecieron bugs que ningún test unitario iba a encontrar. Y dos veces, la
verificación demostró que una afirmación escrita en la documentación era falsa.

---

## Parte 5 — Cómo leer este código sin perderse

### Los archivos que valen la pena leer primero

| Archivo | Por qué |
|---|---|
| `CLAUDE.md` | Las reglas del proyecto y por qué existen |
| `ROADMAP.md` §11 | El historial: qué se hizo en cada sesión y qué se rompió |
| `src/lib/crossSell.ts` | JavaScript puro, bien comentado, corto |
| `src/lib/paymentDiscount.ts` | Las reglas de precios, que son el corazón |
| `src/storefront/StoreLayout.tsx` | Un componente React grande y real |
| `supabase/migrations/` (los últimos) | SQL real con el por qué escrito |

### Cómo se lee un commit

Los mensajes son largos **a propósito**. No dicen qué archivos cambiaron —eso lo
muestra Git solo— sino **por qué se hizo así** y **qué encontró la verificación**.

```bash
git log --oneline -20      # los últimos veinte, en una línea
git show 62ab5ce           # uno entero, con el código
```

Leer diez commits seguidos enseña más del proyecto que leer cien archivos.

### Los comandos del día a día

```bash
npm run dev          # levanta la app en localhost:8080
npm run typecheck    # ¿hay errores de tipos?
npm test             # los 678 tests de cálculos
npm run lint         # estilo del código
npm run build        # ¿compila para producción?
```

Antes de guardar cualquier cambio corren los cuatro. A eso se le dice
**la puerta**: si alguno falla, no pasa.

---

## Parte 6 — Cómo explicárselo a otra persona

Según con quién hables:

**A un comerciante:** "Es un sistema para manejar tu negocio —stock, ventas,
clientes, plata— que además te arma una tienda online que vende de verdad, con
MercadoPago y envíos. Todo con los mismos productos: cargás una vez y está en
los dos lados."

**A un inversor:** "Es un SaaS multi-tenant para comercios argentinos con tienda
online integrada. Monetiza por suscripción y por comisión sobre las ventas
online, que ya está cobrando: el `marketplace_fee` de MercadoPago se deriva
automáticamente a la plataforma."

**A un programador:** "React + TypeScript contra Supabase. Multi-tenant con RLS
por organización. Tres superficies separadas: panel de organización, tienda
pública anónima y panel de plataforma. La lógica de plata vive en funciones de
Postgres, con espejos puros y testeados en el cliente sólo para mostrar."

**A alguien que no sabe nada:** "¿Viste Tiendanube? Esto es eso, más el sistema
que usás adentro del local para vender y controlar el stock, juntos."

---

## Parte 7 — Errores que ya se cometieron acá

Vale más que cualquier tutorial, porque son reales y costaron plata:

1. **El stock se descontaba dos veces.** El código lo ajustaba después de un
   trigger que ya lo había hecho. Vender 3 bajaba 6. Meses.
2. **La firma del webhook de MercadoPago nunca validaba.** Toda compra quedaba
   pagada del lado de MercadoPago e impaga del lado de la tienda, en silencio.
3. **`{(a?.length || b?.length) && …}`** con las dos listas vacías evalúa a `0`,
   y React **imprime el cero**. Había un "0" suelto en casi todas las fichas.
4. **`npx tsc --noEmit` no chequeaba nada** por una configuración del proyecto, y
   daba verde siempre. Llegaron a producción errores que rompían páginas enteras.
5. **Un bloque `DO $$` en Postgres corre como superusuario y saltea la RLS.** Un
   test de permisos escrito ahí da falsos positivos de agujero de seguridad.
6. **Los descuentos se acumulaban.** 20% de oferta + 20% de transferencia daban
   36% real, y el precio tachado no correspondía a ningún porcentaje redondo.

---

## Parte 8 — Un plan realista

| Cuándo | Qué |
|---|---|
| Mes 1 | HTML, CSS, consola, Git. Leer commits sin entenderlos del todo. |
| Mes 2–3 | JavaScript. Leer `crossSell.ts` y `paymentDiscount.ts` hasta entenderlos. |
| Mes 4 | TypeScript + React básico. Cambiar un texto de la tienda y verlo. |
| Mes 5–6 | SQL. Leer migraciones. Escribir un `SELECT` contra la base real. |
| Mes 7+ | Hacer un cambio chico de punta a punta: migración, UI, test, commit. |

**El objetivo del mes 7 no es escribir mucho código.** Es hacer un cambio
completo y verificarlo, que es lo que este proyecto entiende por "hecho".

---

## Recursos

- **JavaScript y web en general:** MDN Web Docs (en español) — es la referencia,
  no un tutorial.
- **React:** la documentación oficial nueva (react.dev) tiene un tutorial
  interactivo.
- **SQL:** cualquier curso de SQL básico sirve; lo específico de Postgres se
  aprende leyendo las migraciones de acá.
- **Git:** con `add`, `commit`, `push`, `pull` y `log` alcanza para meses.

Y lo más útil de todo: **este repositorio**. Tiene años de decisiones explicadas
en los comentarios y en los mensajes de commit. Muy pocos proyectos reales
documentan el *por qué*; éste sí.