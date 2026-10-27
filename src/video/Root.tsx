import React from 'react';
import { Composition } from 'remotion';
import { FloatingPhoto } from './FloatingPhoto';
import { createRecipe, getTimeline, normalizeRecipe } from '../shared/recipe';
import { exifKeys } from '../shared/types';
import type { PhotoAsset, VideoRecipe } from '../shared/types';

const blankValues = Object.fromEntries(
  exifKeys.map((key) => [key, '']),
) as PhotoAsset['exif']['values'];
const studioImage: PhotoAsset = {
  id: 'studio-placeholder',
  name: 'Photo',
  src: '',
  backgroundSrc: '',
  width: 3,
  height: 2,
  color: '#28282b',
  exif: { raw: {}, values: blankValues, hasExif: false },
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="FloatingPhoto"
    component={FloatingPhoto}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={120}
    defaultProps={{ recipe: createRecipe(studioImage) }}
    calculateMetadata={({ props }: { props: { recipe: VideoRecipe } }) => {
      const recipe = normalizeRecipe(props.recipe);
      return {
        width: recipe.videoWidth,
        height: recipe.videoHeight,
        fps: recipe.fps,
        durationInFrames: getTimeline(recipe).durationInFrames,
        props: { recipe },
      };
    }}
  />
);
