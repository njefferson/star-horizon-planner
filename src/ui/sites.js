// =============================================================================
// sites.js (UI) — manage observing sites: list, switch the active one, add /
// edit / delete, and back up everything (sites + favourites + custom scopes) to
// a JSON file you can restore in another browser. The active site drives the
// Tonight graph and the Horizon editor.
// =============================================================================
import { el, clear, toast } from './dom.js';
import {
  loadSites, activeSite, setActiveSite, addSite, updateSite, removeSite,
  exportBundle, importBundle,
} from '../model/sites.js';
import { makeHorizon, maxAltitude, isFlat } from '../model/horizon.js';
import { requestGeolocation } from '../model/location.js';

export function renderSites(app, state, nav) {
  clear(app);
  const sites = loadSites();
  const active = activeSite();

  // The title sits alone on the first row; interactive controls go below it, so
  // they never collide with the floating About/Night-Mode buttons in the corner.
  app.append(
    el('h1', {}, 'Sites'),
    el('div.row-actions', {}, [el('button.btn.primary', { onclick: () => openSiteForm(nav) }, '+ Add site')]),
  );

  if (!sites.length) {
    app.append(el('div.dead-end', {}, [
      el('h2', {}, 'No sites yet'),
      el('p', {}, 'Add your backyard or a dark-sky spot — coordinates place the sky, and each site keeps its own measured horizon.'),
      el('div.card-actions', {}, [el('button.btn.primary', { onclick: () => openSiteForm(nav) }, 'Add your first site')]),
    ]));
  } else {
    const list = el('div.site-list');
    for (const s of sites) list.append(siteRow(s, s.id === active?.id, nav));
    app.append(list);
  }

  app.append(el('section.settings-block', {}, [
    el('h2', {}, 'Backup'),
    el('p.dim.small', {}, 'Export your sites, favourites and custom scopes to a file — and restore them in another browser or after clearing data.'),
    el('div.card-actions', {}, [
      el('button.btn', { onclick: () => exportBackup() }, 'Export backup'),
      el('button.btn', { onclick: () => openImport(nav) }, 'Import backup…'),
    ]),
  ]));
}

function siteRow(site, isActive, nav) {
  const prof = makeHorizon(site.horizon);
  const hz = isFlat(prof) ? 'flat horizon' : `horizon to ${maxAltitude(prof).toFixed(0)}°`;
  return el('div.site-row', { class: isActive ? 'active' : '' }, [
    el('button.site-main', {
      onclick: () => { if (!isActive) { setActiveSite(site.id); nav.rerender(); } },
      title: isActive ? 'Active site' : 'Make active',
    }, [
      el('div.site-name', {}, [
        el('span', {}, site.name),
        isActive ? el('span.site-active', {}, 'active') : null,
      ]),
      el('div.site-meta.mono', {}, `${site.lat.toFixed(3)}, ${site.lon.toFixed(3)} · ${hz}`),
    ]),
    el('div.site-actions', {}, [
      el('button.btn.small', { onclick: () => openSiteForm(nav, site) }, 'Edit'),
      el('button.btn.small.danger', { onclick: () => {
        if (confirm(`Delete “${site.name}”? Its horizon profile is removed too.`)) { removeSite(site.id); toast('Site deleted.'); nav.rerender(); }
      } }, 'Delete'),
    ]),
  ]);
}

function openSiteForm(nav, site = null) {
  document.querySelector('.loc-dialog')?.remove();
  const name = el('input.loc-in', { type: 'text', placeholder: 'Name (e.g. Backyard)', value: site?.name ?? '' });
  const lat = el('input.loc-in', { type: 'number', step: '0.0001', placeholder: 'Latitude', value: site?.lat ?? '' });
  const lon = el('input.loc-in', { type: 'number', step: '0.0001', placeholder: 'Longitude', value: site?.lon ?? '' });
  const geoBtn = el('button.btn.small', { onclick: async () => {
    geoBtn.textContent = 'Locating…';
    const l = await requestGeolocation();
    geoBtn.textContent = 'Use my location';
    if (l) { lat.value = l.lat.toFixed(4); lon.value = l.lon.toFixed(4); }
    else toast('Location unavailable.');
  } }, 'Use my location');

  const dlg = el('dialog.loc-dialog', {}, [
    el('h2', {}, site ? 'Edit site' : 'Add site'),
    el('div.loc-grid', {}, [
      labeled('Name', name), labeled('Latitude', lat), labeled('Longitude', lon),
      el('div', {}, geoBtn),
    ]),
    el('div.hz-dialog-foot', {}, [
      el('button.btn.ghost', { onclick: () => dlg.close() }, 'Cancel'),
      el('button.btn.primary', { onclick: () => {
        const la = parseFloat(lat.value), lo = parseFloat(lon.value);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) { toast('Enter a latitude and longitude.'); return; }
        if (site) updateSite(site.id, { name: name.value, lat: la, lon: lo });
        else { const s = addSite({ name: name.value, lat: la, lon: lo }); setActiveSite(s.id); }
        dlg.close(); nav.rerender();
      } }, 'Save'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}

function exportBackup() {
  try {
    const json = exportBundle(new Date().toISOString());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'horizon-planner-backup.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backup exported.');
  } catch { toast('Export not available here.'); }
}

function openImport(nav) {
  document.querySelector('.loc-dialog')?.remove();
  const ta = el('textarea.hz-import', { placeholder: 'Paste a backup file’s contents, or choose a file above.', rows: 6 });
  const file = el('input', { type: 'file', accept: '.json,application/json', onchange: async (e) => {
    const f = e.target.files[0]; if (f) ta.value = await f.text();
  } });
  const dlg = el('dialog.loc-dialog', {}, [
    el('h2', {}, 'Import backup'),
    el('p.dim.small', {}, 'This replaces your current sites, favourites and custom scopes.'),
    el('div.loc-grid', {}, [file, ta]),
    el('div.hz-dialog-foot', {}, [
      el('button.btn.ghost', { onclick: () => dlg.close() }, 'Cancel'),
      el('button.btn.primary', { onclick: () => {
        try { const r = importBundle(ta.value); dlg.close(); nav.rerender(); toast(`Restored ${r.sites} site${r.sites === 1 ? '' : 's'}.`); }
        catch (err) { toast(`Import failed — ${err.message}.`); }
      } }, 'Restore'),
    ]),
  ]);
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
}

function labeled(label, control) { return el('label.fld', {}, [el('span', {}, label), control]); }
