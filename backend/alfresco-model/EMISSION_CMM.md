# Contrato definitivo CMM: correlativo en gd:numero

Actualización de integración: el modelo fue desplegado manualmente y se verificó por GET. El emisor formal ya está conectado, con escrituras deshabilitadas por defecto. El estado operativo, manifiesto de conciliación y pasos para autorizar DEV están en [OFFICIAL_EMISSION_INTEGRATION.md](../OFFICIAL_EMISSION_INTEGRATION.md).

Ajuste posterior vigente: [OFFICIAL_EMISSION_PILOT_ADJUSTMENTS.md](../OFFICIAL_EMISSION_PILOT_ADJUSTMENTS.md) define conciliación v2 estable ante atención, lectura del receptor por nodo y preflight independiente por dependencia. DSA vacía no requiere aprobar los históricos DTI; no se otorgan permisos sobre carpetas ni se habilitan escrituras automáticamente.

Esta decisión funcional sustituye las propuestas anteriores que añadían una propiedad de correlativo separada. No se borra ni modifica ninguna propiedad en DEV, ni se limpian documentos incompatibles: esa limpieza requiere autorización independiente.

## Modelo y aspecto

Modelo existente `gd_uac`, ACTIVE, namespace `gd`, URI `https://uandina.edu.pe/model/gd/1.0`. Aspecto existente `identificacion` (`gd:identificacion`), compatible con código, ciclo, correlativo e identidad de emisión. No se crea otro aspecto ni una propiedad para un identificador compuesto.

| Propiedad REST / nombre local | Tipo exacto | Estado | Contrato |
|---|---|---|---|
| `gd:numero` / `numero` | `d:text` | EXISTENTE, no se incluye en el fragmento | Única fuente del correlativo: texto decimal canónico positivo, como `"1"`, `"2"`, `"15"`. |
| `gd:codigoDocumental` / `codigoDocumental` | `d:text` | NUEVA | Código institucional completo autorizado; DTI, DTI-UPSI y DTI-UPSI-AMMR son secuencias distintas. |
| `gd:cicloDocumental` / `cicloDocumental` | `d:int` | NUEVA | Año de inicio del ciclo 2 de enero–1 de enero siguiente según America/Lima, calculado por backend. |
| `gd:identidadEmision` / `identidadEmision` | `d:text` | NUEVA | JSON v1: `version`, `actorId`, `requestKey`, `payloadHash` SHA-256 hexadecimal del PDF y parámetros formales canónicos. |

`gd-identificacion-emission.cmm.json` contiene SOLO las tres propiedades nuevas con nombres locales, títulos y descripciones definitivos. Es un fragmento aditivo de propiedades, no un ZIP importable ni una definición completa que deba sustituir el modelo/aspecto. El campo de correlativo separado se retiró de la propuesta; no se ejecuta su eliminación en servidor.

## Flags y restricciones

Las tres nuevas propiedades son singulares (`multiValued:false`), opcionales en CMM (`mandatory:false`, `mandatoryEnforced:false`), sin default ni constraints nuevas. Su obligatoriedad es de backend para una emisión oficial completa; no se impone a todos los documentos históricos del aspecto. No se indexan (`indexed:false`), no generan facetas (`facetable:"FALSE"`) ni tokens (`indexTokenisationMode:"FALSE"`). No se requiere SEARCH/AFTS para enumerar o verificar la numeración.

No se cambian el tipo, multiplicidad, flags, constraints, título o descripción de la propiedad EXISTENTE `gd:numero`. El verificador exige que siga siendo texto singular. Su indexación actual es true y su tokenización TRUE; la aplicación no utiliza ese índice para obtener máximos. El nuevo uso numérico procede de la decisión funcional del piloto y se valida en backend, sin reescribir metadatos de prueba.

