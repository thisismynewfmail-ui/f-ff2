/**
 * Cache-busting URL builder for every runtime-loaded image asset.
 *
 * The game loads its textures and sprites straight off disk with `new Image()`
 * (see TextureLib and Portrait). Static file servers — including the
 * `python3 -m http.server` in the README — hand images out with a
 * `Last-Modified` header but no explicit `no-cache`, so browsers cache them
 * *heuristically*. The practical result: editing a PNG in `assets/` and
 * reloading — or even restarting the server — keeps painting the STALE cached
 * copy, so the documented "drop a PNG in to reskin" workflow silently did
 * nothing.
 *
 * Appending a token that changes every page load forces the browser to
 * re-request the current file, so on-disk edits (a new brick, a 512x512
 * grass.png, a fresh sprite sheet) always show up in game. The bytes fetched
 * are identical to the file on disk — only the request URL carries the token —
 * so keying, tiling, sprite-sheet frames and every rotation/orientation are
 * applied exactly as before.
 *
 * The token is fixed for the life of the page (one value per reload, shared by
 * every asset via the ES-module singleton), so a single session still fetches
 * one coherent generation of assets rather than a different one per request.
 */
export const ASSET_VERSION = Date.now();

/** Append the per-load cache-busting token to an asset path. */
export function assetUrl(path) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}v=${ASSET_VERSION}`;
}
