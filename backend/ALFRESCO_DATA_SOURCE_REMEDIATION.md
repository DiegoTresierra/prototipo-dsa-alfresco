# Remediación de fuentes de datos — DTI/DSA

Fecha: 19/11/2026, America/Lima. Rama `feature/jerarquia-despacho-interno`.
HEAD de partida: `7e19ef66b2b01bbe3720e66a092f48d39fce9113`.
Se conservan todos los cambios locales E01–E04 y los informes previos. Este informe distingue corrección técnica, mitigación y dependencia institucional; no declara completo el workflow formal.

## Resultado ejecutivo

Se unifica la lectura institucional de destinatarios, se persisten metadatos descriptivos existentes al crear oficialmente, se elimina el navegador como fuente documental persistente y se sustituyen puestos/personas de ejemplo por cuentas reales. Jefatura obtiene documentos propios y Por conocimiento encontrados en las bandejas configuradas sin crear asignaciones. Una relación secundaria se verifica con evidencia obtenida del repositorio y la lectura del actor sigue siendo obligatoria. Los avisos locales no conservan títulos/remitentes ni se presentan como eventos oficiales.

Permanecen pendientes las relaciones institucionales de supervisión, códigos de unidades/especialistas, propiedades compatibles de prioridad documental/período académico, eventos de distribución y reglas de revisión/aprobación/cierre. No se crean propiedades, bases de datos ni un segundo sistema de subordinación.

## Fase A — Identidad y directorio

`loadInstitutionalDirectory` reutiliza la consulta clásica paginada de grupos configurados y la validación GET de cada persona. Incluye cuentas Dirección, Jefatura y Especialista cuando corresponde. `loadDispatchDirectory` conserva su contrato restringido a los roles destinatarios del despacho y no cambia el cliente v1 de otros consumidores. La lista genérica de creación usa el mismo servicio; mantiene el mapeo servidor de bandejas requerido por la carga genérica existente.

No se aceptan grupos por nombre visible, prefijos aproximados ni usuarios inactivos. Grupos anidados se rechazan explícitamente hasta definir cómo demostrar supervisión; no se omiten en silencio. La paginación de grupos del login ya corregida en P0 se conserva; también se pagina y valida el cliente v1 residual de miembros. Un error de contrato o alcance no produce una lista incompleta presentada como completa.

Archivos de fase: `src/dispatchDirectory.js`, `src/alfrescoClient.js`, `src/index.js`, `src/dispatchDirectory.test.js`, `src/alfrescoClient.test.js`.

Verificaciones: cuenta Dirección habilitada, cuenta Dirección deshabilitada, páginas posteriores, separación entre directorio genérico y despacho, contrato v1 inválido. La revalidación antes de escritura sigue en `institutionalIdentity.js`; no se modifica la cuenta ni las membresías reales.

## Fase B — Metadatos y navegador

Se consultaron por GET las definiciones reales de `gd:identificacion` y `gd:clasificacion`, con la cuenta técnica configurada, no administrativa. Las propiedades siguientes existen, son `d:text` singulares y no protegidas; no se desplegó ningún modelo:

| Propiedad | Valor que construye el backend en una emisión nueva |
|---|---|
| `gd:tipoDocumental` | Tipo solicitado y validado; aspecto existente `gd:clasificacion`. |
| `gd:dependenciaOrigen` | Dependencia del actor revalidada en Alfresco. |
| `gd:dependenciaDestino` | Dependencia destinataria original validada; no cambia con el despacho. |
| `gd:remitente` | ID Alfresco del actor que emite, no identidad de la cuenta técnica. |
| `gd:destinatario` | Identificador de la Dirección destinataria institucional seleccionada. |
| `gd:fechaDocumento` | Fecha de emisión generada por el backend en America/Lima, texto `YYYY-MM-DD`. |

La fecha documental se registra al emitir; no se copia de `createdAt` ni se rellena retrospectivamente. Un reintento conserva la fecha registrada. Para documentos cuya fecha formal deba ser distinta de la emisión, hace falta definir el contrato de fecha declarada; no se interpreta el contenido del PDF.

El servicio comprueba ambas clases antes de crear y verifica los valores por GET después. Un modelo incompatible impide esa emisión. Se conservan `gd:numero`, código, ciclo, identidad idempotente, máximo numérico, mutex, hash PDF y conciliación. Los aspectos se envían mediante la lista JSON multipart soportada por el contrato REST, no se crean clases nuevas.

