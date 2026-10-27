import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { createRecipe } from '../src/shared/recipe';
import type { PhotoAsset, RenderJob, VideoRecipe } from '../src/shared/types';

const run = promisify(execFile);
const base = process.env.RENDER_BASE_URL || 'http://127.0.0.1:5173';
const artifacts = resolve(process.cwd(), '.frame-motion', 'verification');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
  return body as T;
}
async function upload(name: string, data: Buffer, mime = 'image/jpeg'): Promise<PhotoAsset> {
  const form = new FormData();
  form.append('photos', new Blob([new Uint8Array(data)], { type: mime }), name);
  const result = await json<{ photos: PhotoAsset[]; errors?: string[] }>('/api/import', {
    method: 'POST',
    body: form,
  });
  assert.equal(result.photos.length, 1, `upload ${name}: ${result.errors?.join(',')}`);
  return result.photos[0];
}
async function waitDone(ids: string[], timeoutMs = 15 * 60_000): Promise<RenderJob[]> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const { jobs } = await json<{ jobs: RenderJob[] }>('/api/jobs');
    const selected = ids.map((id) => jobs.find((j) => j.id === id));
    if (selected.every((j) => j && ['done', 'failed', 'cancelled'].includes(j.status)))
      return selected as RenderJob[];
    await wait(1500);
  }
  throw new Error(`Timed out waiting for jobs: ${ids.join(',')}`);
}
async function verifyVideo(
  job: RenderJob,
  expect: { width: number; height: number; fps: number; frames: number; codec?: 'h264' | 'prores' },
) {
  assert.equal(job.status, 'done', `Render ${job.id}: ${job.error}`);
  const codec = expect.codec || 'h264';
  const output = join(artifacts, `${job.id}.${codec === 'prores' ? 'mov' : 'mp4'}`);
  const response = await fetch(`${base}/api/jobs/${job.id}/download`);
  assert.equal(response.status, 200);
  assert(response.headers.get('content-disposition')?.includes(job.id.slice(0, 8)));
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-count_frames',
    '-show_entries',
    'stream=codec_type,codec_name,pix_fmt,color_range,color_space,width,height,avg_frame_rate,nb_read_frames',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    output,
  ]);
  const probe = JSON.parse(stdout) as {
    streams: {
      codec_type: string;
      codec_name?: string;
      pix_fmt?: string;
      color_range?: string;
      color_space?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      nb_read_frames?: string;
    }[];
    format: { duration: string };
  };
  const video = probe.streams.find((s) => s.codec_type === 'video');
  assert(video, 'No video stream');
  assert.equal(video.codec_name, codec);
  assert.equal(video.pix_fmt, codec === 'prores' ? 'yuv422p10le' : 'yuv420p');
  if (codec === 'h264') {
    assert.equal(video.color_range, 'tv');
    assert.equal(video.color_space, 'bt709');
  }
  assert.equal(video.width, expect.width);
  assert.equal(video.height, expect.height);
  assert.equal(video.avg_frame_rate, `${expect.fps}/1`);
  assert.equal(Number(video.nb_read_frames), expect.frames);
  assert.equal(probe.streams.filter((s) => s.codec_type === 'audio').length, 0);
  assert(Math.abs(Number(probe.format.duration) - expect.frames / expect.fps) < 0.08);
  const frameNumbers = [
    0,
    Math.round(expect.frames * 0.18),
    Math.round(expect.frames * 0.5),
    expect.frames - 1,
  ];
  for (const [index, frame] of frameNumbers.entries()) {
    await run('ffmpeg', [
      '-v',
      'error',
      '-i',
      output,
      '-vf',
      `select=eq(n\\,${frame})`,
      '-frames:v',
      '1',
      '-update',
      '1',
      join(artifacts, `${job.id}-frame-${index}.png`),
    ]);
  }
  const { frames: frameCount, ...spec } = expect;
  return {
    id: job.id,
    ...spec,
    codec: video.codec_name,
    pixelFormat: video.pix_fmt,
    colorRange: video.color_range,
    colorSpace: video.color_space,
    duration: Number(probe.format.duration),
    frameCount,
    keyframes: frameNumbers,
  };
}

