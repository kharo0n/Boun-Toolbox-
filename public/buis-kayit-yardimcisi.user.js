// ==UserScript==
// @name         BOUN Toolbox — BUIS Kayıt Yardımcısı
// @namespace    https://github.com/kharo0n/Boun-Toolbox-
// @version      1.1.0
// @description  Boun Toolbox'ta hazırladığın ders programını BUIS ders ekleme formuna yazar, kontenjanları kontrol eder. Gönderme tuşuna sen basarsın.
// @match        https://registration.boun.edu.tr/*
// @match        https://registration.bogazici.edu.tr/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Bu script yalnızca SENİN tarayıcında, SENİN açtığın BUIS oturumunda çalışır.
 * Kullanıcı adı/şifre istemez, saklamaz, hiçbir yere göndermez.
 * Formu doldurur; "Quick Add"e / gönder tuşuna basma kararı sende kalır.
 */
(function () {
  'use strict';
  if (location.protocol !== 'https:' || !['registration.boun.edu.tr', 'registration.bogazici.edu.tr'].includes(location.hostname)) return;
  if (window.__bounToolboxHelper) { window.__bounToolboxHelper.open(); return; }

  var STORE_KEY = 'boun-toolbox:buis-helper:v2:' + location.pathname.toLowerCase();
  var QUOTA_URL = '/scripts/quotasearch.asp';

  // ---------------------------------------------------------------- yardımcılar
  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (tag === 'button') node.type = 'button';
    Object.assign(node, props || {});
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function readStore() {
    try {
      var value = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (e) { return {}; }
  }
  function writeStore(patch) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(readStore(), patch))); } catch (e) { /* özel mod */ }
  }

  /** Form değerini yazar; değişim olaylarıyla erken gönderim tetiklemez. */
  function setValue(node, value) {
    var proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(node, value); else node.value = value;
    // Native form values are enough for WebForms. Synthetic change/blur events
    // can invoke ASP.NET AutoPostBack before all course fields have been filled.
  }

  function flash(node) {
    var previous = node.style.backgroundColor;
    node.style.transition = 'background-color .4s';
    node.style.backgroundColor = '#fff3b0';
    setTimeout(function () { node.style.backgroundColor = previous; }, 1400);
  }

  // ------------------------------------------------------- plan girdisini okuma
  /** Hem Toolbox JSON'unu hem de düz "CMPE 150.01" listesini kabul eder. */
  function parsePlan(text) {
    var trimmed = (text || '').trim(), source, semester;
    if (!trimmed) return { courses: [], error: 'Önce programı yapıştır.' };
    try {
      if (trimmed.charAt(0) === '{') {
        var payload = JSON.parse(trimmed);
        if (payload.source !== 'boun-toolbox' || payload.version !== 1 || !Array.isArray(payload.courses)) throw new Error('Toolbox JSON biçimi tanınmadı.');
        if (!/^\d{4}\/\d{4}-[123]$/.test(payload.semester || '')) throw new Error('Dönem bilgisi geçersiz.');
        semester = payload.semester;
        source = payload.courses.map(function (c) {
          if (!c || !['abbr', 'code', 'section'].every(function (key) { return typeof c[key] === 'string'; })) throw new Error('Geçersiz ders kaydı.');
          return c.abbr + ' ' + c.code + '.' + c.section;
        });
      } else source = trimmed.split(/[\n,;]+/).filter(function (line) { return line.trim(); });
      if (!source.length || source.length > 50) throw new Error('Liste 1–50 ders içermeli.');
      var seen = new Set();
      var courses = source.map(function (line) {
        var match = /^([A-Za-z]{1,6})\s*(\d{2,3}[A-Za-z]?)\s*[.\-/]\s*(\d{1,2})$/.exec(line.trim());
        if (!match || Number(match[3]) === 0) throw new Error('Geçersiz ders: ' + line);
        var abbr = match[1].toUpperCase(), code = match[2].toUpperCase(), section = match[3].padStart(2, '0');
        if (seen.has(abbr + code)) throw new Error('Aynı ders iki kez yazılmış: ' + abbr + code);
        seen.add(abbr + code);
        return { abbr: abbr, code: code, section: section, display: abbr + ' ' + code + '.' + section };
      });
      return { courses: courses, semester: semester };
    } catch (error) { return { courses: [], error: error.message }; }
  }

  // ------------------------------------------------------------ form keşfi
  var FIELD_PATTERNS = {
    abbr: /(?:^|[^a-z])abbr[_$]?(\d+)/i,
    code: /(?:^|[^a-z])code[_$]?(\d+)/i,
    section: /(?:^|[^a-z])sec(?:tion)?[_$]?(\d+)/i,
    nc: /(?:^|[^a-z])r?nc[_$]?(\d+)/i
  };

  function editable(node) {
    return node && node.isConnected && !node.closest('#btbx') && !node.matches(':disabled') && !node.readOnly &&
      node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible' &&
      (node instanceof HTMLSelectElement || (node instanceof HTMLInputElement && ['text', ''].includes(node.type)));
  }
  function candidateFields() {
    return Array.from(document.querySelectorAll('input[type="text"], input:not([type]), select')).filter(editable);
  }
  function validRows(rows) {
    if (!rows.length) return false;
    var form = rows[0].abbr.form, fields = [];
    if (!form) return false;
    for (var row of rows) {
      for (var key of ['abbr', 'code', 'section']) {
        var node = row[key];
        if (!editable(node) || node.form !== form || fields.includes(node)) return false;
        fields.push(node);
      }
    }
    return true;
  }
  function findRows() {
    var taught = readStore().selectors;
    if (taught) {
      try {
        var resolved = { index: '1' };
        for (var key of ['abbr', 'code', 'section']) {
          var matches = document.querySelectorAll(taught[key]);
          if (matches.length !== 1) return [];
          resolved[key] = matches[0];
        }
        return validRows([resolved]) ? [resolved] : [];
      } catch (e) { return []; }
    }
    var byForm = new Map(), ambiguous = false;
    candidateFields().forEach(function (node) {
      if (!node.form) return;
      if (!byForm.has(node.form)) byForm.set(node.form, {});
      var buckets = byForm.get(node.form);
      var identity = (node.name || '') + ' ' + (node.id || '');
      ['abbr', 'code', 'section'].forEach(function (field) {
        var match = FIELD_PATTERNS[field].exec(identity);
        if (!match) return;
        var row = buckets[match[1]] || (buckets[match[1]] = { index: match[1] });
        if (row[field] && row[field] !== node) ambiguous = true;
        row[field] = node;
      });
    });
    var groups = Array.from(byForm.values()).map(function (buckets) {
      if (Object.values(buckets).some(function (row) { return !row.abbr || !row.code || !row.section; })) { ambiguous = true; return []; }
      return Object.values(buckets)
        .sort(function (a, b) { return Number(a.index) - Number(b.index); });
    }).filter(validRows);
    return !ambiguous && groups.length === 1 ? groups[0] : [];
  }

  // --------------------------------------------------------------- kontenjan
  function parseQuota(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var text = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ');
    var capacity = /Max\. Classroom Capacity:\s*(\d+)/i.exec(text);
    var restriction = /This course is open only for the ([\s\S]+?) departments?\./i.exec(text);
    var rows = [];
    Array.prototype.slice.call(doc.querySelectorAll('.schtd, .schtd2')).forEach(function (row) {
      var cells = Array.prototype.slice.call(row.querySelectorAll('td')).map(function (cell) {
        return cell.textContent.replace(/ /g, ' ').trim();
      });
      if (cells.length >= 4 && cells[0]) {
        rows.push({ department: cells[0], status: cells[1], quota: cells[2], current: cells[3] });
      }
    });
    if (!capacity && !rows.length) throw new Error('Kontenjan tablosu tanınmadı; giriş veya hata sayfası gelmiş olabilir.');
    return {
      capacity: capacity ? capacity[1] : null,
      restriction: restriction ? restriction[1] : null,
      rows: rows,
      full: rows.some(function (r) {
        var quota = Number(r.quota), current = Number(r.current);
        return Number.isFinite(quota) && Number.isFinite(current) && quota > 0 && current >= quota;
      })
    };
  }

  function fetchQuota(course, semester) {
    var body = new URLSearchParams({ abbr: course.abbr, code: course.code, section: course.section });
    if (semester) body.set('donem', semester);
    return fetch(QUOTA_URL, {
      method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }).then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.arrayBuffer();
    }).then(function (buffer) {
      return parseQuota(new TextDecoder('windows-1254').decode(buffer));
    });
  }

  // ------------------------------------------------------------------- panel
  var style = el('style', { textContent: [
    '#btbx{position:fixed;right:16px;top:16px;z-index:2147483647;width:340px;max-height:88vh;overflow:auto;',
    'background:#fff;border:1px solid #c9ced6;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.22);',
    'font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24}',
    '#btbx header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;',
    'background:#0d3b66;color:#fff;border-radius:9px 9px 0 0;font-weight:600}',
    '#btbx header button{background:transparent;border:0;color:#fff;font-size:17px;cursor:pointer;line-height:1}',
    '#btbx .body{padding:12px}',
    '#btbx textarea{width:100%;box-sizing:border-box;height:96px;font:12px ui-monospace,Menlo,Consolas,monospace;',
    'border:1px solid #c9ced6;border-radius:6px;padding:7px;resize:vertical}',
    '#btbx .row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}',
    '#btbx button.act{flex:1 1 auto;min-width:96px;padding:8px 10px;border-radius:6px;border:1px solid #0d3b66;',
    'background:#0d3b66;color:#fff;cursor:pointer;font-weight:600;font-size:12px}',
    '#btbx button.ghost{background:#fff;color:#0d3b66}',
    '#btbx button.act:disabled{opacity:.5;cursor:not-allowed}',
    '#btbx .log{margin-top:10px;border-top:1px solid #e6e9ee;padding-top:8px;font-size:12px}',
    '#btbx .log div{padding:3px 0;border-bottom:1px solid #f2f4f7}',
    '#btbx .ok{color:#14622f}#btbx .warn{color:#8a5300}#btbx .err{color:#a11}',
    '#btbx .hint{color:#5a6472;font-size:11.5px;margin-top:8px}'
  ].join('') });
  document.head.appendChild(style);

  var input = el('textarea', { placeholder: 'Boun Toolbox → Kayıt Asistanı → "Kopyala" ile aldığın listeyi buraya yapıştır.\n\nCMPE 150.01\nMATH 101.02' });
  var log = el('div', { className: 'log' });
  var reportOutput = el('textarea', { readOnly: true, hidden: true, ariaLabel: 'Form raporu' });
  var submitChoice = el('select', { ariaLabel: 'BUIS ders ekleme düğmesi', disabled: true });
  var submitTargets = [];
  var fillBtn = el('button', { className: 'act', textContent: 'Formu doldur' });
  var quotaBtn = el('button', { className: 'act ghost', textContent: 'Kontenjan kontrol' });
  var submitBtn = el('button', { className: 'act', textContent: 'Formu gönder', disabled: true });
  var teachBtn = el('button', { className: 'act ghost', textContent: 'Alanları tanıt' });
  var reportBtn = el('button', { className: 'act ghost', textContent: 'Form raporu' });
  var closeBtn = el('button', { textContent: '×', title: 'Kapat' });

  var panel = el('div', { id: 'btbx' }, [
    el('header', {}, [el('span', { textContent: 'BOUN Toolbox · Kayıt Yardımcısı' }), closeBtn]),
    el('div', { className: 'body' }, [
      input,
      el('div', { className: 'row' }, [fillBtn, quotaBtn]),
      el('div', { className: 'row' }, [teachBtn, reportBtn]),
      el('div', { className: 'row' }, [submitChoice, submitBtn]),
      reportOutput,
      log,
      el('div', { className: 'hint', textContent: 'Gönderme tuşuna basmadan önce formu gözden geçir. Şifre/token toplanmaz. Kontenjan sorgusu ve seçtiğin ekleme işlemi yalnız BUIS’e gönderilir.' })
    ])
  ]);
  document.body.appendChild(panel);

  var saved = readStore().plan;
  if (typeof saved === 'string') input.value = saved;
  input.addEventListener('change', function () { writeStore({ plan: input.value }); });

  function say(message, kind) {
    log.insertBefore(el('div', { className: kind || '', textContent: message }), log.firstChild);
  }
  function clearLog() { log.textContent = ''; }

  // ------------------------------------------------------------------ eylemler
  var lastFill = null;
  function invalidate() {
    lastFill = null; submitBtn.disabled = true; submitChoice.disabled = true;
    submitTargets = []; submitChoice.replaceChildren(el('option', { value: '', textContent: 'Önce formu doldur' }));
  }
  input.addEventListener('input', invalidate);
  document.addEventListener('input', function (event) { if (!panel.contains(event.target) && lastFill && lastFill.form.contains(event.target)) invalidate(); }, true);
  document.addEventListener('change', function (event) { if (!panel.contains(event.target) && lastFill && lastFill.form.contains(event.target)) invalidate(); }, true);
  var ADD_LABEL = /^(quick\s*add|add(?:\s+selected)?\s+courses?|ders(?:leri)?\s+ekle|hızlı\s+ekle)$/i;
  function label(node) { return (node instanceof HTMLInputElement ? node.value : node.textContent).trim().replace(/\s+/g, ' '); }
  function targetSignature(node) {
    return JSON.stringify([node.name, node.type, label(node), node.getAttribute('onclick'), node.getAttribute('formaction'), node.getAttribute('formmethod'), node.getAttribute('formtarget')]);
  }
  function actionUrl(form) { return new URL(form.action || location.href, location.href); }
  function fillMatches() {
    var currentRows = findRows();
    return lastFill && lastFill.form.isConnected && lastFill.input === input.value &&
      lastFill.form.action === lastFill.action && lastFill.form.method === lastFill.method &&
      lastFill.form.target === lastFill.target && lastFill.form.enctype === lastFill.enctype &&
      currentRows.length === lastFill.rows.length && currentRows.every(function (row, index) { return ['abbr', 'code', 'section'].every(function (key) { return row[key] === lastFill.rows[index][key]; }); }) &&
      validRows(lastFill.rows) && lastFill.values.every(function (entry) { return entry.node.value === entry.value; });
  }
  function optionValue(node, desired) {
    if (!(node instanceof HTMLSelectElement)) return desired;
    var options = Array.from(node.options).filter(function (option) { return !option.disabled &&
      (option.value.toUpperCase() === desired || /^\d+$/.test(desired) && /^\d+$/.test(option.value) && Number(option.value) === Number(desired)); });
    if (options.length !== 1) throw new Error('Seçenek bulunamadı veya belirsiz: ' + desired);
    return options[0].value;
  }
  fillBtn.addEventListener('click', function () {
    clearLog(); invalidate();
    var parsed = parsePlan(input.value);
    if (parsed.error) { say(parsed.error, 'err'); return; }
    var rows = findRows();
    if (!rows.length) { say('Tek ve doğrulanabilir ders formu bulunamadı. Alanları tanıt veya form raporunu paylaş.', 'err'); return; }
    if (parsed.courses.length > rows.length) { say('Liste forma sığmıyor; hiçbir alan değiştirilmedi. Listeyi bu formun satır sayısına göre böl.', 'err'); return; }
    var form = rows[0].abbr.form, values = [];
    try {
      if (actionUrl(form).origin !== location.origin) throw new Error('Form hedefi BUIS ile aynı kökende değil.');
      rows.forEach(function (row, index) {
        ['abbr', 'code', 'section'].forEach(function (key) {
          var node = row[key], course = parsed.courses[index];
          if (!course) { if (node.value.trim()) throw new Error('Liste dışındaki satırda mevcut ders var; önce BUIS formunu kontrol et.'); return; }
          var value = optionValue(node, course[key]);
          if (node.maxLength > 0 && value.length > node.maxLength) throw new Error('Değer alan sınırını aşıyor: ' + course.display);
          if (node.value.trim() && node.value !== value) throw new Error('Dolu alanın üzerine yazılmadı; önce BUIS formunu kontrol et.');
          values.push({ node: node, value: value });
        });
      });
    } catch (error) { say(error.message, 'err'); return; }
    values.forEach(function (entry) { setValue(entry.node, entry.value); flash(entry.node); });
    lastFill = { form: form, action: form.action, method: form.method, target: form.target, enctype: form.enctype, input: input.value, rows: rows,
      values: rows.flatMap(function (row) { return ['abbr', 'code', 'section'].map(function (key) { return { node: row[key], value: row[key].value }; }); }) };
    writeStore({ plan: input.value });
    submitTargets = Array.from(form.querySelectorAll('input[type="submit"], input[type="button"], button')).filter(function (node) {
      return !panel.contains(node) && node.form === form && ['submit', 'button'].includes(node.type) && !node.matches(':disabled') && node.getClientRects().length && getComputedStyle(node).visibility === 'visible' && ADD_LABEL.test(label(node)) &&
        !node.hasAttribute('formaction') && !node.hasAttribute('formmethod') && !node.hasAttribute('formtarget');
    }).map(function (node) { return { node: node, signature: targetSignature(node) }; });
    submitChoice.replaceChildren(el('option', { value: '', textContent: 'BUIS ders ekleme düğmesini seç' }));
    submitTargets.forEach(function (target, index) { submitChoice.appendChild(el('option', { value: String(index), textContent: label(target.node) + ' (' + (target.node.id || target.node.name || index + 1) + ')' })); });
    submitChoice.disabled = !submitTargets.length;
    say(parsed.courses.length + ' ders forma yazıldı. Gönderme yapılmadı.', 'ok');
    say(submitTargets.length ? 'Listeyi kontrol edip doğru BUIS ders ekleme düğmesini seç.' : 'Ders ekleme düğmesi doğrulanamadı; BUIS’in kendi düğmesini kullan.', 'warn');
  });
  submitChoice.addEventListener('change', function () { submitBtn.disabled = !fillMatches() || submitChoice.value === ''; });
  invalidate();

  quotaBtn.addEventListener('click', function () {
    clearLog();
    var parsed = parsePlan(input.value);
    if (parsed.error) { say(parsed.error, 'err'); return; }
    if (!parsed.semester) { say('Dönemli sorgu için Toolbox’tan Planı kopyala ile aldığın JSON’u yapıştır.', 'err'); return; }
    quotaBtn.disabled = true;
    say('Kontenjanlar sorgulanıyor…');

    // Sunucuyu yormamak için sırayla ve aralıklı sorgula.
    parsed.courses.reduce(function (chain, course) {
      return chain.then(function () {
        return fetchQuota(course, parsed.semester).then(function (quota) {
          var label = course.display || (course.abbr + ' ' + course.code + '.' + course.section);
          var detail = quota.rows.map(function (r) { return r.department + ' ' + r.current + '/' + r.quota; }).join(' · ');
          say(label + ' — kapasite ' + (quota.capacity || '?') + (detail ? ' · ' + detail : '') +
              (quota.restriction ? ' · sadece: ' + quota.restriction : ''), 'warn');
        }).catch(function (error) {
          say((course.display || course.abbr) + ' kontenjanı alınamadı: ' + error.message, 'err');
        }).then(function () {
          return new Promise(function (resolve) { setTimeout(resolve, 350); });
        });
      });
    }, Promise.resolve()).then(function () {
      quotaBtn.disabled = false;
      say('Kontenjan kontrolü bitti. Bu sonuç kayıt garantisi veya senin bölümüne uygunluk onayı değildir.', 'warn');
    });
  });

  submitBtn.addEventListener('click', function () {
    var target = submitChoice.value !== '' ? submitTargets[Number(submitChoice.value)] : null;
    if (!fillMatches() || !target || !target.node.isConnected || target.node.form !== lastFill.form || target.node.matches(':disabled') || getComputedStyle(target.node).visibility !== 'visible' ||
      !target.node.getClientRects().length || target.signature !== targetSignature(target.node) || !ADD_LABEL.test(label(target.node))) {
      invalidate(); say('Form veya düğme değişti. Yeniden doldurup kontrol et.', 'err'); return;
    }
    var node = target.node;
    invalidate();
    say('Seçtiğin ders ekleme düğmesine basılıyor. Başarı durumunu BUIS yanıtından kontrol et.', 'warn');
    node.click();
  });

  var cancelTeaching = null;
  teachBtn.addEventListener('click', function () {
    clearLog(); invalidate();
    if (cancelTeaching) cancelTeaching();
    var fields = ['abbr', 'code', 'section'], picked = {}, step = 0;
    var labels = { abbr: 'ders kısaltması (ör. CMPE)', code: 'ders numarası (ör. 150)', section: 'şube (ör. 01)' };
    say('Sırayla tıkla: ' + labels[fields[0]], 'warn');

    function selectorFor(node) {
      if (node.id) return '#' + CSS.escape(node.id);
      if (node.name) return '[name="' + CSS.escape(node.name) + '"]';
      return null;
    }
    function onPick(event) {
      var node = event.target;
      if (!editable(node)) return;
      if (panel.contains(node)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      var selector = selectorFor(node);
      if (!selector) { say('Bu alanın id/name değeri yok, seçilemedi.', 'err'); return; }
      if (Object.values(picked).includes(selector)) { say('Aynı alan iki kez seçilemez.', 'err'); return; }
      if (step && document.querySelector(picked.abbr)?.form !== node.form) { say('Alanlar aynı formda olmalı.', 'err'); return; }
      picked[fields[step]] = selector;
      flash(node);
      step++;
      if (step < fields.length) { say('Şimdi: ' + labels[fields[step]], 'warn'); return; }
      document.removeEventListener('click', onPick, true);
      writeStore({ selectors: picked });
      say('Alanlar kaydedildi. Artık "Formu doldur" çalışacak.', 'ok');
    }
    cancelTeaching = function () { document.removeEventListener('click', onPick, true); };
    document.addEventListener('click', onPick, true);
  });

  reportBtn.addEventListener('click', function () {
    clearLog();
    var report = {
      url: location.origin + location.pathname,
      scripts: Array.from(document.scripts).filter(function (script) { return script.src; }).map(function (script) { var url = new URL(script.src, location.href); return url.origin + url.pathname; }),
      forms: Array.prototype.slice.call(document.forms).map(function (form) {
        return {
          action: actionUrl(form).origin + actionUrl(form).pathname, method: form.method,
          fields: Array.prototype.slice.call(form.elements).slice(0, 80).map(function (node) {
            return [node.tagName.toLowerCase(), node.type || '', node.name || '', node.id || ''].join('|');
          })
        };
      })
    };
    var text = JSON.stringify(report, null, 2);
    reportOutput.hidden = false; reportOutput.value = text;
    say('Form yapısı ayrı rapor alanına yazıldı; planın korundu. Rapor alan değerleri, parola, çerez veya URL sorgu parametreleri içermez.', 'ok');
    say(document.forms.length + ' form, ' + findRows().length + ' ders satırı tespit edildi.');
  });

  closeBtn.addEventListener('click', function () { if (cancelTeaching) cancelTeaching(); invalidate(); panel.style.display = 'none'; });

  window.__bounToolboxHelper = {
    open: function () { panel.style.display = 'block'; },
    parsePlan: parsePlan, findRows: findRows, parseQuota: parseQuota
  };
  say('Hazır. Programı yapıştır ve "Formu doldur"a bas.', 'ok');
})();
