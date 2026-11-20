# Gestión documental con Alfresco

Frontend React/Vite y backend Express para distribución entre Direcciones, despacho interno, atención individual y preparación de respuestas documentales. Alfresco es la fuente de verdad documental e institucional; Keycloak participa en autenticación.

## Estado y límites

- Despacho y atención utilizan asignaciones equivalentes sobre un mismo UUID original.
- El organigrama JSON es provisional y no concede permisos.
- Jefatura no deriva a Especialista sin supervisión institucional verificable.
- Propuestas, decisiones e integración de emisión aprobada son servicios internos preparados y probados con mocks, sin rutas mutables productivas.
- La emisión oficial requiere habilitación independiente; no se activa por instalar, compilar o verificar el modelo.
- No hay garantía distribuida: el piloto requiere una instancia y escritor exclusivo.

## Instalación local

Se necesita Node.js compatible con Vite y las dependencias del backend. Las suites actuales usan Node.js 22 o posterior; para la regresión Edge se requiere además un runtime con WebSocket global (por ejemplo Node.js 22) y Edge instalado.

Desde la raíz:

```powershell
npm --prefix backend ci
npm --prefix frontend ci
if (-not (Test-Path backend/.env.local)) { Copy-Item backend/.env.example backend/.env.local }
if (-not (Test-Path frontend/.env.local)) { Copy-Item frontend/.env.example frontend/.env.local }
```

Copiar las plantillas únicamente si los archivos privados no existen. No sobrescribir configuraciones locales. Completar en privado destino, cliente OIDC, secreto de sesión, credencial técnica y mapeos institucionales verificados. Las plantillas vacías no son un entorno listo para usar.

Ejecutar en dos terminales:

```powershell
npm --prefix backend run dev
npm --prefix frontend run dev
```

Vite publica bajo la base definida en su configuración y redirige /api al backend local. En despliegue se necesita servir el frontend y mantener el BFF Express con sesiones y cookies; un hosting estático por sí solo no ejecuta el backend. La configuración de GitHub Pages existente requiere revisión: sus comandos npm apuntan a la raíz, pero los paquetes están en backend y frontend.

Nunca colocar credenciales en variables VITE: se incluyen en el cliente. Ningún secreto, UUID operativo, URL interna o evidencia DEV debe copiarse a documentación compartida.

## Documentación vigente

| Tema | Guía |
| --- | --- |
| Arquitectura, identidad y seguridad | [Arquitectura y seguridad](backend/ARCHITECTURE_AND_SECURITY.md) |
| Jerarquía, directorio y despacho | [Despacho interno](backend/INTERNAL_DISPATCH.md) |
| Atención individual y respuestas | [Atención](backend/ATTENTION_FLOW.md) |
| Configuración y operación controlada | [Piloto Alfresco](backend/ALFRESCO_DISPATCH_PILOT.md) |
| Emisión, correlativos y conciliación | [Emisión oficial](backend/OFFICIAL_EMISSION_INTEGRATION.md) |
| Modelo y verificación | [Contrato CMM](backend/alfresco-model/EMISSION_CMM.md) |
| Comprobaciones con sesiones finales | [Lectura autorizada](backend/READ_ACCESS_CHECKS.md) |
| Propuestas, versiones y recuperación | [Propuestas](backend/RESPONSE_PROPOSALS.md) |
| Presentación, observaciones y aprobación | [Decisiones](backend/REVIEW_DECISIONS.md) |
| Emisión desde una aprobación | [Integración aprobada](backend/APPROVED_RESPONSE_EMISSION.md) |
| Evaluación, evidencias y cierre simulado | [Cierre documental V0.1](backend/DOCUMENT_CLOSURE.md) |

## Validación sin escrituras reales

```powershell
node --test backend/src/*.test.js frontend/src/utils/*.test.js
npm --prefix frontend run lint
npm --prefix frontend run build
node frontend/scripts/verify-dispatch-browser.mjs
git diff --check
```

Las pruebas de escritura usan fixtures y Edge utiliza una API local simulada. Sus artefactos están ignorados. Los verificadores administrativos GET consultan el destino configurado y requieren autorización separada para ejecutarse en un entorno institucional.

## Documentos privados

Los informes históricos, manifiestos operativos, respaldos y evidencias se conservan fuera del repositorio, con control de acceso y manifiesto SHA-256. Los documentos de código describen contratos; no reproducen inventarios DEV, cuentas personales ni resultados de sesiones institucionales.

Retirar un archivo del árbol actual no lo elimina del historial publicado. Cualquier tratamiento del historial requiere revisión y autorización independiente.
