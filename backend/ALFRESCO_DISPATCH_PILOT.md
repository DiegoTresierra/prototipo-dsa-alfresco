# Piloto de persistencia documental en Alfresco

Preparado en `feature/jerarquia-despacho-interno`. No desplegado ni activado.
No se han ejecutado escrituras reales en DEV. La configuración existente no fue editada.

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
Las tres propiedades existentes son `d:text` singulares. `gd:asignaciones` no está desplegada.
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

### Preparación y respaldo (antes del despliegue futuro)

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
3. Los UUID autorizados son exclusivamente PDFs de prueba DEV y permanecen asociados directamente a por lo menos una de las carpetas institucionales configuradas. No moverlos durante el piloto.
4. `gd_distribucion` puede listar todas las carpetas configuradas y actualizar cada nodo de prueba. Tener permiso en una carpeta secundaria no demuestra permiso de actualizar el nodo. Verificar `allowableOperations: update` del nodo con esa cuenta; el PUT seguirá aplicando la ACL efectiva.
5. El emisor real puede leer el PDF y cumple rol, dependencia y autoridad de despacho. Jefatura necesita su asignación vigente. La cuenta técnica no reemplaza esa autorización.

Si no se puede verificar cualquiera de estos puntos, **mantener la escritura desactivada**.

Configurar en el entorno del proceso, sin modificar archivos de secretos durante esta entrega:

```text
DISPATCH_PERSISTENCE=alfresco
DISPATCH_ALFRESCO_WRITES_ENABLED=false
```

Primero probar las lecturas. En modo Alfresco, si el modelo falta, la API devuelve `DISPATCH_ALFRESCO_MODEL_NOT_READY`; no lee ni escribe `dispatches.json` como alternativa. Las pantallas muestran el error. No declarar migrados los registros anteriores.

Solo al completar las verificaciones y obtener aprobación para el primer PUT:

```text
DISPATCH_ALFRESCO_WRITES_ENABLED=true
DISPATCH_PILOT_ACK=single-instance-exclusive-writer-dev-test-documents
DISPATCH_PILOT_ALFRESCO_TARGET=<valor exacto del ALFRESCO_TARGET de DEV, sin barra final>
DISPATCH_PILOT_DOCUMENT_IDS_JSON=["<UUID real del PDF de prueba>"]
DISPATCH_PILOT_LEASE_PATH=<ruta absoluta local compartida por los posibles procesos del backend>
```

El último ajuste es opcional: por defecto `backend/data/dispatch-pilot.lock`. Iniciar un solo backend. El proceso rechaza la escritura habilitada sin reconocimiento, destino coincidente o UUID válidos; rechaza configuraciones habituales con varios workers y adquiere el archivo con creación exclusiva. Otro proceso usando la misma ruta no inicia. Una instancia en otra máquina, con otro archivo o que no ejecute estos controles **no queda protegida**.

Un cierre normal elimina el archivo; tras un fallo abrupto puede quedar. No borrarlo automáticamente ni por PID supuesto: verificar que el proceso terminó y que no hay otra instancia antes de retirarlo manualmente. La liberación al cerrar el servidor presupone que no quedan peticiones activas.

Con `DISPATCH_PERSISTENCE=local` se conserva provisionalmente el comportamiento anterior. Es una selección explícita previa al piloto; **no volver a local después de crear asignaciones en Alfresco**, porque mostraría datos antiguos y crearía dos historias. Respaldar el JSON para una migración posterior, sin borrarlo, mezclarlo automáticamente ni importarlo en esta entrega.

## Escritura y concurrencia

La ruta POST valida sesión/CSRF/rol/destinatarios. Dentro de la cola por UUID se comprueba la autoridad documental con la identidad real, incluidos padres secundarios y la consulta inversa de hijos cuando `/parents` devuelve 403. No se confía en carpeta o dependencia del frontend.

La cola cubre lectura, validación, incorporación, PUT y GET de verificación. Se libera con `finally`. Distintos UUID pueden progresar independientemente. El control anterior de peticiones simultáneas de la misma sesión puede devolver 409: reintentar con la misma clave, no crear otra solicitud.

