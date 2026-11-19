# Carga y representación de asignaciones: diagnóstico y validación

Trabajo en `feature/jerarquia-despacho-interno`, conservando los cambios locales. No se modificaron `.env.local`, el modelo, el JSON versionado, las ACL ni las reglas de despacho. Todas las escrituras de prueba fueron locales y simuladas.

## Evidencia de datos reales y límites

Se consultó DEV mediante GET con la cuenta técnica ya configurada. El nodo `18cf8ec0-dbd5-4370-8f8e-c0dbd5a37097` respondió 200 con `gd:asignaciones`, esquema v1 y una asignación `ASIGNADO` para `JEFE_UNIDAD_DSA_1`. La consulta de hijos de Por atender DSA devolvió las propiedades completas, incluyendo dos PDFs con asignaciones. No hay que inventar asignaciones ni esperar al índice para leerlas.

El usuario confirmó que su respuesta de `GET /api/documents/dispatches` contiene `persistence: alfresco`. Por tanto, **no se atribuye su caso a la ausencia de ese campo en el backend**. No había un backend accesible en el puerto local 3000 ni acceso a su sesión del navegador; no se inspeccionaron cookies ni se pidieron credenciales. El endpoint se probó mediante HTTP aislado y la aplicación compilada se ejecutó en Edge real con una API local simulada basada en la estructura comprobada en DEV.

## Causas confirmadas

1. `GET /api/documents/dispatches` invocaba dos lectores independientes para recibidos y enviados. Cada uno recorría las seis carpetas y luego hacía un GET por PDF. `include=documents` volvía a consultar metadatos y podía volver a recorrer asignaciones para autorizar el documento.
2. `allRecords` recorría todo secuencialmente y solo pedía `association` en hijos, desperdiciando las propiedades que Alfresco puede entregar en esa misma respuesta.
3. En `App.jsx`, la carga de asignaciones de Dirección era un efecto separado, mientras que `useAlfrescoInbox` recibía `loadAssignments` vacío. «Actualizar bandeja», foco y eventos de despacho actualizaban PDFs sin volver a consultar asignaciones. Los documentos podían aparecer antes de que terminara la consulta lenta de responsabilidades.
4. `loadAssignmentInbox` descartaba `persistence` al transformar el paquete compartido. Este defecto afectaba la procedencia de los datos de Jefatura/Especialista; no explica por sí solo la ruta directa de Dirección, donde ese campo sí se transformaba. Ahora todos los caminos conservan la procedencia.
5. El selector cerrado mostraba «Sin seleccionar» aunque existieran obligaciones persistidas: describe una nueva acción de derivación, no el estado del documento, pero era ambiguo. Ahora muestra el número de responsables vigentes y cada opción pertinente contiene «— Ya asignado». La confirmación también identifica destinatarios vigentes.
6. Los estilos eran condicionales a que las asignaciones ya estuvieran cargadas: sin datos no había franja ni clase de fondo que pintar. La función de color anterior sumaba caracteres; `_1` y `_2` diferían solo un grado. Además, las pantallas de Jefatura/Especialista realmente renderizan `AssignmentsPage`, que no tenía ese indicador. No se encontró otra regla CSS de la franja que sobrescribiera el ancho.

Con el JSON persistido confirmado, la interfaz compilada representa correctamente `JEFE_UNIDAD_DSA_1`. Si el problema sigue en una sesión concreta después de actualizar ambos procesos, hay que contrastar el `documentId` de la fila y los `recipients[].userId/status` de esa respuesta; no se ha demostrado un error de IDs para esa sesión. No se corrige mediante comparación por nombre, un origen inventado o datos provisionales.

## Optimización aplicada y medición GET en DEV

| Medida | Antes | Después |
| --- | ---: | ---: |
| Solicitudes totales | 40 | 8 |
| Listados de hijos | 12 | 6 |
| GET individuales de nodo | 24 | 0 |
| Identidad/modelo | 4 | 2 |
| Concurrencia máxima | 1 | 4 |
| Tiempo observado | 6226 ms | 808 ms |
| Despachos DSA devueltos | 2 | 2 |

