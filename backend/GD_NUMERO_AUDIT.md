# Auditoría GET-only: gd:numero frente a gd:correlativoDocumental

> HISTORICO: la decision definitiva reutiliza gd:numero como texto numerico oficial y retira el correlativo separado de la propuesta. Las recomendaciones anteriores de este informe quedan sustituidas por [el contrato vigente](./alfresco-model/EMISSION_CMM.md). Se conserva la evidencia de auditoria; no se modificaron documentos de prueba.

## Decisión

Mantener `gd:correlativoDocumental` en la propuesta aditiva. La evidencia observada NO demuestra que `gd:numero` represente un correlativo numérico; sus valores reales son identificadores textuales compuestos. Reutilizarla como entero alteraría su significado observable o exigiría interpretar arbitrariamente sus sufijos.

Los dos campos tienen funciones distintas: `gd:numero` conserva el identificador/número documental textual registrado; la propiedad propuesta `gd:correlativoDocumental` contiene únicamente el entero de la secuencia por código completo y ciclo. No se modifica el tipo, contenido, formato o indexación de `gd:numero`. No se extrae `001` de un identificador de prueba para incorporarlo al contador.

No se afirma que todos los documentos institucionales usen un formato oficial completo determinado ni que los ejemplos provengan de un sistema externo: ese origen y formato no están documentados en el modelo. La evidencia permite descartar la interpretación de correlativo puro en estos documentos, no inventar una semántica de producción más específica.

## Definición real

Se consultaron con GET el modelo CMM `gd_uac`, su aspecto `identificacion`, `/alfresco/service/api/classes/gd_identificacion` y `/alfresco/service/api/classes/gd_identificacion/property/gd_numero`.

| Campo | Resultado |
|---|---|
| Modelo / aspecto | `gd_uac` ACTIVE / `gd:identificacion` |
| Nombre local / cualificado | `numero` / `gd:numero` |
| Título | Número documental |
| Tipo | `d:text` |
| Multiplicidad | Singular (`multiValued:false`) |
| Obligatoriedad | `mandatory:false`, `mandatoryEnforced:false`; runtime `enforced:false` |
| Protección | Runtime `protected:false` |
| Restricciones | Runtime `constraints:[]`; no restricción que exija dígitos, formato o unicidad |
| Descripción | No declarada en CMM; ausente/vacía en el aspecto efectivo, sin definición de correlativo |
| Índice | `indexed:true`, runtime `indexedAtomically:true` |
| Tokenización / facetas CMM | `indexTokenisationMode:"TRUE"`, `facetable:"FALSE"` |
| Valor predeterminado | CMM no declara `defaultValue`; el endpoint de propiedad devuelve `defaultValues:""`. No es evidencia de un correlativo predeterminado. |

El título por sí solo no justificaba clasificarlo como número formal de presentación. La auditoría anterior lo conservaba preventivamente; ahora hay ejemplos reales de identificadores compuestos que sustentan mantenerlo separado del entero. Los comentarios y la descripción CMM propuesta se ajustaron para reflejar esa evidencia y su límite.

## Documentos DEV observados

Se enumeraron directamente las seis bandejas institucionales configuradas de DTI/DSA mediante `children?assocType=cm:contains` paginado y GET de propiedades, deduplicando UUIDs vinculados por asociaciones secundarias. Se encontraron 12 documentos únicos, 2 con `gd:numero`, 10 sin valor, sin fallos de consulta en ese recorrido.

| UUID | gd:numero |
|---|---|
| `ae23bcf0-ef2a-48c7-a3bc-f0ef2a98c7b1` | `TEST-MF-001` |
| `dd778efd-6acd-48f1-b78e-fd6acd08f1e1` | `TEST-SERVICIO-001` |

Ambos tienen `gd:identificacion`. No hay valores puramente numéricos en este conjunto accesible. Esta cobertura no prueba inexistencia de otros usos en todo el repositorio: se limita a las carpetas configuradas y visibles para la cuenta de distribución. No se usó SEARCH, contenido del PDF ni nombres de archivo para deducir correlativos.

