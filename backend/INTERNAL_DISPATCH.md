# Despacho interno jerárquico DTI / DSA

La distribución entre Direcciones sigue siendo un flujo separado. Esta implementación
conserva la persistencia JSON y las consultas de lectura de la entrega anterior.
No modifica el PDF, sus propiedades gd, las ACL ni el modelo de Alfresco.

## Matriz de derivación

| Emisor | Roles destinatarios dentro de su misma dependencia |
| --- | --- |
| Dirección | Jefatura de Unidad y Especialista |
| Jefatura de Unidad | Especialista |
| Especialista | Ninguno |

El backend calcula `dispatchRecipientRoles` en la sesión pública. La interfaz usa
esa respuesta y el directorio autorizado, no una lista manual de usuarios. El POST
revalida la matriz y los destinatarios con el directorio actualizado.

## Directorio automático

`dispatchDirectory.js` usa exclusivamente los grupos institucionales configurados:

- Dependencias: `GROUP_GD_DTI`, `GROUP_GD_DSA`.
- Funciones: `GROUP_GD_DIRECCION`, `GROUP_GD_JEFE_UNIDAD`, `GROUP_GD_ESPECIALISTA`.

Consulta por GET `/people/-me-`, la API clásica
`/alfresco/service/api/groups/{shortName}/children` y las personas candidatas.
Se mantiene intacto el cliente público v1 para los otros consumidores.
La cuenta de distribución ya configurada no necesita administración.

La pertenencia debe identificar una sola dependencia y una sola función. Usuarios
inhabilitados o ambiguos quedan excluidos. Se normaliza `authorityType=USER` y
`shortName` como `id`; `fullName` no se trata como identificador. Todas las páginas
se recorren y el adaptador se detiene en `paging.totalItems`, sin consultar más allá.
Errores, páginas inconsistentes o subgrupos sin una política de herencia aprobada
producen un error explícito, nunca un directorio vacío aparentemente válido.

La API `/api/directory/dispatch-recipients` filtra por la dependencia del emisor y
la matriz. El alias anterior `/api/directory/unit-heads` conserva solo jefaturas
entre los destinatarios permitidos, para compatibilidad. El frontend usa la API nueva.
El directorio se actualiza al entrar, al recuperar foco y cada 60 segundos visibles.

## Configuración

No se requiere agregar usuarios manualmente. Incorporar un usuario habilitado a
los grupos correspondientes basta para que pueda aparecer automáticamente.

`ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON` es opcional para el despacho. Una entrada
válida puede enriquecer la visualización con `{code, name, dependency}`. Una entrada
incompleta o incoherente se ignora como metadato; no oculta ni bloquea al destinatario.
No se infieren códigos, unidades o funciones desde nombres de usuario. La numeración
institucional de documentos nuevos es otro procedimiento y conserva sus reglas.

Se reutilizan `ALFRESCO_GROUP_MAPPINGS_JSON`, las carpetas institucionales configuradas
y el par existente `ALFRESCO_DISTRIBUTION_SERVICE_USERNAME` /
`ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD` (o su alternativa ya soportada).
No agregar secretos a archivos versionados ni variables VITE. No se modifica `.env.local`.
Reiniciar el backend y volver a iniciar sesión para recibir la nueva matriz pública.

## Autorización de derivación

Dirección necesita una sesión institucional activa, capacidad de lectura y escritura,
un PDF legible con su identidad y pertenencia a sus carpetas institucionales,
considerando también asociaciones secundarias.

Jefatura debe indicar una `originAssignmentId` que corresponda a una asignación de
atención vigente (`ASIGNADO` o `DESPACHADO`), de ese mismo documento, usuario, rol y
dependencia. Después se verifica que Alfresco permita leer el PDF con su sesión.
Un ID de otra jefatura, otro documento o una asignación no vigente no autoriza derivar.
La validación también se realiza en reintentos antes de responder éxito.

### Enumeración de padres denegada a Dirección

Se confirmó con la sesión DSA_T un PDF legible (GET del nodo: 200), con ubicación
primaria en Emitidos DTI y recepción secundaria en Por atender DSA, para el que
GET `/parents` devuelve 403. Denegar enumerar padres no demuestra que el documento
sea ajeno a DSA. Antes se devolvía el mismo rechazo genérico para ambos casos.

