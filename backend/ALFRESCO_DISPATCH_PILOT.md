# Piloto de persistencia documental en Alfresco

Ajuste vigente en `feature/jerarquia-despacho-interno`: se utilizan exclusivamente las bandejas institucionales existentes de DTI y DSA. El usuario confirmó previamente PUT/GET real y persistencia tras reiniciar.
No se exige una carpeta de prueba ni una lista de UUID documentales. No se crean carpetas, asociaciones ni copias. Esto amplía expresamente el alcance de escritura a **cualquier PDF autorizado de las bandejas institucionales**, incluidos documentos reales si el operador los selecciona: ya no existe una separación técnica por carpeta de prueba.
Durante este ajuste no se ejecutaron escrituras reales, cambios del modelo ni de permisos. `.env.local` no fue editado. Las escrituras permanecen deshabilitadas por defecto y requieren una confirmación nueva y específica por entorno.

## Contrato y límites

- Un PDF y UUID. No se crean nodos, asociaciones, copias, carpetas ni versiones de trabajo.
- `gd:asignaciones` es la fuente de verdad, JSON `schemaVersion: 1`, `revision`, `documentId`, `dispatches`, `history`.
- Cada despacho contiene `id`, `requestKey`, emisor/rol/dependencia, fecha, instrucción, prioridad, `originAssignmentId` y destinatarios.
- Cada destinatario conserva su ID de asignación, UUID, despacho, usuario/rol/dependencia, emisor, instrucción, fecha y estado. `unit` es opcional, nunca se deduce del usuario.
- El historial registra actor, fecha, despacho e IDs de todas las asignaciones creadas; permite reconstruir la creación individual.
- Los estados vigentes son `ASIGNADO` y `DESPACHADO`. El lector admite `ATENDIDO` y `ANULADO`; esta entrega no añade operaciones para cerrar/anular ni inventa reglas de transición.
- Una derivación hija no cierra la obligación original. Las proyecciones reúnen todos los destinatarios vigentes, sin principal y sin arreglos paralelos.
- No se escribe `gd:estado`, `gd:responsableActual` ni `gd:dependenciaResponsableActual`. No se implementa sincronización del estado global.
- La clave de idempotencia tiene alcance `(UUID, usuario emisor, requestKey)`. Un reintento idéntico retorna los mismos IDs; diferente contenido produce 409.
- El documento completo tiene límite de **262144 bytes UTF-8** en `gd:asignaciones`. No se recorta historial. Un exceso devuelve 413 antes del PUT.

El almacenamiento de cadenas largas de ACS contempla serialización cuando exceden la columna de cadena; esto no garantiza cualquier tamaño en esta instalación. El límite anterior es de la aplicación, no una afirmación sobre el máximo de DEV. Falta probar con un PDF de prueba tamaños representativos y cercanos al límite, después de autorizar escrituras. El JSON se define sin indexación: no depende de tokenización ni de límites del índice.

## Modelo preparado: actualización aditiva CMM

La inspección GET identificó `gd_uac`, ACTIVE, namespace `https://uandina.edu.pe/model/gd/1.0`, prefijo `gd`, aspecto `tramite`.
Las tres propiedades originales son `d:text` singulares. En la inspección inicial `gd:asignaciones` aún no estaba desplegada; el usuario confirmó posteriormente la persistencia real. No se vuelve a desplegar ni se modifica el modelo en esta ampliación.
CMM impide cambiar la multiplicidad de propiedades de un modelo activo. No desactivar el modelo para forzar la conversión.

Archivo de despliegue: `backend/alfresco-model/gd-tramite-dispatch.cmm.json`.
Es un **parche CMM aditivo**, no un modelo XML independiente ni un reemplazo de `gd_uac`.

| Propiedad nueva | Tipo | Multivalor | Índice |
| --- | --- | --- | --- |
| `gd:asignaciones` | `d:text` | no | no |
| `gd:responsablesActuales` | `d:text` | sí | exacto |
| `gd:dependenciasResponsablesActuales` | `d:text` | sí | exacto |

Las proyecciones contienen IDs institucionales reales de usuarios y dependencias normalizadas (`dsa`, `dti`), únicos. La relación entre ellos permanece dentro del JSON.

