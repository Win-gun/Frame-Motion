import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import exifr from 'exifr';

test('photo import keeps only photography EXIF and strips source metadata from served JPEG', async () => {
  const original = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), 'frame-motion-assets-'));
  try {
    process.chdir(dir);
    const { AssetStore } = await import('../server/assets');
    const store = new AssetStore();
    await store.init();
    const source = await sharp({
      create: { width: 120, height: 80, channels: 3, background: '#aabbcc' },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: 'Canon', Model: 'EOS R5' },
        IFD2: { FNumber: '2.8', ISOSpeedRatings: '200', GPSLatitude: '51' },
      })
      .toBuffer();
    const photo = await store.import('test.jpg', source);
    assert.equal(photo.exif.hasExif, true);
    assert.match(photo.exif.values.camera, /Canon/);
    assert.equal(photo.exif.values.iso, 'ISO 200');
    assert.equal(
      Object.keys(photo.exif.raw).some((key) => key.startsWith('GPS')),
      false,
    );
    assert.equal(photo.width, 120);
    assert.equal(photo.height, 80);
    assert.deepEqual(await exifr.parse(await readFile(store.path(photo.id, 'image')!)), undefined);
    const background = await store.background(photo.id, 12);
    assert(background);
    assert((await sharp(background).metadata()).width! <= 960);
    const portraitBackground = await store.background(photo.id, 80, 1080, 1920);
    assert(portraitBackground);
    assert.equal((await sharp(portraitBackground).metadata()).width, 540);
    assert.equal((await sharp(portraitBackground).metadata()).height, 960);
    assert.notEqual(portraitBackground, background);
    assert.equal(await store.background(photo.id, 80, 1080, 1920), portraitBackground);
    await store.remove(photo.id);
    assert.equal(store.get(photo.id), undefined);
  } finally {
    process.chdir(original);
    await rm(dir, { recursive: true, force: true });
  }
});

test('recipe schema rejects URL substitution and invalid export numbers', async () => {
  const { parseRecipe } = await import('../server/schema');
  const { createRecipe } = await import('../src/shared/recipe');
  const image = {
    id: 'known',
    name: 'Sample',
    src: '/api/assets/known/image',
    backgroundSrc: '/api/assets/known/background',
    width: 100,
    height: 100,
    color: '#000000',
    exif: {
      raw: {},
      hasExif: false,
      values: {
        focalLength: '',
        aperture: '',
        shutter: '',
        iso: '',
        camera: '',
        lens: '',
        equivalent: '',
        date: '',
      },
    },
  };
  const recipe = createRecipe(image);
  assert.equal(parseRecipe(recipe).image.id, 'known');
  assert.equal(parseRecipe({ ...recipe, canvasRatio: '3:2' }).canvasRatio, '3:2');
  assert.throws(() => parseRecipe({ ...recipe, image: { ...image, id: '../../etc/passwd' } }));
  assert.throws(() => parseRecipe({ ...recipe, canvasRatio: '999:1' }));
  assert.throws(() => parseRecipe({ ...recipe, fps: 10000 }));
  assert.throws(() =>
    parseRecipe({ ...recipe, backgroundStyle: { ...recipe.backgroundStyle, blur: NaN } }),
  );
});

test('EXIF shutter keeps decimal exposures precise and dates local', async () => {
  const { formatExif } = await import('../server/assets');
  assert.equal(formatExif({ ExposureTime: 0.4 }).values.shutter, '0.4s');
  assert.equal(formatExif({ ExposureTime: 0.8 }).values.shutter, '0.8s');
  assert.equal(formatExif({ ExposureTime: 1 / 125 }).values.shutter, '1/125s');
  assert.equal(formatExif({ ExposureTime: 1.23456 }).values.shutter, '1.235s');
  const date = new Date('2026-01-01T23:30:00-08:00');
  const expected = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  assert.equal(formatExif({ DateTimeOriginal: date }).values.date, expected);
  assert.equal(formatExif({ DateTimeOriginal: '2026:10:24 11:22:33' }).values.date, '2026-10-24');
});
