import type { VideoRecipe } from './types';
import { getTimeline } from './recipe';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, progress: number): number => a + (b - a) * progress;

function ease(progress: number, kind: VideoRecipe['timeline']['easing']): number {
  const p = clamp01(progress);
  if (kind === 'linear') return p;
  if (kind === 'spring') {
    const damping = Math.exp(-6 * p);
    const overshoot = 1 - damping * Math.cos(10 * p);
    const endpoint = 1 - Math.exp(-6) * Math.cos(10);
    return clamp01(overshoot / endpoint);
  }
  return 1 - Math.pow(1 - p, 3);
}

export type PhotoRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  areaWidth: number;
  areaHeight: number;
};

export type MetadataLines = {
  camera: boolean;
  lens: boolean;
  specs: boolean;
  date: boolean;
  specsRows?: number;
};
export type MetadataLayout = {
  left: number;
  width: number;
  top: number;
  height: number;
  fontSize: number;
  safeBottom: number;
};

function hasVisibleMetadata(recipe: VideoRecipe): boolean {
  return Object.entries(recipe.exif.values).some(
    ([key, value]) => value && recipe.exif.enabled[key as keyof typeof recipe.exif.enabled],
  );
}

export function resolveArrangement(recipe: VideoRecipe): 'stacked' | 'photo-left' | 'photo-right' {
  if (
    recipe.photoLayout.arrangement === 'photo-left' ||
    recipe.photoLayout.arrangement === 'photo-right'
  ) {
    return recipe.photoLayout.arrangement;
  }
  if (recipe.photoLayout.arrangement === 'stacked') return 'stacked';
  const canvasAspect = recipe.videoWidth / recipe.videoHeight;
  const sourceAspect =
    recipe.image.width > 0 && recipe.image.height > 0
      ? recipe.image.width / recipe.image.height
      : 1;
  return canvasAspect >= 1.25 && sourceAspect < 0.95 && hasVisibleMetadata(recipe)
    ? 'photo-left'
    : 'stacked';
}

/** Contain preserves the source aspect ratio; cover fills a fixed stage frame. */
export function getPhotoRect(recipe: VideoRecipe): PhotoRect {
  const canvasWidth = recipe.videoWidth;
  const canvasHeight = recipe.videoHeight;
  const arrangement = resolveArrangement(recipe);
  const hasMetadata = hasVisibleMetadata(recipe);
  const sourceAspect =
    recipe.image.width > 0 && recipe.image.height > 0
      ? recipe.image.width / recipe.image.height
      : 1;
  const widePortraitWithoutText =
    arrangement === 'stacked' &&
    !hasMetadata &&
    canvasWidth / canvasHeight >= 1.25 &&
    sourceAspect < 0.95;
  const stageTop =
    arrangement === 'stacked'
      ? canvasHeight * (widePortraitWithoutText ? 0.01 : 0.065)
      : canvasHeight * 0.04;
  const stageBottom =
    arrangement === 'stacked'
      ? canvasHeight * (widePortraitWithoutText ? 0.99 : hasMetadata ? 0.79 : 0.93)
      : canvasHeight * 0.96;
  const stageHeight = stageBottom - stageTop;
  const areaWidth = canvasWidth * (arrangement === 'stacked' ? 0.9 : 0.43);
  const areaHeight =
    arrangement === 'stacked' && !widePortraitWithoutText ? stageHeight * 0.94 : stageHeight;
  const size = Math.max(0.1, Math.min(2, recipe.photoLayout.size / 100));
  const maxWidth = areaWidth * size;
  const maxHeight = areaHeight * size;
  const width =
    recipe.photoLayout.fit === 'cover' ? maxWidth : Math.min(maxWidth, maxHeight * sourceAspect);
  const height = recipe.photoLayout.fit === 'cover' ? maxHeight : width / sourceAspect;
  const centerX =
    canvasWidth *
      (arrangement === 'photo-left' ? 0.275 : arrangement === 'photo-right' ? 0.725 : 0.5) +
    (recipe.photoLayout.x / 100) * canvasWidth;
  const centerY = stageTop + stageHeight / 2 + (recipe.photoLayout.y / 100) * canvasHeight;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height, areaWidth, areaHeight };
}

