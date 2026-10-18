(function () {
  'use strict';
  if (window.__doclyWidgetLoaded) return;
  var script = document.currentScript;
  if (!script) { console.warn('[docly] load widget.js with a <script src> tag'); return; }
  var botId = script.getAttribute('data-bot-id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(botId)) { console.warn('[docly] invalid data-bot-id'); return; }
  var origin;
  try {
    var u = new URL(script.getAttribute('data-app-origin') || script.src, location.href);
    if (!/^https?:$/.test(u.protocol)) throw 0;
    origin = u.origin;
  } catch { console.warn('[docly] invalid origin'); return; }
  window.__doclyWidgetLoaded = true;

  var Z = 2147483000;
  var ICON = function (d) { return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><path d="' + d + '"/></svg>'; };
  var OPEN_ICON = ICON('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
  var CLOSE_ICON = ICON('M18 6 6 18M6 6l12 12');
  var SMALL = '(max-width:480px),(max-height:500px)';
  var CSS = ':host{all:initial}' +
    'button{all:unset;position:fixed;right:20px;bottom:20px;z-index:' + Z + ';width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#4f46e5,#7c3aed);box-shadow:0 0 22px #6366f1aa;cursor:pointer;display:grid;place-items:center}' +
    'button:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}' +
    '.p{display:none;position:fixed;z-index:' + Z + ';right:20px;bottom:88px;width:380px;height:600px;max-width:calc(100vw - 40px);max-height:calc(100vh - 108px);overflow:hidden;background:#05060f;border:1px solid #fff3;border-radius:16px;box-shadow:0 12px 40px #0008,0 0 50px #6366f144}' +
    '.o .p{display:block}' +
    'iframe{display:block;width:100%;height:100%;border:0;background:#05060f}' +
    '@media ' + SMALL + '{.p{inset:0;width:auto;height:auto;max-width:none;max-height:none;border:0;border-radius:0;box-shadow:none}.o button{display:none}}';

  var small = window.matchMedia(SMALL), iframe = null, isOpen = false, savedOverflow = null;

  var host = document.createElement('div');
  host.id = 'docly-widget';
  var shadow = host.attachShadow({ mode: 'closed' });
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    var style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
  }
  var wrap = document.createElement('div');
  var launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = OPEN_ICON;
  var panel = document.createElement('div');
  panel.className = 'p';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat');
  wrap.appendChild(panel);
  wrap.appendChild(launcher);
  shadow.appendChild(wrap);

  // Full-screen is modal.
  function layout() {
    var modal = isOpen && small.matches;
    if (modal) panel.setAttribute('aria-modal', 'true'); else panel.removeAttribute('aria-modal');
    var body = document.body;
    if (modal && savedOverflow === null) { savedOverflow = body.style.overflow; body.style.overflow = 'hidden'; }
    else if (!modal && savedOverflow !== null) { body.style.overflow = savedOverflow; savedOverflow = null; }
  }

  function setOpen(next, keepFocus) {
    isOpen = next;
    if (next && !iframe) {
      iframe = document.createElement('iframe');
      iframe.title = 'Chat assistant';
      iframe.src = origin + '/embed/' + botId;
      iframe.setAttribute('allow', 'clipboard-write');
      panel.appendChild(iframe);
    }
    wrap.className = next ? 'o' : '';
    launcher.setAttribute('aria-expanded', String(next));
    launcher.setAttribute('aria-label', next ? 'Close chat' : 'Open chat');
    launcher.innerHTML = next ? CLOSE_ICON : OPEN_ICON;
    layout();
    if (next) iframe.focus();
    else if (!keepFocus) launcher.focus();
  }

  // Full-screen: close on focus loss.
  function focusLeft() {
    setTimeout(function () {
      if (isOpen && small.matches && document.activeElement !== host) setOpen(false, true);
    }, 0);
  }

  launcher.addEventListener('click', function () { setOpen(!isOpen); });
  host.addEventListener('focusout', focusLeft);
  document.addEventListener('focusin', function (event) { if (event.target !== host) focusLeft(); });
  document.addEventListener('keydown', function (event) {
    if (isOpen && !event.defaultPrevented && event.key === 'Escape') setOpen(false);
  });
  window.addEventListener('message', function (event) {
    if (isOpen && iframe && event.origin === origin && event.source === iframe.contentWindow && event.data && event.data.type === 'docly:close') setOpen(false);
  });
  small.addEventListener('change', layout);

  function mount() { document.body.appendChild(host); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