`documentMapping.js` centraliza la transformación del nodo. Se distinguen `createdAt`, `gd:fechaDocumento`, `gd:estado` y estado individual del sobre. No se inventa un estado global «Creado en Alfresco». `documentStore.js` pasa a ser un adaptador puro de confirmaciones actuales: no consulta ni escribe resúmenes en localStorage, no incrementa números y no conserva prioridad del formulario como dato documental. El arranque limpia únicamente la antigua clave de caché de confirmaciones del navegador; no elimina documentos ni archivos operativos. Cada sesión tiene estado React propio.

Se elimina `withKnownPriorities` del flujo productivo; su exportación residual ya no enriquece desde datos locales. La prioridad de una asignación continúa en `gd:asignaciones`, separada de una prioridad documental global.

**Bloqueo parcial:** no se verificaron propiedades de prioridad documental ni período académico. Ambos campos permanecen como parámetros de solicitud/hash y se informa antes del envío y en la confirmación que no son metadatos oficiales persistidos. El resultado incluye advertencias específicas. No se promete búsqueda, recuperación o filtro institucional por esos datos. Habilitar su persistencia requiere un contrato aprobado; no se usa el hash para reconstruirlos ni se bloquean tipo, origen, fecha y demás campos ya definidos.

Archivos de fase: `src/emissionDescriptiveMetadata.js`, `src/officialEmissionService.js`, `src/testFixtures/officialEmission.js`, pruebas correspondientes; `frontend/src/utils/documentMapping.js`, `documentStore.js`, `documentViews.js`, `frontend/src/api/alfresco.js`, `frontend/src/App.jsx` y pruebas de caché/prioridad. El formulario comunica las limitaciones sin ocultarlas.

## Fase C — Organización, formularios y lectura institucional

El catálogo productivo `emisorCatalog.js` conserva solo dependencias del piloto y tipos/prioridades de presentación. Se retiran personas, puestos ficticios y `reportsToPositionId`. No se buscan destinatarios por fragmentos de nombre. El formulario no-Dirección selecciona por ID real devuelto por el directorio; no inventa una unidad para que valide. La carga genérica sigue necesitando una bandeja configurada y permiso de Alfresco, y no constituye emisión oficial de unidad/especialista.

`/api/auth/me` proporciona el código de Dirección desde la dependencia resuelta en backend. No se generan códigos por iniciales; los helpers residuales no construyen códigos personales o de unidad. Los códigos institucionales de unidades/especialistas y sus relaciones quedan explícitamente pendientes. Las unidades procedentes de configuración no se elevan a «verificadas»: `unitVerified:false`; la interfaz principal no las usa como acreditación institucional. No se borra la configuración ni el organigrama provisional.

La bandeja de Jefatura reúne UUID de encargos y candidatos actor-legibles descubiertos en las carpetas institucionales. `authorizeNodeRead` mantiene la regla: propios o Por conocimiento de su dependencia permiten lectura; Por atender ajeno requiere asignación. El mapa de pertenencia proviene exclusivamente de GET servidor de `cm:contains`, nunca del frontend. Si `/parents` devuelve 403, el proxy puede reutilizar el descubrimiento backend para comprobar la asociación secundaria. Los documentos descubiertos técnicamente requieren después lectura del actor; una asignación o asociación no vence ACL.

La interfaz separa «Documentos propios y Por conocimiento» de los encargos. La sección de lectura no muestra atención ni derivación; la matriz jerárquica sigue intacta y el proveedor institucional ausente sigue bloqueando Jefatura → Especialista. Que el backend devuelva `dispatchRecipientRoles` no prueba supervisión ni sustituye al resolvedor.

Se conservan límites de recorrido como protección contra consultas ilimitadas: no hay truncamiento exitoso silencioso. El fallo de una carpeta de otra dependencia se devuelve como consulta parcial, sin perder los documentos ya verificables; el fallo de una carpeta propia sigue siendo un error. Un sobre ilegible de un nodo actor-legible se informa por separado y no se resetea ni se sobrescribe. El frontend muestra advertencia de parcialidad. Un documento de otra dependencia que no cumpla una regla de lectura simplemente no se incorpora, sin generar un encargo ficticio.

**Límite de cobertura:** «propios» se descubre dentro de las bandejas institucionales configuradas. No se promete una búsqueda exhaustiva de todos los espacios personales del repositorio. Ampliar ese ámbito necesita definir el alcance, no aceptar un UUID del cliente como prueba.

