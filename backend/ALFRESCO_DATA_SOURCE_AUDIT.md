# Auditoría de fuentes de datos y dependencia de Alfresco

Fecha: 19/11/2026, America/Lima. Rama: `feature/jerarquia-despacho-interno`.
Base inspeccionada: `7e19ef66b2b01bbe3720e66a092f48d39fce9113`.

## 1. Resumen ejecutivo y alcance

Alfresco es la fuente operativa actual del PDF, UUID, asociaciones, metadatos, asignaciones individuales y sus eventos. No lo es todavía de toda la organización ni de todos los datos que muestra la interfaz. El código contiene un catálogo de personas y puestos, unidades por usuario desde configuración, un organigrama JSON independiente y una caché de confirmaciones que todavía aporta prioridades a documentos consultados correctamente en Alfresco.

La integración de jerarquía NO reemplazó `resolveManagedRecipients`: Jefatura → Especialista permanece bloqueado sin proveedor institucional. El JSON sirve para dibujar el organigrama, no para acreditar subordinación. Dirección mantiene su ámbito institucional. Emitidos continúa consultándose desde Alfresco, no desde la caché ni por creador; Mis documentos sí aplica un filtro personal intencionado.

Antes de habilitar revisión, aprobación o cierre deben resolverse cuatro riesgos P0: vigencia de roles del actor, comparación exacta de autoridades, diferencias de política entre distribución heredada y emisión oficial, y superficie multipart que admite metadatos no construidos por el servidor. Son hallazgos del código; no se realizó una explotación ni se afirma que hayan ocurrido accesos indebidos en DEV.

Se hicieron lecturas de backend/frontend, configuraciones, módulos integrados, adaptadores, hooks, páginas, pruebas y scripts de arranque. Se contrastaron mediante GET la identidad técnica, definiciones de tres aspectos y las seis bandejas institucionales. Solo se crea este informe, por solicitud expresa; no se cambia código, configuración, modelo, ACL o documentos. No se ejecutaron tests/build en esta auditoría, para no generar archivos ni confundir validación funcional con evidencia de fuentes. Los resultados de pruebas de entregas anteriores no se presentan como pruebas nuevas.

## 2. Evidencia GET actual y límites

Todas las consultas reales fueron GET, con la cuenta técnica ya configurada. `/people/-me-` devolvió 200, identidad coincidente, habilitada y `isAdmin:false`. No se solicitaron tickets ni sesiones nuevas. No se muestran identificadores documentales, personas, credenciales ni destino concreto.

| Dependencia / bandeja | Entradas directas | Nodos con `gd:asignaciones` | Con identidad oficial de emisión | Con origen declarado |
|---|---:|---:|---:|---:|
| DTI / Emitidos | 12 | 3 | 0 | 2 |
| DTI / Por atender | 0 | 0 | 0 | 0 |
| DTI / Por conocimiento | 0 | 0 | 0 | 0 |
| DSA / Emitidos | 0 | 0 | 0 | 0 |
| DSA / Por atender | 10 | 3 | 0 | 2 |
| DSA / Por conocimiento | 0 | 0 | 0 | 0 |

Son conteos de hijos, no conteos de emisiones oficiales ni suma de UUID únicos entre carpetas. Un UUID puede figurar en más de una mediante asociaciones. En esta auditoría no se descargaron PDFs, no se recorrieron ACL de todos los documentos ni se reprodujeron sesiones reales DTI/DSA. Por tanto, estos números no certifican lo que verá cada usuario con sus permisos, ni prueban la consistencia tras un reinicio real.

Configuración efectiva inspeccionada sin mostrar valores sensibles: `dispatchPersistence=alfresco`, escrituras de despacho habilitadas, emisión oficial deshabilitada, cero mapeos usuario–unidad y cero bandejas personales, proveedor de jerarquía ausente. No se alteraron esos valores. Configuración habilitada no demuestra exclusividad de procesos o ausencia de escritores externos.

El adaptador real `loadDispatchDirectory` también se ejecutó exclusivamente con GET: devolvió 1 especialista DTI, 2 especialistas DSA y 3 jefaturas DSA; los seis candidatos tienen `unit:null`, sin error de configuración del adaptador. Son conteos actuales, no la lista histórica de tres destinatarios de pruebas anteriores. La ausencia de unidad no los oculta, pero estos datos no prueban relación de supervisión entre ellos ni autorizan a Jefatura para derivar. No se imprimieron nombres ni IDs personales.

Definiciones reales (`/alfresco/service/api/classes/{clase}`), todas HTTP 200:

| Aspecto | Propiedades relevantes verificadas |
|---|---|
| `gd:identificacion` | `gd:numero`: `d:text`, singular, indexada. `gd:codigoDocumental`: `d:text`, singular, no indexada. `gd:cicloDocumental`: `d:int`, singular, no indexada. `gd:identidadEmision`: `d:text`, singular, no indexada. También existen `gd:dependenciaOrigen`, `gd:dependenciaDestino`, `gd:remitente`, `gd:destinatario`, `gd:fechaDocumento`, todas `d:text` singulares. |
| `gd:tramite` | `gd:asignaciones`: `d:text`, singular, no indexada. `gd:responsablesActuales` y `gd:dependenciasResponsablesActuales`: `d:text` multivalor. `gd:estado`, `gd:responsableActual` y `gd:dependenciaResponsableActual`: `d:text` singular. |
| `gd:clasificacion` | `gd:tipoDocumental`: `d:text`, singular, indexada. |

