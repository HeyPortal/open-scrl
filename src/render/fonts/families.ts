/** Keep the document's portable font names separate from bundled browser faces. */
export function resolveFontFamily(family: string): string {
  return family === 'Inter' ? '"Inter Variable"' : family;
}
