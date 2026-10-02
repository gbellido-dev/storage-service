import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

import { createStorageProvider } from './storage/StorageProviderFactory.js';
import { loadStorageConfig } from './config/storage.config.js';
import { StorageError } from './errors/StorageError.js';
import type { UploadContext } from './types/storage.types.js';

const config = loadStorageConfig();
const storageProvider = createStorageProvider(config);

const app = express();
const upload = multer({
  dest: path.join(os.tmpdir(), 'storage-service-upload-tmp'),
  limits: {
    fileSize: config.maxFileSizeBytes,
  },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.json({
    service: 'storage-service',
    provider: config.provider,
    status: 'ok',
  });
});

app.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new StorageError('INVALID_INPUT', 'file is required in multipart form-data', 400);
  }

  const context = readContext(req);
  const fileStream = createReadStream(req.file.path);

  try {
    const result = await storageProvider.upload({
      stream: fileStream,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      context,
    });

    res.status(201).json(serializeStoredFile(result));
  } finally {
    await fs.rm(req.file.path, { force: true });
  }
}));

app.get('/metadata', asyncHandler(async (req, res) => {
  const id = readStorageIdQuery(req);
  const metadata = await storageProvider.getMetadata(id);
  res.json(serializeStoredFile(metadata));
}));

app.get('/download', asyncHandler(async (req, res) => {
  const id = readStorageIdQuery(req);
  const metadata = await storageProvider.getMetadata(id);
  const stream = await storageProvider.download(id);

  res.setHeader('Content-Type', metadata.mimeType ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDispositionAttachment(metadata.originalName));
  stream.pipe(res);
}));

app.get('/exists', asyncHandler(async (req, res) => {
  const id = readStorageIdQuery(req);
  const exists = await storageProvider.exists(id);
  res.json({ exists });
}));

app.delete('/file', asyncHandler(async (req, res) => {
  const id = readStorageIdQuery(req);
  await storageProvider.delete(id);
  res.json({ deleted: true });
}));

app.get('/files', asyncHandler(async (req, res) => {
  if (!storageProvider.list) {
    throw new StorageError('NOT_SUPPORTED', 'Current provider does not support list', 501);
  }

  const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
  const files = await storageProvider.list(prefix);
  res.json(files.map(serializeStoredFile));
}));

app.get('/test', (_req, res) => {
  res.type('html').send(renderTestPage(config.provider));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const isMulterError = typeof error === 'object' && error !== null && 'code' in error;
  if (isMulterError && (error as { code?: string }).code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'FILE_TOO_LARGE',
      message: `Max file size is ${config.maxFileSizeMb} MB`,
    });
  }

  if (error instanceof StorageError) {
    console.error(error);
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
    });
  }

  console.error(error);
  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'Unexpected error',
  });
});

app.listen(config.port, () => {
  console.log(`storage-service listening on http://localhost:${config.port}`);
  console.log(`active provider: ${config.provider}`);
});

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

function readStorageIdQuery(req: Request): string {
  const id = req.query.id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new StorageError('INVALID_INPUT', 'Query parameter id is required', 400);
  }
  return id;
}

function readContext(req: Request): UploadContext | undefined {
  const read = (value: unknown): string | undefined => {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed || undefined;
  };

  const context: UploadContext = {
    courseId: read(req.body.courseId),
    assignmentId: read(req.body.assignmentId),
    userId: read(req.body.userId),
  };

  if (!context.courseId && !context.assignmentId && !context.userId) {
    return undefined;
  }

  return context;
}

function serializeStoredFile(file: {
  provider: string;
  storageId: string;
  originalName: string;
  mimeType?: string;
  size: number;
  sha256: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}) {
  return {
    ...file,
    createdAt: file.createdAt.toISOString(),
  };
}

