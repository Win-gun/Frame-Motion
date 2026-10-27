import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createRecipe, normalizeRecipe } from './shared/recipe';
import type { PhotoAsset, VideoRecipe } from './shared/types';

type EditorState = {
  recipes: VideoRecipe[];
  selectedId: string | null;
  projectName: string;
  add: (photos: PhotoAsset[], demo?: boolean) => void;
  select: (id: string) => void;
  update: (update: (recipe: VideoRecipe) => VideoRecipe) => void;
  remove: (id: string) => void;
  applyAll: () => void;
  rename: (name: string) => void;
};
export const useEditor = create<EditorState>()(
  persist(
    (set) => ({
      recipes: [],
      selectedId: null,
      projectName: '秋日 · 成片集',
      add: (photos, demo = false) =>
        set((s) => {
          const added = photos
            .filter((p) => !s.recipes.some((r) => r.image.id === p.id))
            .map((p) => {
              const recipe = createRecipe(p);
              if (demo) {
                recipe.exif.values = {
                  ...recipe.exif.values,
                  focalLength: '85mm',
                  aperture: 'f/1.8',
                  shutter: '1/320s',
                  iso: 'ISO 200',
                };
              }
              return recipe;
            });
          return {
            recipes: [...s.recipes, ...added],
            selectedId: added[0]?.image.id ?? s.selectedId,
          };
        }),
      select: (id) => set({ selectedId: id }),
      update: (update) =>
        set((s) => ({
          recipes: s.recipes.map((r) =>
            r.image.id === s.selectedId ? normalizeRecipe(update(structuredClone(r))) : r,
          ),
        })),
      remove: (id) =>
        set((s) => {
          const recipes = s.recipes.filter((r) => r.image.id !== id);
          return {
            recipes,
            selectedId: s.selectedId === id ? (recipes[0]?.image.id ?? null) : s.selectedId,
          };
        }),
      applyAll: () =>
        set((s) => {
          const current = s.recipes.find((r) => r.image.id === s.selectedId);
          if (!current) return {};
          return {
            recipes: s.recipes.map((r) =>
              normalizeRecipe({ ...structuredClone(current), image: r.image, exif: r.exif }),
            ),
          };
        }),
      rename: (projectName) => set({ projectName }),
    }),
    {
      name: 'frame-motion-project-v1',
      merge: (persisted, current) => {
        const saved = persisted as Partial<EditorState> | undefined;
        return {
          ...current,
          ...saved,
          recipes: Array.isArray(saved?.recipes)
            ? saved.recipes.map(normalizeRecipe)
            : current.recipes,
        };
      },
      partialize: (state) => ({
        recipes: state.recipes,
        selectedId: state.selectedId,
        projectName: state.projectName,
      }),
    },
  ),
);
