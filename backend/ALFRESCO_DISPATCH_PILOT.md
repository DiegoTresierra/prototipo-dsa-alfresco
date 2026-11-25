# Operación controlada del despacho Alfresco

## Alcance

El modo institucional usa DISPATCH_PERSISTENCE=alfresco. Los despachos se guardan en el nodo original; no se usa JSON local como fallback de Alfresco.

La pertenencia se limita a bandejas institucionales configuradas, incluyendo asociaciones secundarias verificadas. No se requiere carpeta exclusiva de pruebas ni una lista de UUID de documentos. El alcance puede incluir cualquier PDF institucional autorizado: el operador debe identificar los documentos que utilizará.

No se crean carpetas personales, copias de PDF ni permisos automáticamente. Usuarios y grupos reales se resuelven desde la configuración privada y Alfresco.

## Configuración

Las plantillas públicas están en [.env.example](.env.example); completarlas exclusivamente en configuración privada:

- ALFRESCO_TARGET y credencial de distribución no administrativa.
- ALFRESCO_GROUP_MAPPINGS_JSON, ALFRESCO_OFFICE_GROUP_IDS_JSON y ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON con IDs reales verificados.
- DISPATCH_PERSISTENCE=alfresco.
- DISPATCH_ALFRESCO_WRITES_ENABLED=false por defecto.

ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON solo se consulta en el planificador histórico de migración. El despacho resuelve la supervisión mediante relaciones activas en Alfresco. Las carpetas individuales configuradas solo corresponden a otros flujos compatibles, no son un requisito nuevo del despacho.

No usar DISPATCH_PILOT_TEST_FOLDER_IDS_JSON ni DISPATCH_PILOT_DOCUMENT_IDS_JSON: esos requisitos fueron retirados.

## Habilitación independiente por entorno

Para DEV se requiere DISPATCH_PILOT_ENVIRONMENT=dev, destino exacto en DISPATCH_PILOT_ALFRESCO_TARGET y confirmación explícita del alcance institucional mediante DISPATCH_PILOT_ACK. La confirmación reconocida por el código es single-instance-exclusive-writer-dev-institutional-documents.

Preproducción requiere DISPATCH_PILOT_ENVIRONMENT=preprod, DISPATCH_PREPROD_WRITES_ENABLED, destino propio en DISPATCH_PREPROD_ALFRESCO_TARGET y DISPATCH_PREPROD_ACK con single-instance-exclusive-writer-preprod-institutional-documents. Debe ser distinto del destino DEV. Las confirmaciones DEV no habilitan preproducción.

El destino debe ser HTTPS y no incluir credenciales, consulta, fragmento ni ruta adicional. Cambiar únicamente ALFRESCO_TARGET no habilita nada. No activar variables hasta verificar modelo, nodos, usuarios, permisos y autorización del operador.

## Exclusión y recuperación

La aplicación comprueba configuraciones habituales de múltiples workers y toma un lease local exclusivo. DISPATCH_PILOT_LEASE_PATH es opcional. Un lease no protege contra otro host ni contra aplicaciones externas.

La cola por UUID incluye GET actual, validación, incorporación de asignaciones, actualización de proyecciones, PUT y GET de comprobación. La comparación previa detecta cambios externos comprobables, pero no es CAS.

Ante fallo, no sustituir el sobre por uno vacío ni volver a la persistencia local. Conciliar por GET usando la misma identidad de operación. No retirar un bloqueo de un proceso activo; un bloqueo aparentemente huérfano exige verificación operativa.

No borrar dispatches.json, document-numbers.json u organization.json como parte de una limpieza documental: pueden contener recuperación/configuración provisional. Permanecen privados y no conceden autoridad documental.

## Modelo y comprobaciones

Se reutiliza gd:tramite y el fragmento [gd-tramite-dispatch.cmm.json](alfresco-model/gd-tramite-dispatch.cmm.json). No modificar destructivamente las propiedades singulares existentes.

prepare-dispatch-model.mjs es GET-only por defecto. Su opción de aplicación requiere autorización separada, identidad ya autorizada y directorio de respaldo privado. No ejecutarla durante una comprobación de lectura. DISPATCH_MODEL_BACKUP_DIR debe estar fuera del repositorio; comprobar integridad del respaldo antes de cualquier despliegue autorizado.

La lista de permisos del servicio no prueba los permisos del actor. Usar [comprobaciones de lectura](READ_ACCESS_CHECKS.md) y probar creación/actualización únicamente con una autorización específica posterior.

El circuito de propuestas conserva una barrera adicional sin habilitación real ni rutas mutables; habilitar despacho no habilita propuestas o emisión. Véanse [seguridad](ARCHITECTURE_AND_SECURITY.md), [contrato](INTERNAL_DISPATCH.md) y [propuestas](RESPONSE_PROPOSALS.md).
