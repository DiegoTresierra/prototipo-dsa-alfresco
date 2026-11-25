# Persistencia y piloto DSA de tiempos de respuesta

## Estado y alcance

El modelo contiene un solo tipo, `gdc:tiemposRespuesta`, y se usa un solo contenedor `GD_CONFIGURACION_TIEMPOS_RESPUESTA`. No hay auditoría independiente. El nodo conserva la revisión, último `operationId`, Director responsable y fecha de última modificación. La decisión de retirar el historial detallado implica que no se conserva una secuencia de versiones anteriores.

La configuración de piloto se encuentra deshabilitada por defecto. Con `ALFRESCO_RESPONSE_TIMES_WRITES_ENABLED=false` o `ALFRESCO_RESPONSE_TIMES_SINGLE_INSTANCE_PILOT_ENABLED=false`, no se adquiere un bloqueo y `capabilities.edit` permanece falso. El diagnóstico y las pruebas de esta etapa no ejecutan escrituras reales.

GET no crea nodos. Si no existe una configuración para la dependencia de la sesión, devuelve NORMAL 5 DIAS, ALTA 3 DIAS y URGENTE 1 DIA. Si Alfresco se configuró y falla una consulta, el BFF devuelve un error y no cae a JSON ni memoria.

## Modelo y contenedor

Modelo `gd_configuracion_institucional`, prefijo `gdc`, independiente de `gd_organizacion`. El tipo `gdc:tiemposRespuesta` deriva de `cm:content` y tiene:

| Propiedad | Tipo | Uso |
| --- | --- | --- |
| `gdc:codigoDependencia` | `d:text` | Código institucional indexable |
| `gdc:normalValor` / `gdc:normalUnidad` | `d:int` / `d:text` | Prioridad NORMAL |
| `gdc:altaValor` / `gdc:altaUnidad` | `d:int` / `d:text` | Prioridad ALTA |
| `gdc:urgenteValor` / `gdc:urgenteUnidad` | `d:int` / `d:text` | Prioridad URGENTE |
| `gdc:revisionConfiguracion` | `d:text` | Revisión generada por el BFF |
| `gdc:idOperacion` | `d:text` | Última operación para reconciliar reintentos |
| `gdc:modificadoPor` | `d:text` | Identidad funcional del Director |
| `gdc:fechaModificacion` | `d:datetime` | Fecha de última modificación |

Las unidades permitidas son `DIAS` y `HORAS`. Los límites son 365 días y 8760 horas. Hay cero o un nodo por dependencia con nombre `GDC_TIEMPOS_<CODIGO>` bajo el único contenedor. Se buscan configuraciones por propiedad y se rechaza cualquier duplicado.

## Exclusividad del piloto

Para habilitar temporalmente el guardado DSA se requieren **ambos** flags: `ALFRESCO_RESPONSE_TIMES_WRITES_ENABLED=true` y `ALFRESCO_RESPONSE_TIMES_SINGLE_INSTANCE_PILOT_ENABLED=true`. Al iniciar, el BFF valida almacenamiento Alfresco y UUID, destino esperado, una confirmación explícita de piloto y `ALFRESCO_RESPONSE_TIMES_PILOT_NO_EXTERNAL_WRITERS_CONFIRMED=true`. Además, exige un worker y un destino HTTPS válido.

El proceso adquiere con apertura exclusiva (`wx`) un archivo de lease compartido por los arranques del mismo host, en `backend/data/response-times-pilot.lock` por defecto. Si ya existe cualquier archivo de lease, el nuevo proceso sigue en modo de lectura y no anuncia edición; no intenta decidir automáticamente si una lease antigua es obsoleta. Antes de cada mutación escribe en la lease el `operationId` pendiente. Si el resultado es incierto, bloquea nuevas operaciones para esa dependencia y permite reconciliar solamente el mismo intento. Al cerrar el proceso, conserva la lease si queda una operación pendiente. Un administrador debe verificar el estado de Alfresco y retirar manualmente una lease huérfana o pendiente. En un proceso, las operaciones se serializan por dependencia.

**Alcance:** este archivo de lease coordina procesos del mismo host que usan la misma ruta local. No es un bloqueo distribuido, no impide escrituras desde otros hosts ni desde llamadas manuales a Alfresco. La variable de confirmación externa es una atestación del operador, no una comprobación automática del BFF. Antes de habilitar el piloto, un responsable debe documentar que solo existe una instancia escritora, que las credenciales técnicas no las usa otra aplicación y que los permisos efectivos restringen la escritura al proceso piloto. Si no se puede comprobar esto, ambos flags deben seguir en `false`; el siguiente requisito sería un coordinador distribuido compartido o una operación compare-and-swap proporcionada por la persistencia.

