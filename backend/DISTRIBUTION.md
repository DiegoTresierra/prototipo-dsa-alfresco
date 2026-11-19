# Activar la distribución documental en DEV

La carga en Emitidos y los permisos del PDF se ejecutan con la sesión emisora.
La cuenta `gd_distribucion` solo consulta el original y crea la asociación secundaria
`cm:contains` en la carpeta destinataria configurada por el servidor. No copia el PDF,
no cambia sus propiedades y no reemplaza la identidad del usuario.

## Configuración privada del backend

Agregar o actualizar únicamente estas variables en el entorno que carga el BFF:

```dotenv
ALFRESCO_DISTRIBUTION_USERNAME=gd_distribucion
ALFRESCO_DISTRIBUTION_PASSWORD=CONTRASEÑA_REAL_CONFIGURADA_PRIVADAMENTE
```

No enviar la contraseña por chat, no usar variables `VITE_*`, no incluirla en Git.
También se admite el par `ALFRESCO_DISTRIBUTION_SERVICE_USERNAME` y
`ALFRESCO_DISTRIBUTION_SERVICE_PASSWORD`. Si se configura ese usuario, se utiliza
ese par completo, sin mezclar contraseñas entre las dos convenciones.
El BFF conserva el ticket de servicio en memoria por un máximo de cinco minutos antes
de renovarlo. Una respuesta 401 de lectura o asociación invalida el ticket almacenado;
el siguiente reintento autentica otra vez, conservando el mismo nodo.

Copiar de `.env.example` la variable `ALFRESCO_OFFICE_INBOX_NODE_IDS_JSON`, que contiene
los seis UUID proporcionados para DEV. No reemplazar el resto del entorno. Confirmar
los IDs reales de los grupos en `ALFRESCO_OFFICE_GROUP_IDS_JSON`; los nombres del
ejemplo no sustituyen la comprobación de pertenencia de los destinatarios.

Reiniciar el BFF después de configurar las variables. La ausencia de contraseña o un
fallo de autenticación detiene un envío nuevo antes de crear el documento.

## Permisos de la cuenta de servicio

- Lector / Consumer en Emitidos DTI y Emitidos DSA.
- Contribuidor / Contributor en Por atender y Por conocimiento de ambas dependencias.
- Sin pertenencia a grupos administrativos ni a funciones de director.

La carpeta destinataria se resuelve exclusivamente desde la dependencia y categoría
validadas en el BFF. El cliente no puede elegir una carpeta arbitraria para la cuenta
de servicio. Para recuperar un nodo, el BFF verifica primero con la identidad emisora
que sea un PDF propio situado en Emitidos de su dependencia.

## Comprobación en DEV

1. Recuperar el envío pendiente mediante **Reintentar solo la distribución** en la
   pestaña que conserva su ID. No volver a cargar el PDF.
2. Iniciar sesión como director destinatario y comprobar la bandeja **Por atender**.
3. Abrir el PDF desde esa sesión y verificar que su ID coincide con el de Emitidos.
4. Repetir en dirección contraria con un documento de prueba autorizado.
5. Comprobar que un tercero no autorizado no pueda leer el mismo nodo por su ID.

Si se perdió la pestaña, conservar el ID para reconciliar el envío pendiente; no
crear otro documento para sustituirlo. El registro actual de recuperación vive en
sessionStorage, no constituye una cola persistente de entregas entre dispositivos.

El formulario de directores envía actualmente a Por atender. El endpoint también
admite Por conocimiento y esa categoría está cubierta por pruebas simuladas.

## Pruebas locales

Desde `backend`, ejecutar `npm test`. Las pruebas HTTP simulan Alfresco y verifican
ambas direcciones, ambas categorías, separación de credenciales, fallos de acceso,
reintentos sin nueva carga y rechazo de nodos ajenos. No sustituyen la validación DEV.