Archivos de fase: `src/index.js`, `src/alfrescoDispatchRepository.js`, `src/documentReadPolicy.js` y sus tests; `frontend/src/components/DocumentForm.jsx`, `frontend/src/data/emisorCatalog.js`, `frontend/src/utils/documentValidation.js`, `issuerIdentifier.js`, `frontend/src/App.jsx`, `frontend/src/pages/AssignmentsPage.jsx`, `frontend/src/utils/institutionalSources.render.test.js` y script de regresión de navegador.

## Fase D — Notificaciones, trazabilidad y legacy

Notificaciones conserva únicamente ID de aviso, UUID, detección y preferencia de lectura en una clave por usuario/dependencia. Los datos legados de título/remitente no se usan: los detalles visibles proceden de los documentos autorizados actuales. Si la bandeja se está refrescando o falla, no se muestran detalles de avisos antiguos como si fueran vigentes. Abrir un aviso realiza además GET de metadatos; descargar siempre conserva su autorización backend. La hora es detección local, no recepción oficial; no se sincronizan lecturas entre dispositivos.

El backend mantiene el modo local explícito para recuperación/pruebas, pero la interfaz institucional rechaza `persistence:local` con un error comprensible. No hay fallback de Alfresco a JSON. No se elimina `dispatches.json` ni `document-numbers.json`. La reserva local de números continúa rechazada. El manifiesto de conciliación conserva su aprobación/hash y solo afecta al máximo numérico, no a despacho, atención o visibilidad; no se aplicó ninguna exclusión.

Archivos de fase: `frontend/src/utils/documentNotifications.js`, sus tests, `frontend/src/pages/NotificationsPage.jsx`, `frontend/src/utils/dispatchPersistence.js`, `frontend/src/App.jsx` y `frontend/src/api/alfresco.js`.

### Propuesta pendiente D10 — Eventos de distribución

El contrato actual del sobre define eventos de despacho, atención y respuesta, pero no un evento de distribución entre Direcciones. Las asociaciones históricas no acreditan actor/fecha. Implementar su registro exigiría ampliar el contrato versionado y escribir sobre el nodo ya creado; se deja **bloqueado** conforme a la instrucción expresa, no se marca solucionado por renombrar una fecha.

Propuesta mínima, sin modelo nuevo: añadir una colección validada de eventos versionados al sobre existente de `gd:asignaciones`, bajo `gd:tramite`, independiente de las asignaciones y sin crear destinatarios de atención. Cada evento debe incluir versión, ID idempotente, UUID original, actor real revalidado, dependencia emisora/receptora, categoría de recepción, asociación verificada y momento de confirmación por GET. Este último no debe denominarse fecha atómica de commit de Alfresco. Mantener mutex por UUID y recuperación tras asociación confirmada pero evento pendiente. Los históricos sin evidencia seguirían sin fecha/actor de distribución.

Antes de implementarlo deben aprobarse semántica, visibilidad, retención y transición compatible del JSON. No es necesario decidir por defecto una base de datos ni crear propiedades `gd:*` nuevas. El código de esta entrega no añade eventos ni modifica sobres existentes.

## Matriz de estado

«Corregido» significa cambio técnico probado; «mitigado» conserva un límite explícito; «provisional» sigue siendo solución aceptada; «bloqueado» requiere contrato/decisión institucional. Las 22 filas A/B de la auditoría ya eran correctas o configuración legítima: permanecen vigentes, no se contabilizan como deuda recién corregida.

