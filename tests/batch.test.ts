import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueRecipeBatches } from '../src/shared/batch';
import { createRecipe } from '../src/shared/recipe';
import type { PhotoAsset, RenderJob } from '../src/shared/types';

const asset: PhotoAsset = {
  id: 'test',
  name: 'test.jpg',
  src: '/image',
  backgroundSrc: '/bg',
  width: 100,
  height: 100,
  color: '#333333',
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
test('40-photo project submits all photos within server admission limit and preserves each recipe', async () => {
  const recipes = Array.from({ length: 40 }, (_, i) => ({
    ...createRecipe({ ...asset, id: `photo-${i}` }),
    durationSeconds: (i % 10) + 1,
  }));
  const received: string[] = [];
  const sizes: number[] = [];
  const count = await enqueueRecipeBatches(
    recipes,
    async (batch) => {
      assert(batch.length <= 30);
      sizes.push(batch.length);
      received.push(...batch.map((r) => r.image.id));
      return batch.map((r) => ({ id: r.image.id, recipe: r }) as RenderJob);
    },
    () => {},
  );
  assert.deepEqual(sizes, [30, 10]);
  assert.equal(count, 40);
  assert.deepEqual(
    received,
    recipes.map((r) => r.image.id),
  );
});
test('partial submission reports accepted work and leaves subsequent batches unsubmitted on failure', async () => {
  const recipes = Array.from({ length: 70 }, () => createRecipe(asset));
  let calls = 0;
  let shown = 0;
  await assert.rejects(
    enqueueRecipeBatches(
      recipes,
      async (batch) => {
        if (++calls === 2) throw new Error('服务已断开');
        return batch.map(() => ({ id: 'job' }) as RenderJob);
      },
      (jobs) => {
        shown += jobs.length;
      },
    ),
    /已加入 30 个任务，其余未提交。服务已断开/,
  );
  assert.equal(calls, 2);
  assert.equal(shown, 30);
});