No se deduce una propiedad de prioridad, período, revisión o cierre. El hecho de que exista `gd:estado` no significa que la atención lo sincronice. Los comentarios de `officialEmissionContract.js` que aún hablan de propiedades pendientes no describen el despliegue real; su validación ejecutable sí consulta el contrato.

## 3. Arquitectura y recorridos efectivos

### Identidad, grupos y autorización

Login básico → ticket Alfresco → GET `/people/-me-` y `/people/{id}/groups` → `resolveRole` → sesión Express en memoria → `/api/auth/me` → menú React. SSO usa Keycloak para autenticar y obtiene identidad/grupos en Alfresco. Las capacidades `documents:read/write` son reglas del backend asignadas a un rol reconocido, NO permisos efectivos del nodo. Los GET/PUT posteriores siguen sujetos a ACL, con excepciones de escritura técnica que necesitan autorización de negocio vigente.

Despacho: React → GET `/api/directory/dispatch-recipients` → API clásica `/service/api/groups/{shortId}/children`, paginada, usando los grupos configurados → intersección dependencia/función → GET `/people/{id}` para existencia/habilitación → `resolveManagedRecipients` → opciones del selector. POST `/api/documents/dispatch` repite directorio y resolución, valida solicitud, ámbito documental y ACL antes de escribir con la cuenta técnica. El usuario emisor no tiene su rol reconsultado allí: se usa la sesión.

Organigrama: Ajustes → GET/PUT `/api/hierarchy` → candidatos del mismo directorio real + `organizationStore.js` → `organization.json`. Sus `unitHeadUserId` no entran en `resolveManagedRecipients`, ni se convierten en membresías Alfresco.

### Documentos y bandejas

Dirección: carpetas configuradas desde `/api/directory/office-inboxes` → `useAlfrescoInbox` → GET `/nodes/{folder}/children`, todas las páginas, con credenciales del actor → normalización `nodeToDocument` → Recibidos. El frontend une por UUID e informa el tipo de bandeja por la carpeta consultada.

Emitidos: `useEmittedInbox` → GET `/api/documents/emitted` → `listInstitutionalEmitted` → carpeta Emitidos institucional, hijos `cm:contains` y GET individual del nodo con la sesión del actor → comprobación de origen declarado/código o evidencia explícita de padre primario histórico. No exige `gd:numero` ni creador actual; conflictos o fallos se informan. El origen por ubicación se etiqueta como evidencia, no se escribe como metadato. Mis documentos filtra creador sobre esta colección institucional autorizada, no sustituye Emitidos.

Jefatura/Especialista: `useAssignmentInbox` → `/api/documents/dispatches?include=documents` → descubrimiento de bandejas configuradas, lectura de `gd:asignaciones`, filtro por destinatario y ACL del actor → documentos/asignaciones/errores → `AssignmentsPage`. Si la cuenta no enumera una carpeta, el servicio puede descubrir candidatos; se exige lectura individual del actor antes de devolverlos. Una asignación no vence una denegación de Alfresco.

PDF: `PdfPreview` → `getNodeContent` → proxy o endpoint de respuesta relacionada → autorización backend + GET `/nodes/{id}/content` con el actor. No hay PDF persistente en localStorage. La vista previa usa objetos temporales del navegador.

### Escritura y trazabilidad

`alfrescoDispatchRepository` guarda un sobre JSON versionado dentro del mismo nodo, en `gd:asignaciones`; responsables multivalor son proyecciones del sobre. Lectura, validación, modificación, detección de cambio externo, PUT y GET final ocurren bajo mutex por UUID. Atención modifica solamente la asignación propia y añade evento. Las respuestas usan UUID independientes de documentos emitidos y asociación estándar `cm:references` desde respuesta a original; además se guarda el vínculo en el sobre. Una respuesta no es una copia del original ni marca automáticamente la atención.

Hay dos rutas de distribución con políticas distintas: la oficial comprueba lectura del destinatario en el nodo y se detiene si falta; la heredada construye/actualiza Consumer sobre el nodo y añade `cm:contains` secundario. Ambas conservan el UUID, pero no son equivalentes en permisos ni trazabilidad.

### Numeración

Dirección → `/api/documents/official-emissions` → identidad/grupos vigentes del actor, modelo y permisos → código DTI/DSA obtenido en servidor → mutex por código/ciclo → recorrido directo de Emitidos mediante GET, incluyendo `cm:contains`, sin SEARCH → máximo numérico `gd:numero` → creación con identidad idempotente → distribución → GET de metadatos y verificación del hash del PDF. Anulados no se filtran. No se reutilizan sufijos históricos incompatibles.

El ciclo usa America/Lima y comienza el 2 de enero. El motor soporta códigos completos independientes; el endpoint habilitado funcionalmente para Dirección solo resuelve DTI/DSA. Los códigos de unidad/persona no están habilitados institucionalmente. `reserveDocumentNumber()` antiguo devuelve 503, no incrementa JSON. La emisión oficial permanece deshabilitada en la configuración inspeccionada.

