import { exifKeys } from './types';
import type { PhotoAsset, VideoRecipe } from './types';

type Resolution = VideoRecipe['exportSettings']['resolution'];

const resolutionShortEdge: Record<Resolution, number> = {
  '720p': 720,
  '1080p': 1080,
  '2K': 1440,
  '4K': 2160,
};

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bounded = (value: unknown, fallback: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, finite(value, fallback)));
const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2);
const supportedFps = [24, 25, 30, 60] as const;
const videoFps = (value: unknown): number => {
  const requested = finite(value, 30);
  return supportedFps.reduce<number>(
    (nearest, option) =>
      Math.abs(option - requested) < Math.abs(nearest - requested) ? option : nearest,
    30,
  );
};

/** The resolution names describe the short edge, including square and custom canvases. */
export function canvasDimensions(
  ratio: string,
  resolution: Resolution,
): { width: number; height: number } {
  const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(ratio);
  const a = match ? Number(match[1]) : 9;
  const b = match ? Number(match[2]) : 16;
  const aspect = a > 0 && b > 0 && a / b >= 0.2 && a / b <= 5 ? a / b : 9 / 16;
  const shortEdge = resolutionShortEdge[resolution] ?? 1080;
  const requested =
    aspect <= 1
      ? { width: shortEdge, height: even(shortEdge / aspect) }
      : { width: even(shortEdge * aspect), height: shortEdge };
  const longEdge = Math.max(requested.width, requested.height);
  if (longEdge <= 8192) return requested;
  const scale = 8192 / longEdge;
  return { width: even(requested.width * scale), height: even(requested.height * scale) };
}

export function createRecipe(image: PhotoAsset): VideoRecipe {
  const canvas = canvasDimensions('9:16', '1080p');
  return {
    image,
    exif: {
      values: { ...image.exif.values },
      enabled: Object.fromEntries(
        exifKeys.map((key, index) => [key, index < 4 || Boolean(image.exif.values[key])]),
      ) as VideoRecipe['exif']['enabled'],
    },
    canvasRatio: '9:16',
    videoWidth: canvas.width,
    videoHeight: canvas.height,
    fps: 30,
    durationSeconds: 4,
    timeline: {
      introDuration: 0.55,
      outroDuration: 0.45,
      metadataDelay: 0.7,
      metadataDuration: 0.5,
      easing: 'ease-out',
      exit: 'hold',
      shutter: false,
      shutterDuration: 0.16,
      shutterIntensity: 0.45,
    },
    backgroundStyle: {
      mode: 'drift',
      enabled: true,
      blur: 28,
      opacity: 0.3,
      darken: 0.1,
      scale: 1.1,
      color: image.color || '#101014',
      speed: 1,
      intensity: 0.45,
      direction: 0,
      loop: false,
    },
    photoLayout: {
      arrangement: 'auto',
      size: 90,
      x: 0,
      y: 0,
      radius: 8,
      shadow: 0.7,
      float: 0.15,
      border: 0,
      fit: 'contain',
    },
    motionPreset: 'soft',
    typography: {
      font: 'sans',
      size: 36,
      color: '#f4f1e9',
      letterSpacing: 1.4,
      align: 'center',
      separator: '·',
      offset: 0,
    },
    exportSettings: { resolution: '1080p', quality: 82, codec: 'h264' },
  };
}