Solo ante ese 403, `verifyConfiguredFolderMembership` verifica desde el otro
extremo: pagina los hijos de las carpetas institucionales configuradas para la
dependencia de la sesión y exige el mismo UUID con asociación `cm:contains`.
Usa la autorización del usuario, no la cuenta de servicio; no confía en carpetas
enviadas por el frontend. Un 403 del nodo se rechaza antes de intentar esta vía.
Si la pertenencia no puede verificarse, el despacho continúa denegado. Esto no
cambia las reglas de Jefatura, la distribución entre Direcciones ni las ACL.

Con `ALFRESCO_DIAGNOSTICS=true`, el rechazo incluye un diagnóstico acotado de
usuario/rol/dependencia, UUID, carpetas configuradas, estados HTTP y condición
fallida. No incluye cookies, cabeceras Authorization, tickets o contraseñas.

Leer Por conocimiento no concede autorización para derivar. Un documento creado
por Jefatura sin una asignación formal tampoco basta: falta una regla institucional
aprobada para demostrar responsabilidad documental propia. Este caso permanece
restringido. No se usa `cm:owner` como autorización.

## Asignaciones y trazabilidad

Cada despacho conserva `documentId`, emisor, rol/dependencia del emisor, instrucción,
prioridad, fecha, clave idempotente y, si corresponde, `originAssignmentId`.
Cada destinatario tiene un ID de asignación propio, el mismo UUID documental,
usuario, rol/dependencia, estado individual, emisor, fecha e instrucción. La unidad
es un metadato opcional.

Una derivación de Jefatura crea un despacho hijo relacionado con su asignación,
sin modificar su obligación ni las de otras jefaturas. No se crean copias, carpetas
personales o asociaciones de despacho. Especialista puede recibir encargos directos
y derivados sobre el mismo UUID, con IDs de asignación distintos.

Los reintentos conservan la clave del formulario y no duplican el despacho. Cambiar
el documento, destinatarios/roles, origen, instrucción o prioridad con esa clave
produce conflicto. La confirmación deshabilita el formulario ya registrado.

Los registros de la entrega anterior solo admitían Dirección -> Jefatura. Al leerlos
se exponen roles compatibles e IDs de asignación legacy deterministas, sin reescribir
el archivo por una consulta GET. No se elimina ningún campo histórico. Un cambio
posterior puede persistir ese enriquecimiento junto con los nuevos registros.
`assignmentCompletedAt` indica registro de asignaciones, no cierre de atención.
No se implementa cierre global ni sincronización de `gd:estado`.

## Lectura y bandejas

El proxy verifica metadatos, PDF, listados y búsqueda con la identidad del usuario:

- Jefatura: documentos propios, asignados o vinculados a Por conocimiento de su
  dependencia por padre primario o asociación secundaria.
- Especialista: documentos propios o asignados a su usuario, rol y dependencia.
  Una ACL legible sobre un UUID ajeno no sustituye la asignación de aplicación.
- Una denegación de Alfresco nunca se supera mediante asignaciones o credenciales
  de servicio. Los demás roles conservan su política institucional existente de ACL.

`GET /api/documents/dispatches?include=documents` devuelve las asignaciones recibidas,
las derivaciones enviadas y metadatos autorizados de los UUID originales, sin depender
de ninguna carpeta personal. Los documentos se deduplican por UUID; las asignaciones
se mantienen separadas. Un PDF denegado conserva su encargo con un error por documento,
sin exponer sus metadatos ni habilitar su apertura.

Jefatura tiene vistas de recibidos y derivaciones realizadas. Especialista tiene
consulta funcional en Recibidos y Mis asignaciones, sin acciones de derivación.
El refresco manual, el foco, el evento de despacho y el intervalo de 60 segundos
vuelven a consultar asignaciones y metadatos conjuntamente. Un error conserva la
última información con una alerta; no se presenta como una bandeja vacía válida.
Las colecciones del proxy se filtran y repaginan sin totales o facetas ajenos.