| Hallazgo accionable | Estado | Resultado / pendiente |
|---|---|---|
| E01 | Corregido, conservado | Identidad/rol actuales antes de operaciones críticas; sin caché global. |
| E02 | Corregido, conservado | Autoridades exactas; no equivalencias por nombres. |
| E03 | Corregido, conservado | Emisión nueva solo oficial; recuperación legacy sin ACL automática. |
| E04 | Corregido, conservado | Multipart allowlist y reconstrucción servidor. |
| D01 | Corregido | Cuentas reales por ID; sin catálogo de personas/puestos. La falta de bandejas reales sigue siendo configuración, no se fabrica. |
| D02 | Corregido | Sin iniciales como códigos; Dirección recibe código backend. |
| D03 | Mitigado | Configuración de unidad no se presenta como verificada. Relación/código real bloqueados hasta proveedor institucional. |
| D04 | Corregido | Directorio común, paginado y usuarios habilitados; bandeja genérica sigue requiriendo mapeo legítimo. |
| D05 | Corregido | Login y cliente v1 residual validan páginas y IDs, conservando P0. |
| D06 | Mitigado | Tipo/origen/destino/remitente/fecha persistidos y verificados; prioridad y período oficiales bloqueados por contrato ausente. |
| D07 | Corregido | Caché nunca aporta prioridad documental. Prioridad de encargo permanece persistida en sobre. |
| D08 | Corregido | Sin resúmenes documentales en localStorage, sin estado/fecha inventados; confirmaciones solo memoria de sesión. |
| D09 | Corregido en alcance local | Solo preferencias persistentes, detalles de fuente autorizada y detección etiquetada. No se ofrece servicio de eventos/notificaciones institucionales. |
| D10 | Bloqueado | Propuesta versionada anterior; no se fabrican eventos históricos ni se escriben nodos existentes. |
| D11 | Corregido en ámbito configurado | Propios/conocimiento separados de encargos, ACL y secundaria comprobadas; sin ampliar repositorio completo. |
| D12 | Mitigado | Parcialidad visible de fuentes ajenas, aislamiento de errores por nodo, límites explícitos. Escala/cobertura deben verificarse con datos reales. |
| C01 | Provisional | Organigrama JSON del compañero conservado; sin autoridad de despacho. |
| C02 | Mitigado | Local explícito en backend, rechazado como fuente institucional en React. Datos legacy intactos. |
| C03 | Provisional | Conciliación pendiente de aprobación, sin aplicación ni limpieza automática. |
| C04 | Bloqueado | Revisión, aprobaciones, anulaciones exigibles y cierre global necesitan reglas institucionales. |

Resumen de las 20 filas accionables: 12 corregidas/conservadas, 4 mitigadas, 2 provisionales y 2 bloqueadas. D03 y D06 contienen subfunciones bloqueadas que se detallan expresamente, sin declarar completas las respectivas áreas.

Cobertura restante de la matriz original: A01 identidad, A02 directorio, A03 metadatos básicos, A04 PDF, A05 Emitidos, A06 recepción, A07 asignaciones, A08 proyecciones, A09 atención, A10 respuestas, A11 asociaciones, A12 correlativo, A13 ciclo/idempotencia y A14 lectura permanecen con sus controles, reforzados donde corresponde. B01 despliegue, B02 mapeos, B03 matriz funcional, B04 catálogos, B05 mutex/lease, B06 sesiones, B07 borradores y B08 presentación/pruebas siguen siendo configuración/reglas legítimas.

## Validación por fase

| Fase | Suite completa | Lint | Build |
|---|---|---|---|
| A | 154 aprobadas | Correcto | Correcto |
| B | 155 aprobadas | Correcto | Correcto |
| C | 159 aprobadas | Correcto | Correcto |
| D / final | 163 aprobadas | Correcto | Correcto |

Comandos: `node --test backend/src/*.test.js frontend/src/utils/*.test.js`; `npm run lint` y `npm run build` desde `frontend`. También se ejecutó Edge headless sobre el bundle real con servidor/API aislados: emisión/reintento con una sola identidad, atención independiente, recarga, navegación, responsabilidades equivalentes y Emitidos DTI/DSA sin caché. El script se adapta a la eliminación de puestos ficticios y al código de Dirección entregado por backend.

Todas las escrituras de pruebas son simuladas con destinos `.invalid` o servidor local controlado. La cuenta técnica real se utilizó exclusivamente para GET del modelo; no se usaron pruebas simuladas como demostración de ACL reales. No se emitió ni se cambió un documento DEV. Los 163 tests incluyen las 153 regresiones de la entrega P0 adaptadas donde cambió intencionadamente la semántica de caché, catálogo o fuente local.

Nuevas pruebas de esta entrega: directorio genérico de Dirección activo/inactivo paginado; cliente v1 multipágina/contrato inválido; metadatos descriptivos GET, fecha Lima y reintento estable; no lectura/escritura de caché documental; prioridad no enriquecida; IDs/códigos sin inferencia; Jefatura descubre y descarga conocimiento secundario sin asignación, pero no Por atender ajeno; error de carpeta ajena conserva snapshot con advertencia; UI de lectura sin acción de atención; notificaciones sin datos sensibles y solo sobre documentos autorizados; rechazo de modo local como fuente institucional.

## Pruebas reales pendientes para el compañero