/** Repairs persisted or hand-edited recipes before either Player or renderer uses them. */
export function normalizeRecipe(recipe: VideoRecipe): VideoRecipe {
  const defaults = createRecipe(recipe.image);
  const timeline = { ...defaults.timeline, ...recipe.timeline };
  const backgroundStyle = { ...defaults.backgroundStyle, ...recipe.backgroundStyle };
  const photoLayout = { ...defaults.photoLayout, ...recipe.photoLayout };
  const typography = { ...defaults.typography, ...recipe.typography };
  const exportSettings = { ...defaults.exportSettings, ...recipe.exportSettings };
  const exif = {
    values: { ...defaults.exif.values, ...recipe.exif?.values },
    enabled: { ...defaults.exif.enabled, ...recipe.exif?.enabled },
  };
  const canvasRatio = recipe.canvasRatio || defaults.canvasRatio;
  const resolution =
    exportSettings.resolution in resolutionShortEdge ? exportSettings.resolution : '1080p';
  const dimensions = canvasDimensions(canvasRatio, resolution);
  const legacyPosition =
    recipe.photoLayout.arrangement === undefined
      ? legacyPositionPercent(recipe, dimensions.width, dimensions.height, exif)
      : null;
  const normalized: VideoRecipe = {
    ...defaults,
    ...recipe,
    exif,
    canvasRatio,
    videoWidth: dimensions.width,
    videoHeight: dimensions.height,
    fps: videoFps(recipe.fps),
    durationSeconds: Math.round(bounded(recipe.durationSeconds, 4, 1, 60) * 10) / 10,
    timeline: {
      introDuration: bounded(timeline.introDuration, 0.55, 0, 600),
      outroDuration: bounded(timeline.outroDuration, 0.45, 0, 600),
      metadataDelay: bounded(timeline.metadataDelay, 0.7, 0, 600),
      metadataDuration: bounded(timeline.metadataDuration, 0.5, 0, 600),
      easing: ['ease-out', 'spring', 'linear'].includes(timeline.easing)
        ? timeline.easing
        : 'ease-out',
      exit: ['hold', 'fade', 'background'].includes(timeline.exit) ? timeline.exit : 'hold',
      shutter: Boolean(timeline.shutter),
      shutterDuration: bounded(timeline.shutterDuration, 0.16, 0, 600),
      shutterIntensity: bounded(timeline.shutterIntensity, 0.45, 0, 1),
    },
    backgroundStyle: {
      ...backgroundStyle,
      mode: ['static', 'drift', 'wave', 'breathe'].includes(backgroundStyle.mode)
        ? backgroundStyle.mode
        : 'static',
      enabled: Boolean(backgroundStyle.enabled),
      blur: bounded(backgroundStyle.blur, 28, 0, 100),
      opacity: bounded(backgroundStyle.opacity, 0.3, 0, 1),
      darken: bounded(backgroundStyle.darken, 0.1, 0, 1),
      scale: bounded(backgroundStyle.scale, 1.1, 1, 2),
      speed: bounded(backgroundStyle.speed, 1, 0, 5),
      intensity: bounded(backgroundStyle.intensity, 0.45, 0, 1),
      direction: bounded(backgroundStyle.direction, 0, -360, 360),
    },
    photoLayout: {
      ...photoLayout,
      arrangement: ['auto', 'stacked', 'photo-left', 'photo-right'].includes(
        photoLayout.arrangement,
      )
        ? photoLayout.arrangement
        : 'auto',
      size: bounded(photoLayout.size, 90, 10, 200),
      x: bounded(legacyPosition?.x ?? photoLayout.x, 0, -100, 100),
      y: bounded(legacyPosition?.y ?? photoLayout.y, 0, -100, 100),
      radius: bounded(photoLayout.radius, 8, 0, 100),
      shadow: bounded(photoLayout.shadow, 0.7, 0, 1),
      float: bounded(photoLayout.float, 0.15, 0, 1),
      border: bounded(photoLayout.border, 0, 0, 20),
      fit: photoLayout.fit === 'cover' ? 'cover' : 'contain',
    },
    motionPreset: ['soft', 'gallery', 'shutter', 'cinematic', 'still'].includes(recipe.motionPreset)
      ? recipe.motionPreset
      : 'soft',
    typography: {
      ...typography,
      font: typography.font === 'mono' ? 'mono' : 'sans',
      size: bounded(typography.size, 36, 16, 96),
      letterSpacing: bounded(typography.letterSpacing, 1.4, -2, 12),
      offset: bounded(typography.offset, 0, -80, 80),
      align: ['left', 'center', 'right'].includes(typography.align) ? typography.align : 'center',
      separator: ['·', '/', '—'].includes(typography.separator) ? typography.separator : '·',
    },
    exportSettings: {
      resolution,
      quality: bounded(exportSettings.quality, 82, 1, 100),
      codec: exportSettings.codec === 'prores' ? 'prores' : 'h264',
    },
  };
  const frames = getTimeline(normalized);
  normalized.timeline.introDuration = frames.introFrames / normalized.fps;
  normalized.timeline.outroDuration = frames.outroFrames / normalized.fps;
  normalized.timeline.metadataDelay = frames.metadataDelayFrames / normalized.fps;
  normalized.timeline.metadataDuration = frames.metadataFrames / normalized.fps;
  if (normalized.timeline.shutter || normalized.motionPreset === 'shutter') {
    normalized.timeline.shutterDuration = frames.shutterFrames / normalized.fps;
  }
  return normalized;
}

