import type { RenderJob, VideoRecipe } from './types';

/** Keep large projects inside the local API's per-request admission limit. */
export async function enqueueRecipeBatches(
  recipes: VideoRecipe[],
  submit: (recipes: VideoRecipe[]) => Promise<RenderJob[]>,
  onAccepted: (jobs: RenderJob[]) => void,
): Promise<number> {
  let accepted = 0;
  for (let index = 0; index < recipes.length; index += 30) {
    try {
      const jobs = await submit(recipes.slice(index, index + 30));
      accepted += jobs.length;
      onAccepted(jobs);
    } catch (error) {
      throw new Error(
        `${accepted ? `已加入 ${accepted} 个任务，其余未提交。` : ''}${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return accepted;
}