El escritor técnico verifica su identidad habilitada/no administradora y el modelo, vuelve a comprobar la lectura del actor, obtiene el nodo vigente y exige `update`. Revalida el origen de Jefatura, agrega todas las asignaciones juntas y recalcula proyecciones. Antes de escribir relee para detectar cambios observables. El PUT incluye solo las tres propiedades nuevas y, si falta, añade `gd:tramite` preservando los aspectos actuales. El GET posterior compara el JSON y las proyecciones.

**La revisión del JSON no es CAS.** El GET previo no evita que otro proceso escriba justo después. La lectura posterior tampoco evita una sobrescritura posterior. El mutex solo protege esta instancia. No se usan locks de Alfresco, checkout ni copias de trabajo.

Un 403 detiene la operación sin modificar ACL. Un timeout, error de transporte o fallo de verificación puede ocurrir después del commit: se informa resultado desconocido/conflicto, nunca éxito ni rollback automático. Conservar la misma clave de reintento y consultar el nodo para resolverlo. No intentar restaurar una versión anterior sobre posibles cambios de otro escritor.

## Consulta sin esperar al índice

Las bandejas enumeran mediante GET paginado los hijos de las carpetas institucionales configuradas, incluyen asociaciones secundarias `cm:contains`, deduplican UUID y leen las propiedades de cada PDF con la identidad real del usuario. Luego filtran emisor/destinatario/rol/dependencia. Se reutiliza esta fuente para autorización, recibidos y enviados; no se consulta el JSON local ni el índice de búsqueda.

Un fallo de carpeta/paginación/modelo/JSON es visible, no una lista vacía. Un nodo denegado por la ACL del actor no se muestra. Límite de exploración: 10000 entradas, páginas de 100. No se recorren subcarpetas: el piloto exige conservar las asociaciones directas de los PDFs en las bandejas configuradas. Un documento retirado de todas ellas deja de descubrirse; no es pérdida del JSON del nodo, pero requiere detener/revisar el piloto. Esta estrategia es suficiente para pruebas pequeñas, no una solución escalable de búsqueda histórica.

## Primer PUT real: procedimiento futuro, no ejecutado

1. Elegir un PDF de prueba autorizado y respaldar su GET con `include=properties,aspectNames,allowableOperations`. Registrar hash del PDF y asociaciones actuales. Confirmar que no tiene asignaciones previas que deban migrarse desde JSON.
2. Desplegar/verificar el modelo y activar el piloto según los pasos anteriores. No ejecutar un PUT manual paralelo: el único escritor será el backend.
3. Iniciar sesión como Dirección de su dependencia; seleccionar dos destinatarios válidos del directorio dinámico. Registrar `documentId` y `requestKey`, nunca cookies/tokens.
4. Confirmar en React: `POST /api/documents/dispatch` con UUID, destinatarios, instrucción, prioridad y clave. El backend realiza `PUT /alfresco/api/-default-/public/alfresco/versions/1/nodes/{UUID}` y luego GET; no realiza otras escrituras.
5. Hacer GET del mismo nodo. Verificar JSON `schemaVersion:1`, `revision:1`, dos IDs individuales, un UUID común, historial y las proyecciones. Comprobar que `gd:estado`, singulares antiguas, PDF, otras propiedades/aspectos y asociaciones conservan sus valores.
6. Repetir exactamente la solicitud con la misma clave: mismos IDs y sin duplicados. Cambiar contenido con esa clave: 409.
7. Reiniciar **solo ese backend**, volver a navegar y actualizar bandejas de ambas jefaturas. Verificar lectura persistida, sin consultar `dispatches.json`.
8. Desde una jefatura, derivar a un especialista con `originAssignmentId`: ambas obligaciones originales permanecen. Confirmar que el especialista no deriva.
9. Probar dos sesiones de Dirección simultáneas sobre el mismo UUID y claves diferentes: deben persistir ambos despachos. Verificar denegaciones fuera de dependencia y ACL con mocks; no cambiar permisos reales para provocar errores.
10. Probar tamaños representativos en el mismo documento de prueba, inspeccionar la respuesta sin truncamiento. Si el repositorio/proxy rechaza tamaños menores al límite de aplicación, reducir el límite y repetir pruebas antes de ampliar el piloto.