/** One-time translation of the former remaining-space position sliders. */
function legacyPositionPercent(
  recipe: VideoRecipe,
  width: number,
  height: number,
  exif: VideoRecipe['exif'],
): { x: number; y: number } {
  const hasMetadata = Object.entries(exif.values).some(
    ([key, value]) => value && exif.enabled[key as keyof typeof exif.enabled],
  );
  const stageHeight = height * ((hasMetadata ? 0.79 : 0.93) - 0.065);
  const size = bounded(recipe.photoLayout.size, 90, 10, 100) / 100;
  const maxWidth = width * 0.9 * size;
  const maxHeight = stageHeight * 0.94 * size;
  const sourceAspect =
    recipe.image.width > 0 && recipe.image.height > 0
      ? recipe.image.width / recipe.image.height
      : 1;
  const oldWidth =
    recipe.photoLayout.fit === 'cover' ? maxWidth : Math.min(maxWidth, maxHeight * sourceAspect);
  const oldHeight = recipe.photoLayout.fit === 'cover' ? maxHeight : oldWidth / sourceAspect;
  return {
    x: (bounded(recipe.photoLayout.x, 0, -100, 100) * (width - oldWidth)) / (2 * width),
    y: (bounded(recipe.photoLayout.y, 0, -100, 100) * (stageHeight - oldHeight)) / (2 * height),
  };
}

export type RecipeTimeline = {
  durationInFrames: number;
  introFrames: number;
  outroFrames: number;
  holdFrames: number;
  metadataDelayFrames: number;
  metadataFrames: number;
  shutterFrames: number;
};

export function getTimeline(recipe: VideoRecipe): RecipeTimeline {
  const fps = videoFps(recipe.fps);
  const durationInFrames = Math.max(1, Math.round(bounded(recipe.durationSeconds, 4, 1, 60) * fps));
  const desiredIntro = Math.max(
    0,
    Math.round(bounded(recipe.timeline.introDuration, 0.55, 0, 600) * fps),
  );
  const desiredOutro = Math.max(
    0,
    Math.round(bounded(recipe.timeline.outroDuration, 0.45, 0, 600) * fps),
  );
  const transitionBudget = Math.floor(durationInFrames / 2);
  const desiredTotal = desiredIntro + desiredOutro;
  const introFrames =
    desiredTotal <= transitionBudget
      ? desiredIntro
      : Math.round((transitionBudget * desiredIntro) / desiredTotal);
  const outroFrames =
    desiredTotal <= transitionBudget ? desiredOutro : transitionBudget - introFrames;
  const holdFrames = durationInFrames - introFrames - outroFrames;
  const metadataDelayFrames = Math.min(
    durationInFrames - 1,
    Math.max(0, Math.round(bounded(recipe.timeline.metadataDelay, 0.7, 0, 600) * fps)),
  );
  const metadataFrames = Math.min(
    durationInFrames - metadataDelayFrames,
    Math.max(0, Math.round(bounded(recipe.timeline.metadataDuration, 0.5, 0, 600) * fps)),
  );
  const shutterFrames =
    recipe.timeline.shutter || recipe.motionPreset === 'shutter'
      ? Math.min(
          transitionBudget,
          Math.max(0, Math.round(bounded(recipe.timeline.shutterDuration, 0.16, 0, 600) * fps)),
        )
      : 0;
  return {
    durationInFrames,
    introFrames,
    outroFrames,
    holdFrames,
    metadataDelayFrames,
    metadataFrames,
    shutterFrames,
  };
}
