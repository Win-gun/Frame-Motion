import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRecipe, normalizeRecipe } from '../src/shared/recipe';
import { getPhotoRect } from '../src/shared/animation';
import type { PhotoAsset, RenderJob } from '../src/shared/types';

const base = process.env.RENDER_BASE_URL || 'http://127.0.0.1:5173';
const run = promisify(execFile);
const artifacts = resolve('artifacts');
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  let image: PhotoAsset | undefined;
  if (process.env.PHOTO_ASSET_ID) {
    const { jobs } = await json<{ jobs: RenderJob[] }>('/api/jobs');
    image = jobs.find((job) => job.recipe.image.id === process.env.PHOTO_ASSET_ID)?.recipe.image;
  } else {
    const { photos } = await json<{ photos: PhotoAsset[] }>('/api/demo');
    image = photos.find((photo) => photo.name.includes('portrait'));
  }
  assert(image, 'A registered portrait photograph is required');
  const seed = createRecipe(image);
  if (!image.exif.hasExif) {
    seed.exif.values = {
      ...seed.exif.values,
      camera: 'Manual sample',
      focalLength: '85mm',
      aperture: 'f/1.8',
      shutter: '1/320s',
      iso: 'ISO 200',
    };
    seed.exif.enabled.camera = true;
  }
  const recipes = (['photo-left', 'photo-right'] as const).map((arrangement) =>
    normalizeRecipe({
      ...structuredClone(seed),
      canvasRatio: '16:9',
      durationSeconds: 2,
      photoLayout: { ...seed.photoLayout, arrangement, size: 90, x: 0, y: 0 },
    }),
  );
  for (const recipe of recipes) {
    const rect = getPhotoRect(recipe);
    assert(
      rect.height / recipe.videoHeight >= 0.8,
      'Portrait must use at least 80% of canvas height',
    );
    assert(Math.abs(rect.width / rect.height - image.width / image.height) < 1e-9);
  }
  const submitted = await json<{ jobs: RenderJob[] }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipes }),
  });
  const ids = submitted.jobs.map((job) => job.id);
  let completed: RenderJob[] = [];
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const { jobs } = await json<{ jobs: RenderJob[] }>('/api/jobs');
    completed = ids.map((id) => jobs.find((job) => job.id === id)!);
    if (completed.every((job) => ['done', 'failed', 'cancelled'].includes(job.status))) break;
    await new Promise((done) => setTimeout(done, 1000));
  }
  const results = [];
  for (const [index, job] of completed.entries()) {
    assert.equal(job.status, 'done', job.error || 'Render did not finish');
    assert.equal(job.recipe.photoLayout.arrangement, recipes[index].photoLayout.arrangement);
    const stem = `landscape-portrait-${index === 0 ? 'left' : 'right'}`;
    const output = resolve(artifacts, `${stem}.mp4`);
    const response = await fetch(`${base}/api/jobs/${job.id}/download`);
    assert.equal(response.status, 200);
    await writeFile(output, Buffer.from(await response.arrayBuffer()));
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames',
      '-show_entries',
      'format=duration',
      '-of',
      'json',
      output,
    ]);
    const probe = JSON.parse(stdout);
    assert.equal(probe.streams.length, 1);
    assert.equal(probe.streams[0].codec_name, 'h264');
    assert.equal(probe.streams[0].width, 1920);
    assert.equal(probe.streams[0].height, 1080);
    assert.equal(probe.streams[0].avg_frame_rate, '30/1');
    assert.equal(Number(probe.streams[0].nb_read_frames), 60);
    assert.equal(Number(probe.format.duration), 2);
    for (const frame of [0, 45, 59]) {
      await run('ffmpeg', [
        '-y',
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
        resolve(artifacts, `${stem}-${frame}.png`),
      ]);
    }
    results.push({
      id: job.id,
      arrangement: job.recipe.photoLayout.arrangement,
      photoHeightFraction: getPhotoRect(job.recipe).height / 1080,
      ...probe,
    });
  }
  await writeFile(
    resolve(artifacts, 'landscape-verification.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(
    'PASS: two 1920x1080, 30fps, 60-frame silent MP4s; portrait >=80% canvas height; mirrored layouts.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
