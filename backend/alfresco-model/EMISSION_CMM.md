# Contrato del modelo documental

## Definiciones conservadas

- [gd-identificacion-emission.cmm.json](gd-identificacion-emission.cmm.json): propiedades aditivas del aspecto existente gd:identificacion.
- [gd-tramite-dispatch.cmm.json](gd-tramite-dispatch.cmm.json): asignaciones y proyecciones de gd:tramite.

Son entradas de scripts y pruebas; no reemplazan el modelo completo ni prueban por sí solas que un entorno esté desplegado. No cambiar nombres técnicos para anonimizar evidencias.

## Identificación oficial

| Propiedad | Tipo | Multiplicidad | Uso |
| --- | --- | --- | --- |
| gd:numero | d:text existente | Singular | Correlativo positivo en texto decimal canónico |
| gd:codigoDocumental | d:text | Singular | Código completo institucional |
| gd:cicloDocumental | d:int | Singular | Año de inicio del ciclo del 2 de enero en America/Lima |
| gd:identidadEmision | d:text | Singular | JSON v1: version, actorId, requestKey, payloadHash |

No existe en este contrato una propiedad nueva gd:correlativoDocumental ni un identificador compuesto adicional. El backend convierte gd:numero numéricamente; no interpreta sufijos de identificadores antiguos.

Las tres propiedades aditivas son opcionales y no obligatorias de forma forzada, sin valores por defecto. No se indexan, facetan ni tokenizan. La obligatoriedad de una emisión oficial se valida en backend; no se rompe la lectura de documentos históricos.

## Asignaciones

gd:asignaciones es d:text singular, opcional y no indexada. Conserva el JSON versionado de asignaciones, respuestas, procesos y operaciones. El límite de 256 KiB es aplicativo, no un límite declarado del repositorio.

gd:responsablesActuales y gd:dependenciasResponsablesActuales son d:text multivalor, indexadas sin tokenización, opcionales y sin predeterminados. Son proyecciones de asignaciones vigentes, no arrays relacionados por posición ni responsables principales.

Las propiedades singulares antiguas se conservan sin modificación destructiva. gd:estado no se sincroniza automáticamente por despacho, propuesta o atención.

## Verificación y despliegue

```powershell
node backend/scripts/verify-emission-model.mjs --require-present
node backend/scripts/verify-emission-model.mjs --audit-existing
```

El verificador exige definiciones CMM y runtime compatibles, incluido gd:numero singular de texto. Solo realiza GET; no acepta aplicación ni usa administración como fallback. La auditoría de existentes puede producir evidencia interna y debe guardarse en privado.

Antes de un despliegue autorizado, obtener y respaldar íntegramente modelo/aspecto activos fuera del repositorio. Si faltan propiedades, crear únicamente las aditivas con nombre local, título, descripción y flags definidos en el fragmento, dentro del aspecto existente. No renombrar, cambiar multiplicidad ni sustituir propiedades activas.

El helper de despacho tiene una opción de aplicación separada; no equivale a autorización para usarla. El contrato de emisión se despliega manualmente bajo aprobación independiente. Verificar de nuevo CMM/runtime por GET después.

Modelo compatible no significa permisos efectivos, conciliación aprobada ni emisión habilitada. Véanse [emisión](../OFFICIAL_EMISSION_INTEGRATION.md) y [operación](../ALFRESCO_DISPATCH_PILOT.md).