Para nuevas emisiones el backend serializa `String(number)` y al leer exige `^[1-9][0-9]*$` y conversión a entero seguro positivo (`Number.MAX_SAFE_INTEGER` como límite). No usa orden lexicográfico, parseInt parcial, sufijos ni fechas para numerar. Se rechazan ceros, prefijos/sufijos, espacios, signos, decimales, exponentes, ceros iniciales no canónicos y valores que superen el rango seguro. Un valor como `TEST-MF-001` produce `OFFICIAL_NUMBER_RECONCILIATION_REQUIRED`, no se convierte a 1 ni se ignora. Un documento sin contrato completo bloquea la enumeración oficial hasta conciliación.

La identidad agrupa actor real, clave idempotente y huella sin otra propiedad. CMM no comprueba JSON ni unicidad; el backend debe hacerlo. No se registran tokens ni contraseñas. El código debe resolverse desde la autoridad/catálogo verificados, no del nombre del usuario o un parámetro frontend confiado.

## Verificación exclusivamente GET

Desde la raíz del repositorio:

```powershell
node backend/scripts/verify-emission-model.mjs
node backend/scripts/verify-emission-model.mjs --audit-existing
```

El verificador consulta el modelo CMM, el aspecto CMM, el aspecto efectivo y la definición runtime de `gd:numero`. Comprueba el modelo activo y namespace, las tres nuevas propiedades y el tipo/multiplicidad de `gd:numero`. El plan aditivo SOLO contiene nuevas propiedades faltantes; si una ya existe con contrato incompatible, no propone reemplazarla. Muestra notas de títulos/descripciones y normalizaciones inertes de flags de campos no indexados.

`--audit-existing` enumera por GET directo las bandejas institucionales configuradas con paginación y deduplicación de UUIDs secundarios. Reporta valores de `gd:numero` y `compatible:false` para números incompatibles. `reconciliationRequired:true` indica faltantes o valores incompatibles. La cobertura es únicamente el conjunto visible para la identidad configurada; no certifica todo el repositorio.

Después de la actualización manual:

```powershell
node backend/scripts/verify-emission-model.mjs --require-present --audit-existing
```

Devuelve código 1 si falta alguna nueva propiedad, existe conflicto de modelo, `gd:numero` no es texto singular, la definición efectiva aún no refleja el contrato o el inventario solicitado necesita conciliación. Sin `--audit-existing`, el modo estricto comprueba solo modelo, no calidad de datos. El modo preflight normal permite informar faltantes sin aplicar cambios. `modelReady:true` solo significa esquema compatible; NO habilita emisión. La salida siempre declara `issuanceEnabled:false`.

Usa la cuenta de distribución ya configurada y no realiza fallback administrativo. No tiene `--apply`, no escribe ficheros, no actualiza modelos y no imprime secretos. Si pierde acceso a CMM o encuentra una página inconsistente, falla explícitamente.

## Pasos manuales para crear las tres propiedades

1. Respaldar con la herramienta institucional la definición completa de `gd_uac` y del aspecto `identificacion`. Ejecutar el preflight y revisar las tres faltantes y `existingNumero.compatibleModel:true`.
2. Con la identidad de administración ya autorizada para el cambio manual, abrir `gd_uac` → aspecto `identificacion` en CMM y añadir SOLO `codigoDocumental`, `cicloDocumental`, `identidadEmision`. Copiar tipos, títulos, descripciones y flags del fragmento. No editar `numero` ni las otras propiedades vigentes; no crear una propiedad de número compuesto ni un correlativo separado.
3. Conservar el resto del modelo y su estado activo. No usar el fragmento para reemplazar el aspecto completo ni desactivar/borrar/recrear el modelo. Si la versión CMM rechaza una adición en activo, detenerse e investigar antes de un procedimiento alternativo.
4. Ejecutar el verificador estricto. Revisar separadamente compatibilidad del modelo y conciliación de documentos de prueba: crear las propiedades no corrige sus valores. No limpiar documentos ni cambiar sus números sin autorización.
5. No realizar una emisión de prueba hasta completar los requisitos siguientes. El despliegue del modelo por sí solo no habilita escrituras.