## 4. Matriz de auditoría

Categorías: A correcto; B configuración/regla legítima; C provisional aceptado; D deuda técnica; E riesgo crítico. Prioridades: P0 antes de ampliar operaciones; P1 antes de revisión/aprobación/cierre; P2 mejora controlada. A/B con «—» no implican una corrección pendiente. Una fila es un hallazgo, aunque abarque varios archivos.

Referencias relativas a la raíz del repositorio; `archivo:línea` identifica el inicio relevante, no un rango. El riesgo describe límites actuales, no incidentes confirmados.

| ID / módulo | Dato | Fuente actual | Fuente esperada | Archivo y línea | Clase | Riesgo / prioridad | Acción recomendada |
|---|---|---|---|---|---|---|---|
| A01 Identidad | ID y perfil autenticados | GET Alfresco tras Basic/SSO | Alfresco | `backend/src/alfrescoClient.js:89`; `backend/src/index.js:112` | A | Lectura real; enabled del actor requiere la mejora E01 / — | Conservar identidad real y no derivarla del nombre visible. |
| A02 Directorio de despacho | Usuarios activos y roles destinatarios | API clásica paginada + GET persona, intersección exacta de grupos configurados | Alfresco | `backend/src/dispatchDirectory.js:8` | A | Subgrupos rechazados explícitamente / — | Mantener; adaptar subgrupos con la futura política institucional. |
| A03 Metadatos básicos | UUID, nombre, tipo, título, descripción | Nodo Core v1 → mapper React | Alfresco | `frontend/src/api/alfresco.js:204` | A | Transformación de campos, no creación de documentos / — | Conservar procedencia; completar campos omitidos según D06. |
| A04 Contenido | PDF binario | GET contenido con actor | Alfresco | `frontend/src/api/alfresco.js:264`; `backend/src/index.js:1029` | A | ACL obligatoria; GET real de contenido no repetido / — | Mantener comprobación antes de descargar. |
| A05 Emitidos | Originales institucionales | GET raíz/hijos/nodo, origen verificado o evidencia histórica | Alfresco | `backend/src/emittedDocuments.js:28`; `frontend/src/pages/DirectorWorkspacePage.jsx:49` | A | No confundir ubicación histórica con declaración formal / — | Conservar etiquetas de evidencia y errores parciales. |
| A06 Recibidos Dirección | Por atender / Por conocimiento | GET hijos de carpetas servidor, deduplicación UUID | Alfresco | `frontend/src/hooks/useAlfrescoInbox.js:26`; `backend/src/index.js:333` | A | Datos según ACL; nombre PDF adicional filtra candidatos / — | Mantener consulta completa y errores visibles. |
| A07 Asignaciones | Destinatarios equivalentes, instrucción, fechas | JSON versionado `gd:asignaciones` | Alfresco | `backend/src/alfrescoDispatchRepository.js:181` | A | Límite de tamaño y concurrencia de piloto / — | Conservar un UUID y registros individuales; nunca elegir principal. |
| A08 Responsables actuales | Usuarios/dependencias multivalor | Proyección del sobre, verificada en GET | Alfresco | `backend/src/alfrescoDispatchRepository.js:112`; `backend/src/alfrescoDispatchRepository.js:222` | A | Se detectan proyecciones divergentes / — | No usar propiedades singulares ni concatenaciones. |
| A09 Atención | Estado propio ATENDIDO y actor/fecha | Sobre persistido y evento individual | Alfresco | `backend/src/alfrescoDispatchRepository.js:315`; `backend/src/attentionPolicy.js:9` | A | No implica cierre global / — | Mantener validación de propiedad y ACL. |
| A10 Respuestas | UUID vinculado y trazabilidad | `cm:references` + sobre JSON + GET relación | Alfresco | `backend/src/alfrescoDispatchRepository.js:272`; `backend/src/alfrescoDispatchRepository.js:340` | A | Dos escrituras, resultado parcial explícito / — | Conservar recuperación idempotente; no afirmar transacción única. |
| A11 Distribución | Identidad única en dos bandejas | Asociación secundaria `cm:contains` | Alfresco | `backend/src/index.js:914`; `backend/src/officialEmissionService.js:189` | A | La asociación no concede ACL / — | Mantener UUID; revisar diferencia de permisos E03. |
| A12 Correlativo | Máximo numérico, incluidos anulados | Recorrido directo y `gd:numero`, parse decimal estricto | Alfresco | `backend/src/alfrescoNumbering.js:44`; `backend/src/officialEmissionContract.js:9` | A | Cobertura depende de visibilidad técnica completa / — | No activar sin comprobar cobertura e históricos. |
| A13 Ciclo e idempotencia | Código/ciclo/número/identidad | Regla backend y cuatro campos Alfresco | Alfresco para persistencia | `backend/src/numberingStore.js:3`; `backend/src/officialEmissionContract.js:24` | A | Código de Dirección únicamente; sin formato visible aprobado / — | Conservar GET posterior, hash y recuperación con misma clave. |
| A14 Lectura institucional | Propios, conocimiento, asignaciones | ACL actor + reglas backend | Alfresco + regla aprobada | `backend/src/documentReadPolicy.js:71` | A | La bandeja Jefatura no muestra todos los derechos de lectura: D11 / — | Mantener separación lectura/responsabilidad y denegación de Alfresco. |
| B01 Despliegue | IDs de carpetas, destino, APIs | Variables de entorno | Configuración servidor | `backend/src/config.js:90` | B | Un mapeo equivocado afecta alcance / — | Validar GET y separar entornos; no introducir UUID productivos en React. |
| B02 Grupos institucionales | IDs de grupos de dependencia/función | Mapeo de despliegue; membresía real | Configuración + Alfresco | `backend/src/config.js:58`; `backend/src/dispatchDirectory.js:27` | B | El mapeo no es lista de personas / — | Mantener IDs reales; aplicar exactitud E02. |
| B03 Matriz funcional | Roles permitidos y capacidades técnicas | Reglas backend, no rol visual | Backend + ACL | `backend/src/dispatchPolicy.js:3`; `backend/src/index.js:127` | B | Capacidad no demuestra permiso del nodo / — | Mantener validación backend, con vigencia E01. |
| B04 Catálogos de UI | Tipos, prioridades, filtros y colores | Constantes de presentación/regla | Configuración aprobada | `frontend/src/data/emisorCatalog.js:60`; `frontend/src/utils/documentViews.js:1` | B | Persistencia del valor elegido es otro problema: D06/D07 / — | No requerir un modelo nuevo solo para etiquetas. |
| B05 Exclusión local | Mutex UUID y código/ciclo, lease | Memoria y archivo lock | Backend, piloto de instancia única | `backend/src/documentQueue.js:2`; `backend/src/dispatchPilot.js:36`; `backend/src/alfrescoNumbering.js:102` | B | No protege de otros hosts/escritores; detección no es CAS / — | Mantener exclusividad operativa verificable; no afirmar concurrencia distribuida. |
| B06 Sesiones | Cookie firmada, CSRF, transacción OIDC | Maps en memoria con TTL | Backend | `backend/src/sessionStore.js:3`; `backend/src/index.js:209` | B | Reinicio cierra sesiones; no pierde asignaciones / — | Separar sesión de fuente documental; vigencia de roles E01. |
| B07 Borradores y reintentos | Clave/parametría pendiente, archivo seleccionado | sessionStorage y estado React | Estado temporal, identidad final Alfresco | `frontend/src/components/DocumentForm.jsx:28`; `frontend/src/components/DocumentForm.jsx:63` | B | PDF no persiste en sessionStorage; requiere reselección / — | Conservar misma clave/hash; no convertir borrador en emisión. |
| B08 Presentación y pruebas | Indicadores calculados, mocks, páginas vacías | Colecciones consultadas; fixtures solo tests/scripts | UI/pruebas | `frontend/src/pages/DirectorWorkspacePage.jsx:9`; `frontend/scripts/verify-dispatch-browser.mjs:1` | B | Sin importación productiva de fixtures observada / — | Contadores representan colección autorizada, no estadística global; conservar placeholders honestos. |
| C01 Organigrama | Especialista → jefe, integrantes, auditoría | `organization.json`, PUT completo | Futuras relaciones institucionales Alfresco | `backend/src/organizationStore.js:7`; `backend/src/index.js:421`; `frontend/src/pages/HierarchyManagementPage.jsx:142` | C | Configuración provisional no autoriza; sin versión concurrente / P1 | Mantener aislado; preparar proveedor real, versionar cambios y detalle de auditoría si se amplía. |
| C02 Persistencia alternativa | Despachos legacy | JSON solo con `DISPATCH_PERSISTENCE=local` | Alfresco para operación institucional | `backend/src/dispatchRepository.js:5`; `backend/src/dispatchStore.js:11` | C | Cambiar modo cambia fuente; no hay fallback automático / P1 | No usar modo local como sustituto operativo; conservar archivo para conciliación autorizada. |
| C03 Conciliación histórica | Exclusiones de numeración | Manifiesto versionado aprobado, hash, GET contenido | Decisión administrativa verificable | `backend/src/emissionReconciliation.js:16`; `backend/src/officialEmissionService.js:22` | C | No aprueba por sí mismo ni cambia documentos / P1 | Aprobar solo históricos identificados; afecta números, no despacho ni bandejas. |
| C04 Revisión/plazos/cierre | Resumen de atención y pantallas reservadas | Regla conservadora, sin workflow formal | Flujo institucional por definir | `backend/src/attentionPolicy.js:23`; `frontend/src/pages/HierarchyManagementPage.jsx:161`; `frontend/src/config/roles.js:11` | C | `formalClosureAllowed:false`; plazos no configurados / P1 | No presentar como workflow completo; definir revisión jerárquica, anulaciones y aprobación antes de implementar. |
| D01 Catálogo organizativo residual | Personas, puestos, subordinación de ejemplo | Constantes `organizationalUnits` usadas por formulario | Directorio/jerarquía real | `frontend/src/data/emisorCatalog.js:16`; `frontend/src/components/DocumentForm.jsx:83` | D | Resuelve destinatario por unidad y coincidencia de nombre; no es autoridad / P1 | Sustituir selector no-Dirección por IDs reales; no usar nombres aproximados ni relaciones del catálogo. |
| D02 Código personal | Iniciales de nombre y código de unidad | `derivePersonCode/getIssuerCode` en React | Código institucional verificado | `frontend/src/utils/issuerIdentifier.js:9`; `frontend/src/App.jsx:133` | D | Puede mostrar identificador no institucional; no controla numeración oficial actual / P1 | Quitar inferencia en flujos oficiales y mostrar pendiente; integrar proveedor de códigos reales. |
| D03 Unidades | Unidad de cada usuario | `ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON` | Relaciones institucionales Alfresco | `backend/src/config.js:121`; `backend/src/index.js:125`; `backend/src/dispatchDirectory.js:71` | D | Actualmente vacío; no oculta candidatos ni prueba supervisión / P1 | Consultar módulo institucional futuro; conservar `unit:null` sin inventar sufijos. |
| D04 Directorio genérico | Destinatarios de creación personal | API v1 + mapeo manual de bandeja | Alfresco, con validación uniforme | `backend/src/index.js:136`; `backend/src/alfrescoClient.js:101` | D | Máximo 1000 sin paginar; no GET enabled por persona; distinto al despacho / P1 | Unificar lectura validada sin reintroducir copias/carpetas personales; decidir alcance no-Dirección. |
| D05 Membresías de login | Lista completa de grupos | Una página `/people/{id}/groups` | Alfresco paginado e IDs exactos | `backend/src/alfrescoClient.js:96` | D | Truncamiento/ausencia de entries se vuelve lista vacía; roles incompletos o ambigüedad omitida / P1 | Validar contrato y todas las páginas; fallar explícitamente si no se verifica. |
| D06 Contrato de emisión | Tipo, período, prioridad, fecha formal, remitente/destino | Formulario + hash; solo parte se escribe al crear | Metadatos reales y contrato explícito | `backend/src/officialEmissionService.js:54`; `backend/src/officialEmissionService.js:129`; `frontend/src/api/alfresco.js:204` | D | Tipo/período/prioridad no quedan como valores consultables; campos formales existentes tampoco se completan / P1 | Reutilizar `gd:tipoDocumental` y su aspecto real; acordar fecha/remitente/destino; decidir período/prioridad sin inventar propiedades. |
| D07 Prioridad institucional | Prioridad fuera del despacho | Caché local `withKnownPriorities` | Valor persistido verificable | `frontend/src/utils/documentViews.js:18`; `frontend/src/App.jsx:192` | D | Dos navegadores muestran prioridades distintas; selección se incluye en hash, no valor persistido / P1 | Distinguir prioridad de asignación (sí en sobre) y documental; no usar caché como verdad. |
| D08 Resumen local | Confirmaciones, estado y fechas | localStorage global; estado fijo y createdAt como emisión | Consulta de nodo y semántica explícita | `frontend/src/utils/documentStore.js:1`; `frontend/src/utils/documentStore.js:59`; `frontend/src/App.jsx:29` | D | Conserva metadatos entre usuarios; catch inicial oculta corrupción; fechas/estado no son gd:estado/fechaDocumento / P1 | Reducir a borrador/confirmación por sesión, reconsultar nodo, no confiar en marca `source:alfresco` local. |
| D09 Notificaciones | Llegada/leído/historial | Snapshot navegador y hora de detección | UI local explícita o eventos institucionales verificables | `frontend/src/utils/documentNotifications.js:3`; `frontend/src/App.jsx:194` | D | No comparte leído ni demuestra fecha de distribución; persiste títulos después de cambios de ACL / P2 | Etiquetar como notificaciones de este navegador; minimizar datos retenidos y revalidar acceso. |
| D10 Distribución histórica | Quién distribuyó y cuándo | Asociación actual + creator/modifiedAt, sin evento propio | Historial de operación institucional | `backend/src/index.js:914`; `backend/src/officialEmissionService.js:178` | D | Asociación no prueba actor/fecha; no usar evento de despacho interno como distribución / P1 | Acordar evento versionado utilizando mecanismos existentes, sin alterar identidad original. |
| D11 Bandeja Jefatura | Propios y Por conocimiento sin asignación | `/dispatches?include=documents` solo reúne UUID de encargos | Derechos de lectura institucional sin exigir responsabilidad | `backend/src/index.js:488`; `backend/src/documentReadPolicy.js:84`; `frontend/src/App.jsx:189` | D | La política permite más documentos que los que descubre la bandeja; /parents 403 bloquea conocimiento secundario sin alternativa / P1 | Unir descubrimiento autorizado de propios/conocimiento; conservar asignación para Por atender y ACL obligatoria. |
| D12 Disponibilidad de asignaciones | Descubrimiento de documentos | Escanea todas las bandejas configuradas de ambas dependencias | Descubrimiento completo sin acoplamiento innecesario | `backend/src/alfrescoDispatchRepository.js:418`; `backend/src/index.js:482` | D | Error de carpeta ajena/corrupción de un PDF puede impedir bandeja completa; límite global 10000 / P2 | Documentar cobertura, aislar errores seguros sin ocultar asignaciones y medir escala; no filtrar por padre primario. |
| E01 Vigencia del emisor | Rol, dependencia y habilitación | Snapshot de sesión hasta 8 h; refresh renueva token, no rol | Alfresco revalidado en operación crítica | `backend/src/sessionStore.js:6`; `backend/src/index.js:112`; `backend/src/index.js:185`; `backend/src/index.js:677` | E | Rol revocado puede seguir autorizando PUT técnico si actor aún lee el nodo / P0 | Revalidar identidad enabled y membresías exactas antes de despacho/atención/organigrama; no confundir read ACL con permiso funcional. |
| E02 Identidad de grupos | Autoridades institucionales | Normalización quita prefijos y puntuación | IDs exactos configurados | `backend/src/roleResolver.js:13`; `backend/src/roleResolver.js:32` | E | IDs distintos pueden conceder el mismo rol; reproducción sintética positiva / P0 | Comparar IDs canónicos exactos; alias de presentación nunca equivalen a autoridad. |
| E03 Distribución heredada | Permiso Consumer del destinatario | Ruta heredada añade ACL, oficial exige ACL previa | Política única aprobada y mínimo privilegio | `backend/src/index.js:775`; `backend/src/index.js:883`; `backend/src/documentDelivery.js:3` | E | Con emisión oficial deshabilitada, POST directo heredado sigue disponible y puede modificar ACL / P0 | Decidir compatibilidad y cerrar bypass de flujo antes del piloto; no quitar distribución ni aplicar cambios de ACL durante auditoría. |
| E04 Creación multipart | Propiedades/aspectos suministrados por cliente | Reenvío del cuerpo; se prohíben solo cuatro campos de numeración | Contrato allowlist construido en backend | `backend/src/index.js:809`; `backend/src/index.js:1022`; `backend/src/index.js:1060` | E | Otras propiedades gd/aspectos podrían introducir autoría/origen/asignaciones no orquestadas si Alfresco permite crearlas / P0 | Parsear y reconstruir campos permitidos; rechazar `gd:asignaciones`, proyecciones y metadatos controlados fuera de sus servicios. No explotado en DEV. |