Comparación del lector con la **misma identidad técnica**, 12 UUID legibles, misma configuración institucional y solo GET. Antes se ejecutaron los dos lectores usados por el endpoint; después, una instantánea compartida. No es una medición de la sesión DSA_T ni un SLA: sus ACL, red y paginación pueden requerir más peticiones. Si el actor no puede enumerar una carpeta, el descubrimiento técnico mantiene GET individuales de verificación con el actor; si faltan propiedades en hijos, también hay un GET de respaldo por UUID, con concurrencia acotada.

Reproducir únicamente la medición actual, sin arrancar Express ni habilitar escrituras:

```powershell
node backend/scripts/measure-dispatch-read.mjs DSA
```

La instantánea es exclusiva de una petición. No hay caché compartida, TTL ni caché de autorizaciones entre sesiones. `loadInbox` sirve recibidos y enviados desde una sola lectura. Se pide `include=properties,aspectNames,association`, se deduplican UUID, se conserva la respuesta más reciente por `modifiedAt` al aparecer en varias asociaciones y se validan JSON/proyecciones como antes. Los errores no se convierten en listas vacías.

Las propiedades completas solo se reutilizan si proceden de un listado hecho con las credenciales del actor. Los datos descubiertos con la cuenta técnica nunca constituyen prueba de ACL del usuario. `authorizeNodeRead` sigue aplicando las mismas reglas: propio, conocimiento cuando corresponde y asignación vigente; únicamente reutiliza metadatos ya verificados en la petición, en lugar de otro GET idéntico. El proxy no recibe ni confía en una instantánea enviada desde React. La respuesta de asignaciones lleva `Cache-Control: no-store`.

El frontend carga documentos y responsabilidades en el mismo refresco, agrupa solicitudes de foco/navegación que coinciden y fuerza una lectura posterior si se confirma un despacho durante una lectura anterior. Se conserva la protección de versiones para que un GET anterior no borre un POST ya verificado. Seleccionar un PDF no vuelve a explorar carpetas. Un backend que omita `persistence` produce un error visible y pide actualizarlo, en lugar de presentar silenciosamente sus datos como provisionales.

## Colores y componentes reales

`responsibleColor` usa FNV-1a y mezcla avalanche del ID completo. No usa roles, prioridades, nombres visibles, aleatoriedad ni contexto de la página. Para los IDs DSA comprobados, los matices son 282°, 95° y 147°: los sufijos similares ya no producen colores casi iguales. Se combina matiz, saturación y luminosidad, manteniendo el mismo resultado para el usuario en cada documento y sesión. Como toda codificación cromática, no garantiza distinguir todos los posibles IDs ni sustituye las etiquetas textuales.

`ResponsibilityIndicator` se reutiliza en `DirectorPage` y `AssignmentsPage`, las pantallas efectivamente conectadas desde `App`. Cada usuario vigente tiene un segmento equivalente; el ancho calculado es **11 px**, con margen compensado para conservar el ancho total. El fondo usa los mismos colores al 6%, sin aplicar opacidad al texto. «Para mí» y los estados anulados/atendidos no generan responsabilidades vigentes. No cambian las reglas de duplicados ni se elige un responsable principal.

## Validación en navegador real

```powershell
cd frontend
npm run build
cd ..
node frontend/scripts/verify-dispatch-browser.mjs
```

Requiere Edge instalado en Windows o `DISPATCH_TEST_EDGE_PATH` apuntando a su ejecutable. Usa un perfil temporal, un servidor local aislado y bloquea solicitudes HTTP fuera de ese servidor. No utiliza una sesión real, credenciales, Alfresco ni el backend del usuario. El único despacho es un POST simulado local. No realiza PUT.

Ejecuta el bundle de producción completo y verifica:

- Carga de datos con la forma del backend y etiqueta por ID de la jefatura ya asignada.
- Un GET de asignaciones por refresco manual y ninguno extra al seleccionar el PDF.
- Confirmación simulada a dos destinatarios equivalentes e incorporación de sus etiquetas.
- Conservación tras navegar y recargar toda la aplicación.
- Colores calculados estables tras recargar, tres colores distintos, segmentos de igual altura y ancho calculado de 11 px.
- Capturas de escritorio y móvil tras terminar la transición del menú.

