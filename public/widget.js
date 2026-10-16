(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || window.__doclyWidgetLoaded) return;
  var botId = script.getAttribute('data-bot-id') || '';
  if (!/^[0-9a-f-]{36}$/i.test(botId)) { console.warn('[docly] invalid data-bot-id'); return; }
  window.__doclyWidgetLoaded = true;
  var origin = new URL(script.src).origin;
  var Z = '2147483000';
  var OPEN_ICON = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var CLOSE_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var small = window.matchMedia('(max-width: 480px)');
  var iframe = null;
  var isOpen = false;

  function el(tag, css) {
    var node = document.createElement(tag);
    node.style.cssText = css;
    return node;
  }

  var root = el('div', 'all:initial;position:fixed;z-index:' + Z + ';right:0;bottom:0;');
  var launcher = el('button', 'all:initial;box-sizing:border-box;position:fixed;right:20px;bottom:20px;z-index:' + Z + ';width:56px;height:56px;border-radius:50%;background:#4f46e5;box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;display:flex;align-items:center;justify-content:center;');
  launcher.type = 'button';
  launcher.setAttribute('aria-label', 'Open chat');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = OPEN_ICON;
  var panel = el('div', 'all:initial;display:none;position:fixed;z-index:' + Z + ';overflow:hidden;background:#fff;');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Chat');

  function layout() {
    var s = panel.style;
    if (small.matches) {
      s.cssText += ';top:0;left:0;right:0;bottom:0;width:auto;height:auto;max-height:none;border-radius:0;box-shadow:none;';
      launcher.style.display = isOpen ? 'none' : 'flex';
    } else {
      s.cssText += ';top:auto;left:auto;right:20px;bottom:88px;width:380px;height:600px;max-width:calc(100vw - 40px);max-height:calc(100vh - 108px);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);';
      launcher.style.display = 'flex';
    }
  }

  function setOpen(next) {
    isOpen = next;
    if (next && !iframe) {
      iframe = el('iframe', 'border:0;width:100%;height:100%;display:block;background:#fff;');
      iframe.title = 'Chat assistant';
      iframe.src = origin + '/embed/' + botId;
      iframe.setAttribute('allow', 'clipboard-write');
      panel.appendChild(iframe);
    }
    panel.style.display = next ? 'block' : 'none';
    launcher.setAttribute('aria-expanded', String(next));
    launcher.setAttribute('aria-label', next ? 'Close chat' : 'Open chat');
    launcher.innerHTML = next ? CLOSE_ICON : OPEN_ICON;
    layout();
    if (next) iframe.focus();
    else launcher.focus();
  }

  launcher.addEventListener('click', function () { setOpen(!isOpen); });
  document.addEventListener('keydown', function (event) { if (isOpen && event.key === 'Escape') setOpen(false); });
  window.addEventListener('message', function (event) {
    if (event.origin === origin && event.data && event.data.type === 'docly:close' && isOpen) setOpen(false);
  });
  if (small.addEventListener) small.addEventListener('change', layout);

  layout();
  root.appendChild(panel);
  root.appendChild(launcher);
  function mount() { document.body.appendChild(root); }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