async function readReport(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(join(artifacts, 'report.json'), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function main() {
  const started = Date.now();
  await json('/api/health');
  if (process.env.RENDER_PNG_ONLY === '1') {
    await mkdir(artifacts, { recursive: true });
    const source = await readFile(resolve(process.cwd(), 'public/demo/02-portrait.jpg'));
    const png = await sharp(source).resize(900, 900, { fit: 'cover' }).png().toBuffer();
    const asset = await upload('verification-square.png', png, 'image/png');
    assert.equal(asset.width, 900);
    assert.equal(asset.height, 900);
    assert.equal(asset.exif.hasExif, false);
    const recipe: VideoRecipe = {
      ...createRecipe(asset),
      canvasRatio: '1:1',
      videoWidth: 720,
      videoHeight: 720,
      durationSeconds: 1,
      fps: 24,
      exportSettings: { ...createRecipe(asset).exportSettings, resolution: '720p' },
    };
    const queued = await json<{ jobs: RenderJob[] }>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipes: [recipe] }),
    });
    const job = (await waitDone([queued.jobs[0].id]))[0];
    const result = await verifyVideo(job, { width: 720, height: 720, fps: 24, frames: 24 });
    const report = await readReport();
    if (Array.isArray(report.results))
      for (const item of report.results as Record<string, unknown>[]) {
        if (Array.isArray(item.frames)) {
          item.keyframes = item.frames;
          item.frameCount = Math.round(Number(item.duration) * Number(item.fps));
          delete item.frames;
        }
      }
    report.pngVerified = result;
    await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    await json(`/api/jobs/${job.id}`, { method: 'DELETE' });
    await json(`/api/assets/${asset.id}`, { method: 'DELETE' });
    console.log(`PASS: PNG import and 720p H.264 smoke render; ${artifacts}`);
    return;
  }
  if (process.env.RENDER_CACHE_SMOKE === '1') {
    await mkdir(artifacts, { recursive: true });
    const source = await readFile(resolve(process.cwd(), 'public/demo/02-portrait.jpg'));
    const jpeg = await sharp(source)
      .resize(800, 1200, { fit: 'cover' })
      .withExif({
        IFD0: { Make: 'Canon', Model: 'EOS R5' },
        IFD2: { FNumber: '2.8', ExposureTime: '0.008', ISOSpeedRatings: '200', FocalLength: '50' },
      })
      .jpeg()
      .toBuffer();
    const asset = await upload('cache-portrait-exif.jpg', jpeg);
    const standard = createRecipe(asset);
    const blur80: VideoRecipe = {
      ...standard,
      canvasRatio: '9:16',
      videoWidth: 720,
      videoHeight: 1280,
      fps: 24,
      durationSeconds: 1,
      backgroundStyle: { ...standard.backgroundStyle, blur: 80 },
      exportSettings: { ...standard.exportSettings, resolution: '720p' },
    };
    const queued = await json<{ jobs: RenderJob[] }>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipes: [blur80, standard] }),
    });
    const [small, full] = await waitDone(queued.jobs.map((j) => j.id));
    const smallResult = await verifyVideo(small, { width: 720, height: 1280, fps: 24, frames: 24 });
    const fullResult = await verifyVideo(full, { width: 1080, height: 1920, fps: 30, frames: 120 });
    for (const [blur, w, h] of [
      [80, 720, 1280],
      [28, 1080, 1920],
    ]) {
      const path = resolve(
        process.cwd(),
        '.frame-motion',
        'assets',
        `${asset.id}-bg-${blur}-${w}x${h}.jpg`,
      );
      const metadata = await sharp(path).metadata();
      assert.equal(metadata.width, 540);
      assert.equal(metadata.height, 960);
    }
    const report = await readReport();
    const results = Array.isArray(report.results) ? report.results : [];
    const oldHero = results[0]?.id;
    results[0] = fullResult;
    report.results = results;
    report.cacheVerified = {
      blur80: smallResult,
      defaultBlur: fullResult,
      textureSize: [540, 960],
    };
    await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    await json(`/api/jobs/${small.id}`, { method: 'DELETE' });
    if (oldHero) await json(`/api/jobs/${oldHero}`, { method: 'DELETE' });
    console.log(`PASS: blur 80 cached texture and refreshed 1080x1920 render; ${artifacts}`);
    return;
  }
  await rm(artifacts, { recursive: true, force: true });
  await mkdir(artifacts, { recursive: true });
  const badOrigin = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { Origin: 'https://outside.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(badOrigin.status, 403);
  const { stdout: badHostCode } = await run('curl', [
    '-s',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    '-H',
    'Host: outside.example',
    `${base}/api/health`,
  ]);
  assert.equal(Number(badHostCode), 403);
  const source = await readFile(resolve(process.cwd(), 'public/demo/02-portrait.jpg'));
  const horizontal = await sharp(source).resize(1200, 800, { fit: 'cover' }).jpeg().toBuffer();
  const portrait = await sharp(source)
    .resize(800, 1200, { fit: 'cover' })
    .withExif({
      IFD0: { Make: 'Canon', Model: 'EOS R5' },
      IFD2: { FNumber: '2.8', ExposureTime: '0.008', ISOSpeedRatings: '200', FocalLength: '50' },
    })
    .jpeg()
    .toBuffer();
  const square = await sharp(source).resize(900, 900, { fit: 'cover' }).png().toBuffer();
  const [landscape, tall, sq] = await Promise.all([
    upload('landscape.jpg', horizontal),
    upload('portrait-exif.jpg', portrait),
    upload('square.png', square, 'image/png'),
  ]);
  const heicPath = join(artifacts, 'test-heic.heic');
  await run('sips', [
    '-s',
    'format',
    'heic',
    resolve(process.cwd(), 'public/demo/02-portrait.jpg'),
    '--out',
    heicPath,
  ]);
  const heic = await upload('heic.heic', await readFile(heicPath), 'image/heic');
  assert(heic.width > 0 && heic.height > 0);
  assert.equal(landscape.exif.hasExif, false);
  assert.equal(sq.exif.hasExif, false);
  assert.equal(tall.exif.hasExif, true);
  assert.equal(tall.exif.values.iso, 'ISO 200');
  assert(!('GPSLatitude' in tall.exif.raw));
  assert(landscape.width > landscape.height && tall.height > tall.width && sq.width === sq.height);
  const portraitRecipe = createRecipe(tall);
  portraitRecipe.image = {
    ...portraitRecipe.image,
    src: 'https://example.invalid/untrusted.jpg',
    backgroundSrc: 'file:///etc/passwd',
  };
  const first = await json<{ jobs: RenderJob[] }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: [portraitRecipe] }),
  });
  assert(first.jobs[0].recipe.image.src.startsWith(`/api/assets/${tall.id}/image`));
  assert(first.jobs[0].recipe.image.backgroundSrc.startsWith(`/api/assets/${tall.id}/background`));
  const cancelled = await json<{ jobs: RenderJob[] }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: [createRecipe(landscape)] }),
  });
  const cancellation = await json<{ cancelled: boolean }>(
    `/api/jobs/${cancelled.jobs[0].id}/cancel`,
    { method: 'POST' },
  );
  assert.equal(cancellation.cancelled, true);
  assert.equal((await waitDone([cancelled.jobs[0].id]))[0].status, 'cancelled');
  const bad = { ...createRecipe(sq), image: { ...sq, id: 'missing-asset' } };
  const rejection = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: [bad] }),
  });
  assert.equal(rejection.status, 400);
  const invalidRatio = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: [{ ...createRecipe(sq), canvasRatio: '999:1' }] }),
  });
  assert.equal(invalidRatio.status, 400);
  const heicRecipe: VideoRecipe = {
    ...createRecipe(heic),
    durationSeconds: 1,
    fps: 24,
    canvasRatio: '9:16',
    videoWidth: 720,
    videoHeight: 1280,
    exportSettings: { ...createRecipe(heic).exportSettings, resolution: '720p' },
  };
  const doomed = await json<{ jobs: RenderJob[] }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: [heicRecipe] }),
  });
  const heicFile = resolve(process.cwd(), '.frame-motion', 'assets', `${heic.id}.jpg`);
  const hiddenFile = `${heicFile}.verification-hidden`;
  await rename(heicFile, hiddenFile);
  try {
    const failed = (await waitDone([doomed.jobs[0].id]))[0];
    assert.equal(
      failed.status,
      'failed',
      `Expected a real missing-asset render failure, got ${failed.status}`,
    );
  } finally {
    await rename(hiddenFile, heicFile);
  }
  const retry = await json<{ jobs: RenderJob[] }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: [heicRecipe] }),
  });
  const landscapeRecipe: VideoRecipe = {
    ...createRecipe(landscape),
    canvasRatio: '16:9',
    videoWidth: 1280,
    videoHeight: 720,
    durationSeconds: 1,
    fps: 24,
    exportSettings: { ...createRecipe(landscape).exportSettings, resolution: '720p' },
  };
  const squareRecipe: VideoRecipe = {
    ...createRecipe(sq),
    canvasRatio: '1:1',
    videoWidth: 720,
    videoHeight: 720,
    durationSeconds: 1,
    fps: 24,
    exportSettings: { ...createRecipe(sq).exportSettings, resolution: '720p' },
  };
  const batch = await json<{ jobs: RenderJob[] }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: [landscapeRecipe, squareRecipe] }),
  });
  const completed = await waitDone([
    first.jobs[0].id,
    retry.jobs[0].id,
    ...batch.jobs.map((j) => j.id),
  ]);
  const results = [];
  results.push(
    await verifyVideo(completed[0], { width: 1080, height: 1920, fps: 30, frames: 120 }),
  );
  results.push(await verifyVideo(completed[1], { width: 720, height: 1280, fps: 24, frames: 24 }));
  results.push(await verifyVideo(completed[2], { width: 1280, height: 720, fps: 24, frames: 24 }));
  results.push(await verifyVideo(completed[3], { width: 720, height: 720, fps: 24, frames: 24 }));
  const activeRecipe: VideoRecipe = {
    ...createRecipe(sq),
    canvasRatio: '9:16',
    videoWidth: 1080,
    videoHeight: 1920,
    durationSeconds: 4,
  };
  const active = await json<{ jobs: RenderJob[] }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes: [activeRecipe] }),
  });
  const activeEnd = Date.now() + 60_000;
  let sawActive = false;
  while (Date.now() < activeEnd) {
    const state = (await json<{ jobs: RenderJob[] }>('/api/jobs')).jobs.find(
      (j) => j.id === active.jobs[0].id,
    );
    if (state && ['rendering', 'encoding'].includes(state.status)) {
      sawActive = true;
      break;
    }
    if (state && ['done', 'failed', 'cancelled'].includes(state.status)) break;
    await wait(250);
  }
  assert(sawActive, 'Did not observe active render for cancellation test');
  assert.equal(
    (
      await json<{ cancelled: boolean }>(`/api/jobs/${active.jobs[0].id}/cancel`, {
        method: 'POST',
      })
    ).cancelled,
    true,
  );
  assert.equal((await waitDone([active.jobs[0].id]))[0].status, 'cancelled');
  let extra: RenderJob[] = [];
  if (process.env.RENDER_EXTRA_SPECS === '1') {
    const fourK: VideoRecipe = {
      ...createRecipe(tall),
      canvasRatio: '9:16',
      videoWidth: 2160,
      videoHeight: 3840,
      fps: 24,
      durationSeconds: 1,
      exportSettings: { ...createRecipe(tall).exportSettings, resolution: '4K' },
    };
    const prores: VideoRecipe = {
      ...createRecipe(sq),
      canvasRatio: '1:1',
      videoWidth: 720,
      videoHeight: 720,
      fps: 24,
      durationSeconds: 1,
      exportSettings: { ...createRecipe(sq).exportSettings, resolution: '720p', codec: 'prores' },
    };
    const special = await json<{ jobs: RenderJob[] }>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipes: [fourK, prores] }),
    });
    extra = await waitDone(
      special.jobs.map((j) => j.id),
      25 * 60_000,
    );
    results.push(await verifyVideo(extra[0], { width: 2160, height: 3840, fps: 24, frames: 24 }));
    results.push(
      await verifyVideo(extra[1], {
        width: 720,
        height: 720,
        fps: 24,
        frames: 24,
        codec: 'prores',
      }),
    );
  }
  const zipJobs = [...completed, ...extra];
  const zip = await fetch(`${base}/api/download.zip?ids=${zipJobs.map((j) => j.id).join(',')}`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type')?.includes('zip'), true);
  await writeFile(join(artifacts, 'batch.zip'), Buffer.from(await zip.arrayBuffer()));
  const { stdout: zipNames } = await run('unzip', ['-Z', '-1', join(artifacts, 'batch.zip')]);
  assert.equal(zipNames.trim().split('\n').length, zipJobs.length);
  await writeFile(
    join(artifacts, 'report.json'),
    JSON.stringify(
      {
        assets: [landscape.id, tall.id, sq.id, heic.id],
        cancelled: [cancelled.jobs[0].id, active.jobs[0].id],
        failedAndRetried: [doomed.jobs[0].id, retry.jobs[0].id],
        rejectedInvalidAsset: true,
        rejectedInvalidRatio: true,
        rejectedOriginAndHost: true,
        heicImported: true,
        results,
      },
      null,
      2,
    ),
  );
  for (const id of [cancelled.jobs[0].id, doomed.jobs[0].id, retry.jobs[0].id])
    await json(`/api/jobs/${id}`, { method: 'DELETE' });
  await json(`/api/assets/${heic.id}`, { method: 'DELETE' });
  if (process.env.RENDER_PRUNE_TEST_JOBS === '1') {
    const previous = (await json<{ jobs: RenderJob[] }>('/api/jobs')).jobs.filter(
      (job) =>
        job.createdAt < started &&
        ['landscape.jpg', 'portrait-exif.jpg', 'square.jpg', 'square.png', 'heic.heic'].includes(
          job.name,
        ) &&
        ['done', 'failed', 'cancelled'].includes(job.status),
    );
    for (const job of previous) await json(`/api/jobs/${job.id}`, { method: 'DELETE' });
    const registry = JSON.parse(
      await readFile(resolve(process.cwd(), '.frame-motion', 'assets.json'), 'utf8'),
    ) as PhotoAsset[];
    for (const asset of registry)
      if (
        !asset.id.startsWith('demo-') &&
        ![landscape.id, tall.id, sq.id].includes(asset.id) &&
        ['landscape.jpg', 'portrait-exif.jpg', 'square.jpg', 'square.png', 'heic.heic'].includes(
          asset.name,
        )
      )
        await json(`/api/assets/${asset.id}`, { method: 'DELETE' });
  }
  console.log(
    `PASS: ${results.length} real renders, JPEG/HEIC, EXIF/no EXIF, queued/active cancellation, failed-job retry, ZIP; ${artifacts}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
