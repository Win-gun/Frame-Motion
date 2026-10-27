/** Keep a local asset URL's existing query while requesting a canvas-sized blur texture. */
export function backgroundTextureUrl(
  source: string,
  blur: number,
  width: number,
  height: number,
): string {
  const hashAt = source.indexOf('#');
  const hash = hashAt < 0 ? '' : source.slice(hashAt);
  const withoutHash = hashAt < 0 ? source : source.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  const path = queryAt < 0 ? withoutHash : withoutHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt < 0 ? '' : withoutHash.slice(queryAt + 1));
  params.set('blur', String(Math.round(blur)));
  params.set('w', String(Math.round(width)));
  params.set('h', String(Math.round(height)));
  return `${path}?${params.toString()}${hash}`;
}
