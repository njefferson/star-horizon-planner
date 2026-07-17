// =============================================================================
// thumbnails.js — representative sky images per catalog object, from CDS
// hips2fits (keyless, CORS-friendly; the roadmap's thumbnail source). Builds
// the image URL for a real survey cutout centred on the object; the same
// builder serves the small in-list preview and the big image on the details
// page, just at different pixel sizes and field of view.
//
// OFFLINE: these are network images. Displayed via a plain <img> (no CORS
// needed just to show one), they use the browser cache and degrade to a
// placeholder when offline or when a cutout isn't available — a network
// feature that never blocks the offline core. (Cache-API precaching per object
// is a later refinement.)
//
// COORDS: the catalog stores RA in HOURS (like NGC1952 ra 5.57555); hips2fits
// wants DEGREES, so RA is ×15 here. Dec is already in degrees.
// =============================================================================

const BASE = 'https://alasky.u-strasbg.fr/hips-image-services/hips2fits';
// DSS2 colour: a real photographic all-sky survey — the closest keyless match
// to the rendered look the Seestar app shows.
const HIPS = 'CDS/P/DSS2/color';

/** Catalog RA (hours) → degrees. */
export function raDeg(o) { return Number(o.ra) * 15; }

/**
 * A field of view (degrees) that frames the object with a little margin.
 * Sized objects get ~2.5× their major axis; point-ish objects a fixed small
 * field. Clamped so nothing is absurdly wide or a sub-pixel sliver.
 */
export function thumbFovDeg(o, margin = 2.5) {
  const majDeg = o && o.size && o.size.maj ? o.size.maj / 60 : 0.1;
  return Math.max(0.15, Math.min(3, majDeg * margin));
}

/**
 * The hips2fits URL for an object's cutout.
 * @param o catalog object ({ ra (hours), dec (deg), size? })
 * @param opts { width, height, fovDeg }
 */
export function thumbUrl(o, { width = 128, height = 128, fovDeg } = {}) {
  const fov = fovDeg != null ? fovDeg : thumbFovDeg(o);
  const p = new URLSearchParams({
    hips: HIPS,
    ra: raDeg(o).toFixed(5),
    dec: Number(o.dec).toFixed(5),
    fov: fov.toFixed(4),
    width: String(width),
    height: String(height),
    projection: 'TAN',
    format: 'jpg',
  });
  return `${BASE}?${p.toString()}`;
}
