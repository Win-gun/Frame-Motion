import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';
import express, { type ErrorRequestHandler } from 'express';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { AssetStore } from './assets';
import { JobQueue, downloadName } from './jobs';
import { clientJob, createNetworkGuard, loadPublicOrigin, resolveServerHost } from './network';

const loopbackHost = '127.0.0.1';
const port = Number(process.env.PORT || 5173);
const rendererBaseUrl = `http://${loopbackHost}:${port}`;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 30, fileSize: 40 * 1024 * 1024, parts: 35 },
});
export async function createApp() {
  const publicOrigin = await loadPublicOrigin();
  const host = resolveServerHost(publicOrigin);
  const configuredHost = publicOrigin ? new URL(publicOrigin).host : null;
  const assets = new AssetStore();
  await assets.init();
  const jobs = new JobQueue(assets, rendererBaseUrl);
  await jobs.init();
  const app = express();
  app.disable('x-powered-by');
  app.use(createNetworkGuard(port, publicOrigin));
  app.use(express.json({ limit: '5mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/demo', (_req, res) => res.json({ photos: assets.demos() }));
  app.post('/api/import', upload.array('photos', 30), async (req, res, next) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files?.length) return res.status(400).json({ error: 'No photos provided' });
      const photos = [];
      const errors: string[] = [];
      for (const file of files) {
        try {
          photos.push(await assets.import(file.originalname, file.buffer));
        } catch (e) {
          errors.push(`${file.originalname}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      res.status(photos.length ? 200 : 400).json({ photos, ...(errors.length ? { errors } : {}) });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/assets/:id/:variant', async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const variant = String(req.params.variant);
      if (!assets.get(id) || !['image', 'background'].includes(variant)) return res.sendStatus(404);
      const query = Number(req.query.blur ?? 28);
      if (variant === 'background' && (!Number.isInteger(query) || query < 0 || query > 100))
        return res.sendStatus(400);
      const hasW = req.query.w !== undefined,
        hasH = req.query.h !== undefined;
      if (variant === 'background' && hasW !== hasH) return res.sendStatus(400);
      const parseDimension = (input: unknown) =>
        typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : Number.NaN;
      const w = hasW ? parseDimension(req.query.w) : undefined,
        h = hasH ? parseDimension(req.query.h) : undefined;
      const validSize =
        w !== undefined &&
        h !== undefined &&
        Number.isInteger(w) &&
        Number.isInteger(h) &&
        w >= 240 &&
        w <= 8192 &&
        h >= 240 &&
        h <= 8192 &&
        w / h >= 0.2 &&
        w / h <= 5;
      if (variant === 'background' && hasW && !validSize) return res.sendStatus(400);
      const path =
        variant === 'image' ? assets.path(id, 'image') : await assets.background(id, query, w, h);
      if (!path) return res.sendStatus(404);
      res
        .type('jpeg')
        .set('Cache-Control', 'private, max-age=31536000')
        .sendFile(path, { dotfiles: 'allow' });
    } catch (e) {
      next(e);
    }
  });
  app.delete('/api/assets/:id', async (req, res, next) => {
    try {
      res.json({ deleted: await assets.remove(String(req.params.id)) });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/jobs', (_req, res) => res.json({ jobs: jobs.list().map(clientJob) }));
  app.post('/api/jobs', async (req, res, next) => {
    try {
      const recipes = req.body?.recipes;
      if (!Array.isArray(recipes) || recipes.length === 0 || recipes.length > 30)
        return res.status(400).json({ error: 'Expected 1–30 recipes' });
      const queued = await jobs.enqueue(recipes);
      res.status(202).json({ jobs: queued.map(clientJob) });
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/jobs/:id/cancel', async (req, res) => {
    const cancelled = await jobs.cancel(String(req.params.id));
    res.status(cancelled ? 200 : 404).json({ cancelled });
  });
  app.delete('/api/jobs/:id', async (req, res, next) => {
    try {
      const deleted = await jobs.remove(String(req.params.id));
      res.status(deleted ? 200 : 409).json({ deleted });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/jobs/:id/download', async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const file = jobs.file(id);
      const job = jobs.get(id);
      if (!file || !job) return res.sendStatus(404);
      await access(file);
      res.download(file, downloadName(job), { dotfiles: 'allow' });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/jobs/:id/preview', async (req, res, next) => {
    try {
      const file = jobs.file(String(req.params.id));
      if (!file) return res.sendStatus(404);
      await access(file);
      res
        .type(file.endsWith('.mov') ? 'video/quicktime' : 'video/mp4')
        .set('Cache-Control', 'private, no-cache')
        .sendFile(file, { dotfiles: 'allow', acceptRanges: true });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/download.zip', async (req, res, next) => {
    try {
      const ids = String(req.query.ids || '')
        .split(',')
        .filter(Boolean);
      if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length)
        return res.status(400).json({ error: 'Invalid ids' });
      const files = ids.map((id) => ({ id, file: jobs.file(id), job: jobs.get(id) }));
      if (files.some((item) => !item.file))
        return res.status(404).json({ error: 'Unknown or unfinished job' });
      for (const item of files) await access(item.file!);
      res.attachment('frame-motion.zip');
      const archive = archiver('zip', { zlib: { level: 1 } });
      archive.on('error', next);
      archive.pipe(res);
      for (const item of files) archive.file(item.file!, { name: downloadName(item.job!) });
      await archive.finalize();
    } catch (e) {
      next(e);
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route' }));
  const dist = resolve(process.cwd(), 'dist');
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(dist));
    app.get('/{*splat}', (_req, res) => res.sendFile(join(dist, 'index.html')));
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: loopbackHost,
        hmr: { host: loopbackHost, port: port === 5173 ? 24678 : port + 20000 },
      },
    });
    const staticFiles = express.static(dist);
    app.use((req, res, next) => {
      if (req.headers.host === configuredHost) return staticFiles(req, res, next);
      return vite.middlewares(req, res, next);
    });
    app.get('/', (req, res, next) =>
      req.headers.host === configuredHost ? res.sendFile(join(dist, 'index.html')) : next(),
    );
  }
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    const status =
      err instanceof multer.MulterError
        ? 400
        : err?.name === 'ZodError'
          ? 400
          : err?.message === 'Unknown photo asset'
            ? 400
            : 500;
    res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
    if (status === 500) console.error(err);
  };
  app.use(errors);
  return { app, assets, jobs, host };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createApp()
    .then(({ app, host }) =>
      app.listen(port, host, () => console.log(`Frame Motion ready at http://${host}:${port}`)),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
