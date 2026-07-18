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
// feature that never blocks the offline core. Favourited objects additionally
// get their cutouts warmed into the Cache API (model/precache.js) so the field
// works offline; the image SPECS below are shared so the page, the framing
// overlay, and the precacher agree byte-for-byte on the URL.
//
// GEOMETRY: hips2fits' `fov` parameter is the angular size along the LARGEST
// image dimension — the width for the 800×500 detail image (vertical FOV =
// fov × height/width), both axes for the square list thumb.
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
 * The details page's wider framing: ~3× the major axis (vs the list's 2.5×),
 * floored so point sources still get real sky context. One definition, used by
 * the big image, the framing overlay, and the precacher — never recompute.
 */
export function detailFovDeg(o) {
  const majDeg = o && o.size && o.size.maj ? o.size.maj / 60 : 0.15;
  return Math.min(3, Math.max(0.3, majDeg * 3));
}

/** The exact image spec of the details page's big image. */
export function detailImageSpec(o) {
  return { width: 800, height: 500, fovDeg: detailFovDeg(o) };
}

/** The exact image spec of a Targets-row preview (fov defaults inside thumbUrl). */
export function listImageSpec() {
  return { width: 96, height: 96 };
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