1. **Todas las cuentas:** iniciar sesión con IDs/grupos exactos; comprobar que roles y dependencia vienen del backend. Mediante GET verificar listados, metadatos y PDF; no asumir que aparecer en una carpeta concede lectura.
2. **Dirección DTI y DSA:** verificar Emitidos propios de la dependencia, Recibidos secundarios, fecha documental frente a registro, ausencia de prioridad inventada y funcionamiento de Ajustes sin modificar el organigrama. La prueba real de emisión sigue desautorizada; revisar solo su disponibilidad/mensaje de bloqueo.
3. **Jefatura:** comparar encargos con la sección de lectura institucional. Abrir propios y conocimiento con ACL válida; denegar Por atender no asignado y UUID ajeno. Verificar que derivar sigue bloqueado por relación institucional pendiente. No cambiar membresías para probar revocación real en esta entrega: ya está cubierto por mocks.
4. **Especialista:** ver solamente documentos permitidos y asignaciones propias; ningún despacho. Atención y vinculación real requerirían autorización de escritura separada; por ahora verificar interfaz y consultas GET.
5. **Mismo navegador / dos usuarios:** salir e iniciar con otra cuenta; no reutilizar títulos, remitentes, prioridades o documentos de la cuenta anterior. Notificaciones reconstruidas solo desde la bandeja actual; preferencias no equivalen a tareas.
6. **Operaciones inciertas anteriores:** verificar por GET UUID, creador, Emitidos, asociación y permisos. La recuperación con POST debe autorizarse aparte; no crear otro PDF ni aprobar nuevas ACL desde esta entrega.
7. **Operador antes de escrituras:** revisar conciliación, cobertura de la cuenta técnica sobre la secuencia, una instancia y escritor exclusivo; no activar flags sin aprobación. El mutex/lease no garantiza exclusión entre hosts ni escritores externos.

## Decisiones pendientes e instrucciones de entrega

- Proveedor de grupos internos reales: contrato de supervisión Jefatura–Especialista, unidades y códigos verificables; no se sustituye por JSON ni nombres.
- Persistencia y semántica de prioridad documental/período académico; la prioridad de encargo ya está resuelta y no necesita otra propiedad para cumplir su función.
- Fecha documental declarada distinta de emisión, si se requiere; no es lo mismo que `createdAt`.
- Contrato del evento de distribución, aprobación de escritura sobre el sobre y retención de auditoría.
- Revisión jerárquica, aprobación obligatoria de Dirección, reglas de anulaciones y sincronización global con `gd:estado`. No se implementó cierre automático.
- Clasificación y aprobación de conciliación histórica; no se limpian ni excluyen los documentos por código.

No se modificó `.env.local`, modelo/CMM, ACL, grupos, usuarios o archivos operativos. No se alteró deliberadamente `organizationStore.js` ni la pantalla del compañero. No se habilitó emisión oficial ni Jefatura → Especialista. Sin commit, push, merge, rebase o reset. El trabajo queda local y revisable.

## Revisión final — Corrección de los cinco hallazgos

Las cifras y contratos de las fases anteriores describen sus respectivas entregas. La validación actual asciende a **169 pruebas aprobadas**, con lint, build y regresión Edge correctos. No se alteran los datos históricos ni se aplican escrituras reales para comprobar estas correcciones.

