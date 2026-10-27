import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import type { ExifData, ExifValues, PhotoAsset } from '../src/shared/types';
import { convertHeicInMemory } from './heic';

export const dataRoot = join(process.cwd(), '.frame-motion');
const assetDir = join(dataRoot, 'assets');
const registryPath = join(dataRoot, 'assets.json');
const tags = [
  'FocalLength',
  'FNumber',
  'ExposureTime',
  'ISO',
  'PhotographicSensitivity',
  'Make',
  'Model',
  'LensModel',
  'FocalLengthIn35mmFilm',
  'DateTimeOriginal',
] as const;
const emptyValues = (): ExifValues => ({
  focalLength: '',
  aperture: '',
  shutter: '',
  iso: '',
  camera: '',
  lens: '',
  equivalent: '',
  date: '',
});

function short(value: unknown): string {
  return String(value ?? '')
    .replace(/[\x00-\x1f]/g, ' ')
    .trim()
    .slice(0, 120);
}
const localDateTime = (date: Date) => {
  const p = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
};
export function formatExif(parsed: Record<string, unknown> | undefined): ExifData {
  const raw: Record<string, string | number> = {};
  for (const key of tags) {
    const value = parsed?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) raw[key] = value;
    else if (typeof value === 'string') raw[key] = short(value);
    else if (value instanceof Date && Number.isFinite(value.valueOf()))
      raw[key] = localDateTime(value);
  }
  const val = (key: string) => raw[key];
  const n = (key: string) => (typeof val(key) === 'number' ? Number(val(key)) : Number.NaN);
  const values = emptyValues();
  if (Number.isFinite(n('FocalLength')))
    values.focalLength = `${Number(n('FocalLength').toFixed(1))}mm`;
  if (Number.isFinite(n('FNumber'))) values.aperture = `f/${Number(n('FNumber').toFixed(1))}`;
  if (Number.isFinite(n('ExposureTime')) && n('ExposureTime') > 0) {
    const seconds = n('ExposureTime');
    const denominator = Math.round(1 / seconds);
    values.shutter =
      seconds < 1 && denominator > 0 && Math.abs(1 / denominator - seconds) / seconds <= 0.01
        ? `1/${denominator}s`
        : `${Number(seconds.toFixed(3))}s`;
  }
  const iso = Number.isFinite(n('ISO')) ? n('ISO') : n('PhotographicSensitivity');
  if (Number.isFinite(iso)) values.iso = `ISO ${Math.round(iso)}`;
  values.camera = [val('Make'), val('Model')]
    .filter(Boolean)
    .map(short)
    .join(' ')
    .replace(/\b(\S+)(?:\s+\1)\b/i, '$1');
  values.lens = short(val('LensModel'));
  if (Number.isFinite(n('FocalLengthIn35mmFilm')))
    values.equivalent = `${Math.round(n('FocalLengthIn35mmFilm'))}mm eq.`;
  if (val('DateTimeOriginal'))
    values.date = short(val('DateTimeOriginal')).slice(0, 10).replace(/:/g, '-');
  return { raw, values, hasExif: Object.keys(raw).length > 0 };
}

