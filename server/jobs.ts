import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer';
import type { RenderJob, VideoRecipe } from '../src/shared/types';
import { normalizeRecipe } from '../src/shared/recipe';
import { AssetStore, dataRoot } from './assets';
import { parseRecipe } from './schema';

const jobsPath = join(dataRoot, 'jobs.json');
export const outputDir = join(dataRoot, 'exports');
export function downloadName(job: RenderJob) {
  const stem =
    job.name
      .replace(/\.[^.]+$/, '')
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}_-]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'photo';
  return `${stem}-${job.id.slice(0, 8)}.${job.recipe.exportSettings.codec === 'prores' ? 'mov' : 'mp4'}`;
}
type Active = { id: string; cancel: () => void };
export class JobQueue {
  private jobs = new Map<string, RenderJob>();
  private running: Active | null = null;
  private bundlePromise: Promise<string> | null = null;
  private lastSave = 0;
  private pendingSave: Promise<void> = Promise.resolve();
  constructor(
    private assets: AssetStore,
    private baseUrl: string,
  ) {}
  async init() {
    await mkdir(outputDir, { recursive: true });
    try {
      for (const job of JSON.parse(await readFile(jobsPath, 'utf8')) as RenderJob[]) {
        if (['queued', 'bundling', 'rendering', 'encoding'].includes(job.status)) {
          job.status = 'failed';
          job.error = 'Server restarted before render completed';
          job.progress = 0;
        }
        if (job.status === 'done') {
          try {
            await access(
              join(
                outputDir,
                `${job.id}.${job.recipe.exportSettings.codec === 'prores' ? 'mov' : 'mp4'}`,
              ),
            );
          } catch {
            job.status = 'failed';
            job.error = 'Export file was removed';
            job.url = undefined;
          }
        }
        this.jobs.set(job.id, job);
      }
    } catch {
      /* first run */
    }
    await this.save();
  }
  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
  get(id: string) {
    return this.jobs.get(id);
  }
  file(id: string) {
    const job = this.jobs.get(id);
    return job?.status === 'done'
      ? join(outputDir, `${id}.${job.recipe.exportSettings.codec === 'prores' ? 'mov' : 'mp4'}`)
      : null;
  }
  private async save() {
    this.pendingSave = this.pendingSave
      .catch(() => undefined)
      .then(async () => {
        const tmp = `${jobsPath}.${randomUUID()}.tmp`;
        await writeFile(tmp, JSON.stringify([...this.jobs.values()]));
        await rename(tmp, jobsPath);
        this.lastSave = Date.now();
      });
    await this.pendingSave;
  }
  private saveProgress() {
    if (Date.now() - this.lastSave > 700) void this.save().catch(console.error);
  }
  async enqueue(inputs: unknown[]): Promise<RenderJob[]> {
    const recipes = inputs.map((input) => this.canonicalRecipe(parseRecipe(input)));
    const jobs = recipes.map((recipe) => {
      const id = randomUUID();
      const job: RenderJob = {
        id,
        name: recipe.image.name,
        status: 'queued',
        progress: 0,
        renderedFrames: 0,
        totalFrames: Math.round(recipe.durationSeconds * recipe.fps),
        createdAt: Date.now(),
        recipe,
      };
      this.jobs.set(id, job);
      return job;
    });
    await this.save();
    void this.drain();
    return jobs;
  }
  private canonicalRecipe(recipe: VideoRecipe): VideoRecipe {
    const asset = this.assets.get(recipe.image.id);
    if (!asset) throw new Error('Unknown photo asset');
    const canonical = normalizeRecipe({
      ...recipe,
      image: {
        ...asset,
        src: `${this.baseUrl}${asset.src}`,
        backgroundSrc: `${this.baseUrl}${asset.backgroundSrc}`,
      },
    });
    if (Math.max(canonical.videoWidth, canonical.videoHeight) > 8192)
      throw new Error('Canvas long edge exceeds 8192 pixels');
    return canonical;
  }
  async cancel(id: string) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.error = undefined;
      await this.save();
      return true;
    }
    if (['bundling', 'rendering', 'encoding'].includes(job.status)) {
      job.status = 'cancelled';
      job.error = undefined;
      this.running?.id === id && this.running.cancel();
      await this.save();
      return true;
    }
    return false;
  }
  async remove(id: string) {
    const job = this.jobs.get(id);
    if (!job || !['done', 'failed', 'cancelled'].includes(job.status)) return false;
    this.jobs.delete(id);
    await this.save();
    await rm(
      join(outputDir, `${id}.${job.recipe.exportSettings.codec === 'prores' ? 'mov' : 'mp4'}`),
      { force: true },
    );
    return true;
  }
  private async drain() {
    if (this.running) return;
    const job = this.list()
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!job) return;
    const signal = makeCancelSignal();
    this.running = { id: job.id, cancel: signal.cancel };
    const output = join(
      outputDir,
      `${job.id}.${job.recipe.exportSettings.codec === 'prores' ? 'mov' : 'mp4'}`,
    );
    try {
      job.status = 'bundling';
      await this.save();
      if (!this.bundlePromise)
        this.bundlePromise = bundle({
          entryPoint: resolve(process.cwd(), 'src/video/index.ts'),
        }).catch((e) => {
          this.bundlePromise = null;
          throw e;
        });
      const serveUrl = await this.bundlePromise;
      if (this.jobs.get(job.id)?.status === 'cancelled') return;
      const composition = await selectComposition({
        serveUrl,
        id: 'FloatingPhoto',
        inputProps: { recipe: job.recipe },
      });
      if (this.jobs.get(job.id)?.status === 'cancelled') return;
      job.status = 'rendering';
      await this.save();
      const prores = job.recipe.exportSettings.codec === 'prores';
      await renderMedia({
        serveUrl,
        composition,
        inputProps: { recipe: job.recipe },
        outputLocation: output,
        codec: prores ? 'prores' : 'h264',
        pixelFormat: prores ? 'yuv422p10le' : 'yuv420p',
        // Explicit conversion avoids JPEG full-range output differing across platforms.
        imageFormat: prores ? undefined : 'png',
        colorSpace: prores ? undefined : 'bt709',
        proResProfile: prores ? 'hq' : undefined,
        crf: prores ? undefined : Math.round(35 - job.recipe.exportSettings.quality * 0.2),
        muted: true,
        concurrency: Math.max(
          1,
          Math.min(job.recipe.videoWidth * job.recipe.videoHeight >= 3840 * 2160 ? 1 : 2, 2),
        ),
        cancelSignal: signal.cancelSignal,
        onProgress: (progress) => {
          if (job.status === 'cancelled') return;
          job.status = progress.encodedFrames > 0 ? 'encoding' : 'rendering';
          job.progress = Math.min(0.999, Math.max(0, progress.progress));
          job.renderedFrames = progress.renderedFrames;
          this.saveProgress();
        },
      });
      if (this.jobs.get(job.id)?.status === 'cancelled') {
        await rm(output, { force: true });
        return;
      }
      job.status = 'done';
      job.progress = 1;
      job.renderedFrames = job.totalFrames;
      job.url = `/api/jobs/${job.id}/download`;
      await this.save();
    } catch (error) {
      await rm(output, { force: true });
      if (job.status !== 'cancelled') {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : String(error);
        await this.save();
      }
    } finally {
      if (job.status === 'cancelled') {
        await rm(output, { force: true });
        await this.save();
      }
      this.running = null;
      void this.drain();
    }
  }
}