## Creación documental y fuente única

`officialEmissionContract.js` prepara un único mapa de propiedades que incluye `gd:numero` como texto y las tres nuevas; `decodeEmissionMetadata` lo convierte a número para el cálculo del máximo. El lector institucional usa ese decoder, mantiene anulados y verifica pertenencia por asociaciones `cm:contains` con GET. El mutex por código/ciclo cubre lectura, cálculo, creación, GET y comprobación de visibilidad. Se mantienen idempotencia y cuarentena de resultados inciertos; no existe contador adicional.

`documentStore.js` ya no contiene `getCorrelativeStatus`, cálculo de máximos locales, reserva ni incremento posterior a una confirmación. Solo cachea el valor `gd:numero` devuelto por Alfresco y su código/ciclo; si falta, queda sin número. No usa el número solicitado por el formulario como sustituto. Los registros locales anteriores sin origen de metadata no se muestran como numeración oficial y leerlos no modifica la evidencia histórica almacenada. Las confirmaciones repetidas actualizan la caché desde la misma respuesta sin reservar otro número.

La presentación compuesta usa el formato de vista existente con código, correlativo y ciclo confirmados por Alfresco; no se almacena en otra propiedad. El formulario ya no llama al endpoint de reserva separado: envía una única solicitud al emisor formal. La habilitación del piloto permanece desactivada hasta completar sus controles; el endpoint antiguo de reserva continúa bloqueado para impedir una segunda fuente.

## Restricciones pendientes antes de activar

- Las tres propiedades ya están desplegadas y verificadas por GET. Falta aprobar y verificar la exclusión administrativa de pruebas incompatibles o sin contrato; no se limpian en esta entrega.
- El alta de PDF y metadata ya está implementada en una operación multipart dentro de la cola. Falta la prueba real autorizada en DEV; no se registra el número mediante un PUT separado.
- Código de Dirección verificado por grupos, huella canónica v1 y reintento con ciclo original implementados. Falta la validación operativa real y la autorización de eventuales emisores de códigos de unidad/persona.
- Probar visibilidad inmediata por GET/children, paginación, asociaciones secundarias y anulados con credenciales reales y sin depender de índice eventual.
- Probar conciliación durable tras timeout/reinicio. Ausencia temporal no equivale a fallo definitivo; no reutilizar ni incrementar ante incertidumbre.
- Mantener una sola instancia y ningún escritor externo. El mutex no da garantías distribuidas ni CMM impone unicidad.
- Respetar permanencia en Emitidos. La aplicación bloquea movimiento y borrado, pero la cuenta técnica aún tiene delete efectivo observado; no se cambian ACL ni se afirma protección fuera de la aplicación.
- Integrar la revisión/aprobación formal jerárquica, como requisito independiente de la numeración.

No se modificó el modelo activo, ACL, `.env.local` ni documentos DEV. La emisión oficial permanece deshabilitada y los JSON históricos se conservan.

## Resultado de esta entrega

123 pruebas automatizadas aprobadas, sin fallos u omitidas; lint y build correctos. Incluyen máximo numérico sobre valores de texto `9`, `10`, `2` (siguiente `11`), escritura de un solo correlativo en `gd:numero`, rechazo de identificadores incompatibles, contrato CMM de solo tres adiciones y ausencia de asignación/renumeración local, incluso en reintentos.

El preflight real GET-only con `--audit-existing` devolvió `existingNumero.compatibleModel:true`, las tres propiedades nuevas faltantes y `issuanceEnabled:false`. El inventario accesible conserva 12 documentos: 2 con texto incompatible y 10 sin número; `reconciliationRequired:true`. No se limpió ninguno. Ambos `.env.local` conservan sus hashes anteriores y se preservaron los cambios locales en `feature/jerarquia-despacho-interno`, sin commit ni push.