/** Place actual metadata rows near the photograph while retaining a safe canvas bottom. */
export function getMetadataLayout(recipe: VideoRecipe, lines: MetadataLines): MetadataLayout {
  const unit = recipe.videoWidth / 1080;
  const arrangement = resolveArrangement(recipe);
  const side = arrangement !== 'stacked';
  const specsRows = lines.specs ? (side ? Math.max(1, Math.min(3, lines.specsRows ?? 2)) : 1) : 0;
  const rowWeight =
    (lines.camera ? 1.15 * 1.2 : 0) +
    (lines.lens ? 0.82 * 1.4 : 0) +
    specsRows * 1.35 +
    (lines.date ? 0.68 * 1.4 : 0);
  if (side) {
    const left = recipe.videoWidth * (arrangement === 'photo-left' ? 0.55 : 0.06);
    const width = recipe.videoWidth * 0.39;
    const safeBottom = recipe.videoHeight * 0.07;
    const safeTop = recipe.videoHeight * 0.07;
    const available = recipe.videoHeight - safeTop - safeBottom;
    const fontSize = Math.min(
      recipe.typography.size * unit,
      recipe.videoHeight * 0.054,
      rowWeight > 0 ? available / rowWeight : recipe.typography.size * unit,
    );
    const height = rowWeight * fontSize;
    const preferredTop = (recipe.videoHeight - height) / 2 + recipe.typography.offset * unit;
    const top = Math.max(safeTop, Math.min(preferredTop, recipe.videoHeight - safeBottom - height));
    return { left, width, top, height, fontSize, safeBottom };
  }
  // Oversized or repositioned photos may intentionally overlap text; keep text legible at its authored anchor.
  const anchoredRecipe = {
    ...recipe,
    photoLayout: {
      ...recipe.photoLayout,
      size: Math.min(100, recipe.photoLayout.size),
      x: 0,
      y: 0,
    },
  };
  const photo = getPhotoRect(anchoredRecipe);
  const safeBottom = Math.max(recipe.videoHeight * 0.045, 20 * unit) + 14 * unit;
  const minTop = photo.y + photo.height + 16 * unit;
  const preferredTop = photo.y + photo.height + (40 + recipe.typography.offset) * unit;
  const available = Math.max(1, recipe.videoHeight - safeBottom - minTop);
  const fontSize = Math.min(
    recipe.typography.size * unit,
    rowWeight > 0 ? available / rowWeight : recipe.typography.size * unit,
  );
  const height = rowWeight * fontSize;
  const top = Math.max(minTop, Math.min(preferredTop, recipe.videoHeight - safeBottom - height));
  return {
    left: recipe.videoWidth * 0.06,
    width: recipe.videoWidth * 0.88,
    top,
    height,
    fontSize,
    safeBottom,
  };
}

export type FrameState = {
  photoOpacity: number;
  photoScale: number;
  photoX: number;
  photoY: number;
  photoRotation: number;
  metadataOpacity: number;
  metadataY: number;
  backgroundX: number;
  backgroundY: number;
  backgroundScale: number;
  backgroundOpacity: number;
  backgroundBrightness: number;
  shutterOpacity: number;
};

