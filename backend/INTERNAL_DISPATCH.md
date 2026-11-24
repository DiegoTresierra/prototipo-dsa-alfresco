# Contrato de despacho interno

## Jerarquía

| Emisor | Destinatarios de la misma dependencia |
| --- | --- |
| Dirección | Jefatura o Especialista |
| Jefatura | Especialista con supervisión institucional comprobada |
| Especialista | Ninguno |

La derivación Jefatura a Especialista permanece bloqueada si falta el proveedor real de supervisión. La distribución entre Direcciones es otro flujo. Un despacho no crea carpetas personales ni duplica el PDF.

## Directorio y validaciones

GET /api/directory/dispatch-recipients devuelve recipients y allowedRecipientRoles. El adaptador clásico consulta exclusivamente grupos configurados, pagina y normaliza autoridades USER; mantiene intacto el cliente público v1 de otros consumidores. Se intersecta dependencia con función, comprobando personas habilitadas.

No se infieren unidades o roles desde nombres. unit puede ser null y no oculta destinatarios válidos. ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON es un enriquecimiento opcional, no una lista de autoridad. Los errores de directorio no se convierten en listas vacías.

POST /api/documents/dispatch requiere sesión, CSRF, identidad institucional vigente y autoridad documental. Acepta documentId, recipientUserIds, instruction, priority, requestKey y originAssignmentId cuando corresponde. El servidor valida nuevamente roles, dependencia, destinatarios y encargo de origen.

Dirección no necesita una asignación previa para despachar un PDF institucional autorizado. Jefatura necesita encargo propio vigente y supervisión verificable. La existencia de lectura Por conocimiento no concede derivación.

La pertenencia se verifica por Alfresco, incluyendo cm:contains secundarias. Si /parents devuelve 403, se puede comprobar positivamente la asociación desde las bandejas configuradas; no se permite acceso global ni se utiliza únicamente parentId.

## Persistencia y responsabilidades

El modo institucional usa gd:asignaciones en el original, con schemaVersion, revision, documentId, dispatches e history, además de colecciones compatibles de respuestas y revisión. El JSON local no es un fallback silencioso.

Todos los destinatarios son responsables equivalentes y conservan estado individual. Los registros apuntan al mismo UUID. Las proyecciones gd:responsablesActuales y gd:dependenciasResponsablesActuales son multivalor, sin responsable principal ni relación posicional entre arrays.

No se escribe una selección arbitraria en las propiedades singulares antiguas. Para mí representa una asignación propia, no un permiso adicional.

GET /api/documents/dispatches devuelve asignaciones; include=documents incorpora metadatos autorizados. Cada actualización de bandeja vuelve a consultar documentos y asignaciones. Un fallo visible no se presenta como bandeja vacía.

La cola por UUID cubre lectura, validación, PUT y GET de verificación. Se detectan cambios externos comprobables, sin prometer CAS o exclusión distribuida. Se conserva idempotencia por actor/clave/payload.

El límite aplicativo del sobre completo es 256 KiB en UTF-8; el exceso se rechaza sin truncar. No se atienden obligaciones ni se sincroniza gd:estado al despachar.

Véanse [operación controlada](ALFRESCO_DISPATCH_PILOT.md), [atención](ATTENTION_FLOW.md) y [seguridad](ARCHITECTURE_AND_SECURITY.md).

## Integración de jerarquía institucional

El adaptador `institutionalHierarchyProvider.js` resuelve especialistas y revisores
desde las unidades y asignaciones activas `gdo:*` de Alfresco. Contrasta personas
habilitadas y grupos institucionales exactos mediante el mismo contrato clásico
paginado del directorio. El cliente público v1 se conserva para diagnóstico y
otros consumidores; su listado de miembros no sustituye esta comprobación.
Los subgrupos no acreditados, errores o páginas incompletas bloquean la resolución.

`HIERARCHY_READ_STORAGE=alfresco` es el valor predeterminado. Requiere configurar
la cuenta lectora y los contenedores existentes mediante las variables
`ALFRESCO_HIERARCHY_SERVICE_USERNAME`, `ALFRESCO_HIERARCHY_SERVICE_PASSWORD`,
`ALFRESCO_HIERARCHY_STORAGE`, `ALFRESCO_HIERARCHY_CONTAINER_NODE_ID` y
`ALFRESCO_HIERARCHY_AUDIT_CONTAINER_NODE_ID`. La cuenta debe ser no administrativa
y disponer de lectura efectiva. Esta integración no crea contenedores ni despliega
el modelo organizativo. JSON, si se selecciona expresamente, solo muestra el
organigrama provisional y nunca resuelve autoridad.

La Jefatura solo obtiene especialistas de su unidad activa y única; necesita además
su propio encargo vigente y ACL documental para despachar. Un especialista se
presenta a su Jefatura real. La revisión por Dirección exige una Dirección vigente
inequívoca en su dependencia; no se selecciona arbitrariamente entre varias.
Se comparan revisiones institucionales antes y después de resolver y se bloquean
operaciones administrativas pendientes de conciliación. Las decisiones de revisión
y emisión mantienen sus bloqueos de escritura y autoaprobación anteriores.

Las rutas administrativas y de auditoría revalidan la identidad institucional.
Las capacidades mutables del backend permanecen bloqueadas aun si se cambian sus
flags: no existe todavía garantía suficiente de exclusión, cobertura y recuperación.
Los servicios simulados de cambio de Jefatura y reasignación de especialista
comparten una cola local por dependencia y exigen `NO_PENDING` antes de registrar
la intención y otra vez antes de desactivar la relación anterior. `HAS_PENDING`,
`INDETERMINATE` y la ausencia de lector bloquean el cambio. El adaptador de Jefatura
reutiliza `hasPendingResponsibilities`; no atribuye obligaciones de especialistas
a su superior. Ninguna responsabilidad se transfiere automáticamente.

Está pendiente acreditar un lector con cobertura documental e institucional
completa para ambas operaciones. Un resultado vacío de búsqueda o una relación
visible no lo sustituyen. La cola no protege contra otros procesos ni contra una
nueva asignación concurrente por otro escritor. Las comprobaciones GET tampoco
son una transacción ni una precondición de escritura del repositorio. Estas
limitaciones impiden habilitar cambios administrativos reales en esta entrega.