## 5. Hardcoding legítimo frente a indebido

Legítimo: DTI/DSA como ámbito aprobado, rutas API, nombres técnicos del modelo, roles permitidos, enum de prioridad, colores deterministas, mensajes, límites de tamaño, períodos de sondeo, America/Lima, fecha de inicio de ciclo, UUID de carpetas en configuración servidor y no en código productivo. No se deben migrar automáticamente a un modelo para eliminar constantes.

Indebido: nombres y cargos del catálogo organizativo productivo, vínculos `reportsToPositionId` de ejemplo, búsqueda de destinatario por nombre parcial, iniciales del usuario como código oficial y prioridad del navegador presentada sin fuente institucional uniforme. No se encontraron listas fijas de jefaturas/especialistas en el directorio de despacho actual ni inferencias `_1/_2` allí. `unit:null` permanece admisible.

Los UUID reales presentes en fixtures, scripts de prueba o informes no son rutas operativas hardcodeadas; son un asunto separado de minimización de información al publicar el repositorio. El candidato de conciliación es configuración administrativa pendiente, NO catálogo oculto de permisos. `server/roleResolver.js` residual no se importa desde el backend actual; los scripts activos arrancan `backend/src/index.js`, y Vite redirige `/api` al BFF. No se observó importación de `testFixtures` ni interceptores de mock desde las entradas productivas. `EmisorPage.jsx` conserva un resumen basado en documentos recibidos por props, pero no está registrado en `rolePages`; no debe describirse como pantalla principal activa.

