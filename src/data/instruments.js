// =============================================================================
// Bundled instrument presets. Each profile is deliberately spec-driven — focal
// length + sensor — so the field-of-view is COMPUTED (model/instruments.js),
// never a hardcoded constant. The same catalog then serves every scope: the
// S50, the wider S30, and any custom profile a user enters.
//
// A profile:
//   { id, name, focalLength_mm, aperture_mm,
//     sensor: { w_px, h_px, pixel_um } | { w_mm, h_mm },
//     fov?: { w_deg, h_deg },              // optional override; else computed
//     mount: { altAz, eqCapable, zenithDeadZone_deg } }
//
// The Seestar S50 carries the Sony IMX462 and the S30 the Sony IMX662 —
// different chips with IDENTICAL 1920×1080 @ 2.9 µm geometry, so they share
// one geometry constant below; the focal length (250 mm vs 150 mm) is why the
// S30 frames wider. Do NOT bake FOV numbers here — let it compute.
// =============================================================================

const IMX462 = { w_px: 1920, h_px: 1080, pixel_um: 2.9 };
const IMX662 = { ...IMX462 }; // same geometry, different (newer) chip

export const PRESETS = [
  {
    id: 's50',
    name: 'Seestar S50',
    focalLength_mm: 250,
    aperture_mm: 50,
    sensor: { ...IMX462 },
    // Alt-az smart scope with a firmware EQ mode; field rotation makes the last
    // few degrees to the zenith unusable in alt-az, relaxable in EQ mode.
    mount: { altAz: true, eqCapable: true, zenithDeadZone_deg: 85 },
  },
  {
    id: 's30',
    name: 'Seestar S30',
    focalLength_mm: 150,
    aperture_mm: 30,
    sensor: { ...IMX662 },
    mount: { altAz: true, eqCapable: true, zenithDeadZone_deg: 85 },
  },
];

export const DEFAULT_INSTRUMENT_ID = 's50';
