// Tiny DOM helpers — no framework, just sugar over createElement.

/**
 * el('div.card#id', { onclick }, [children]) → HTMLElement
 * Tag string supports .class and #id shorthand.
 */
export function el(tag, props = {}, children = []) {
  let tagName = 'div', id = null;
  const classes = [];
  tag.replace(/([.#]?[^.#]+)/g, (m) => {
    if (m[0] === '.') classes.push(m.slice(1));
    else if (m[0] === '#') id = m.slice(1);
    else tagName = m;
    return m;
  });
  const node = document.createElement(tagName);
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === 'class') node.className = [node.className, v].filter(Boolean).join(' ');
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function pct(x) { return `${Math.round(x * 100)}%`; }

/**
 * Toast above the tab bar (auto-dismisses). Optionally actionable:
 *   toast('Deleted "X"', { action: { label: 'Undo', onClick } })
 * An actionable toast catches taps (the plain one stays pointer-transparent),
 * lingers longer so the offer is reachable, and dismisses the instant the
 * action fires. Back-compat: the second arg may still be a plain number of ms.
 * Returns a dismiss() so a caller can retract it early.
 */
export function toast(msg, opts = {}) {
  if (typeof opts === 'number') opts = { ms: opts };
  const action = opts.action || null;
  const ms = opts.ms ?? (action ? 6500 : 3500);
  document.querySelector('.toast')?.remove();
  const t = el('div.toast', {}, [el('span.toast-msg', {}, msg)]);
  let done = false;
  const dismiss = () => {
    if (done) return; done = true;
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  };
  if (action) {
    t.classList.add('has-action');
    t.append(el('button.toast-action', {
      onclick: () => { dismiss(); action.onClick(); },
    }, action.label));
  }
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(dismiss, ms);
  return dismiss;
}

// (The bird app's scoreScale()/sparkline() helpers were pruned in v1.1 — this
// app never used them; recover from Bird-location-scouting if ever needed.)