## 6. Persistencia, reinicios y consistencia entre usuarios

| Fuente | Qué conserva | Reinicio backend/frontend | Consistencia institucional |
|---|---|---|---|
| Alfresco | PDF, UUID, propiedades, sobre de asignaciones, eventos, referencias y asociaciones | Persistente si se confirma PUT/POST y GET | Según ACL, grupos y cobertura de descubrimiento; no depende del navegador |
| `organization.json` | Organigrama provisional y hasta 1000 eventos de reemplazo | Persiste si el archivo/volumen sigue disponible | Compartido solo por procesos con ese archivo; reemplazo completo permite actualizaciones perdidas |
| `dispatches.json` | Despachos solo en modo local explícito | Persiste si se conserva archivo | No es la fuente seleccionada actualmente; no se migra automáticamente |
| `document-numbers.json` | Legacy residual | Conservado, no incrementado por numeración oficial | No es fuente de números nuevos; variable residual requiere limpieza futura de contrato |
| Manifiesto de conciliación | Decisión aprobada, hashes y exclusiones | Se relee al activar servicio | Excluye del máximo únicamente; no modifica atención ni visibilidad |
| localStorage confirmaciones | Resúmenes de documento + prioridad elegida | Persiste entre recargas y usuarios del mismo origen | Clave global, datos obsoletos y no autoridad; Emitidos ya no depende de ella |
| localStorage Para mí | UUID seleccionados por usuario/dependencia | Persiste en navegador | Preferencia personal; no crea asignación ni concede lectura |
| localStorage notificaciones | Leído, título, conocido y detección | Persiste en navegador | No es registro institucional de entrega; no se comparte entre dispositivos |
| sessionStorage emisión | Clave, parámetros y UUID incierto | Recarga misma pestaña conserva recuperación | Borrador local; reconciliación final por identidad Alfresco y hash, no por este estado |
| Memoria Express | Sesiones/tokens, exclusión de operaciones, mapas de incertidumbre | Se pierde al reiniciar | Sesión requiere nuevo login; número/UUID se recuperan en Alfresco, no en contador local |
| Archivos lease | Exclusión local de piloto | Pueden quedar obsoletos tras caída | No son garantía de exclusión entre hosts, rutas distintas o escritores externos |