La pantalla ofrece edición solo a DSA cuando GET confirma que el lease de este proceso está tomado y la cuenta técnica tiene la operación Alfresco necesaria. Las otras dependencias permanecen en lectura. Si la lease no se adquiere o no se valida, el servidor no anuncia edición.

## Escritura, revisión y recuperación

El BFF toma dependencia y actor de la sesión activa de Dirección; React no puede elegirlos. Se valida CSRF, prioridad, unidad, límites, `operationId` y `expectedRevision`. El guardado inicial crea un nodo sin renombrado automático; los guardados siguientes actualizan el mismo UUID. Se comprueba el estado mediante una nueva lectura antes de responder éxito.

El `operationId` ya almacenado, actor y valores permiten reconocer un reintento exacto sin repetir la mutación; reutilizar una clave con actor o payload distinto produce conflicto. La revisión se compara dentro de la cola del piloto y de nuevo en el repositorio antes de la escritura. Un timeout se reconcilia mediante lectura: si coincide la operación se devuelve el estado persistido; si no puede confirmarse se devuelve `PARCIAL` con `operationId`, sin repetir escrituras a ciegas. Un siguiente reintento vuelve a leer el nodo y su revisión antes de decidir.

La cola y el lease local no protegen frente a escritores externos. La garantía de no sobrescritura solo es válida mientras se cumpla el control operativo de escritor único. Alfresco no ofrece compare-and-swap en el `PUT /nodes/{id}` utilizado por este BFF.

## Variables de entorno

No copiar secretos a Git ni al chat. `.env.example` solo documenta nombres; `.env.local` no se modifica en esta etapa.

- `ALFRESCO_RESPONSE_TIMES_STORAGE=alfresco`
- `ALFRESCO_RESPONSE_TIMES_SERVICE_USERNAME=gd_tiempos_respuesta_servicio`
- `ALFRESCO_RESPONSE_TIMES_SERVICE_PASSWORD=<secreto local>`
- `ALFRESCO_RESPONSE_TIMES_CONTAINER_NODE_ID=<UUID de GD_CONFIGURACION_TIEMPOS_RESPUESTA>`
- `ALFRESCO_RESPONSE_TIMES_WRITES_ENABLED=false`
- `ALFRESCO_RESPONSE_TIMES_SINGLE_INSTANCE_PILOT_ENABLED=false`
- `ALFRESCO_RESPONSE_TIMES_PILOT_EXPECTED_TARGET=<ALFRESCO_TARGET exacto>`
- `ALFRESCO_RESPONSE_TIMES_PILOT_ACKNOWLEDGEMENT=single-instance-exclusive-writer-response-times-dsa`
- `ALFRESCO_RESPONSE_TIMES_PILOT_NO_EXTERNAL_WRITERS_CONFIRMED=false`
- `ALFRESCO_RESPONSE_TIMES_PILOT_LEASE_PATH=<ruta local compartida por los arranques del mismo host>`

El UUID debe diferir de los contenedores de jerarquía y laboratorio. Para el estado actual de lectura, dejar ambos flags de escritura en `false`. No habilitar el piloto hasta completar la verificación operativa y autorizar una prueba separada.

## Lista administrativa para un futuro piloto

1. Confirmar permisos efectivos de la cuenta técnica, su estado no administrador y que no pueda acceder a documentos institucionales.
2. Revisar y registrar que no haya otra instancia BFF, script, integración ni operador usando credenciales con permiso de escritura sobre el contenedor.
3. Confirmar que los arranques escritores del mismo host usen la misma ruta local de lease y un único worker.
4. Mantener `ALFRESCO_RESPONSE_TIMES_WRITES_ENABLED=false` y `ALFRESCO_RESPONSE_TIMES_SINGLE_INSTANCE_PILOT_ENABLED=false` mientras se revisan los puntos anteriores.
5. Autorizar explícitamente la prueba de escritura; habilitar variables únicamente en el entorno local protegido, nunca en Git ni en `.env.example`.
6. Crear/actualizar solo una configuración DSA ficticia o aprobada, verificar UUID, valores, actor, fecha y revisión por lectura, y restaurar los flags a `false` al terminar.

La cuenta propuesta `gd_tiempos_respuesta_servicio` debe ser independiente de distribución y jerarquías. No se ha creado un contenedor de auditoría de tiempos, ni se han alterado los eventos de jerarquías.
