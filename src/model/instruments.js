// =============================================================================
// instruments.js — the per-instrument field-of-view model. Every "does it fit /
// how many mosaic panels / framing overlay" answer in the app reads the ACTIVE
// instrument's FOV from here; nothing hardcodes a constant. v1 bundles the S50
// (default) and S30; users can add custom scopes that persist and export.
// =============================================================================
import { PRESETS, DEFAULT_INSTRUMENT_ID } from '../data/instruments.js';

const ACTIVE_KEY = 'horizon.instrument';
const CUSTOM_KEY = 'horizon.instruments';

const RAD = Math.PI / 180;

// Angular size (degrees) a sensor edge of `size_mm` subtends at `focal_mm`.
function fovEdgeDeg(size_mm, focal_mm) {
  return 2 * Math.atan(size_mm / (2 * focal_mm)) / RAD;
}

// Sensor extent in mm, whether the profile gives millimetres directly or
// pixels + pixel pitch (µm).
function sensorMM(sensor) {
  if (sensor.w_mm != null && sensor.h_mm != null) return { w: sensor.w_mm, h: sensor.h_mm };
  return { w: (sensor.w_px * sensor.pixel_um) / 1000, h: (sensor.h_px * sensor.pixel_um) / 1000 };
}

/**
 * Field of view for a profile, in degrees. Uses an explicit `fov` override if
 * present, otherwise computes it from focal length + sensor. Returns
 * { w_deg, h_deg } — width is the sensor's long edge.
 */
export function fovOf(profile) {
  if (profile.fov && profile.fov.w_deg && profile.fov.h_deg) return { ...profile.fov };
  const mm = sensorMM(profile.sensor);
  return {
    w_deg: fovEdgeDeg(mm.w, profile.focalLength_mm),
    h_deg: fovEdgeDeg(mm.h, profile.focalLength_mm),
  };
}

/** Pixel scale in arcsec/pixel, when the sensor is given in pixels. */
export function pixelScale(profile) {
  const s = profile.sensor;
  if (s.pixel_um == null) return null;
  return (206.265 * s.pixel_um) / profile.focalLength_mm; // arcsec per pixel
}

/** The mount's near-zenith dead-zone (degrees of altitude), 0 if none. */
export function zenithDeadZone(profile) {
  return profile?.mount?.zenithDeadZone_deg ?? 0;
}

// --- Fit vs mosaic ----------------------------------------------------------
// Neighbouring panels must overlap so the mosaic stitches cleanly; the usable
// stride is the FOV minus that overlap.
const DEFAULT_OVERLAP = 0.1; // 10% — a sane smart-scope default

/**
 * How the active instrument must frame a target of angular size
 * `{ w_deg, h_deg }` (a single dimension may be passed as both).
 * @returns { fits, cols, rows, panels, overlap, tier }
 *   fits  — true when one frame covers it (1×1)
 *   tier  — 'fits' | 'mosaic 2×1' | 'mosaic 3×2' | …
 * A zero/absent size is treated as a point source → always fits.
 */
export function mosaicFor(sizeDeg, profile, { overlap = DEFAULT_OVERLAP } = {}) {
  const fov = fovOf(profile);
  const w = Math.max(0, sizeDeg?.w_deg || 0);
  const h = Math.max(0, sizeDeg?.h_deg || 0);
  const strideW = fov.w_deg * (1 - overlap);
  const strideH = fov.h_deg * (1 - overlap);
  // One frame covers the object outright if it's within a single (un-strided)
  // FOV; only larger objects pay the overlap on additional panels.
  const cols = w <= fov.w_deg ? 1 : Math.ceil((w - fov.w_deg) / strideW) + 1;
  const rows = h <= fov.h_deg ? 1 : Math.ceil((h - fov.h_deg) / strideH) + 1;
  const panels = cols * rows;
  const fits = panels === 1;
  return { fits, cols, rows, panels, overlap, tier: fits ? 'fits' : `mosaic ${cols}×${rows}` };
}

// --- Persistence + registry -------------------------------------------------
function readJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

/** User-added custom instruments (persisted, exportable with sites). */
export function customInstruments() {
  const list = readJSON(CUSTOM_KEY, []);
  return Array.isArray(list) ? list : [];
}

/** Presets first, then customs — the full switcher list. */
export function allInstruments() {
  return [...PRESETS, ...customInstruments()];
}

export function instrumentById(id) {
  return allInstruments().find((p) => p.id === id) || null;
}

/** The active instrument profile; falls back to the S50 default. */
export function activeInstrument() {
  let id;
  try { id = localStorage.getItem(ACTIVE_KEY); } catch { id = null; }
  return instrumentById(id) || instrumentById(DEFAULT_INSTRUMENT_ID) || PRESETS[0];
}

/** Set the active instrument by id; ignored if the id is unknown. */
export function setActiveInstrument(id) {
  if (!instrumentById(id)) return false;
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* private mode */ }
  return true;
}

/** Add (or replace by id) a custom instrument. Returns the stored profile. */
export function addCustomInstrument(profile) {
  const customs = customInstruments().filter((p) => p.id !== profile.id);
  customs.push(profile);
  writeJSON(CUSTOM_KEY, customs);
  return profile;
}

/** Remove a custom instrument by id (presets can't be removed). */
export function removeCustomInstrument(id) {
  writeJSON(CUSTOM_KEY, customInstruments().filter((p) => p.id !== id));
  if (activeInstrument().id === id) setActiveInstrument(DEFAULT_INSTRUMENT_ID);
}

/**
 * Build a custom profile from user inputs: focal length + either sensor mm or
 * pixels + pixel size. FOV is left to compute. id defaults to a slug of name.
 */
export function makeCustomInstrument({ id, name, focalLength_mm, aperture_mm, sensor, mount }) {
  return {
    id: id || `custom-${String(name || 'scope').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: name || 'Custom scope',
    focalLength_mm,
    aperture_mm: aperture_mm ?? null,
    sensor,
    mount: mount || { altAz: true, eqCapable: false, zenithDeadZone_deg: 0 },
    custom: true,
  };
}
