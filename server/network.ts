import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RequestHandler } from 'express';
import type { RenderJob } from '../src/shared/types';

export function parsePublicOrigin(value: unknown): string {
  if (typeof value !== 'string' || !value || value !== value.trim())
    throw new Error('Invalid publicOrigin: expected an HTTPS ts.net or HTTP private IPv4 origin');

  const privateIpv4 = /^http:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?\/?$/.exec(
    value,
  );
  if (privateIpv4) {
    const octets = privateIpv4.slice(1, 5);
    const canonicalIpv4 = octets.every(
      (octet) => Number(octet) <= 255 && String(Number(octet)) === octet,
    );
    const [first, second] = octets.map(Number);
    const isPrivate =
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168);
    const port = privateIpv4[5];
    const legalPort =
      port === undefined ||
      (String(Number(port)) === port && Number(port) >= 1 && Number(port) <= 65535);
    if (canonicalIpv4 && isPrivate && legalPort) return new URL(value).origin;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid publicOrigin: expected an HTTPS ts.net or HTTP private IPv4 origin');
  }
  const tailnetHost =
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$/;
  if (
    url.protocol !== 'https:' ||
    !tailnetHost.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (value.toLowerCase() !== url.origin.toLowerCase() &&
      value.toLowerCase() !== `${url.origin}/`.toLowerCase())
  )
    throw new Error('Invalid publicOrigin: expected a root HTTPS ts.net origin');
  return url.origin;
}

export function resolveServerHost(
  publicOrigin: string | null,
  envValue = process.env.FRAME_MOTION_HOST,
): '127.0.0.1' | '0.0.0.0' {
  if (envValue === undefined || envValue === '127.0.0.1') return '127.0.0.1';
  if (envValue !== '0.0.0.0')
    throw new Error('Invalid FRAME_MOTION_HOST: expected 127.0.0.1 or 0.0.0.0');
  if (!publicOrigin)
    throw new Error('FRAME_MOTION_HOST=0.0.0.0 requires FRAME_MOTION_PUBLIC_ORIGIN or network.json');
  return '0.0.0.0';
}

export async function loadPublicOrigin(options?: {
  envValue?: string;
  configPath?: string;
}): Promise<string | null> {
  const envValue = options?.envValue ?? process.env.FRAME_MOTION_PUBLIC_ORIGIN;
  if (envValue !== undefined) return parsePublicOrigin(envValue);
  const configPath = options?.configPath ?? resolve(process.cwd(), '.frame-motion/network.json');
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error('Invalid network.json: expected JSON with publicOrigin');
  }
  if (!config || typeof config !== 'object' || !('publicOrigin' in config))
    throw new Error('Invalid network.json: missing publicOrigin');
  return parsePublicOrigin(config.publicOrigin);
}

export function createNetworkGuard(port: number, publicOrigin: string | null): RequestHandler {
  const localOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const configuredHost = publicOrigin ? new URL(publicOrigin).host : null;
  return (req, res, next) => {
    const requestHost = req.headers.host || '';
    if (!localHosts.has(requestHost) && requestHost !== configuredHost)
      return res.status(403).json({ error: 'Local or configured host required' });
    const origin = req.headers.origin;
    if (origin && !localOrigins.has(origin) && origin !== publicOrigin)
      return res.status(403).json({ error: 'Cross-origin request denied' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return res.status(403).json({ error: 'Cross-site request denied' });
      if (!origin && req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
        return res.status(403).json({ error: 'Invalid content type' });
    }
    next();
  };
}

function relativeAssetUrl(value: string, fallback: string): string {
  try {
    const parsed = new URL(value, 'http://127.0.0.1');
    if (parsed.pathname === fallback.split('?')[0] && !parsed.hash)
      return `${parsed.pathname}${parsed.search}`;
  } catch {
    // Older persisted jobs may contain an invalid URL; use its asset ID.
  }
  return fallback;
}

export function clientJob(job: RenderJob): RenderJob {
  const image = job.recipe.image;
  const id = encodeURIComponent(image.id);
  return {
    ...job,
    error: job.error?.replaceAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g, ''),
    recipe: {
      ...job.recipe,
      image: {
        ...image,
        src: relativeAssetUrl(image.src, `/api/assets/${id}/image`),
        backgroundSrc: relativeAssetUrl(
          image.backgroundSrc,
          `/api/assets/${id}/background?blur=28`,
        ),
      },
    },
  };
}