El motor oficial usa nombre determinista por actor/clave, identidad persistida y lectura directa para recuperar creación incierta. Las marcas de incertidumbre en memoria se pierden al reiniciar: no se puede afirmar que sustituyan la conciliación durable ni que cubran procesos externos. La completitud del GET técnico es condición previa para reservar; no se demuestra solo con tener permiso de lectura sobre una parte de Emitidos. Los anulados deben retener metadatos y ubicación.

Los responsables son equivalentes. Las fechas de despacho/atención son generadas por backend y luego persistidas en el sobre, lo cual es válido; no son fechas inventadas solo para mostrar. En cambio el fallback del caché que presenta registro como fecha de emisión o `Creado en Alfresco` como estado documental debe distinguirse del dato formal. El documento puede tener `gd:estado` distinto de la atención individual: no hay sincronización global implementada.

## 7. Detalle de seguridad y evidencias negativas

### E01: rol conservado en sesión

`createAlfrescoSession` resuelve una vez grupos y capacidades. `requireSession` verifica firma/TTL y eventualmente renueva tokens OIDC. No vuelve a consultar enabled o roles. `createDispatch` valida el rol recibido de la sesión y la lectura del actor, y escribe con servicio. Una revocación de rol funcional no necesariamente revoca esa lectura; por eso la ACL de lectura no subsana esta falta. La emisión oficial sí hace GET de persona y grupos por solicitud y comprueba coherencia con la sesión. No se debe trasladar esta mejora al frontend.