Se usa la API **privada CMM** ya existente, no se instala una extensión. Su compatibilidad debe revisarse al actualizar ACS.

### Preparación y respaldo (referencia del despliegue inicial)

1. Detener los despachos y comprobar el destino DEV. No usar documentos institucionales reales como pruebas.
2. Respaldar de forma consistente base de datos y contentstore con el procedimiento del servidor. Conservar también el modelo completo y metadatos/aspectos de los UUID de prueba. Una respuesta CMM JSON no sustituye ese respaldo del repositorio.
3. Ejecutar desde la raíz `node backend/scripts/prepare-dispatch-model.mjs`. Por defecto solo hace GET, presenta propiedades faltantes y no cambia archivos ni Alfresco.
4. El script lee `GET /alfresco/api/-default-/private/alfresco/versions/1/cmm/gd_uac?select=all` y `GET .../cmm/gd_uac/aspects/tramite`. Rechaza otro namespace, modelo inactivo y definiciones incompatibles. Si todas las propiedades ya coinciden, no necesita PUT.
5. Para desplegar, el operador necesita una identidad **ya autorizada** en `ALFRESCO_MODEL_ADMINISTRATORS`. `gd_distribucion` no debe recibir esa pertenencia. No se solicita ni configura una cuenta administrativa nueva.

### Despliegue futuro: requiere autorización independiente

En una terminal privada, proporcionar temporalmente `ALFRESCO_MODEL_AUTHORIZATION` (cabecera Basic/Bearer de la identidad autorizada, sin pegarla en comandos compartidos ni logs). Definir `DISPATCH_MODEL_BACKUP_DIR` a un directorio protegido de respaldo.

Ejecutar **solo después de aprobar el despliegue**:

```powershell
node backend/scripts/prepare-dispatch-model.mjs --apply
```

El script guarda un respaldo JSON completo con nombre nuevo, añade únicamente las propiedades faltantes mediante:

`PUT /alfresco/api/-default-/private/alfresco/versions/1/cmm/gd_uac/aspects/tramite?select=props`

El cuerpo contiene `name: tramite` y las nuevas propiedades con nombres locales. No usar `update`, `delete`, cambio de estado del modelo ni un PUT que reemplace su definición completa. Luego comprueba mediante GET el contrato añadido y la conservación de las propiedades originales. Ante cualquier error, detenerse; no desactivar/borrar el modelo automáticamente.

Comprobar adicionalmente:

- `GET /alfresco/api/-default-/private/alfresco/versions/1/cmm/gd_uac`: `ACTIVE`.
- `GET /alfresco/service/api/classes/gd_tramite`: las tres propiedades nuevas con `d:text`, multiplicidades esperadas y JSON no indexado.
- Las propiedades singulares y todos los otros aspectos permanecen iguales al respaldo.

No hace falta reiniciar el servidor para una adición CMM validada; si la instalación rechaza el cambio, revisar el error de esa versión, no forzar un despliegue estático con el mismo namespace.

## Activación del piloto: desactivada actualmente

Antes de habilitar, un operador debe verificar y registrar:

1. Solo un proceso Express activo: sin cluster de Node, workers, réplicas, PM2 cluster ni otro despliegue en otra máquina.
2. Nadie modifica `gd:asignaciones` o las dos proyecciones desde Share, REST, scripts, integraciones o herramientas administrativas. El proxy de esta aplicación no expone PUT genérico de metadatos. La ausencia de escritores externos **no puede demostrarse desde Express**: requiere control operativo y revisión de integraciones.
3. Revisar los documentos que se utilizarán y aceptar expresamente que el alcance incluye todos los PDFs autorizados de las bandejas institucionales. No se distingue automáticamente un documento real de uno de prueba. Usar las asociaciones institucionales existentes, primarias o secundarias `cm:contains`, sin añadir ubicaciones ni copiar el PDF. Verificar los IDs actuales de `ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON` en el repositorio seleccionado.
4. `gd_distribucion` puede listar todas las carpetas configuradas y actualizar cada nodo de prueba. Tener permiso en una carpeta secundaria no demuestra permiso de actualizar el nodo. Verificar `allowableOperations: update` del nodo con esa cuenta; el PUT seguirá aplicando la ACL efectiva.
5. El emisor real puede leer el PDF y cumple rol, dependencia y autoridad de despacho. Jefatura necesita su asignación vigente. La cuenta técnica no reemplaza esa autorización.