## Reversión

Detener las escrituras y el backend antes de intervenir. Respaldar lo recién creado. Revertir la aplicación a lectura Alfresco con escritura desactivada; no reactivar el JSON viejo como si estuviera actualizado. Las propiedades nuevas pueden quedarse opcionales/sin uso: es la reversión menos invasiva del modelo. No desactivar ni eliminar `gd_uac` ni propiedades usadas. Si se requiere restaurar datos de prueba, hacerlo mediante procedimiento aprobado sobre esos UUID, comparando el respaldo y preservando cambios ajenos; esta entrega no lo automatiza. Una reversión integral usa el respaldo consistente del repositorio bajo administración del servidor.

## Evidencia y referencias

- DEV consultado mediante GET: ACS Community 26.2; modelo CMM activo, singulares existentes, propiedad nueva ausente y cuenta técnica no administradora. En el PDF inspeccionado la cuenta técnica tenía `update`; esto no prueba todos los UUID futuros.
- [Restricciones de edición de propiedades activas](https://docs.hyland.com/r/Alfresco/Alfresco-Content-Services/23.4/Alfresco-Content-Services/Configure/Content-models/Custom-types-aspects-and-properties/Manage-properties/Edit-a-property).
- [Implementación oficial CMM](https://github.com/Alfresco/alfresco-community-repo/blob/master/remote-api/src/main/java/org/alfresco/rest/api/impl/CustomModelsImpl.java): `updateTypeAspect`, `mergeProperties`, `validateActivePropertyUpdate`. `select=props` agrega sin reemplazar las anteriores; los cambios de multiplicidad activos se rechazan.
- [Pruebas oficiales CMM](https://github.com/Alfresco/alfresco-community-repo/blob/master/remote-api/src/test/java/org/alfresco/rest/api/tests/BaseCustomModelApiTest.java): ámbito privado y `?select=props`.
- [Almacenamiento oficial de propiedades largas](https://github.com/Alfresco/alfresco-community-repo/blob/master/repository/src/main/java/org/alfresco/repo/domain/node/NodePropertyValue.java): `ValueType.STRING.getPersistedType` contempla serialización; no establece el máximo operativo de este DEV.

Los contratos del código fuente de referencia requieren verificación real después de desplegar; no se ejecutó el PUT CMM ni el PUT documental durante esta entrega.

## Archivos de esta entrega

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

## Validación de esta entrega (2026-11-17)

- `node --test backend/src/*.test.js frontend/src/utils/*.test.js`: **72 aprobadas, 0 fallidas**. Escrituras y fallos de Alfresco simulados; almacenamiento de pruebas aislado.
- `npm run lint` en `frontend`: aprobado.
- `npm run build` en `frontend`: aprobado.
- `node backend/scripts/prepare-dispatch-model.mjs`: preflight GET real aprobado; confirmó las tres propiedades faltantes, sin PUT.
- Configuración efectiva al terminar: `dispatchPersistence=local`, `alfrescoWritesEnabled=false`. No se activó la migración.
- HEAD conservado: `b8a41e8cd990760963a251bb7c324bdbb351e704`; sin commit, push, merge ni cambio de rama.

Las pruebas cubren reinicio del repositorio simulado, nuevas lecturas al volver a cargar la bandeja, PUT/GET, múltiples responsables, derivación encadenada, cola concurrente, reintentos, denegaciones, errores de transporte, proyecciones incoherentes, modelo ausente y una demostración de pérdida por escritor externo. No sustituyen una prueba real de reinicio/navegación en el navegador contra DEV: permanece pendiente junto con el despliegue, tamaño efectivo de almacenamiento y primer PUT autorizado.