| Hallazgo | Causa comprobada | Corrección | Pruebas / resultado |
|---|---|---|---|
| UUID sin ACL | Un fallo del GET del actor añadía a `discoveryErrors` el ID descubierto técnicamente. | `alfrescoDispatchRepository.js` separa prueba de lectura y decodificación. Solo incluye ID cuando existe lectura confirmada del actor. 403/404 omiten el nodo; 500/red producen error anónimo con correlación opaca. Diagnóstico interno opcional contiene únicamente correlación, operación y estado, sin UUID, nombres, URL, tokens o mensajes arbitrarios. | Reproducciones 403/404/500/red, cero documentos autorizados y marcadores privados: ningún ID, nombre, título o contexto privado aparece en la respuesta. |
| Destinatario sin revalidar | El POST solo comprobaba el mapeo de carpeta y el rol vigente del emisor. | `genericCreation.js` vuelve a consultar el directorio común; exige coincidencia exacta de usuario, dependencia y función seleccionados con el estado real, y mapeo servidor vigente. GET de la carpeta con el actor exige ID correcto, carpeta y permiso create antes del POST. | HTTP: deshabilitado, cambio de dependencia/rol, pérdida de grupo, 404/500/red, directorio caído, carpeta/remapeo/modelo inválidos: cero creaciones. |
| Fecha/ciclo discrepantes | Dos consultas al reloj podían cruzar el límite del 2 de enero. | Una sola referencia temporal para la emisión nueva, compartida por fecha documental y ciclo. Los reintentos no consultan el reloj y reutilizan fecha/ciclo originales. | Cambio de año, 1 de enero, 2 de enero, reloj que devuelve un instante distinto en la segunda lectura y replay: fecha/ciclo consistentes, mismo UUID y una lectura de reloj por emisión nueva. |
| Tipo genérico descartado | React lo exigía, pero su adaptador no lo enviaba y la allowlist no lo admitía. | React envía `documentType` como campo de negocio. Backend valida tipo contra el catálogo admitido y la propiedad real writable `gd:tipoDocumental`; construye exclusivamente `gd:clasificacion` y ese metadato. GET posterior verifica tipo, aspecto, UUID y PDF antes de confirmar. Período/prioridad son opcionales en este recorrido y se informa que no persisten. | Contrato real de adaptador React, HTTP con modelo simulado, lectura posterior, rechazo de propiedad/aspecto inyectados y resultado incierto con UUID si falla la comprobación posterior. |
| UTF-8 | Literales nuevos tenían signos `?` en lugar de letras acentuadas/separadores. | Se restauran Dirección, código, verificación, subordinación y separadores `·`. | `utf8.test.js` decodifica estrictamente todos los JSX productivos, detecta patrones de corrupción y exige los literales reparados. |

### Archivos de este cierre

- UUID: `src/alfrescoDispatchRepository.js` y `src/alfrescoDispatchRepository.test.js`.
- Destinatario: nuevo `src/genericCreation.js`, `src/index.js`, nuevo `src/genericCreation.integration.test.js`, `src/hierarchy.integration.test.js`, `frontend/src/App.jsx` y `frontend/src/api/alfresco.js`.
- Tiempo: `src/officialEmissionService.js` y `src/officialEmissionService.test.js`.
- Tipo: `src/pdfCreation.js`, `src/index.js`, `frontend/src/components/DocumentForm.jsx`, `frontend/src/utils/documentValidation.js` y sus pruebas, y `frontend/src/utils/institutionalSources.render.test.js`.
- UTF-8: `frontend/src/components/DocumentForm.jsx` y nuevo `frontend/src/utils/utf8.test.js`.

### Contrato genérico actualizado y compatibilidad

La selección incluye ID, dependencia y función esperados en `X-UAC-Recipient-User`, `X-UAC-Recipient-Dependency` y `X-UAC-Recipient-Role`. Son afirmaciones de selección que se contrastan con Alfresco; no conceden autoridad. El frontend actual los envía. Clientes anteriores sin dependencia/función deben actualizar su contrato: se rechazan explícitamente, no se completan con una suposición.

La relación usuario–carpeta sigue siendo el mapeo autorizado de despliegue, comprobado de nuevo frente al destinatario real y la carpeta actor-legible/creable. No se inventa una asociación Alfresco usuario–carpeta ni se afirma haber demostrado lectura del destinatario con sus credenciales. Si la institución quiere sustituir ese mapeo por una relación almacenada en Alfresco, requiere su contrato correspondiente.

`documentType` se admite como campo neutral, con los tipos de presentación ya utilizados por la aplicación; no se admiten `gd:tipoDocumental`, `aspectNames`, `properties` ni otros campos privilegiados del cliente. El tipo es obligatorio en el formulario actual. Se mantiene la carga básica sin tipo para compatibilidad de su contrato de PDF, sin atribuirle clasificación o numeración oficial. No existe fallback si se solicita tipo y el modelo no puede verificarse: esa creación se rechaza antes del POST.

Si el POST tipado se realiza pero el GET final no puede confirmar lo escrito, la API devuelve resultado incierto y UUID. El cliente lo conserva y muestra una carga genérica pendiente de verificación, sin llamarla distribución desde Emitidos ni permitir una segunda carga automática. La conciliación de una carga genérica incierta sigue siendo manual; la emisión oficial conserva su mecanismo idempotente existente.

Se mantienen bloqueadas las mismas decisiones institucionales: subordinación y códigos reales, prioridad documental/período persistentes, eventos históricos de distribución, revisión, aprobación y cierre. Estos cinco ajustes no resuelven esas decisiones ni habilitan flujos restringidos. No se modifican modelos, ACL, membresías, datos DEV, `.env.local` ni archivos operativos; sin commit o push.