Artefactos locales ignorados por Git: `frontend/artifacts/dispatch-read/desktop.png`, `mobile.png` y `report.json`. Las capturas son de la aplicación real con datos sintéticos; no deben presentarse como capturas de la sesión DEV del usuario.

## Verificación manual de la sesión DEV

1. Reiniciar el backend actualizado conservando la configuración autorizada, sin cambiar el modelo ni permisos. La compilación frontend no reinicia Express.
2. Si se usa Vite, mantenerlo activo y recargar `/prototipo-dsa-alfresco/`; si se sirve estático, desplegar el nuevo `frontend/dist` en el servidor correspondiente. No ejecutar este despliegue automáticamente.
3. Abrir Network, activar temporalmente «Disable cache» y recargar. Confirmar que `/api` apunta al backend esperado (Vite usa localhost:3000; `VITE_API_BASE_URL` puede cambiar el destino).
4. Entrar a Documentos recibidos. Revisar una respuesta de `/api/documents/dispatches`, `persistence: alfresco`, UUID de la fila y `recipients[].userId/status`. El JSON vigente debe mostrar la misma identidad canónica del directorio.
5. Abrir el selector: la jefatura vigente debe indicar «— Ya asignado». El selector cerrado muestra el número de responsables. «Para mí» permanece independiente. Confirmar ancho de 11 px con DevTools y colores distintos por ID.
6. Pulsar Actualizar bandeja: debe volver a consultar asignaciones y documentos. Seleccionar o cerrar una vista previa no debe disparar otra exploración de asignaciones. Las lecturas por carpeta siguen siendo necesarias y pueden paginarse.
7. Volver a Inicio y regresar, recargar y reiniciar solo el backend: las asignaciones deben reaparecer desde Alfresco. La persistencia real tras reinicio fue confirmada previamente por el usuario; esta entrega no repitió una escritura real para provocarla.

## Archivos de esta corrección

- Backend: `alfrescoDispatchRepository.js`, `index.js`, `documentReadPolicy.js` (reutilización de prueba ACL, mismas reglas), `mapConcurrent.js` (nuevo), sus pruebas de repositorio/HTTP/política y el medidor GET nuevo.
- Frontend: `App.jsx`, `useAlfrescoInbox.js`, `useAssignmentInbox.js`, `api/alfresco.js`, `assignmentInbox.js`, `dispatchPersistence.js`, `DirectorPage.jsx`, `AssignmentsPage.jsx`, `DispatchPanel.jsx`, `App.css` y pruebas de transformación/renderizado.
- Nuevos: `responsibleColors.js`, su prueba, `ResponsibilityIndicator.jsx`, verificador Edge y este informe. `.gitignore` excluye las capturas locales.

## Resultado de validación

- `node --test backend/src/*.test.js frontend/src/utils/*.test.js`: **90 aprobadas, 0 fallidas**, incluidas integración HTTP, prueba de ACL con metadatos reutilizados y lecturas recientes por asociaciones secundarias.
- `npm run lint` y `npm run build` en `frontend`: aprobados.
- `node frontend/scripts/verify-dispatch-browser.mjs`: aprobado en Edge headless, aplicación de producción real con API local simulada. Se inspeccionaron las capturas completas de escritorio y móvil.
- GET de DEV: medición antes/después y confirmación de propiedades/JSON persistido. No se ejecutaron PUT reales ni pruebas sobre documentos institucionales reales.
- `.env.local`, modelo, propiedades, reglas de asignación y contenido del bloque de distribución DTI–DSA conservados. No se hizo commit ni push.

Pendiente: contrastar la respuesta completa y el DOM de la sesión DEV del usuario si persiste una diferencia con el navegador aislado. No se garantiza por estas mediciones el mismo tiempo en todas las identidades o tamaños de bandeja. La limitación de una instancia escritora y las reglas de autorización existentes no se alteran.
