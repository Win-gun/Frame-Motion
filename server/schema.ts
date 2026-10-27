import { z } from 'zod';
import { exifKeys, type VideoRecipe } from '../src/shared/types';
import { normalizeRecipe } from '../src/shared/recipe';

const number = (min: number, max: number) => z.number().finite().min(min).max(max);
const text = z.string().max(160);
const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);
const ratio = z
  .string()
  .regex(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/)
  .refine((value) => {
    const [a, b] = value.split(':').map(Number);
    return a > 0 && b > 0 && a / b >= 0.2 && a / b <= 5;
  }, 'Canvas ratio must be between 1:5 and 5:1');
const values = z.object(
  Object.fromEntries(exifKeys.map((key) => [key, text])) as Record<
    (typeof exifKeys)[number],
    typeof text
  >,
);
const enabled = z.object(
  Object.fromEntries(exifKeys.map((key) => [key, z.boolean()])) as Record<
    (typeof exifKeys)[number],
    z.ZodBoolean
  >,
);

export const recipeSchema = z
  .object({
    image: z
      .object({
        id: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[a-zA-Z0-9_-]+$/),
      })
      .passthrough(),
    exif: z.object({ values, enabled }),
    canvasRatio: ratio,
    videoWidth: z.number().int().min(240).max(8192),
    videoHeight: z.number().int().min(240).max(8192),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
    durationSeconds: number(1, 60),
    timeline: z.object({
      introDuration: number(0, 30),
      outroDuration: number(0, 30),
      metadataDelay: number(0, 60),
      metadataDuration: number(0, 60),
      easing: z.enum(['ease-out', 'spring', 'linear']),
      exit: z.enum(['hold', 'fade', 'background']),
      shutter: z.boolean(),
      shutterDuration: number(0, 5),
      shutterIntensity: number(0, 2),
    }),
    backgroundStyle: z.object({
      mode: z.enum(['static', 'drift', 'wave', 'breathe']),
      enabled: z.boolean(),
      blur: number(0, 100),
      opacity: number(0, 1),
      darken: number(0, 1),
      scale: number(0.5, 3),
      color,
      speed: number(0, 10),
      intensity: number(0, 5),
      direction: number(-360, 360),
      loop: z.boolean(),
    }),
    photoLayout: z.object({
      arrangement: z
        .enum(['auto', 'stacked', 'photo-left', 'photo-right'])
        .optional()
        .default('auto'),
      size: number(10, 200),
      x: number(-100, 100),
      y: number(-100, 100),
      radius: number(0, 100),
      shadow: number(0, 1),
      float: number(0, 1),
      border: number(0, 20),
      fit: z.enum(['contain', 'cover']),
    }),
    motionPreset: z.enum(['soft', 'gallery', 'shutter', 'cinematic', 'still']),
    typography: z.object({
      font: z.enum(['sans', 'mono']),
      size: number(8, 200),
      color,
      letterSpacing: number(-10, 30),
      align: z.enum(['left', 'center', 'right']),
      separator: z.enum(['·', '/', '—']),
      offset: number(-500, 500),
    }),
    exportSettings: z.object({
      resolution: z.enum(['720p', '1080p', '2K', '4K']),
      quality: number(0, 100),
      codec: z.enum(['h264', 'prores']),
    }),
  })
  .strict();

export function parseRecipe(input: unknown): VideoRecipe {
  const parsed = recipeSchema.parse(input) as VideoRecipe;
  const photoLayout = (input as { photoLayout?: Record<string, unknown> } | null)?.photoLayout;
  if (!photoLayout || photoLayout.arrangement !== undefined) return parsed;
  const legacy = { ...parsed.photoLayout } as Partial<VideoRecipe['photoLayout']>;
  delete legacy.arrangement;
  return normalizeRecipe({ ...parsed, photoLayout: legacy as VideoRecipe['photoLayout'] });
}
