# Gestión Documental UAC

Aplicación separada en frontend React/Vite y backend Node.js/Express.

## Estructura

- `frontend/`: interfaz, navegación y cliente de API.
- `backend/`: BFF, autenticación Alfresco, sesiones y autorización.

## Ejecución local

Requiere Node.js compatible con las dependencias del proyecto.

```powershell
cd backend
npm install
npm run dev
```

En otra terminal:

```powershell
cd frontend
npm install
npm run dev
```

Vite redirige `/api/*` al backend local. Copia las plantillas `.env.example` como `.env.local` y completa los valores únicamente en el backend.

## Autenticación y autorización

El backend crea un ticket Basic Auth en Alfresco, consulta la identidad y los grupos reales, y conserva el ticket en una sesión HttpOnly. La interfaz recibe únicamente la sesión pública, la dependencia y la función resueltas.

Los grupos funcionales son:

- `GROUP_GD_DTI` y `GROUP_GD_DSA`
- `GROUP_GD_DIRECCION`
- `GROUP_GD_JEFE_UNIDAD`
- `GROUP_GD_ESPECIALISTA`

## Bandejas y multi-filing

El envío entre dependencias utiliza `/api/documents/send-to-director`. Las carpetas de `Emitidos`, `Por atender` y `Por conocimiento` se configuran en `ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON`; los grupos destinatarios, en `ALFRESCO_OFFICE_GROUP_IDS_JSON`.

Las bandejas individuales se configuran en `ALFRESCO_USER_INBOX_NODE_IDS_JSON` y las unidades en `ALFRESCO_USER_UNIT_ASSIGNMENTS_JSON`. Los identificadores de nodos son configuración privada del backend y no deben exponerse como variables `VITE_*`.

## Estado de Keycloak

La integración OIDC permanece preparada, pero el login institucional no se activa hasta contar con el cliente autorizado y su redirect URI. No coloques secretos en `frontend/` ni en archivos versionados.
