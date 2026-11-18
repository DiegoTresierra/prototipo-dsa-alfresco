# Auditoría y corrección de Emitidos / enviados DTI–DSA

## Causa confirmada

`DirectorWorkspacePage` alimentaba la pantalla `documentos-enviados` con `ownSentDocuments(alfrescoDocuments, office.userId)`. `alfrescoDocuments` se inicializa en `App.jsx`, `getInitialAlfrescoDocuments`, desde las confirmaciones de `localStorage`; no es un inventario de Alfresco. Una caché vacía producía cero filas aunque hubiera PDFs institucionales. Otro navegador/equipo u otro creador también quedaban fuera.

La página además construía un inbox ficticio con loading false, error vacío y sin refresh. El hook institucional consultaba solamente Por atender/Por conocimiento; `/api/directory/office-inboxes` no suministraba Emitidos y no había un endpoint conectado para su listado. No era un filtro nuevo de numeración: la pantalla ni siquiera leía Emitidos. `ownSentDocuments` filtraba por creator/senderUserId, no por origen institucional.

La corrección mantiene `Mis documentos` como subconjunto creado por el usuario, pero la opción institucional ahora se identifica como **Emitidos**, sin filtrar por creador ni depender de la caché. No significa «todas las acciones salientes».

## Flujo corregido y lugares exactos

1. `backend/src/index.js`, ruta **GET `/api/documents/emitted`**, protegida por `requireSession`. No acepta parámetros de dependencia, carpeta, rol o autor: los rechaza con 400.
2. `backend/src/emittedDocuments.js`, `listInstitutionalEmitted`: exige Dirección activa y documents:read; obtiene la carpeta de la dependencia de sesión. Todos los GET usan `session.authorization`, sin cuenta técnica ni fallback. Lee la carpeta, enumera todos los children cm:contains paginados y consulta cada UUID con propiedades. Los fallos de ACL de carpeta son errores; los nodos inaccesibles/conflictivos se omiten con `documentErrors` visibles, no como un éxito vacío.
3. `emittedOrigin`: comprueba el origen declarado `gd:dependenciaOrigen`, o la afiliación institucional del código completo `gd:codigoDocumental`. La pertenencia cm:contains a Emitidos se verifica en el servidor. Si faltan ambos datos, se utiliza únicamente el padre primario institucional como evidencia histórica. Una asociación secundaria sin origen declarado no basta para convertir un recibido en original propio. Un origen declarado propio puede conservarse aunque el padre primario difiera, si la asociación con Emitidos y la lectura están verificadas. Conflictos de metadata no se reescriben: generan advertencia.
4. `frontend/src/api/alfresco.js`, `getEmittedDocuments` transforma la respuesta mediante `nodeToDocument`, conservando creador, identidad/origen, destinatario formal, fecha documental y estado persistidos. No valida correlativos para decidir visibilidad. No añade documentos desde caché.
5. `frontend/src/hooks/useEmittedInbox.js` reutiliza el ciclo de refresco/error de `useAssignmentInbox` con un loader independiente. Consulta al abrir/cambiar panel, actualizar manualmente, volver al foco, cada minuto y después de una operación confirmada. Cambiar usuario/dependencia reinicia el estado visible.
6. `App.jsx` entrega ese inbox a `DirectorWorkspacePage`. `documentos-enviados` muestra originales institucionales, `mis-documentos` filtra únicamente este inventario autorizado por creador y `inicio` usa su conteo. `DirectorPage`, modo sent, muestra errores, advertencias parciales y actualización real.

No se utiliza `alfrescoNumbering.js`, el manifiesto de pruebas, gd:identidadEmision, asignaciones ni estado de atención para excluir históricos del listado. Los registros PDF con cero bytes siguen visibles, con advertencia de contenido vacío.

## Identidad y trazabilidad: datos persistidos frente a inferencias