## Validación local

Desde la raíz:

```powershell
node --test backend/src/*.test.js frontend/src/utils/*.test.js
npm --prefix frontend run lint
npm --prefix frontend run build
```

Las pruebas HTTP sustituyen todas las solicitudes a Alfresco por mocks y guardan
el JSON en un directorio temporal aislado. Cubren ambos departamentos, toda la matriz,
usuarios sin unidad, inactivos/ambiguos, origen ajeno, solo conocimiento, UUID único,
obligaciones originales intactas, reintentos, bandejas y protección de PDF/metadatos.
La suite de distribución DTI–DSA conserva ambos sentidos, categorías y fallos parciales.

## Prueba real de extremo a extremo pendiente

No se ha realizado una derivación real en DEV. Los siguientes pasos requieren
una autorización posterior explícita para escribir asignaciones de prueba en el
backend y usar usuarios/documentos de prueba aprobados; no implican cambiar ACL.

1. Reiniciar backend/frontend e iniciar una nueva sesión de Dirección DSA o DTI.
2. Abrir un PDF de su ámbito en Recibidos. Verificar jefaturas y especialistas
   activos de esa dependencia, incluso sin mapeo de unidad.
3. Derivar a dos destinatarios. Anotar el UUID y los IDs de asignación desde la
   respuesta de red. Verificar un encargo individual por destinatario y un solo PDF.
4. Iniciar sesión como la jefatura asignada. Actualizar Recibidos y abrir el PDF.
   Derivar a un especialista desde esa asignación. Verificar Derivaciones realizadas.
5. Confirmar que la obligación inicial y la de la otra jefatura siguen asignadas.
6. Como especialista, actualizar Mis asignaciones, comprobar emisor/instrucción/estado
   y abrir el PDF con el mismo UUID. Verificar ausencia de acciones de derivación.
7. Comprobar con usuarios aprobados las denegaciones: origen de otra jefatura,
   documento de conocimiento sin atención, destinatario de otra dependencia y POST
   manual de especialista. No cambiar grupos o permisos para forzar los escenarios.
8. Repetir en la otra dependencia. La prueba de distribución DTI–DSA es separada.

## Límites pendientes

Persistencia local JSON sin coordinación entre procesos, sin base de datos ni cierre
global de atención. Límite de 10 000 entradas y timeout por consulta; se debe evaluar
el coste con volúmenes reales. Subgrupos requieren definir la política de herencia.
La responsabilidad institucional de documentos propios de Jefatura sin asignación
sigue sin una regla autorizada. No se implementan comentarios, hilos, apoyo ni
compartición, ni se escriben `gd:responsableActual` o `gd:dependenciaResponsableActual`.

## Archivos de esta implementación

Archivos existentes adaptados, incluidos los cambios locales de la entrega anterior:

```text
backend/INTERNAL_DISPATCH.md
backend/src/index.js
backend/src/dispatchPolicy.js
backend/src/dispatchPolicy.test.js
backend/src/dispatchStore.js
backend/src/dispatchStore.test.js
backend/src/dispatchDirectory.js
backend/src/dispatchDirectory.test.js
backend/src/documentReadPolicy.js
backend/src/documentReadPolicy.test.js
backend/src/dispatch.integration.test.js
frontend/src/App.jsx
frontend/src/api/alfresco.js
frontend/src/config/roles.js
frontend/src/pages/DirectorPage.jsx
frontend/src/pages/JefeUnidadPage.jsx
frontend/src/pages/EspecialistaPage.jsx
```

Archivos creados para la jerarquía:

```text
frontend/src/components/DispatchPanel.jsx
frontend/src/hooks/useAssignmentInbox.js
frontend/src/pages/AssignmentsPage.jsx
frontend/src/utils/assignmentInbox.js
frontend/src/utils/assignmentViews.js
frontend/src/utils/assignmentViews.test.js
```

También se conservan los archivos de la entrega anterior
`frontend/src/hooks/useAlfrescoInbox.js`, `frontend/src/utils/inboxPages.js`,
`frontend/src/utils/refreshInbox.js` y `frontend/src/utils/refreshInbox.test.js`.