export class AssetStore {
  private assets = new Map<string, PhotoAsset>();
  private backgroundTasks = new Map<string, Promise<string>>();
  async init() {
    await mkdir(assetDir, { recursive: true });
    try {
      for (const item of JSON.parse(await readFile(registryPath, 'utf8')) as PhotoAsset[])
        this.assets.set(item.id, item);
    } catch {
      /* first run */
    }
    await this.addDemos();
  }
  private async save() {
    const temp = `${registryPath}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify([...this.assets.values()]));
    await rename(temp, registryPath);
  }
  list() {
    return [...this.assets.values()].filter((a) => !a.id.startsWith('demo-'));
  }
  demos() {
    return [...this.assets.values()].filter((a) => a.id.startsWith('demo-'));
  }
  get(id: string) {
    return this.assets.get(id);
  }
  path(id: string, variant: 'image' | 'background', blur = 28, w?: number, h?: number) {
    if (!this.assets.has(id)) return null;
    if (variant === 'image') return join(assetDir, `${id}.jpg`);
    if (w !== undefined && h !== undefined) return join(assetDir, `${id}-bg-${blur}-${w}x${h}.jpg`);
    if (blur === 28) return join(assetDir, `${id}-bg-28.jpg`);
    return join(assetDir, `${id}-bg-${blur}.jpg`);
  }
  async background(id: string, blur: number, w?: number, h?: number) {
    const target = this.path(id, 'background', blur, w, h);
    const clear = this.path(id, 'image');
    if (!target || !clear) return null;
    try {
      await access(target);
      return target;
    } catch {
      /* generate */
    }
    const pending = this.backgroundTasks.get(target);
    if (pending) return pending;
    const task = (async () => {
      const temp = `${target}.${randomUUID()}.tmp`;
      try {
        let image;
        if (w !== undefined && h !== undefined) {
          const scale = 960 / Math.max(w, h);
          const textureW = Math.max(1, Math.round(w * scale));
          const textureH = Math.max(1, Math.round(h * scale));
          image = sharp(clear).resize(textureW, textureH, { fit: 'cover' });
          if (blur > 0) image = image.blur(Math.max(0.3, (blur * textureW) / 1080));
        } else {
          image = sharp(clear).resize({
            width: 960,
            height: 960,
            fit: 'inside',
            withoutEnlargement: true,
          });
          if (blur > 0) image = image.blur(Math.max(0.3, Math.min(100, blur)));
        }
        await image.jpeg({ quality: 85 }).toFile(temp);
        await rename(temp, target);
        return target;
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      } finally {
        this.backgroundTasks.delete(target);
      }
    })();
    this.backgroundTasks.set(target, task);
    return task;
  }
  async import(name: string, buffer: Buffer, id: string = randomUUID()): Promise<PhotoAsset> {
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = (await exifr.parse(buffer, {
        pick: [...tags],
        gps: false,
        icc: false,
        xmp: false,
        iptc: false,
      })) as Record<string, unknown> | undefined;
    } catch {
      /* corrupted metadata is nonfatal */
    }
    const exif = formatExif(parsed);
    const clear = this.pathFor(id, 'image');
    const bg = this.pathFor(id, 'background');
    try {
      const encode = (input: Buffer) =>
        sharp(input, { limitInputPixels: 100_000_000 })
          .rotate()
          .resize({ width: 7680, height: 7680, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 94, mozjpeg: true })
          .toFile(clear);
      let info;
      try {
        info = await encode(buffer);
      } catch (error) {
        if (!/\.(heic|heif)$/i.test(name)) throw error;
        const metadata = await sharp(buffer).metadata();
        if (!metadata.width || !metadata.height || metadata.width * metadata.height > 100_000_000)
          throw new Error('HEIC dimensions exceed import limit');
        await rm(clear, { force: true });
        info = await encode(await convertHeicInMemory(buffer));
      }
      await sharp(clear)
        .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
        .blur(28)
        .jpeg({ quality: 85 })
        .toFile(bg);
      const stat = await sharp(clear).stats();
      const [r, g, b] = stat.channels.slice(0, 3).map((c) => Math.round(c.mean));
      const asset: PhotoAsset = {
        id,
        name: short(name) || 'Photo',
        src: `/api/assets/${id}/image`,
        backgroundSrc: `/api/assets/${id}/background?blur=28`,
        width: info.width,
        height: info.height,
        color: `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`,
        exif,
      };
      this.assets.set(id, asset);
      await this.save();
      return asset;
    } catch (error) {
      await Promise.all([rm(clear, { force: true }), rm(bg, { force: true })]);
      throw error;
    }
  }
  private pathFor(id: string, variant: 'image' | 'background') {
    return join(assetDir, variant === 'image' ? `${id}.jpg` : `${id}-bg-28.jpg`);
  }
  async remove(id: string) {
    if (!this.assets.delete(id)) return false;
    await this.save();
    for (const file of await readdir(assetDir))
      if (file === `${id}.jpg` || file.startsWith(`${id}-bg-`))
        await rm(join(assetDir, file), { force: true });
    return true;
  }
  private async addDemos() {
    const demoDir = join(process.cwd(), 'public', 'demo');
    let files: string[] = [];
    try {
      files = (await readdir(demoDir)).filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f));
    } catch {
      return;
    }
    for (const file of files) {
      const id = `demo-${file.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      if (!this.assets.has(id)) {
        try {
          await this.import(file, await readFile(join(demoDir, file)), id);
        } catch {
          /* broken demo does not block startup */
        }
      }
    }
  }
}