/** Pure frame function shared by interactive preview, renderer, and tests. */
export function getFrameState(frame: number, recipe: VideoRecipe): FrameState {
  const timeline = getTimeline(recipe);
  const f = Math.max(0, Math.min(timeline.durationInFrames - 1, Math.floor(frame)));
  const intro =
    timeline.introFrames === 0
      ? 1
      : ease(f / Math.max(1, timeline.introFrames - 1), recipe.timeline.easing);
  const outroStart = timeline.durationInFrames - timeline.outroFrames;
  const outro =
    timeline.outroFrames === 0 || f < outroStart
      ? 0
      : timeline.outroFrames === 1
        ? 1
        : ease((f - outroStart) / (timeline.outroFrames - 1), recipe.timeline.easing);
  const metadataProgress =
    timeline.metadataFrames === 0
      ? 1
      : ease(
          (f - timeline.metadataDelayFrames) / Math.max(1, timeline.metadataFrames - 1),
          recipe.timeline.easing,
        );
  const exitFade = recipe.timeline.exit === 'fade' ? 1 - outro : 1;
  const backgroundOpacity = recipe.timeline.exit === 'hold' ? 1 : 1 - outro;
  const metadataOpacity =
    f < timeline.metadataDelayFrames ? 0 : clamp01(metadataProgress) * exitFade;
  const progress = f / Math.max(1, timeline.durationInFrames - 1);
  const speed = recipe.backgroundStyle.enabled ? recipe.backgroundStyle.speed : 0;
  const cycles = Math.round(speed);
  const phase = recipe.backgroundStyle.loop
    ? 2 * Math.PI * cycles * progress + (speed - cycles) * 0.5 * Math.sin(2 * Math.PI * progress)
    : 2 * Math.PI * speed * progress;
  const power = recipe.backgroundStyle.enabled ? recipe.backgroundStyle.intensity : 0;
  const direction = (recipe.backgroundStyle.direction * Math.PI) / 180;
  let backgroundX = 0;
  let backgroundY = 0;
  let backgroundScale = recipe.backgroundStyle.scale;
  let backgroundBrightness = 1;
  if (recipe.backgroundStyle.mode === 'drift') {
    const travel = Math.sin(phase) * recipe.videoWidth * 0.018 * power;
    backgroundX = Math.cos(direction) * travel;
    backgroundY = Math.sin(direction) * travel;
  } else if (recipe.backgroundStyle.mode === 'wave') {
    const travel =
      (Math.sin(phase) + 0.2 * Math.sin(phase * 2)) * recipe.videoWidth * 0.022 * power;
    const cross = (1 - Math.cos(phase)) * recipe.videoWidth * 0.004 * power;
    backgroundX = Math.cos(direction) * travel - Math.sin(direction) * cross;
    backgroundY = Math.sin(direction) * travel + Math.cos(direction) * cross;
    backgroundScale += Math.sin(phase) * 0.01 * power;
  } else if (recipe.backgroundStyle.mode === 'breathe') {
    backgroundScale += Math.sin(phase) * 0.012 * power;
    backgroundBrightness += Math.sin(phase) * 0.045 * power;
  }
  const usesPreblur = Boolean(recipe.image.backgroundSrc);
  const cssBlur = usesPreblur ? 0 : (recipe.backgroundStyle.blur * recipe.videoWidth) / 1080;
  const blurSafeScale = 1 + (6 * cssBlur) / Math.min(recipe.videoWidth, recipe.videoHeight);
  backgroundScale = Math.max(1, blurSafeScale, backgroundScale);
  // Scaled cover image must always extend beyond the canvas after translating.
  const horizontalRoom = (recipe.videoWidth * (backgroundScale - 1)) / 2;
  const verticalRoom = (recipe.videoHeight * (backgroundScale - 1)) / 2;
  backgroundX = Math.max(-horizontalRoom, Math.min(horizontalRoom, backgroundX));
  backgroundY = Math.max(-verticalRoom, Math.min(verticalRoom, backgroundY));
  const preset = recipe.motionPreset;
  const float = preset === 'still' ? 0 : recipe.photoLayout.float;
  const oscillation = Math.sin((2 * Math.PI * progress) / 1.4);
  const photoX =
    preset === 'still'
      ? 0
      : (preset === 'cinematic' ? lerp(-14, 14, progress) : 0) + oscillation * 4 * float;
  const photoY =
    preset === 'still'
      ? 0
      : lerp(preset === 'gallery' ? 34 : preset === 'cinematic' ? 22 : 18, 0, intro) -
        oscillation * 8 * float -
        (preset === 'gallery' ? 16 * outro : 0);
  const photoScale =
    preset === 'still'
      ? 1
      : preset === 'cinematic'
        ? lerp(1.015, 1.045, progress) * lerp(0.97, 1, intro)
        : lerp(preset === 'gallery' ? 0.94 : 0.975, 1, intro);
  const photoRotation = preset === 'gallery' ? lerp(-1.2, 0, intro) : 0;
  const photoOpacity = clamp01((preset === 'still' ? 1 : intro) * exitFade);
  const shutterOpacity =
    timeline.shutterFrames > 0 && f < timeline.shutterFrames
      ? Math.pow(1 - f / Math.max(1, timeline.shutterFrames - 1), 2) *
        recipe.timeline.shutterIntensity
      : 0;
  return {
    photoOpacity,
    photoScale,
    photoX,
    photoY,
    photoRotation,
    metadataOpacity,
    metadataY: (1 - metadataProgress) * 14,
    backgroundX,
    backgroundY,
    backgroundScale,
    backgroundOpacity,
    backgroundBrightness,
    shutterOpacity,
  };
}