| Concepto | Fuente y tratamiento |
|---|---|
| Creador del nodo | `createdByUser`, reflejado como «Creado por». No se sustituye por el distribuidor. |
| Autor/firmante del contenido | No está probado por el creador, `gd:remitente` o `cm:author`. No se inventa. `cm:author` contiene valores libres, incluido Home. |
| Remitente formal | `gd:remitente`, si existe. Es distinto del creador y del ejecutor de distribución. |
| Origen institucional original | `gd:dependenciaOrigen`, o namespace institucional del código completo. Sin esos datos: evidencia explícita de carpeta primaria, sin estampar ni fingir una propiedad persistida. |
| Usuario/dependencia de derivación interna | `gd:asignaciones`, dispatch.senderUserId/senderDependency. Conservan su significado y no se copian a autoría/origen. |
| Destinatario formal | `gd:destinatario`, `gd:dependenciaDestino`, si están registrados; si no, «No registrado». |
| Recepción distribuida actual | Asociación secundaria cm:contains al UUID original. No identifica por sí sola fecha ni actor de la operación. |
| Fecha documental | `gd:fechaDocumento`, texto existente, cuando se declara. No se rellena desde un despacho. |
| Registro en Alfresco | `createdAt`, ahora rotulado expresamente así. No se etiqueta como fecha de envío/distribución. |
| Fecha/actor de distribución entre Direcciones | No hay evento de negocio persistido y verificable en los nodos históricos revisados. No se deduce de modifiedAt, createdAt ni de eventos de derivación a jefaturas. |

`documentIdentity.js` backend/frontend también reconoce el namespace institucional del código completo desplegado, como DSA o DTI-UPSI. No deduce roles, unidades o autoría desde nombres de usuario. No promueve una carpeta histórica a propiedad gd:dependenciaOrigen: muestra la evidencia separada.

## Evidencia real GET en DEV

Cuenta de inventario utilizada: `gd_distribucion`, confirmada por `/people/-me-`. No se utilizaron sesiones simuladas como si fueran cuentas reales de Dirección. No se realizaron POST, PUT, PATCH o DELETE en DEV.

| Comparación | DTI | DSA |
|---|---|---|
| Emitidos configurado | `69e39272-905e-426c-a392-72905ef26ca6` | `0bbf2022-7bbb-40a9-bf20-227bbb00a929` |
| Nodos encontrados por GET | 12 | 0 |
| Clasificación pura del lote real con lógica nueva | 12 originales DTI, sin escrituras | 0 originales DSA |
| Ruta anterior que consultase Emitidos | No existía para esa pantalla | No existía para esa pantalla |
| Pantalla anterior con caché vacía | 0, reproducible por código | 0; coincide por casualidad con inventario vacío |
| Nuevo endpoint con sesión real Dirección | PENDIENTE sesión accesible | PENDIENTE sesión accesible |
| Nueva pantalla con API simulada y caché vacía | Muestra el original devuelto; comprobado en Edge y SSR | No incorpora recibidos DTI como originales; comprobado en Edge y SSR |

Los 12 UUID reales siguen siendo los del candidato de conciliación. Diez se crearon con DTI_T, uno con admin y otro con gd_distribucion. La pantalla institucional debe incluirlos sin usar al creador como criterio de oficina.

Dos documentos declaran origen DTI, remitente DTI, destino/destinatario DSA y fecha documental 2026-11-13: `ae23bcf0-ef2a-48c7-a3bc-f0ef2a98c7b1` y `dd778efd-6acd-48f1-b78e-fd6acd08f1e1`. Son los dos registros con números TEST y contenido vacío; siguen visibles con advertencia. Los otros diez no declaran esos metadatos ni numeración oficial y se clasifican por la ubicación primaria verificada. Ninguno tiene los tres campos nuevos de numeración poblados.

GET `/parents` confirmó diez asociaciones secundarias hacia DSA Por atender `701049e5-a6a9-48c0-9049-e5a6a998c02b`, manteniendo Emitidos DTI como padre primario y el mismo UUID. No hay originales DSA que permitan una reproducción real inversa hoy; se cubre con fixtures sin crear PDFs en DEV.

Ejemplo concreto: `18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097`, creado por DTI_T el 16/11/2026, conserva padre DTI y asociación receptora DSA. Su derivación interna registra DSA_T/dsa el 17/11/2026. Es un original DTI recibido/derivado en DSA, no un original emitido por DSA. También hay derivaciones internas DSA en `9d86827f-105b-4eab-8682-7f105baeab90` y `fb0d45e5-4d7e-418a-8d45-e54d7eb18a07`.

## Reproducción desde sesiones reales sin exponer credenciales

