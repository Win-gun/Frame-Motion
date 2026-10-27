import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getFrameState,
  getMetadataLayout,
  getPhotoRect,
  resolveArrangement,
} from '../src/shared/animation';
import { canvasDimensions, createRecipe, getTimeline, normalizeRecipe } from '../src/shared/recipe';
import { exifKeys } from '../src/shared/types';
import type { PhotoAsset, VideoRecipe } from '../src/shared/types';
import { backgroundTextureUrl } from '../src/video/backgroundTexture';
import { parseRecipe, recipeSchema } from '../server/schema';

const image: PhotoAsset = {
  id: 'test',
  name: 'Photo',
  src: '/photo.jpg',
  backgroundSrc: '/background.jpg',
  width: 4000,
  height: 3000,
  color: '#333',
  exif: {
    raw: {},
    hasExif: true,
    values: Object.fromEntries(
      exifKeys.map((key) => [key, key === 'camera' ? 'Camera' : '']),
    ) as PhotoAsset['exif']['values'],
  },
};

test('default recipe and canvas dimensions', () => {
  const recipe = createRecipe(image);
  assert.deepEqual(
    [recipe.videoWidth, recipe.videoHeight, recipe.fps, recipe.durationSeconds],
    [1080, 1920, 30, 4],
  );
  assert.equal(recipe.typography.size, 36);
  assert.deepEqual(
    [
      recipe.backgroundStyle.opacity,
      recipe.backgroundStyle.darken,
      recipe.backgroundStyle.scale,
      recipe.backgroundStyle.color,
      recipe.photoLayout.float,
    ],
    [0.3, 0.1, 1.1, image.color, 0.15],
  );
  assert.deepEqual(
    exifKeys.slice(0, 4).map((key) => recipe.exif.enabled[key]),
    [true, true, true, true],
  );
  assert.equal(recipe.exif.enabled.camera, true);
  assert.equal(recipe.exif.enabled.lens, false);
  assert.deepEqual(canvasDimensions('16:9', '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(canvasDimensions('1:1', '720p'), { width: 720, height: 720 });
  assert.deepEqual(canvasDimensions('3:2', '1080p'), { width: 1620, height: 1080 });
  assert.deepEqual(canvasDimensions('bad', '1080p'), { width: 1080, height: 1920 });
});

test('extreme custom ratios scale evenly within the renderer limit', () => {
  for (const [ratio, expectedAspect] of [
    ['5:1', 5],
    ['1:5', 0.2],
  ] as const) {
    const dimensions = canvasDimensions(ratio, '4K');
    assert.ok(Math.max(dimensions.width, dimensions.height) <= 8192);
    assert.equal(dimensions.width % 2, 0);
    assert.equal(dimensions.height % 2, 0);
    assert.ok(Math.abs(dimensions.width / dimensions.height - expectedAspect) <= 0.01);
    const recipe = createRecipe(image);
    recipe.canvasRatio = ratio;
    recipe.exportSettings.resolution = '4K';
    const normalized = normalizeRecipe(recipe);
    assert.deepEqual(
      [normalized.videoWidth, normalized.videoHeight],
      [dimensions.width, dimensions.height],
    );
  }
  assert.deepEqual(canvasDimensions('16:9', '4K'), { width: 3840, height: 2160 });
});

test('background texture URL carries blur and canvas size without losing the asset path', () => {
  assert.equal(
    backgroundTextureUrl('/api/assets/id/background?blur=28&token=local', 47.6, 1080, 1920),
    '/api/assets/id/background?blur=48&token=local&w=1080&h=1920',
  );
  assert.equal(
    backgroundTextureUrl(
      'http://127.0.0.1:3000/api/assets/id/background?blur=28#preview',
      0,
      3840,
      2160,
    ),
    'http://127.0.0.1:3000/api/assets/id/background?blur=0&w=3840&h=2160#preview',
  );
});

test('1-second clip keeps at least half of frames for display', () => {
  const recipe = createRecipe(image);
  recipe.durationSeconds = 1;
  recipe.timeline.introDuration = 1;
  recipe.timeline.outroDuration = 1;
  recipe.timeline.shutter = true;
  recipe.timeline.shutterDuration = 2;
  const timeline = getTimeline(recipe);
  assert.equal(timeline.durationInFrames, 30);
  assert.ok(timeline.holdFrames >= 15);
  assert.equal(timeline.introFrames + timeline.outroFrames + timeline.holdFrames, 30);
  assert.ok(timeline.shutterFrames <= 15);
  assert.ok(timeline.metadataDelayFrames + timeline.metadataFrames <= 30);
});

test('15-second 60fps clip has exact frame count and legal metadata', () => {
  const recipe = createRecipe(image);
  recipe.durationSeconds = 15;
  recipe.fps = 60;
  recipe.timeline.metadataDelay = 20;
  recipe.timeline.metadataDuration = 30;
  const timeline = getTimeline(recipe);
  assert.equal(timeline.durationInFrames, 900);
  assert.equal(timeline.metadataDelayFrames, 899);
  assert.equal(timeline.metadataFrames, 1);
  assert.ok(timeline.holdFrames >= 450);
});

test('normalization recomputes dimensions and protects zero-length transitions', () => {
  const recipe = createRecipe(image);
  recipe.canvasRatio = '3:2';
  recipe.videoWidth = 1;
  recipe.videoHeight = 1;
  recipe.timeline.introDuration = 0;
  recipe.timeline.outroDuration = 0;
  const normalized = normalizeRecipe(recipe);
  assert.deepEqual([normalized.videoWidth, normalized.videoHeight], [1620, 1080]);
  const timeline = getTimeline(normalized);
  assert.equal(timeline.holdFrames, timeline.durationInFrames);
  assert.equal(getFrameState(0, normalized).photoOpacity, 1);
});

test('normalization writes frame budget back and limits duration and fps', () => {
  const recipe = createRecipe(image);
  recipe.durationSeconds = 0.2;
  recipe.fps = 59;
  recipe.timeline.introDuration = 2;
  recipe.timeline.outroDuration = 2;
  recipe.timeline.shutter = true;
  recipe.timeline.shutterDuration = 3;
  const normalized = normalizeRecipe(recipe);
  const timeline = getTimeline(normalized);
  assert.equal(normalized.durationSeconds, 1);
  assert.equal(normalized.fps, 60);
  assert.equal(normalized.timeline.introDuration, timeline.introFrames / 60);
  assert.equal(normalized.timeline.outroDuration, timeline.outroFrames / 60);
  assert.equal(normalized.timeline.shutterDuration, timeline.shutterFrames / 60);
  assert.ok(timeline.holdFrames >= 30);
  assert.deepEqual(getTimeline(normalizeRecipe(normalized)), timeline);
  recipe.durationSeconds = 100;
  recipe.fps = 23;
  assert.deepEqual(
    [normalizeRecipe(recipe).durationSeconds, normalizeRecipe(recipe).fps],
    [60, 24],
  );
});

test('duration target survives frame rounding and fps changes', () => {
  const recipe = createRecipe(image);
  recipe.durationSeconds = 1.1;
  recipe.fps = 24;
  const at24 = normalizeRecipe(recipe);
  assert.equal(at24.durationSeconds, 1.1);
  assert.equal(getTimeline(at24).durationInFrames, 26);
  const at60 = normalizeRecipe({ ...at24, fps: 60 });
  assert.equal(at60.durationSeconds, 1.1);
  assert.equal(getTimeline(at60).durationInFrames, 66);
});

test('photo layout contains full image without deformation or overflow', () => {
  const recipe = createRecipe(image);
  for (const ratio of ['9:16', '16:9', '1:1']) {
    const normalized = normalizeRecipe({ ...recipe, canvasRatio: ratio });
    const rect = getPhotoRect(normalized);
    assert.ok(Math.abs(rect.width / rect.height - image.width / image.height) < 1e-10);
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.width <= normalized.videoWidth);
    assert.ok(rect.y + rect.height <= normalized.videoHeight);
  }
});

test('auto layout enlarges a portrait photo beside metadata on wide canvas', () => {
  const portrait = { ...image, width: 3000, height: 4500 };
  const recipe = normalizeRecipe({ ...createRecipe(portrait), canvasRatio: '16:9' });
  assert.equal(resolveArrangement(recipe), 'photo-left');
  const photo = getPhotoRect(recipe);
  const metadata = getMetadataLayout(recipe, {
    camera: true,
    lens: true,
    specs: true,
    specsRows: 2,
    date: true,
  });
  assert.ok(photo.height >= recipe.videoHeight * 0.8);
  assert.ok(photo.x + photo.width < metadata.left);
  assert.ok(metadata.left + metadata.width <= recipe.videoWidth);
  assert.ok(
    metadata.top >= 0 && metadata.top + metadata.height <= recipe.videoHeight - metadata.safeBottom,
  );
  assert.ok(metadata.fontSize >= 24);

  const right = normalizeRecipe({
    ...recipe,
    photoLayout: { ...recipe.photoLayout, arrangement: 'photo-right' },
  });
  const rightPhoto = getPhotoRect(right);
  const rightMetadata = getMetadataLayout(right, {
    camera: true,
    lens: true,
    specs: true,
    specsRows: 2,
    date: true,
  });
  assert.ok(Math.abs(photo.x + rightPhoto.x + photo.width - recipe.videoWidth) < 1e-8);
  assert.ok(rightMetadata.left + rightMetadata.width < rightPhoto.x);
  assert.ok(
    Math.abs(metadata.left + rightMetadata.left + metadata.width - recipe.videoWidth) < 1e-8,
  );
});

test('wide portrait photo without metadata fills most of the canvas height', () => {
  const portrait = {
    ...image,
    width: 3000,
    height: 4500,
    exif: {
      ...image.exif,
      values: Object.fromEntries(exifKeys.map((key) => [key, ''])) as PhotoAsset['exif']['values'],
    },
  };
  const recipe = normalizeRecipe({ ...createRecipe(portrait), canvasRatio: '16:9' });
  assert.equal(resolveArrangement(recipe), 'stacked');
  assert.ok(getPhotoRect(recipe).height >= recipe.videoHeight * 0.88);
});

test('manual size and canvas-relative position keep working past the frame edges', () => {
  const portrait = { ...image, width: 3000, height: 4500 };
  const recipe = normalizeRecipe({ ...createRecipe(portrait), canvasRatio: '16:9' });
  const rect90 = getPhotoRect(recipe);
  const rect150 = getPhotoRect({ ...recipe, photoLayout: { ...recipe.photoLayout, size: 150 } });
  const rect200 = getPhotoRect({ ...recipe, photoLayout: { ...recipe.photoLayout, size: 200 } });
  assert.ok(rect90.height < rect150.height && rect150.height < rect200.height);
  const left = getPhotoRect({
    ...recipe,
    photoLayout: { ...recipe.photoLayout, size: 200, x: -100 },
  });
  const right = getPhotoRect({
    ...recipe,
    photoLayout: { ...recipe.photoLayout, size: 200, x: 100 },
  });
  const up = getPhotoRect({
    ...recipe,
    photoLayout: { ...recipe.photoLayout, size: 200, y: -100 },
  });
  const down = getPhotoRect({
    ...recipe,
    photoLayout: { ...recipe.photoLayout, size: 200, y: 100 },
  });
  assert.ok(left.x < rect200.x && right.x > rect200.x);
  assert.ok(up.y < rect200.y && down.y > rect200.y);
  assert.ok(Math.abs(right.x - left.x - 2 * recipe.videoWidth) < 1e-8);
  assert.ok(Math.abs(down.y - up.y - 2 * recipe.videoHeight) < 1e-8);
  const metadata = getMetadataLayout(
    { ...recipe, photoLayout: { ...recipe.photoLayout, size: 200, x: 100, y: 100 } },
    { camera: true, lens: true, specs: true, specsRows: 2, date: true },
  );
  assert.ok(Number.isFinite(metadata.fontSize) && metadata.fontSize > 0);
  assert.ok(metadata.top >= 0 && metadata.top + metadata.height <= recipe.videoHeight);
});

test('manual stacked mode and existing canvas/photo pairings retain their layout', () => {
  const portraitImage = { ...image, width: 3000, height: 4500 };
  const portraitCanvas = normalizeRecipe(createRecipe(portraitImage));
  assert.equal(resolveArrangement(portraitCanvas), 'stacked');
  const landscapeCanvas = normalizeRecipe({ ...createRecipe(image), canvasRatio: '16:9' });
  assert.equal(resolveArrangement(landscapeCanvas), 'stacked');
  const forcedStacked = normalizeRecipe({
    ...createRecipe(portraitImage),
    canvasRatio: '16:9',
    photoLayout: { ...createRecipe(portraitImage).photoLayout, arrangement: 'stacked' },
  });
  assert.equal(resolveArrangement(forcedStacked), 'stacked');
});

test('old recipe positions migrate once and server accepts missing arrangement', () => {
  const old = createRecipe(image);
  old.photoLayout.x = 80;
  old.photoLayout.y = -60;
  const oldPosition = { ...old, photoLayout: { ...old.photoLayout } } as VideoRecipe;
  delete (oldPosition.photoLayout as Partial<VideoRecipe['photoLayout']>).arrangement;
  assert.equal(recipeSchema.parse(oldPosition).photoLayout.arrangement, 'auto');
  const migrated = normalizeRecipe(oldPosition);
  assert.equal(migrated.photoLayout.arrangement, 'auto');
  assert.deepEqual(normalizeRecipe(migrated).photoLayout, migrated.photoLayout);
  const baseRect = getPhotoRect(createRecipe(image));
  const rect = getPhotoRect(migrated);
  const stageHeight = old.videoHeight * (0.79 - 0.065);
  assert.ok(
    Math.abs(rect.x - baseRect.x - ((old.videoWidth - baseRect.width) * old.photoLayout.x) / 200) <
      1e-8,
  );
  assert.ok(
    Math.abs(rect.y - baseRect.y - ((stageHeight - baseRect.height) * old.photoLayout.y) / 200) <
      1e-8,
  );
  assert.deepEqual(parseRecipe(oldPosition).photoLayout, migrated.photoLayout);
});

test('cover uses a fixed stage frame while contain preserves the photo ratio', () => {
  const recipe = createRecipe(image);
  const contain = getPhotoRect(recipe);
  recipe.photoLayout.fit = 'cover';
  const cover = getPhotoRect(recipe);
  assert.ok(Math.abs(contain.width / contain.height - image.width / image.height) < 1e-10);
  assert.ok(Math.abs(cover.width / cover.height - image.width / image.height) > 0.1);
  assert.ok(cover.width >= contain.width && cover.height >= contain.height);
});

test('metadata follows photo, stays readable and avoids canvas edges with four rows', () => {
  const lines = { camera: true, lens: true, specs: true, date: true };
  for (const ratio of ['9:16', '16:9', '1:1']) {
    for (const offset of [-80, 0, 80]) {
      const recipe = createRecipe(image);
      recipe.canvasRatio = ratio;
      recipe.typography.offset = offset;
      recipe.photoLayout.size = 100;
      const normalized = normalizeRecipe(recipe);
      const photo = getPhotoRect(normalized);
      const metadata = getMetadataLayout(normalized, lines);
      assert.ok(
        metadata.top > photo.y + photo.height,
        `${ratio} offset ${offset}: metadata overlaps photo`,
      );
      assert.ok(
        metadata.top + metadata.height <= normalized.videoHeight - metadata.safeBottom + 1e-8,
      );
      assert.ok(metadata.fontSize >= 25, `${ratio} offset ${offset}: metadata too small`);
      if (ratio === '9:16' && offset === 0) {
        assert.ok(Math.abs(metadata.top - (photo.y + photo.height + 40)) < 1e-8);
        assert.equal(metadata.fontSize, 36);
      }
    }
  }
});

test('frame animation is deterministic and fade reaches zero on the final frame', () => {
  const recipe = createRecipe(image);
  recipe.timeline.exit = 'fade';
  recipe.backgroundStyle.mode = 'wave';
  const timeline = getTimeline(recipe);
  assert.deepEqual(getFrameState(47, recipe), getFrameState(47, recipe));
  assert.equal(getFrameState(timeline.durationInFrames - 1, recipe).photoOpacity, 0);
  assert.equal(getFrameState(timeline.durationInFrames - 1, recipe).metadataOpacity, 0);
  assert.equal(getFrameState(timeline.durationInFrames - 1, recipe).backgroundOpacity, 0);
  recipe.timeline.exit = 'hold';
  assert.equal(getFrameState(timeline.durationInFrames - 1, recipe).photoOpacity, 1);
  assert.equal(getFrameState(timeline.durationInFrames - 1, recipe).backgroundOpacity, 1);
  recipe.timeline.exit = 'background';
  const end = getFrameState(timeline.durationInFrames - 1, recipe);
  assert.equal(end.photoOpacity, 1);
  assert.equal(end.metadataOpacity, 1);
  assert.equal(end.backgroundOpacity, 0);
  assert.equal(getFrameState(0, recipe).photoOpacity, 0);
});

test('still photo is fixed; static and disabled background have no motion', () => {
  const recipe = createRecipe(image);
  recipe.motionPreset = 'still';
  for (const frame of [0, 17, 90, 119]) {
    const state = getFrameState(frame, recipe);
    assert.deepEqual(
      [state.photoOpacity, state.photoScale, state.photoX, state.photoY, state.photoRotation],
      [1, 1, 0, 0, 0],
    );
  }
  recipe.backgroundStyle.mode = 'static';
  const staticState = getFrameState(40, recipe);
  assert.deepEqual(
    [
      staticState.backgroundX,
      staticState.backgroundY,
      staticState.backgroundBrightness,
      staticState.backgroundOpacity,
    ],
    [0, 0, 1, 1],
  );
  recipe.backgroundStyle.mode = 'wave';
  recipe.backgroundStyle.enabled = false;
  const disabled = getFrameState(40, recipe);
  assert.deepEqual(
    [
      disabled.backgroundX,
      disabled.backgroundY,
      disabled.backgroundBrightness,
      disabled.backgroundOpacity,
    ],
    [0, 0, 1, 1],
  );
});

test('background speed, direction, loop and breathe brightness are frame-driven', () => {
  const recipe = createRecipe(image);
  recipe.backgroundStyle.mode = 'drift';
  recipe.backgroundStyle.loop = true;
  const first = getFrameState(0, recipe);
  const last = getFrameState(getTimeline(recipe).durationInFrames - 1, recipe);
  assert.ok(Math.abs(first.backgroundX - last.backgroundX) < 1e-8);
  assert.ok(Math.abs(first.backgroundY - last.backgroundY) < 1e-8);
  recipe.backgroundStyle.speed = 2;
  assert.notEqual(
    getFrameState(31, recipe).backgroundX,
    getFrameState(31, { ...recipe, backgroundStyle: { ...recipe.backgroundStyle, speed: 1 } })
      .backgroundX,
  );
  assert.equal(
    getFrameState(31, recipe).photoY,
    getFrameState(31, { ...recipe, backgroundStyle: { ...recipe.backgroundStyle, speed: 1 } })
      .photoY,
  );
  recipe.backgroundStyle.direction = 90;
  const vertical = getFrameState(31, recipe);
  assert.ok(Math.abs(vertical.backgroundX) < 1e-8);
  assert.notEqual(vertical.backgroundY, 0);
  recipe.backgroundStyle.mode = 'breathe';
  assert.notEqual(getFrameState(31, recipe).backgroundBrightness, 1);
  const breatheEnd = getFrameState(getTimeline(recipe).durationInFrames - 1, recipe);
  assert.ok(
    Math.abs(breatheEnd.backgroundBrightness - getFrameState(0, recipe).backgroundBrightness) <
      1e-8,
  );
});

test('background translation stays inside scaled image cover at every resolution', () => {
  const recipe = createRecipe(image);
  recipe.backgroundStyle.mode = 'wave';
  recipe.backgroundStyle.intensity = 1;
  recipe.backgroundStyle.scale = 1;
  recipe.backgroundStyle.blur = 0;
  for (const resolution of ['720p', '1080p', '4K'] as const) {
    const normalized = normalizeRecipe({
      ...recipe,
      exportSettings: { ...recipe.exportSettings, resolution },
    });
    for (let frame = 0; frame < getTimeline(normalized).durationInFrames; frame += 7) {
      const state = getFrameState(frame, normalized);
      const xRoom = (normalized.videoWidth * (state.backgroundScale - 1)) / 2;
      const yRoom = (normalized.videoHeight * (state.backgroundScale - 1)) / 2;
      assert.ok(Math.abs(state.backgroundX) <= xRoom + 1e-8);
      assert.ok(Math.abs(state.backgroundY) <= yRoom + 1e-8);
    }
  }
});

test('preblur texture avoids CSS blur safety zoom for nondefault blur settings', () => {
  const recipe = createRecipe(image);
  recipe.backgroundStyle.blur = 80;
  recipe.backgroundStyle.scale = 1;
  recipe.backgroundStyle.mode = 'static';
  assert.equal(getFrameState(30, recipe).backgroundScale, 1);
  const withoutTexture = { ...recipe, image: { ...image, backgroundSrc: '' } };
  assert.ok(getFrameState(30, withoutTexture).backgroundScale > 1);
});
