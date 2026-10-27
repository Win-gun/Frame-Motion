export const exifKeys = [
  'focalLength',
  'aperture',
  'shutter',
  'iso',
  'camera',
  'lens',
  'equivalent',
  'date',
] as const;
export type ExifKey = (typeof exifKeys)[number];
export type ExifValues = Record<ExifKey, string>;
export type ExifData = {
  raw: Record<string, string | number>;
  values: ExifValues;
  hasExif: boolean;
};
export type PhotoAsset = {
  id: string;
  name: string;
  src: string;
  backgroundSrc: string;
  width: number;
  height: number;
  color: string;
  exif: ExifData;
};
export type MotionPreset = 'soft' | 'gallery' | 'shutter' | 'cinematic' | 'still';
export type BackgroundMode = 'static' | 'drift' | 'wave' | 'breathe';
export type VideoRecipe = {
  image: PhotoAsset;
  exif: { values: ExifValues; enabled: Record<ExifKey, boolean> };
  canvasRatio: string;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  durationSeconds: number;
  timeline: {
    introDuration: number;
    outroDuration: number;
    metadataDelay: number;
    metadataDuration: number;
    easing: 'ease-out' | 'spring' | 'linear';
    exit: 'hold' | 'fade' | 'background';
    shutter: boolean;
    shutterDuration: number;
    shutterIntensity: number;
  };
  backgroundStyle: {
    mode: BackgroundMode;
    enabled: boolean;
    blur: number;
    opacity: number;
    darken: number;
    scale: number;
    color: string;
    speed: number;
    intensity: number;
    direction: number;
    loop: boolean;
  };
  photoLayout: {
    arrangement: 'auto' | 'stacked' | 'photo-left' | 'photo-right';
    size: number;
    x: number;
    y: number;
    radius: number;
    shadow: number;
    float: number;
    border: number;
    fit: 'contain' | 'cover';
  };
  motionPreset: MotionPreset;
  typography: {
    font: 'sans' | 'mono';
    size: number;
    color: string;
    letterSpacing: number;
    align: 'left' | 'center' | 'right';
    separator: '·' | '/' | '—';
    offset: number;
  };
  exportSettings: {
    resolution: '720p' | '1080p' | '2K' | '4K';
    quality: number;
    codec: 'h264' | 'prores';
  };
};
export type RenderJob = {
  id: string;
  name: string;
  status: 'queued' | 'bundling' | 'rendering' | 'encoding' | 'done' | 'failed' | 'cancelled';
  progress: number;
  renderedFrames: number;
  totalFrames: number;
  error?: string;
  url?: string;
  createdAt: number;
  recipe: VideoRecipe;
};