El backend local respondió 401 a `/api/auth/me` sin cookies y 404 a la ruta nueva `/api/documents/emitted`: el proceso en ejecución todavía no incorpora este endpoint. Es necesario cargar/reiniciar el backend actualizado y usar el frontend compilado antes de la prueba autenticada. No se reinició un proceso que puede contener sesiones de usuario en memoria; no hay una sesión de Dirección accesible al agente. No se capturan cookies del navegador ni se crean tickets. Mantener la emisión oficial deshabilitada.

Con cada sesión ya iniciada en la aplicación, abrir **Emitidos** y ejecutar en DevTools Console:

```javascript
await (async () => {
  const options = { method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store' };
  const meResponse = await fetch('/api/auth/me', options);
  if (meResponse.status !== 200) throw new Error('Sesión pendiente: no sustituir por cuenta técnica');
  const me = await meResponse.json();
  const response = await fetch('/api/documents/emitted', options);
  const body = await response.json();
  console.log({ userId: me.alfresco?.id, dependency: me.dependency, role: me.functionalRole,
    http: response.status, source: body.source, folderId: body.folderId,
    returned: body.documents?.length, warnings: body.documentErrors?.length });
  console.table((body.documents || []).map(node => ({ UUID: node.id,
    creator: node.createdByUser?.id, origin: node.emittedOrigin?.dependency,
    evidence: node.emittedOrigin?.evidence, registeredAt: node.createdAt,
    formalDate: node.properties?.['gd:fechaDocumento'] || 'No registrada' })));
  console.log({ displayed: document.querySelectorAll('.received-inbox__table tbody .received-inbox__subject').length });
})();
```

Compartir solo ese resumen/tabla, nunca la respuesta completa de auth/me, cabeceras ni cookies. Esperado sujeto a ACL reales: DTI_T, 12 retornados/12 visibles; DSA_T, 0/0. Si hay búsqueda o filtro de prioridad activo, limpiarlo antes de comparar. Actualizar la bandeja debe producir otra petición GET emitted. Un error de autorización debe aparecer como error, no como inventario vacío verificado.

Para PDF y controles positivos/negativos de lectura utilizar `READ_ACCESS_CHECKS.md`. No crear un documento DSA para llenar la lista como parte de esta auditoría.

## Pruebas y correcciones verificadas

145 pruebas aprobadas, cero fallos u omitidas. Nuevas pruebas: originales DTI→DSA y DSA→DTI, recibido con derivación interna que no cambia origen, UUID/metadata inmutables durante lectura, creadores diferentes, legacy sin numeración y vacío, todas las páginas, origen conflictivo, ACL por carpeta/nodo, rechazo de parámetros de ámbito, UI real sin caché, Mis documentos personal, errores visibles y refresco. También se comprueba un original declarado con asociación válida a Emitidos aunque su padre primario difiera.

Lint y build correctos. Edge headless con bundle real y API LOCAL simulada: DTI muestra su original tras vaciar caché, el botón actualiza el repositorio y DSA no toma ese recibido DTI como propio. No son capturas o peticiones autenticadas de usuarios reales DEV. El resto de regresiones de distribución y despacho sigue pasando.

## Decisiones funcionales pendientes

- Definir si se desea una vista adicional de **Derivaciones realizadas** para Dirección. Hay datos en `GET /api/documents/dispatches`, campo sentDispatches, con usuario, dependencia, fecha y encargos individuales. Es otro concepto; no se incorpora a Emitidos ni requiere duplicar el PDF.
- Definir si se necesita historial de **distribuciones entre Direcciones**, incluyendo actor y fecha. Las asociaciones actuales prueban destino/presencia, no quién/cuándo. Antes de implementar, acordar evento/semántica y evaluar persistencia versionada con mecanismos existentes, sin añadir propiedades o base por defecto. No se falsea historia a partir de creador o fecha de modificación.
- Resolver manualmente orígenes declarados contradictorios si aparecen; no se corrigen automáticamente. Los doce actuales no presentan conflicto con su carpeta original.
- Completar la comprobación autenticada en ambos perfiles. Con las sesiones accesibles hoy no es posible certificar conteos HTTP reales de Dirección; quedan instrucciones concretas y evidencia separada del inventario técnico.

Sin modificaciones a documentos, autoría, creador, origen, modelos, ACL o `.env.local`; sin nueva infraestructura, habilitación de emisión, commit, push, merge o rebase. Se conservan rama y cambios locales.