### E02: colisión reproducida sin tocar Alfresco

Se ejecutó únicamente la función pura `resolveRole` con datos sintéticos: mapeos `GROUP_GD_DSA` y `GROUP_GD_DIRECCION`, membresías distintas `GROUP_DSA` y `GROUP_DIRECCION`. Devolvió autorización `active`. Demuestra equivalencia indebida de identificadores en código, no existencia de esos grupos alternativos ni explotación real en DEV. Deben mantenerse alias solo para etiquetas/configuración explícita, no para aceptar autoridades diferentes.

### E03/E04: rutas distintas del formulario oficial

Que React use el nuevo endpoint oficial no elimina `/send-to-director`. Este último bloquea creación nueva cuando el flag oficial está activo; cuando está deshabilitado, sigue aceptando creación legacy. Además, su ruta retry puede configurar ACL. `buildRecipientPermissions` preserva denegaciones y el PUT usa al actor, de modo que no implica privilegios admin; aun así, es una diferencia real respecto del requisito de no cambiar ACL automáticamente en el piloto oficial.

La validación PDF comprueba formato/firma, no lista completa de propiedades multipart. `containsOfficialMetadata` rechaza únicamente `gd:numero`, código, ciclo e identidad. El resto del cuerpo se reenvía. Si el actor tiene permiso de creación y el modelo acepta esos campos/aspectos, hay superficie para metadatos controlados por cliente. Es un riesgo condicionado a permisos reales, no prueba de que un nodo existente pueda sobrescribirse globalmente. No se creó un documento de prueba para explotarlo.

Protecciones confirmadas en código: CSRF en escrituras; operaciones de mover/eliminar/PUT genérico bloqueadas por `emittedRetentionPolicy`; controles de ACL del actor antes de usar servicio para asignaciones; servicio con permiso update concreto; proyecciones verificadas; directorio de destinatarios activo y por dependencia; Jefatura sin proveedor rechazada; búsqueda y descarga de usuarios de asignación pasan por política backend; no concesión automática de ACL desde repositorio de asignaciones ni desde servicio oficial. Las restricciones de la aplicación no equivalen a inmutabilidad de ACL en clientes Alfresco externos.

## 8. Resultado del merge

El commit de integración añadió la pantalla, endpoints y `organizationStore`, configuró el archivo temporal y lo excluyó de Git. No cambió el repositorio de `gd:asignaciones`, el lector de Emitidos, la numeración ni la autoridad de `resolveManagedRecipients`. `App.jsx` transmite CSRF y `DirectorWorkspacePage.jsx` conserva `emittedInbox`.

La nueva fuente local es C01, expresamente provisional. Persisten problemas propios: relación opcional al guardar por API, PUT de estructura completa sin versión, auditoría con cantidad pero sin diff y director visual igual a sesión actual, no catálogo de todos los directores. No deben confundirse carriles del organigrama con creación de roles/grupos o con asignaciones documentales. Las deudas D01–D12 y riesgos E01–E04 no se atribuyen al merge sin evidencia: en gran parte ya estaban en el código común/local anterior.

## 9. Qué funciona y qué sigue pendiente

Respaldado por Alfresco en el código: identidad autenticada, directorio de despacho, nodos/PDF, bandejas, Emitidos institucionales, asignaciones múltiples, responsables proyectados, atención individual, referencias de respuestas, numeración preparada y recuperación de emisión. La existencia de tres nodos con asignaciones y el modelo real se verificó por GET. No se certificó el contenido completo de cada sobre ni se emitió un documento oficial.