function contentDispositionAttachment(filename: string): string {
  const escaped = filename.replace(/"/g, '');
  return `attachment; filename="${escaped}"`;
}

function renderTestPage(provider: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>storage-service test</title>
  <style>
    :root {
      --bg: #f2f4f8;
      --card: #ffffff;
      --text: #12202f;
      --muted: #4f6378;
      --accent: #0c7c59;
      --accent-2: #f4b400;
      --border: #d9e0ea;
      --danger: #b42318;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      color: var(--text);
      background: radial-gradient(circle at top right, #d7efe7 0%, var(--bg) 45%);
      min-height: 100vh;
      padding: 24px;
    }

    .layout {
      max-width: 980px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
      grid-template-columns: 1fr;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
      box-shadow: 0 8px 24px rgba(12, 124, 89, 0.08);
    }

    h1, h2 { margin-top: 0; }
    .muted { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }

    input, button, select {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      font-size: 14px;
    }

    button {
      background: linear-gradient(120deg, var(--accent), #0ea271);
      color: white;
      border: none;
      cursor: pointer;
      font-weight: 600;
      transition: transform 0.12s ease;
    }

    button:hover { transform: translateY(-1px); }
    button.secondary { background: #1a2736; }
    button.warn { background: var(--danger); }

    pre {
      overflow: auto;
      margin: 0;
      padding: 12px;
      border-radius: 10px;
      background: #0f1720;
      color: #e7f1ff;
      min-height: 200px;
    }

    .row {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      align-items: end;
    }
  </style>
</head>
<body>
  <main class="layout">
    <section class="card">
      <h1>storage-service</h1>
      <p class="muted">Provider activo: <strong>${provider}</strong></p>
      <p class="muted">Pruebas mínimas de upload, exists, metadata, download, delete y list.</p>
    </section>

    <section class="card">
      <h2>Upload</h2>
      <form id="uploadForm">
        <div class="grid">
          <input type="file" name="file" required />
          <input type="text" name="courseId" placeholder="courseId (ej: asir2)" />
          <input type="text" name="assignmentId" placeholder="assignmentId (ej: 23)" />
          <input type="text" name="userId" placeholder="userId (ej: 154)" />
        </div>
        <div style="margin-top:12px">
          <button type="submit">Subir archivo</button>
        </div>
      </form>
    </section>

    <section class="card">
      <h2>CRUD por storageId</h2>
      <div class="row">
        <input id="storageId" type="text" placeholder="storageId" />
        <button id="existsBtn" type="button" class="secondary">Existe</button>
        <button id="metadataBtn" type="button" class="secondary">Metadatos</button>
        <button id="downloadBtn" type="button" class="secondary">Descargar</button>
        <button id="deleteBtn" type="button" class="warn">Eliminar</button>
      </div>
      <div style="margin-top:12px" class="row">
        <input id="prefix" type="text" placeholder="prefix opcional para list" />
        <button id="listBtn" type="button">Listar archivos</button>
      </div>
    </section>

    <section class="card">
      <h2>Resultado</h2>
      <pre id="result">Esperando acciones...</pre>
    </section>
  </main>

  <script>
    const resultEl = document.getElementById('result');
    const storageIdEl = document.getElementById('storageId');
    const prefixEl = document.getElementById('prefix');

    function print(data) {
      resultEl.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }

    async function api(url, options) {
      const response = await fetch(url, options);
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await response.json() : await response.text();

      if (!response.ok) {
        throw new Error(typeof body === 'string' ? body : JSON.stringify(body));
      }

      return body;
    }

    document.getElementById('uploadForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(event.target);
      try {
        const result = await api('/upload', { method: 'POST', body: formData });
        print(result);
        storageIdEl.value = result.storageId || '';
      } catch (error) {
        print(String(error));
      }
    });

    document.getElementById('existsBtn').addEventListener('click', async () => {
      try { print(await api('/exists?id=' + encodeURIComponent(storageIdEl.value))); }
      catch (error) { print(String(error)); }
    });

    document.getElementById('metadataBtn').addEventListener('click', async () => {
      try { print(await api('/metadata?id=' + encodeURIComponent(storageIdEl.value))); }
      catch (error) { print(String(error)); }
    });

    document.getElementById('downloadBtn').addEventListener('click', () => {
      const id = encodeURIComponent(storageIdEl.value);
      window.location.href = '/download?id=' + id;
    });

    document.getElementById('deleteBtn').addEventListener('click', async () => {
      try { print(await api('/file?id=' + encodeURIComponent(storageIdEl.value), { method: 'DELETE' })); }
      catch (error) { print(String(error)); }
    });

    document.getElementById('listBtn').addEventListener('click', async () => {
      const prefix = prefixEl.value ? ('?prefix=' + encodeURIComponent(prefixEl.value)) : '';
      try { print(await api('/files' + prefix)); }
      catch (error) { print(String(error)); }
    });
  </script>
</body>
</html>`;
}