Si no se puede verificar cualquiera de estos puntos, **mantener la escritura desactivada**.

Configurar en el entorno del proceso, sin modificar archivos de secretos durante esta entrega:

```text
DISPATCH_PERSISTENCE=alfresco
DISPATCH_ALFRESCO_WRITES_ENABLED=false
```

Primero probar las lecturas. En modo Alfresco, si el modelo falta, la API devuelve `DISPATCH_ALFRESCO_MODEL_NOT_READY`; no lee ni escribe `dispatches.json` como alternativa. Las pantallas muestran el error. No declarar migrados los registros anteriores.

Eliminar manualmente estas dos variables obsoletas de `.env.local`; el backend no las lee, ni siquiera para validar su JSON:

- `DISPATCH_PILOT_TEST_FOLDER_IDS_JSON`
- `DISPATCH_PILOT_DOCUMENT_IDS_JSON`

No añadir otros UUID ni carpetas a la configuración. Mantener el mapeo institucional existente `ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON`, los grupos y las credenciales actuales. No volver a modo local después de persistir en Alfresco.

Solo al completar las verificaciones anteriores, revisar los documentos seleccionados y autorizar las pruebas manuales en **DEV**, configurar:

```text
DISPATCH_ALFRESCO_WRITES_ENABLED=true
DISPATCH_PILOT_ENVIRONMENT=dev
DISPATCH_PILOT_ACK=single-instance-exclusive-writer-dev-institutional-documents
DISPATCH_PILOT_ALFRESCO_TARGET=<valor exacto del ALFRESCO_TARGET de DEV, sin barra final>
DISPATCH_PREPROD_WRITES_ENABLED=false
DISPATCH_PILOT_LEASE_PATH=<ruta absoluta local compartida por los posibles procesos del backend>
```

La confirmación antigua `single-instance-exclusive-writer-dev-test-documents` ya no es válida. Debe confirmarse el nuevo alcance institucional y seleccionarse explícitamente `dev`; dejar la variable de entorno vacía o cambiar únicamente `ALFRESCO_TARGET` no autoriza escrituras. El destino debe ser HTTPS, sin credenciales, consulta, fragmento ni ruta adicional. El ejemplo actualizado está en `backend/.env.example`; sus valores vacíos y escritura `false` no activan el piloto.

La ruta de lease es opcional: por defecto `backend/data/dispatch-pilot.lock`. Iniciar un solo backend. El proceso rechaza escritura habilitada sin entorno reconocido, confirmación, destino coincidente o bandejas institucionales configuradas. Rechaza configuraciones habituales con varios workers y adquiere el archivo con creación exclusiva. Registra entorno, destino y bandejas institucionales en `[dispatch-pilot]` y en el lease, sin credenciales. Otro proceso usando la misma ruta no inicia. Una instancia en otra máquina, con otro archivo o que no ejecute estos controles **no queda protegida**.

### Preproducción: habilitación independiente

Antes de trasladar: verificar mediante GET el modelo existente, los grupos, las bandejas institucionales y los permisos efectivos de usuarios y de `gd_distribucion` en **ese repositorio**. No copiar ciegamente IDs DEV ni aplicar ACL automáticamente. No se prepara una estructura de carpetas alternativa. La adaptación de valores de la configuración institucional a los IDs reales de preproducción forma parte de la configuración normal del entorno.

Mantener deshabilitada la escritura durante esas verificaciones. Solo después de una autorización específica para preproducción, configurar:

```text
DISPATCH_PERSISTENCE=alfresco
DISPATCH_ALFRESCO_WRITES_ENABLED=true
DISPATCH_PILOT_ENVIRONMENT=preprod
DISPATCH_PREPROD_WRITES_ENABLED=true
DISPATCH_PREPROD_ACK=single-instance-exclusive-writer-preprod-institutional-documents
DISPATCH_PREPROD_ALFRESCO_TARGET=<valor exacto del ALFRESCO_TARGET de preproducción>
```

