import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';
import type { ExifKey, VideoRecipe } from '../shared/types';
import {
  getFrameState,
  getMetadataLayout,
  getPhotoRect,
  resolveArrangement,
} from '../shared/animation';
import { normalizeRecipe } from '../shared/recipe';
import { backgroundTextureUrl } from './backgroundTexture';

export type FloatingPhotoProps = { recipe: VideoRecipe };

const systemSans = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const systemMono = 'SFMono-Regular, Menlo, Consolas, monospace';

function PhotoMetadata({
  recipe,
  opacity,
  translateY,
}: {
  recipe: VideoRecipe;
  opacity: number;
  translateY: number;
}) {
  const value = (key: ExifKey): string =>
    recipe.exif.enabled[key] ? (recipe.exif.values[key]?.trim() ?? '') : '';
  const camera = value('camera');
  const lens = value('lens');
  const date = value('date');
  const specs = [value('focalLength'), value('aperture'), value('shutter'), value('iso')].filter(
    Boolean,
  );
  const equivalent = value('equivalent');
  if (!camera && !lens && !date && !specs.length && !equivalent) return null;
  const unit = recipe.videoWidth / 1080;
  const side = resolveArrangement(recipe) !== 'stacked';
  const technical = [...specs, equivalent].filter(Boolean);
  const specRows = side
    ? Array.from({ length: Math.ceil(technical.length / 2) }, (_, index) =>
        technical.slice(index * 2, index * 2 + 2),
      )
    : technical.length
      ? [technical]
      : [];
  const layout = getMetadataLayout(recipe, {
    camera: Boolean(camera),
    lens: Boolean(lens),
    specs: technical.length > 0,
    specsRows: specRows.length,
    date: Boolean(date),
  });
  const base = layout.fontSize;
  const separator = ` ${recipe.typography.separator} `;
  const align = recipe.typography.align;
  const color = recipe.typography.color;
  const shared: React.CSSProperties = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  };
  return (
    <div
      style={{
        position: 'absolute',
        left: layout.left,
        width: layout.width,
        top: layout.top,
        height: layout.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
        textAlign: align,
        color,
        opacity,
        transform: `translateY(${translateY * unit}px)`,
        fontFamily: recipe.typography.font === 'mono' ? systemMono : systemSans,
        letterSpacing: recipe.typography.letterSpacing * unit,
        textShadow: `0 ${3 * unit}px ${14 * unit}px rgba(0,0,0,.65)`,
      }}
    >
      {camera && (
        <div
          style={{
            ...shared,
            fontSize: base * 1.15,
            lineHeight: 1.2,
            fontWeight: 550,
            width: '100%',
          }}
          title={camera}
        >
          {camera}
        </div>
      )}
      {lens && (
        <div
          style={{
            ...shared,
            fontSize: base * 0.82,
            lineHeight: 1.4,
            opacity: 0.82,
            width: '100%',
          }}
          title={lens}
        >
          {lens}
        </div>
      )}
      {specRows.map((row, index) => {
        const text = row.join(separator);
        const estimatedWidth = text.length * (0.62 * base + recipe.typography.letterSpacing * unit);
        const fontSize =
          estimatedWidth > layout.width
            ? Math.max(base * 0.75, (base * layout.width) / estimatedWidth)
            : base;
        return (
          <div
            key={index}
            style={{
              ...shared,
              fontFamily: systemMono,
              fontSize,
              lineHeight: 1.35,
              opacity: 0.92,
              width: '100%',
            }}
            title={text}
          >
            {text}
          </div>
        );
      })}
      {date && (
        <div
          style={{
            ...shared,
            fontSize: base * 0.68,
            lineHeight: 1.4,
            opacity: 0.62,
            width: '100%',
          }}
        >
          {date}
        </div>
      )}
    </div>
  );
}

export const FloatingPhoto: React.FC<FloatingPhotoProps> = ({ recipe: inputRecipe }) => {
  const frame = useCurrentFrame();
  const recipe = normalizeRecipe(inputRecipe);
  const state = getFrameState(frame, recipe);
  const rect = getPhotoRect(recipe);
  const { backgroundStyle, photoLayout, image } = recipe;
  const usePreblur = Boolean(image.backgroundSrc);
  const backgroundSource = usePreblur
    ? backgroundTextureUrl(
        image.backgroundSrc,
        backgroundStyle.blur,
        recipe.videoWidth,
        recipe.videoHeight,
      )
    : image.src;
  const backgroundBlur = usePreblur ? 0 : (backgroundStyle.blur * recipe.videoWidth) / 1080;
  const radius = (photoLayout.radius * recipe.videoWidth) / 1080;
  const deepShadow = photoLayout.shadow;
  return (
    <AbsoluteFill style={{ backgroundColor: backgroundStyle.color, overflow: 'hidden' }}>
      {backgroundSource && (
        <AbsoluteFill style={{ overflow: 'hidden', opacity: state.backgroundOpacity }}>
          <Img
            src={backgroundSource}
            style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: backgroundStyle.opacity,
              filter: `${backgroundBlur > 0 ? `blur(${backgroundBlur}px) ` : ''}brightness(${state.backgroundBrightness})`,
              transform: `translate(${state.backgroundX}px, ${state.backgroundY}px) scale(${state.backgroundScale})`,
              transformOrigin: 'center',
            }}
          />
          <AbsoluteFill style={{ backgroundColor: '#08090d', opacity: backgroundStyle.darken }} />
        </AbsoluteFill>
      )}
      {image.src && (
        <div
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            opacity: state.photoOpacity,
            transform: `translate(${state.photoX}px, ${state.photoY}px) scale(${state.photoScale}) rotate(${state.photoRotation}deg)`,
            transformOrigin: 'center',
            borderRadius: radius,
            boxShadow: `${0}px ${(28 * recipe.videoWidth) / 1080}px ${(85 * recipe.videoWidth) / 1080}px rgba(0,0,0,${0.5 * deepShadow}), 0 ${(7 * recipe.videoWidth) / 1080}px ${(24 * recipe.videoWidth) / 1080}px rgba(0,0,0,${0.42 * deepShadow})`,
            overflow: 'hidden',
            border: photoLayout.border
              ? `${(photoLayout.border * recipe.videoWidth) / 1080}px solid rgba(255,255,255,.75)`
              : undefined,
            boxSizing: 'border-box',
          }}
        >
          <Img
            src={image.src}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: photoLayout.fit }}
          />
        </div>
      )}
      <PhotoMetadata recipe={recipe} opacity={state.metadataOpacity} translateY={state.metadataY} />
      {state.shutterOpacity > 0 && (
        <AbsoluteFill style={{ backgroundColor: '#fff9ed', opacity: state.shutterOpacity }} />
      )}
    </AbsoluteFill>
  );
};