No terminado o provisional: jerarquía interna real; unidades y códigos de especialistas; creación no-Dirección dependiente del catálogo y bandejas personales (cero configuradas); revisión Especialista → Jefatura real → Dirección; aprobación formal; anulación/cierre global; plazos; eventos de distribución; persistencia consultable de ciertos datos del formulario; notificaciones compartidas. Las pantallas de colaborador/técnico y menús de cierre son contenedores/espacios reservados, no workflows funcionales. Adjuntos adicionales se seleccionan en memoria, pero el formulario bloquea envío con ellos y lo explica (`DocumentForm.jsx:187`); no hay pérdida silenciosa que deba confundirse con soporte de adjuntos.

Para Jefatura hay una diferencia adicional entre seguridad y experiencia: `authorizeNodeRead` permite propios y conocimiento con ACL, pero el endpoint de bandeja solo descubre UUID con encargos. Un usuario puede tener lectura legítima sin verlo allí. Solucionarlo no debe conceder capacidad de derivación sin encargo vigente ni abrir contenido por UUID.

## 10. Plan de corrección mínimo y validación requerida

1. **P0 / identidad vigente:** `alfrescoClient.js`, `roleResolver.js`, middleware de `index.js`. Comparación exacta de IDs, paginación y validación de contrato; GET enabled/roles del actor antes de acciones con servicio o administración. Pruebas de revocación tras login, cuenta deshabilitada, grupos parecidos pero distintos, ambigüedad y páginas posteriores. No modificar grupos ni ACL para solucionar lógica.
2. **P0 / contratos de escritura:** `index.js`, `documentDelivery.js`. Acordar si legacy queda solo como recuperación controlada; impedir nuevos documentos que eludan el contrato oficial y reconstruir multipart con allowlist. Probar metadatos prohibidos, PDF válido con campos adicionales, endpoint oficial deshabilitado, retry y conservación de distribución DTI–DSA. No retirar legacy sin analizar casos de recuperación ya existentes.
3. **P1 / metadatos persistidos:** `officialEmissionService.js`, mapper API y `documentStore.js`. Utilizar `gd:tipoDocumental` existente con su aspecto confirmado; definir uso de propiedades formales existentes y distinguir prioridad documental/asignación y período académico/ciclo. El hash no reemplaza valores consultables. Si no hay propiedad apropiada para algún dato, presentar la necesidad antes de ampliar modelo. Probar creación mock, GET y recarga de otro navegador, sin fallback local.
4. **P1 / organización:** sustituir en `DocumentForm.jsx` y `emisorCatalog.js` personas/puestos aproximados por IDs reales. Integrar proveedor desacoplado en `organizationalHierarchy.js` cuando el compañero suministre contrato de grupos internos y supervisión. Consultas paginadas, enabled, intersección de dependencia/rol y evidencia de supervisión obligatorias. Mantener el bloqueo actual hasta entonces; el JSON puede seguir como borrador sin autoridad. Probar otra unidad, dependencia, jefe revocado, grupo anidado y relación ausente.
5. **P1 / lectura y caché:** completar descubrimiento de propios/conocimiento en bandeja Jefatura y fallback seguro de asociaciones, sin depender exclusivamente de `/parents` ni de padre primario. Reducir caché de confirmaciones a contexto temporal, eliminar dependencia institucional de prioridad local y etiquetar detección/notificaciones. Probar dos usuarios/navegadores y denegación ACL posterior.
6. **P1 / revisión y cierre:** diseñar política después de resolver 1–5: revisión por jefe real, elevación a Dirección y aprobación obligatoria. Conservar estados individuales; no cerrar por un único destinatario ni sumar anulados como cumplidos sin regla aprobada. Definir transición global y sincronización con `gd:estado`, auditoría e idempotencia antes de permitir cierre. No hay implementación actual que pueda activarse solo cambiando menú.
7. **P2 / robustez:** aislar errores de descubrimiento, revisar cobertura/limites y colecciones grandes; versionado del organigrama y auditoría de cambios; minimizar información local y de informes publicados. Mantener todos los datos existentes y solicitar aprobación separada para limpieza/conciliación histórica.

Antes de la primera emisión: confirmar visibilidad técnica de todos los correlativos de la secuencia, inmutabilidad operacional de Emitidos, ausencia de escritores externos, una instancia, decisiones de conciliación y lectura real del destinatario. Probar con mocks timeout/reinicio/idempotencia y con GET sesiones reales; solo después autorizar por separado una escritura de prueba. No añadir base de datos ni modelo nuevo como solución predeterminada.

## 11. Cuantificación

La matriz contiene 42 hallazgos: A=14, B=8, C=4, D=12 y E=4. C/D/E suman 20 filas de trabajo pendiente: P0=4, P1=14 y P2=2; las otras 22 filas A/B no tienen corrección asignada. A/B describen controles y fuentes que deben conservarse.

El número de filas no equivale a cantidad de vulnerabilidades independientes ni demuestra incidentes. Las consecuencias condicionadas y verificaciones reales pendientes están identificadas arriba. No se aprobaron escrituras, conciliaciones, cambios de modelo/ACL ni habilitaciones mediante este informe.