El perfil `preprod` no utiliza `DISPATCH_PILOT_ACK` ni `DISPATCH_PILOT_ALFRESCO_TARGET` como sustitutos. Necesita su interruptor adicional, su confirmación distinta y su destino exacto; si el destino preproducción coincide con el destino DEV configurado, se rechaza. Cambiar solo `ALFRESCO_TARGET` o el selector de entorno no es suficiente. Nunca registrar secretos al comprobar estos valores. El mutex continúa siendo local también en preproducción: una sola instancia, sin escritores externos. No hay habilitación de producción en este mecanismo.

Un cierre normal elimina el archivo; tras un fallo abrupto puede quedar. No borrarlo automáticamente ni por PID supuesto: verificar que el proceso terminó y que no hay otra instancia antes de retirarlo manualmente. La liberación al cerrar el servidor presupone que no quedan peticiones activas.

El modo por defecto es `alfresco`, con escritura deshabilitada: nunca se recurre al JSON local por un error de lectura, modelo, permiso o configuración. El modo explícito `local` queda para compatibilidad y pruebas heredadas; **no volver a local después de crear asignaciones en Alfresco**, porque mostraría datos antiguos y crearía dos historias. Respaldar el JSON para una migración posterior, sin borrarlo, mezclarlo automáticamente ni importarlo en esta entrega.

## Escritura y concurrencia

La ruta POST valida sesión/CSRF/rol/destinatarios. Dentro de la cola por UUID se comprueba la autoridad documental con la identidad real, incluidos padres secundarios y la consulta inversa de hijos cuando `/parents` devuelve 403. No se confía en carpeta o dependencia del frontend.

Además, `verifyPilotDocumentScope` exige un PDF de tipo `cm:content` y prueba su pertenencia a una bandeja configurada para la dependencia de la sesión mediante GET paginado de hijos (`include=association`) con la identidad del actor, para Dirección y Jefatura. Solo acepta `cm:contains`; las asociaciones primaria y secundaria son válidas. No confía en nombres de archivo, títulos, sufijos de usuario, `parentId` primario ni parámetros de React para autorizar el documento. No se admiten carpetas, otros MIME ni subtipos documentales no verificados. Una asignación previa no sustituye la pertenencia institucional. Los reintentos idempotentes también revalidan el alcance antes de devolver el registro existente.

La autorización ya no incluye una clasificación «de prueba». La confirmación por entorno acepta ese alcance ampliado y la responsabilidad del operador sobre los documentos utilizados. Esta entrega solo prueba escrituras con mocks; no se ejecutan PUT reales. La aplicación no añade asociaciones ni concede permisos al comprobar pertenencia.

La cola cubre lectura, validación, incorporación, PUT y GET de verificación. Se libera con `finally`. Distintos UUID pueden progresar independientemente. El control anterior de peticiones simultáneas de la misma sesión puede devolver 409: reintentar con la misma clave, no crear otra solicitud.

El escritor técnico verifica su identidad habilitada/no administradora y el modelo, vuelve a comprobar la lectura del actor, obtiene el nodo vigente y exige `update`. Revalida el origen de Jefatura, agrega todas las asignaciones juntas y recalcula proyecciones. Antes de escribir relee para detectar cambios observables. El PUT incluye solo las tres propiedades nuevas y, si falta, añade `gd:tramite` preservando los aspectos actuales. El GET posterior compara el JSON y las proyecciones.

**La revisión del JSON no es CAS.** El GET previo no evita que otro proceso escriba justo después. La lectura posterior tampoco evita una sobrescritura posterior. El mutex solo protege esta instancia. No se usan locks de Alfresco, checkout ni copias de trabajo.

Un 403 detiene la operación sin modificar ACL. Un timeout, error de transporte o fallo de verificación puede ocurrir después del commit: se informa resultado desconocido/conflicto, nunca éxito ni rollback automático. Conservar la misma clave de reintento y consultar el nodo para resolverlo. No intentar restaurar una versión anterior sobre posibles cambios de otro escritor.

## Consulta sin esperar al índice

Las bandejas enumeran mediante GET paginado los hijos de las carpetas institucionales configuradas, incluyen asociaciones secundarias `cm:contains`, deduplican UUID y leen las propiedades de cada PDF con la identidad real del usuario. Luego filtran emisor/destinatario/rol/dependencia. Se reutiliza esta fuente para autorización, recibidos y enviados; no se consulta el JSON local ni el índice de búsqueda.