## Usos en el código actual

- `backend/src/index.js`, endpoint `send-to-director`: recibe y reenvía el multipart; no asigna `gd:numero` ni lo interpreta para numerar. Las escrituras de asignaciones tampoco lo usan.
- `frontend/src/api/alfresco.js`, `uploadPdfToFolder` y `uploadPdfToDirectorInbox`: el multipart incluye filedata, name, nodeType, `cm:title` y `cm:description`; no estampa `gd:numero` ni el aspecto `gd:identificacion`.
- `nodeToDocument` en ese cliente no lee `gd:numero`. Por tanto, un número calculado por el frontend no demuestra que el nodo tenga ese metadato.
- `frontend/src/components/DocumentForm.jsx`: reserva `originalConsecutive` y prepara un número de presentación con tipo, consecutivo, año y código. Estos son campos de formulario, no un mapeo a `gd:numero`.
- `frontend/src/App.jsx`, `handleDocumentSubmit`: tras confirmar Alfresco registra datos en `recordAlfrescoConfirmedDocument`. La identidad local `documentNumber` no se persiste automáticamente como `gd:numero`.
- `frontend/src/utils/documentStore.js`: `recordAlfrescoConfirmedDocument` aún calcula un máximo local y compone `documentNumber`, guardado en localStorage. `getCorrelativeStatus` también ofrece cálculo local, aunque el formulario actual usa el endpoint de reserva bloqueado. Este legado NO es fuente oficial ni evidencia de la semántica de `gd:numero`; debe eliminarse/reemplazarse al integrar el emisor oficial para que no renumere localmente un resultado backend. No se cambió ese flujo en esta auditoría.
- `backend/src/officialEmissionContract.js`: la propuesta registra el entero solo en `gd:correlativoDocumental` y no escribe `gd:numero`. Las pruebas comprueban que los valores reales `TEST-MF-001` y `TEST-SERVICIO-001` permanecen intactos. Ni siquiera un texto `0001` se utiliza automáticamente como registro oficial completo sin código, ciclo e identidad.

## Contrato y verificación actualizados

Se conservan las cuatro propiedades nuevas. La descripción CMM de `correlativoDocumental` ahora distingue expresamente el entero del identificador textual existente. `gd:numero` no aparece en el fragmento aditivo, así que éste no propone redefinirlo.

El verificador ahora muestra la definición CMM y runtime de `gd:numero`. Para repetir la auditoría de documentos, ejecutar desde la raíz:

```powershell
node backend/scripts/verify-emission-model.mjs --audit-existing
```

La opción añade únicamente GETs directos de las carpetas configuradas y sus nodos. Reporta UUID, valor y clasificación (texto numérico, identificador textual, vacío o tipo inesperado), sin derivar números del texto. El modo `--require-present` sigue disponible y puede combinarse. No existe opción de escritura ni fallback administrativo.

Las cuatro propiedades siguen ausentes en DEV. Antes de activar la numeración faltan aprobación/despliegue del contrato, conciliación histórica, código institucional autorizado, creación de PDF+metadata en una operación, eliminación de la renumeración frontend y conciliación durable de reintentos/timeout. Los identificadores de prueba existentes no se convierten automáticamente en emisiones oficiales ni se les asignan ciclo/número inventados. La propuesta no impone un formato nuevo de `gd:numero`: esa decisión de presentación formal sigue pendiente.

Resultado de validación: 121 pruebas aprobadas, cero fallos u omitidas. Incluyen conservación exacta de los valores DEV, rechazo de su uso como metadata numérica y deduplicación del inventario. El verificador GET-only ampliado se ejecutó contra DEV con el mismo resultado de 12 documentos/2 valores. `git diff --check` correcto; ambos `.env.local` conservaron sus hashes. Sin escrituras Alfresco, cambios de propiedades existentes, commit ni push.
