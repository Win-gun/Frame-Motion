import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';
import type { RenderJob } from '../src/shared/types';
import {
  clientJob,
  createNetworkGuard,
  loadPublicOrigin,
  parsePublicOrigin,
  resolveServerHost,
} from '../server/network';

const publicOrigin = 'https://example.tail123.ts.net';

test('network configuration permits only a root HTTPS ts.net origin', async () => {
  assert.equal(parsePublicOrigin(`${publicOrigin}/`), publicOrigin);
  for (const value of [
    'http://example.tail123.ts.net',
    'https://evil.example.com',
    'https://example.tail123.ts.net.evil.com',
    'https://user:pass@example.tail123.ts.net',
    `${publicOrigin}/nested`,
    `${publicOrigin}/nested/..`,
    `${publicOrigin}/?x=1`,
    `${publicOrigin}/#fragment`,
    '',
  ])
    assert.throws(() => parsePublicOrigin(value), value);

  const dir = await mkdtemp(join(tmpdir(), 'frame-motion-network-'));
  const path = join(dir, 'network.json');
  try {
    assert.equal(await loadPublicOrigin({ configPath: path }), null);
    await writeFile(path, JSON.stringify({ publicOrigin }));
    assert.equal(await loadPublicOrigin({ configPath: path }), publicOrigin);
    assert.equal(
      await loadPublicOrigin({ configPath: path, envValue: 'https://other.tail123.ts.net' }),
      'https://other.tail123.ts.net',
    );
    await writeFile(path, '{bad');
    await assert.rejects(loadPublicOrigin({ configPath: path }));
    await writeFile(path, JSON.stringify({ publicOrigin: 'https://evil.com' }));
    await assert.rejects(loadPublicOrigin({ configPath: path }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('network configuration accepts only canonical RFC1918 HTTP origins', () => {
  for (const value of [
    'http://10.0.0.0',
    'http://10.255.255.255/',
    'http://172.16.0.0:5173',
    'http://172.31.255.255:65535/',
    'http://192.168.0.0:1',
    'http://192.168.255.255:80',
  ])
    assert.equal(parsePublicOrigin(value), new URL(value).origin, value);

  for (const value of [
    'https://192.168.1.50:5173',
    'http://9.255.255.255:5173',
    'http://11.0.0.0:5173',
    'http://172.15.255.255:5173',
    'http://172.32.0.0:5173',
    'http://192.167.255.255:5173',
    'http://192.169.0.0:5173',
    'http://127.0.0.1:5173',
    'http://169.254.1.1:5173',
    'http://8.8.8.8:5173',
    'http://localhost:5173',
    'http://router.local:5173',
    'http://user:pass@192.168.1.50:5173',
    'http://192.168.1.50.evil.example:5173',
    'http://192.168.1.50:0',
    'http://192.168.1.50:65536',
    'http://192.168.1.50:05173',
    'http://0192.168.1.50:5173',
    'http://0xa.21.247.110:5173',
    'http://167772161:5173',
    'http://192.168.1.50:5173/nested',
    'http://192.168.1.50:5173/?x=1',
    'http://192.168.1.50:5173/#fragment',
  ])
    assert.throws(() => parsePublicOrigin(value), value);
});

test('server host defaults to loopback and requires an origin for bind-all', () => {
  assert.equal(resolveServerHost(null, undefined), '127.0.0.1');
  assert.equal(resolveServerHost(null, '127.0.0.1'), '127.0.0.1');
  assert.equal(resolveServerHost('http://192.168.1.50:5173', '0.0.0.0'), '0.0.0.0');
  assert.throws(() => resolveServerHost(null, '0.0.0.0'), /requires/);
  for (const value of ['', 'localhost', '192.168.1.50', '::', '::0'])
    assert.throws(() => resolveServerHost(publicOrigin, value), value);
});

async function withGuard(
  origin: string | null,
  run: (
    send: (headers: Record<string, string>, method?: string) => Promise<number>,
  ) => Promise<void>,
) {
  const app = express();
  app.use(createNetworkGuard(5173, origin));
  app.all('/probe', (_req, res) => res.sendStatus(204));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== 'string');
    const send = (headers: Record<string, string>, method = 'GET') =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          { hostname: '127.0.0.1', port: address.port, path: '/probe', method, headers },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode || 0));
          },
        );
        req.on('error', reject);
        req.end();
      });
    await run(send);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('configured tailnet host and origin are exact, and cross-site writes stay blocked', async () => {
  await withGuard(publicOrigin, async (send) => {
    const tailnet = 'example.tail123.ts.net';
    assert.equal(await send({ Host: tailnet, Origin: publicOrigin }), 204);
    assert.equal(await send({ Host: '127.0.0.1:5173', Origin: publicOrigin }, 'POST'), 204);
    assert.equal(await send({ Host: tailnet, Origin: publicOrigin }, 'POST'), 204);
    assert.equal(await send({ Host: tailnet, Origin: 'https://evil.ts.net' }, 'POST'), 403);
    assert.equal(await send({ Host: 'evil.ts.net', Origin: publicOrigin }), 403);
    assert.equal(
      await send({ Host: 'evil.ts.net', 'X-Forwarded-Host': tailnet, Origin: publicOrigin }),
      403,
    );
    assert.equal(
      await send({ Host: tailnet, Origin: publicOrigin, 'Sec-Fetch-Site': 'cross-site' }, 'POST'),
      403,
    );
  });
  await withGuard(null, async (send) => {
    assert.equal(await send({ Host: 'example.tail123.ts.net' }), 403);
    assert.equal(await send({ Host: '127.0.0.1:5173', Origin: publicOrigin }), 403);
    assert.equal(await send({ Host: '127.0.0.1:5173' }), 204);
  });
});

test('configured LAN host and origin are exact for writes', async () => {
  const lanOrigin = 'http://192.168.1.50:5173';
  await withGuard(lanOrigin, async (send) => {
    assert.equal(
      await send({ Host: '192.168.1.50:5173', Origin: lanOrigin }, 'POST'),
      204,
    );
    assert.equal(
      await send({ Host: '192.168.1.50:5173', Origin: 'http://192.168.1.51:5173' }, 'POST'),
      403,
    );
    assert.equal(
      await send({ Host: '192.168.1.51:5173', Origin: lanOrigin }, 'POST'),
      403,
    );
    assert.equal(
      await send(
        {
          Host: 'evil.example',
          'X-Forwarded-Host': '192.168.1.50:5173',
          Origin: lanOrigin,
        },
        'POST',
      ),
      403,
    );
  });
});

test('job DTO uses relative image URLs without changing renderer job', () => {
  const internal = `http://127.0.0.1:5173/api/assets/photo-1`;
  const job = {
    id: 'job-1',
    name: 'Photo',
    status: 'queued',
    progress: 0,
    renderedFrames: 0,
    totalFrames: 24,
    createdAt: 1,
    recipe: {
      image: {
        id: 'photo-1',
        name: 'Photo',
        src: `${internal}/image`,
        backgroundSrc: `${internal}/background?blur=28`,
      },
    },
  } as RenderJob;
  const dto = clientJob(job);
  assert.equal(dto.recipe.image.src, '/api/assets/photo-1/image');
  assert.equal(dto.recipe.image.backgroundSrc, '/api/assets/photo-1/background?blur=28');
  assert.equal(job.recipe.image.src, `${internal}/image`);
  assert.equal(job.recipe.image.backgroundSrc, `${internal}/background?blur=28`);
  assert(!JSON.stringify(dto).includes('127.0.0.1'));
});