Dirección recibe los despachos de su dependencia, incluidos los creados por Jefatura, para representar todos los responsables; la lista de enviados sigue siendo propia del emisor. La respuesta informa `persistence: alfresco|local`. El indicador oficial y «Ya asignado» solo usan registros cuya procedencia de respuesta es Alfresco; un registro provisional no se presenta como persistencia real. Esto no cambia la autorización de lectura ni la capacidad de derivación.

El desplegable conserva todos los destinatarios válidos y añade «Ya asignado» a quienes tengan alguna asignación individual `ASIGNADO` o `DESPACHADO` sobre el UUID. `ANULADO` y `ATENDIDO` no se consideran vigentes; `gd:estado` y el estado global del despacho no se utilizan para inferir responsabilidad individual. «Para mí» sigue siendo una selección personal local y no obtiene esa etiqueta. El PUT exitoso devuelve datos verificados y actualiza la pantalla inmediatamente; navegar o actualizar vuelve a consultar Alfresco.

No se cambian reglas de duplicados: una misma clave reintenta el mismo despacho; otra clave puede generar una nueva obligación incluso para un destinatario vigente. «Ya asignado» informa, no bloquea ni elimina destinatarios. Varios encargos del mismo usuario se representan con una sola etiqueta/segmento visual por usuario, conservando todos los registros individuales en Alfresco.

La franja vigente es de 11 px y compensa su margen para conservar el ancho total. El fondo usa los mismos colores al 6%, con segmentos equivalentes por usuario y sin reducir la opacidad del texto. La función de color mezcla el ID completo para distinguir sufijos similares. La validación de lectura y de la aplicación compilada en Edge, con capturas de escritorio/móvil, está en [ASSIGNMENT_READ_DIAGNOSIS.md](ASSIGNMENT_READ_DIAGNOSIS.md).

Un fallo de carpeta/paginación/modelo/JSON es visible, no una lista vacía. Un nodo denegado por la ACL del actor no se muestra. Límite de exploración: 10000 entradas, páginas de 100. No se recorren subcarpetas: el piloto exige conservar las asociaciones directas de los PDFs en las bandejas configuradas. Un documento retirado de todas ellas deja de descubrirse; no es pérdida del JSON del nodo, pero requiere detener/revisar el piloto. Esta estrategia es suficiente para pruebas pequeñas, no una solución escalable de búsqueda histórica.

## Prueba manual de la ampliación: no ejecutada durante esta entrega

1. Revisar y seleccionar dos PDFs apropiados de las bandejas existentes, verificar su pertenencia institucional y respaldar sus GET con `include=properties,aspectNames,allowableOperations`. Registrar hash de los PDFs y asociaciones actuales. No registrar sus UUID en variables de entorno. Confirmar que no hay asignaciones previas que deban migrarse desde JSON. La selección es responsabilidad del operador: el backend no distingue PDFs reales de PDFs de prueba.
2. Verificar el modelo ya desplegado y habilitar expresamente DEV según los pasos anteriores; no redesplegar el modelo ni añadir carpetas o asociaciones. No ejecutar un PUT manual paralelo: el único escritor será el backend.
3. Iniciar sesión como Dirección de su dependencia; seleccionar dos destinatarios válidos del directorio dinámico. Registrar `documentId` y `requestKey`, nunca cookies/tokens.
4. Confirmar en React: `POST /api/documents/dispatch` con UUID, destinatarios, instrucción, prioridad y clave. El backend realiza `PUT /alfresco/api/-default-/public/alfresco/versions/1/nodes/{UUID}` y luego GET; no realiza otras escrituras.
5. Hacer GET del mismo nodo. Verificar JSON `schemaVersion:1`, `revision:1`, dos IDs individuales, un UUID común, historial y las proyecciones. Comprobar que `gd:estado`, singulares antiguas, PDF, otras propiedades/aspectos y asociaciones conservan sus valores.
6. Repetir exactamente la solicitud con la misma clave: mismos IDs y sin duplicados. Cambiar contenido con esa clave: 409.
7. Reiniciar **solo ese backend**, volver a navegar y actualizar bandejas de ambas jefaturas. Verificar lectura persistida, sin consultar `dispatches.json`.
8. Desde una jefatura, derivar a un especialista con `originAssignmentId`: ambas obligaciones originales permanecen. Confirmar que el especialista no deriva.
9. Probar dos sesiones de Dirección simultáneas sobre el mismo UUID y claves diferentes: deben persistir ambos despachos. Verificar denegaciones fuera de dependencia y ACL con mocks; no cambiar permisos reales para provocar errores.
10. Probar tamaños representativos en el mismo documento de prueba, inspeccionar la respuesta sin truncamiento. Si el repositorio/proxy rechaza tamaños menores al límite de aplicación, reducir el límite y repetir pruebas antes de ampliar el piloto.
11. Despachar el segundo PDF sin cambiar la configuración. Comprobar «Ya asignado», varios colores y fondo tenue. Navegar, recargar y reiniciar solo ese backend: las etiquetas deben permanecer. Un PDF de otra dependencia sin asociación institucional verificada debe devolver 403 sin PUT; los casos negativos se cubren con mocks, sin intentar modificar documentos reales.

