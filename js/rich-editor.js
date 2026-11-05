(function () {
  'use strict';
  const editors = new WeakMap();
  function unescape(text) { return text.replace(/\\([*#\\])/g, '$1'); }
  function inline(text) {
    const runs = []; let plain = '', i = 0;
    const flush = () => { if (plain) { runs.push({ text: plain, bold: false }); plain = ''; } };
    while (i < text.length) {
      if (text[i] === '\\' && /[*#\\]/.test(text[i + 1] || ' ')) { plain += text[i + 1]; i += 2; continue; }
      if (text.slice(i, i + 2) === '**') {
        let end = i + 2;
        while ((end = text.indexOf('**', end)) >= 0) {
          let slashes = 0; for (let k = end - 1; k >= 0 && text[k] === '\\'; k--) slashes++;
          if (!(slashes % 2)) break; end += 2;
        }
        if (end > i + 2) { flush(); runs.push({ text: unescape(text.slice(i + 2, end)), bold: true }); i = end + 2; continue; }
      }
      plain += text[i++];
    }
    flush(); return runs;
  }
  function deltaFromMarkdown(value) {
    const Delta = window.Quill.import('delta'); let delta = new Delta();
    String(value).split('\n').forEach(line => {
      const heading = /^(#{1,3})[ \t]+(.*)$/.exec(line), text = heading ? heading[2] : line;
      inline(text).forEach(run => { delta = delta.insert(run.text, run.bold ? { bold: true } : undefined); });
      delta = delta.insert('\n', heading ? { header: heading[1].length } : undefined);
    });
    return delta;
  }
  function markdownFromDelta(delta) {
    const lines = []; let line = '';
    function escaped(s) { return s.replace(/[\\*]/g, '\\$&'); }
    (delta.ops || []).forEach(op => {
      if (typeof op.insert !== 'string') return;
      const parts = op.insert.split('\n');
      parts.forEach((part, i) => {
        if (part) line += op.attributes && op.attributes.bold ? '**' + escaped(part) + '**' : escaped(part);
        if (i < parts.length - 1) {
          const level = op.attributes && op.attributes.header;
          if (level && line.trim()) line = '#'.repeat(level) + ' ' + line;
          else if (/^#{1,3}\s/.test(line)) line = '\\' + line;
          lines.push(line); line = '';
        }
      });
    });
    if (line) lines.push(line);
    return lines.join('\n');
  }
  function attach(source) {
    if (editors.has(source)) return editors.get(source);
    if (!window.Quill) return null;
    const host = document.createElement('div'); host.className = 'qa-rich-editor'; source.after(host);
    let original = source.value, dirty = false, range = { index: 0, length: 0 };
    const required = source.required; source.required = false; source.hidden = true; source.classList.add('qa-rich-source');
    const quill = new window.Quill(host, { theme: null, formats: ['header', 'bold'], placeholder: source.placeholder || '', modules: { toolbar: false, history: { delay: 500, maxStack: 100, userOnly: true } } });
    quill.setContents(deltaFromMarkdown(original), 'silent'); quill.history.clear();
    const root = quill.root; root.id = source.id + '-visual'; root.setAttribute('role', 'textbox'); root.setAttribute('aria-multiline', 'true'); root.setAttribute('aria-required', String(required));
    const label = Array.from(source.closest('form').querySelectorAll('label')).find(l => l.htmlFor === source.id);
    if (label) { label.id = label.id || source.id + '-label'; root.setAttribute('aria-labelledby', label.id); label.addEventListener('click', () => quill.focus()); }
    const error = document.createElement('div'); error.className = 'qa-editor-error'; error.setAttribute('role', 'alert'); error.hidden = true; host.after(error);
    const tools = document.createElement('div'); tools.className = 'qa-editor-tools'; tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', '文字格式');
    const buttons = [];
    function updateButtons() {
      const format = quill.getFormat(range.index, range.length);
      buttons.forEach(({ button, level }) => { const active = level ? format.header === level : !!format.bold; button.setAttribute('aria-pressed', String(active)); });
    }
    [1, 2, 3, 0].forEach(level => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'qa-format-button' + (!level ? ' qa-format-bold' : '');
      button.textContent = level ? 'H' + level : 'B'; button.title = level ? level + '级标题（再次点击恢复正文）' : '加粗'; button.setAttribute('aria-label', level ? level + '级标题' : '加粗'); button.setAttribute('aria-pressed', 'false');
      button.addEventListener('mousedown', e => e.preventDefault());
      button.addEventListener('click', () => {
        quill.focus(); quill.setSelection(range.index, range.length, 'silent');
        const format = quill.getFormat(range.index, range.length);
        quill.format(level ? 'header' : 'bold', level ? (format.header === level ? false : level) : !format.bold, 'user'); updateButtons();
      });
      buttons.push({ button, level }); tools.append(button);
    });
    const composer = source.closest('.qa-composer');
    if (composer) composer.querySelector('.qa-composer-toolbar').prepend(tools); else host.before(tools);
    function change() {
      dirty = true; source.value = markdownFromDelta(quill.getContents()); error.hidden = true; root.removeAttribute('aria-invalid');
      source.dispatchEvent(new Event('input', { bubbles: true })); updateButtons();
    }
    function selection(value) { if (value) { range = value; updateButtons(); } }
    quill.on('text-change', change); quill.on('selection-change', selection);
    const api = {
      quill, root, source, dirty: () => dirty, text: () => quill.getText(),
      value: () => dirty ? markdownFromDelta(quill.getContents()) : original,
      set(value) { original = value; dirty = false; quill.setContents(deltaFromMarkdown(value), 'silent'); quill.history.clear(); source.value = value; range = { index: 0, length: 0 }; error.hidden = true; updateButtons(); source.dispatchEvent(new Event('input', { bubbles: true })); },
      focus() { quill.focus(); },
      enable(value) { quill.enable(value); },
      validate() {
        source.value = api.value();
        const text = !quill.getText().trim() ? '请填写内容。' : source.value.length > (source.maxLength || 6000) ? '内容较长，请精简后再提交。' : '';
        error.textContent = text; error.hidden = !text; root.setAttribute('aria-invalid', String(!!text)); if (text) quill.focus(); return !text;
      },
      destroy() { quill.disable(); quill.off('text-change', change); quill.off('selection-change', selection); editors.delete(source); }
    };
    editors.set(source, api); return api;
  }
  window.HRQARich = { attach, get: source => editors.get(source), inline, markdownFromDelta, deltaFromMarkdown };
})();
