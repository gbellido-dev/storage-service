@echo off
setlocal

cd /d "%~dp0"

echo [storage-service] Iniciando en modo Google Drive...

if not exist ".env" (
  if exist ".env.example" (
    echo [storage-service] No existe .env, copiando desde .env.example
    copy /Y ".env.example" ".env" >nul
    echo [storage-service] IMPORTANTE: completa GOOGLE_DRIVE_FOLDER_ID y GOOGLE_APPLICATION_CREDENTIALS en .env
  ) else (
    echo [storage-service] ERROR: no existe .env ni .env.example
    exit /b 1
  )
)

if not exist "node_modules" (
  echo [storage-service] Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo [storage-service] ERROR: fallo en npm install
    exit /b 1
  )
)

set STORAGE_PROVIDER=google_drive

echo [storage-service] Provider forzado: %STORAGE_PROVIDER%
start "storage-service-drive-dev" cmd /k "npm run dev"

echo [storage-service] Abriendo navegador en http://localhost:3000/test
start "" "http://localhost:3000/test"

endlocal