## Reversión

Detener las escrituras y el backend antes de intervenir. Respaldar lo recién creado. Revertir la aplicación a lectura Alfresco con escritura desactivada; no reactivar el JSON viejo como si estuviera actualizado. Las propiedades nuevas pueden quedarse opcionales/sin uso: es la reversión menos invasiva del modelo. No desactivar ni eliminar `gd_uac` ni propiedades usadas. Si se requiere restaurar datos de prueba, hacerlo mediante procedimiento aprobado sobre esos UUID, comparando el respaldo y preservando cambios ajenos; esta entrega no lo automatiza. Una reversión integral usa el respaldo consistente del repositorio bajo administración del servidor.

## Evidencia y referencias

- DEV consultado mediante GET: ACS Community 26.2; modelo CMM activo, singulares existentes, propiedad nueva ausente y cuenta técnica no administradora. En el PDF inspeccionado la cuenta técnica tenía `update`; esto no prueba todos los UUID futuros.
- [Restricciones de edición de propiedades activas](https://docs.hyland.com/r/Alfresco/Alfresco-Content-Services/23.4/Alfresco-Content-Services/Configure/Content-models/Custom-types-aspects-and-properties/Manage-properties/Edit-a-property).
- [Implementación oficial CMM](https://github.com/Alfresco/alfresco-community-repo/blob/master/remote-api/src/main/java/org/alfresco/rest/api/impl/CustomModelsImpl.java): `updateTypeAspect`, `mergeProperties`, `validateActivePropertyUpdate`. `select=props` agrega sin reemplazar las anteriores; los cambios de multiplicidad activos se rechazan.
- [Pruebas oficiales CMM](https://github.com/Alfresco/alfresco-community-repo/blob/master/remote-api/src/test/java/org/alfresco/rest/api/tests/BaseCustomModelApiTest.java): ámbito privado y `?select=props`.
- [Almacenamiento oficial de propiedades largas](https://github.com/Alfresco/alfresco-community-repo/blob/master/repository/src/main/java/org/alfresco/repo/domain/node/NodePropertyValue.java): `ValueType.STRING.getPersistedType` contempla serialización; no establece el máximo operativo de este DEV.

Los contratos del código fuente de referencia requieren verificación real después de desplegar; no se ejecutó el PUT CMM ni el PUT documental durante esta entrega.

## Archivos de la entrega inicial

Nuevos:

- `backend/alfresco-model/gd-tramite-dispatch.cmm.json`: adiciones al aspecto existente.
- `backend/scripts/prepare-dispatch-model.mjs`: preflight GET y despliegue futuro explícito con respaldo.
- `backend/src/dispatchModelPlan.js` y su prueba: contrato CMM y detección de conflictos.
- `backend/src/alfrescoDispatchRepository.js` y su prueba: JSON versionado, proyecciones, PUT/GET, idempotencia y lecturas autoritativas.
- `backend/src/dispatchRepository.js`: selección explícita local/Alfresco, sin fallback.
- `backend/src/documentQueue.js` y su prueba: exclusión por UUID en este proceso.
- `backend/src/dispatchPilot.js`: requisitos de activación y archivo exclusivo de proceso.
- `backend/src/alfrescoDispatch.integration.test.js`: flujo HTTP completo con Alfresco simulado.
- `frontend/src/utils/dispatchPersistence.js` y su prueba: errores visibles y agregación de responsables equivalentes.
- Este documento.

Adaptados, conservando los cambios anteriores:

- `.gitignore`: excluir lease y respaldos locales.
- `backend/src/config.js`: configuración del piloto, sin editar `.env.local`.
- `backend/src/index.js`: repositorio seleccionado, espera asíncrona, cola que incluye autorización, cierre del lease.
- `backend/src/documentReadPolicy.js`: consulta asíncrona de asignaciones, manteniendo la ACL obligatoria.
- `frontend/src/App.jsx`, `hooks/useAssignmentInbox.js`: volver a consultar al navegar.
- `frontend/src/api/alfresco.js`, `utils/assignmentInbox.js`: mensajes específicos de persistencia.
- `frontend/src/pages/DirectorPage.jsx`: agregar responsables de todos los despachos, incluso de la misma unidad.
- `frontend/src/utils/assignmentViews.test.js`: mock HTTP con cuerpo de error realista.
- `frontend/src/utils/dispatchRecipients.render.test.js`: representación de todos los responsables registrados.

El bloque de distribución DTI–DSA conserva su contenido: SHA256 normalizando finales de línea a LF `70a0209b17447e4b66f975ed56d53ffa134d57ba897ed70114596fef3ab643ff`.

## Validación de la entrega inicial (histórica, 2026-11-17)

- `node --test backend/src/*.test.js frontend/src/utils/*.test.js`: **72 aprobadas, 0 fallidas**. Escrituras y fallos de Alfresco simulados; almacenamiento de pruebas aislado.
- `npm run lint` en `frontend`: aprobado.
- `npm run build` en `frontend`: aprobado.
- `node backend/scripts/prepare-dispatch-model.mjs`: preflight GET real aprobado; confirmó las tres propiedades faltantes, sin PUT.
- Configuración efectiva al terminar: `dispatchPersistence=local`, `alfrescoWritesEnabled=false`. No se activó la migración.
- HEAD conservado: `b8a41e8cd990760963a251bb7c324bdbb351e704`; sin commit, push, merge ni cambio de rama.

Las pruebas cubren reinicio del repositorio simulado, nuevas lecturas al volver a cargar la bandeja, PUT/GET, múltiples responsables, derivación encadenada, cola concurrente, reintentos, denegaciones, errores de transporte, proyecciones incoherentes, modelo ausente y una demostración de pérdida por escritor externo. No sustituyen una prueba real de reinicio/navegación en el navegador contra DEV: permanece pendiente junto con el despliegue, tamaño efectivo de almacenamiento y primer PUT autorizado.

## Archivos y validación de la ampliación anterior (histórica; sustituida por el ajuste vigente)

Cambios backend:

- `backend/src/dispatchPilotScope.js` (nuevo) y `dispatchPilotScope.test.js` (nuevo): doble pertenencia comprobada con GET y credenciales del actor, sin lista documental.
- `backend/src/config.js`, `dispatchPilot.js`: carpetas exclusivas de prueba, validación del destino HTTPS sin credenciales en URL, registro del ámbito y conservación del lease.
- `backend/src/alfrescoDispatchRepository.js`: control de alcance antes del PUT y del reintento; consulta de responsabilidades de toda la dependencia para Dirección.
- `backend/src/index.js`: procedencia explícita de persistencia en GET/POST y revalidación del alcance en reintentos Alfresco.
- `backend/src/alfrescoDispatchRepository.test.js`, `alfrescoDispatch.integration.test.js`: segundo PDF sin registro, exclusión de reales/ajenos, ACL, responsabilidades, idempotencia y lease.
- `backend/src/dispatch.integration.test.js`, `documentDelivery.integration.test.js`: aislamiento explícito del modo provisional en pruebas heredadas, sin depender de la configuración real del piloto.
- `backend/.env.example` y esta guía: variables definitivas e instrucciones manuales.

Cambios frontend:

- `frontend/src/pages/DirectorPage.jsx`, `App.css`: «Ya asignado», franja y fondo para asignaciones Alfresco vigentes.
- `frontend/src/api/alfresco.js`, `utils/dispatchPersistence.js`: procedencia Alfresco, filtro de estados individuales y colores equivalentes.
- `frontend/src/App.jsx`: actualización inmediata y protección frente a un GET anterior que termine después del POST.
- `frontend/src/utils/dispatchPersistence.test.js`, `dispatchRecipients.render.test.js`: usuarios vigentes/anulados, varios equivalentes, recarga de datos, exclusión de provisional y «Para mí», renderizado del indicador.

Validación automatizada: **80 pruebas aprobadas, 0 fallidas**; lint y build del frontend aprobados. Todas las escrituras de prueba fueron mocks, con almacenamiento aislado. La suite conserva las pruebas de exclusión por UUID, reintentos, reinicio del repositorio simulado y regresión de distribución DTI–DSA.

La confirmación real previa de PUT/GET y reinicio fue proporcionada por el usuario. En esta ampliación no se volvió a escribir en DEV ni se modificó el modelo. Quedan pendientes la elección/verificación de carpetas exclusivas ya existentes, actualizar manualmente la configuración, reiniciar un único backend y probar dos PDFs no institucionales y el aspecto visual en el navegador, incluido móvil. El mutex continúa sin garantía entre procesos o frente a escritores externos.

## Resultado del ajuste definitivo: estructura institucional existente

Este apartado y las instrucciones operativas anteriores sustituyen el requisito histórico de carpeta de prueba. No hay lista de documentos ni otra ubicación obligatoria. El alcance son los PDFs `cm:content` con pertenencia institucional `cm:contains` verificada para la dependencia de la sesión. La confirmación del operador acepta expresamente que pueden ser documentos reales: la habilitación no los excluye automáticamente.

Archivos modificados en este ajuste, conservando las modificaciones locales de entregas anteriores:

- `backend/src/dispatchPilotScope.js`: elimina la segunda pertenencia; conserva la verificación paginada con credenciales del actor, tipo PDF y rol.
- `backend/src/dispatchPilot.js`: valida perfil DEV/preproducción, destino, confirmación e inventario institucional; mantiene exclusión de proceso y registro del ámbito.
- `backend/src/config.js`: elimina la lectura de ambas variables obsoletas y configura perfiles independientes. Alfresco es el modo por defecto; las escrituras son `false` por defecto.
- `backend/src/dispatchPilot.test.js` (nuevo): configuración segura por defecto, perfiles independientes, rechazo del destino DEV como preproducción y ausencia de dependencia de UUID/carpetas adicionales.
- `backend/src/dispatchPilotScope.test.js`, `alfrescoDispatchRepository.test.js`, `alfrescoDispatch.integration.test.js`: alcance institucional, primarias/secundarias, rechazo de ajenos o usuarios sin autoridad, permisos, reintentos y conservación de datos.
- `backend/.env.example`: configuración actual y variables que deben eliminarse manualmente.
- `frontend/src/utils/dispatchPersistence.js`: mensajes de configuración institucional y de entorno, sin errores de carpetas de prueba.
- Esta guía: activación DEV, habilitación independiente de preproducción, alcance ampliado y límites.

Validación: **84 pruebas aprobadas, 0 fallidas**, `npm run lint` y `npm run build` del frontend aprobados. Las escrituras son exclusivamente mocks. Las pruebas mantienen la cobertura de múltiples responsables equivalentes, obligaciones originales, asignaciones existentes, mutex por UUID, idempotencia, reinicio del repositorio simulado y distribución DTI–DSA. El renderizado de «Ya asignado», franja y fondo continúa validándose con los mismos datos persistidos.

El modelo, las propiedades, el JSON versionado, las ACL y el contenido del bloque de distribución DTI–DSA no se alteran. `.env.local` no se modifica. No se ejecutan escrituras reales, commit, push ni merge. Quedan pendientes la actualización manual de variables, la confirmación del operador sobre el entorno/documentos y la validación manual del ajuste. Antes de preproducción, verificar además modelo, grupos, IDs institucionales y permisos de ese repositorio mediante GET y conservar una sola instancia activa.
