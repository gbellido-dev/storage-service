# storage-service

Servicio independiente en Node.js + TypeScript para abstraer almacenamiento de archivos usando una interfaz única.

Proveedores soportados:
- local
- nfs
- google_drive

No incluye S3 ni MinIO.

## Objetivo

Consumir cualquier proveedor con la misma API:

- upload
- download
- delete
- exists
- getMetadata
- list (opcional)

La lógica de negocio no necesita saber dónde se almacena físicamente el archivo.

## Arquitectura

- `StorageProvider` define contrato común.
- `FilesystemStorageProvider` encapsula lógica compartida para disco local/NFS.
- `LocalStorageProvider` y `NfsStorageProvider` heredan de la base.
- `GoogleDriveStorageProvider` usa `googleapis` y `fileId` como `storageId`.
- `createStorageProvider` selecciona implementación por configuración.
- Express solo expone API de pruebas y página `/test`.

## Instalación

1. Copia configuración:
   - `cp .env.example .env` (o copia manual en Windows)
2. Instala dependencias:
   - `npm install`
3. Desarrollo:
   - `npm run dev`
4. Build y ejecución:
   - `npm run build`
   - `npm start`

## Variables de entorno

Ver `.env.example`.

Principales:
- `PORT`
- `STORAGE_PROVIDER=local|nfs|google_drive`
- `MAX_FILE_SIZE_MB`
- `LOCAL_STORAGE_PATH`
- `NFS_STORAGE_PATH`
- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_APPLICATION_CREDENTIALS`

## Local Storage

- Guarda archivos en `LOCAL_STORAGE_PATH`.
- Nombre físico interno: UUID + extensión segura.
- Conserva `originalName` en metadata sidecar `.metadata.json`.
- `storageId` es ruta lógica relativa.

## NFS

- Funciona igual que local, pero en `NFS_STORAGE_PATH`.
- El montaje NFS lo hace el sistema operativo, no la aplicación.

### Montar NFS en Linux (ejemplo)

```bash
sudo mkdir -p /mnt/app-files
sudo mount -t nfs <server>:/<export-path> /mnt/app-files
```

Persistente (ejemplo `/etc/fstab`):

```text
<server>:/<export-path> /mnt/app-files nfs defaults,_netdev 0 0
```

## Google Drive

- Backend server-to-server con credenciales de Service Account.
- Usa `GOOGLE_APPLICATION_CREDENTIALS` para JSON de credenciales.
- `GOOGLE_DRIVE_FOLDER_ID` define carpeta raíz de almacenamiento.
- `storageId` es siempre `fileId` de Drive.
- Descarga por `files.get` con `alt=media`.
- Metadatos adicionales se guardan en `appProperties` cuando aplica.

### Compartir carpeta con Service Account

1. Crea carpeta en Drive (ejemplo: `APP_STORAGE`).
2. Comparte esa carpeta con el email de la Service Account.
3. Usa el ID de esa carpeta como `GOOGLE_DRIVE_FOLDER_ID`.

## Cambiar de proveedor

Solo cambiar `STORAGE_PROVIDER` y variables asociadas. No se requieren cambios en código consumidor.

## Página de pruebas

- URL: `http://localhost:3000/test`
- Permite:
  - Subir archivo
  - Consultar exists
  - Ver metadata
  - Descargar
  - Eliminar
  - Listar archivos

## Endpoints

- `GET /`
- `POST /upload`
- `GET /metadata?id=<storageId>`
- `GET /download?id=<storageId>`
- `GET /exists?id=<storageId>`
- `DELETE /file?id=<storageId>`
- `GET /files?prefix=<optional>`
- `GET /test`

## Ejemplos curl

Upload:

```bash
curl -X POST http://localhost:3000/upload \
  -F "file=@./sample.pdf" \
  -F "courseId=asir2" \
  -F "assignmentId=23" \
  -F "userId=154"
```

Metadata:

```bash
curl "http://localhost:3000/metadata?id=files%2F<uuid>.pdf"
```

Exists:

```bash
curl "http://localhost:3000/exists?id=files%2F<uuid>.pdf"
```

Download:

```bash
curl -L "http://localhost:3000/download?id=files%2F<uuid>.pdf" -o downloaded.pdf
```

Delete:

```bash
curl -X DELETE "http://localhost:3000/file?id=files%2F<uuid>.pdf"
```

List:

```bash
curl "http://localhost:3000/files"
```

## Seguridad aplicada

- Validación de entrada básica.
- Límite máximo de tamaño por `MAX_FILE_SIZE_MB`.
- Sanitización de componentes de ruta.
- Bloqueo de path traversal.
- Nombres físicos con UUID.
- Descarga exclusivamente por API.
- Secretos fuera del repositorio (`.env` ignorado).

## Integración futura con PostgreSQL

`StoredFile` devuelve datos suficientes para persistir luego en tabla `files`:

- provider
- storageId
- originalName
- mimeType
- size
- sha256
- createdAt

Los sidecars actuales de local/NFS son temporales para pruebas y pueden eliminarse cuando PostgreSQL sea la fuente de verdad.

## Estructura

```text
storage-service/
  src/
    config/
    errors/
    storage/
      base/
      local/
      nfs/
      google-drive/
    types/
    utils/
    index.ts
  uploads/
  downloads/
  .env.example
  .gitignore
  package.json
  tsconfig.json
  vitest.config.ts
```
