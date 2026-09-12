// ==UserScript==
// @name         BOUN Toolbox — BUIS Kayıt Yardımcısı
// @namespace    https://github.com/kharo0n/Boun-Toolbox-
// @version      1.0.0
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
  if (window.__bounToolboxHelper) { window.__bounToolboxHelper.open(); return; }

  var STORE_KEY = 'boun-toolbox:buis-helper';
  var QUOTA_URL = '/scripts/quotasearch.asp';

  // ---------------------------------------------------------------- yardımcılar
  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.assign(node, props || {});
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeStore(patch) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(readStore(), patch))); } catch (e) { /* özel mod */ }
  }

  /** React/ASP.NET doğrulamalarının fark etmesi için değeri setter üzerinden yazar. */
  function setValue(node, value) {
    var proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(node, value); else node.value = value;
    ['input', 'change', 'blur'].forEach(function (type) {
      node.dispatchEvent(new Event(type, { bubbles: true }));
    });
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
    var trimmed = (text || '').trim();
    if (!trimmed) return { courses: [], error: 'Önce programı yapıştır.' };
    if (trimmed.charAt(0) === '{') {
      try {
        var payload = JSON.parse(trimmed);
        var list = (payload.courses || []).filter(function (c) { return c && c.abbr && c.code && c.section; });
        if (!list.length) return { courses: [], error: 'JSON içinde ders bulunamadı.' };
        return { courses: list, semester: payload.semester };
      } catch (e) {
        return { courses: [], error: 'JSON okunamadı: ' + e.message };
      }
    }
    var courses = [], bad = [];
    trimmed.split(/[\n,;]+/).forEach(function (line) {
      var raw = line.trim();
      if (!raw) return;
      var match = /^([A-Za-z]{1,6})\s*(\d{2,3}[A-Za-z]?)\s*[.\-/]\s*(\d{1,2})$/.exec(raw);
      if (!match) { bad.push(raw); return; }
      courses.push({
        abbr: match[1].toUpperCase(),
        code: match[2].toUpperCase(),
        section: match[3].length === 1 ? '0' + match[3] : match[3],
        display: match[1].toUpperCase() + ' ' + match[2].toUpperCase() + '.' + match[3]
      });
    });
    if (!courses.length) return { courses: [], error: 'Hiçbir satır okunamadı. Örnek: CMPE 150.01' };
    return { courses: courses, skipped: bad };
  }

  // ------------------------------------------------------------ form keşfi
  var FIELD_PATTERNS = {
    abbr: /(?:^|[^a-z])abbr[_$]?(\d+)/i,
    code: /(?:^|[^a-z])code[_$]?(\d+)/i,
    section: /(?:^|[^a-z])sec(?:tion)?[_$]?(\d+)/i,
    nc: /(?:^|[^a-z])r?nc[_$]?(\d+)/i
  };

  function candidateFields() {
    return Array.prototype.slice.call(
      document.querySelectorAll('input[type="text"], input:not([type]), select')
    ).filter(function (node) { return node.offsetParent !== null || node.type === 'hidden'; });
  }

  /** ASP.NET isimleri "ctl00$x$abbr1" gibi olabildiği için ada/id'ye desen uygular. */
  function discoverRows() {
    var buckets = { abbr: {}, code: {}, section: {}, nc: {} };
    candidateFields().forEach(function (node) {
      var identity = (node.name || '') + ' ' + (node.id || '');
      Object.keys(FIELD_PATTERNS).forEach(function (field) {
        var match = FIELD_PATTERNS[field].exec(identity);
        if (match && !buckets[field][match[1]]) buckets[field][match[1]] = node;
      });
    });
    var rows = Object.keys(buckets.abbr)
      .filter(function (index) { return buckets.code[index] && buckets.section[index]; })
      .sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (index) {
        return { index: index, abbr: buckets.abbr[index], code: buckets.code[index],
                 section: buckets.section[index], nc: buckets.nc[index] || null };
      });
    return rows;
  }

  /** İsim deseni tutmazsa: aynı tablo satırındaki üçlü metin kutularını kullan. */
  function discoverRowsByLayout() {
    var rows = [];
    Array.prototype.slice.call(document.querySelectorAll('tr')).forEach(function (tr) {
      var inputs = Array.prototype.slice.call(tr.querySelectorAll('input[type="text"], input:not([type])'))
        .filter(function (node) { return !node.disabled && !node.readOnly && node.offsetParent !== null; });
      if (inputs.length >= 3) {
        rows.push({ index: String(rows.length + 1), abbr: inputs[0], code: inputs[1], section: inputs[2], nc: null, guessed: true });
      }
    });
    return rows;
  }

  function findRows() {
    var rows = discoverRows();
    if (rows.length) return rows;
    var taught = readStore().selectors;
    if (taught) {
      var resolved = ['abbr', 'code', 'section'].map(function (field) {
        try { return document.querySelector(taught[field]); } catch (e) { return null; }
      });
      if (resolved.every(Boolean)) {
        return [{ index: '1', abbr: resolved[0], code: resolved[1], section: resolved[2], nc: null, taught: true }];
      }
    }
    return discoverRowsByLayout();
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
      method: 'POST', credentials: 'same-origin',
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
      el('div', { className: 'row' }, [submitBtn]),
      log,
      el('div', { className: 'hint', textContent: 'Gönderme tuşuna basmadan önce formu gözden geçir. Bu script şifre istemez ve hiçbir veriyi dışarı göndermez.' })
    ])
  ]);
  document.body.appendChild(panel);

  var saved = readStore().plan;
  if (saved) input.value = saved;
  input.addEventListener('change', function () { writeStore({ plan: input.value }); });

  function say(message, kind) {
    log.insertBefore(el('div', { className: kind || '', textContent: message }), log.firstChild);
  }
  function clearLog() { log.textContent = ''; }

  // ------------------------------------------------------------------ eylemler
  var lastForm = null;

  fillBtn.addEventListener('click', function () {
    clearLog();
    var parsed = parsePlan(input.value);
    if (parsed.error) { say(parsed.error, 'err'); return; }
    writeStore({ plan: input.value });

    var rows = findRows();
    if (!rows.length) {
      say('Ders ekleme formu bulunamadı. Doğru sayfada mısın? Değilsen "Alanları tanıt"ı kullan.', 'err');
      return;
    }
    if (rows[0].guessed) say('Alan adları tanınmadı, tablo düzenine göre tahmin edildi — kontrol et.', 'warn');

    var filled = 0;
    parsed.courses.forEach(function (course, i) {
      var row = rows[i];
      if (!row) return;
      setValue(row.abbr, course.abbr);
      setValue(row.code, course.code);
      setValue(row.section, course.section);
      [row.abbr, row.code, row.section].forEach(flash);
      lastForm = row.abbr.form || lastForm;
      filled++;
    });

    say(filled + ' ders forma yazıldı (' + rows.length + ' satırlık form).', 'ok');
    if (parsed.courses.length > filled) {
      var rest = parsed.courses.slice(filled).map(function (c) { return c.display || (c.abbr + ' ' + c.code + '.' + c.section); });
      say('Forma sığmayan ' + rest.length + ' ders: ' + rest.join(', ') + ' — bunları ikinci turda ekle.', 'warn');
    }
    if (parsed.skipped && parsed.skipped.length) {
      say('Okunamayan satırlar: ' + parsed.skipped.join(', '), 'warn');
    }
    submitBtn.disabled = !lastForm;
  });

  quotaBtn.addEventListener('click', function () {
    clearLog();
    var parsed = parsePlan(input.value);
    if (parsed.error) { say(parsed.error, 'err'); return; }
    quotaBtn.disabled = true;
    say('Kontenjanlar sorgulanıyor…');

    // Sunucuyu yormamak için sırayla ve aralıklı sorgula.
    parsed.courses.reduce(function (chain, course) {
      return chain.then(function () {
        return fetchQuota(course, parsed.semester).then(function (quota) {
          var label = course.display || (course.abbr + ' ' + course.code + '.' + course.section);
          var detail = quota.rows.map(function (r) { return r.department + ' ' + r.current + '/' + r.quota; }).join(' · ');
          say(label + ' — kapasite ' + (quota.capacity || '?') + (detail ? ' · ' + detail : '') +
              (quota.restriction ? ' · sadece: ' + quota.restriction : ''), quota.full ? 'warn' : 'ok');
        }).catch(function (error) {
          say((course.display || course.abbr) + ' kontenjanı alınamadı: ' + error.message, 'err');
        }).then(function () {
          return new Promise(function (resolve) { setTimeout(resolve, 350); });
        });
      });
    }, Promise.resolve()).then(function () {
      quotaBtn.disabled = false;
      say('Kontenjan kontrolü bitti.', 'ok');
    });
  });

  submitBtn.addEventListener('click', function () {
    if (!lastForm) { say('Gönderilecek form bulunamadı.', 'err'); return; }
    var trigger = lastForm.querySelector('input[type="submit"], button[type="submit"]');
    say('Form gönderiliyor…');
    if (trigger) trigger.click(); else lastForm.submit();
  });

  teachBtn.addEventListener('click', function () {
    clearLog();
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
      if (!(node instanceof HTMLInputElement || node instanceof HTMLSelectElement)) return;
      if (panel.contains(node)) return;
      event.preventDefault(); event.stopPropagation();
      var selector = selectorFor(node);
      if (!selector) { say('Bu alanın id/name değeri yok, seçilemedi.', 'err'); return; }
      picked[fields[step]] = selector;
      flash(node);
      step++;
      if (step < fields.length) { say('Şimdi: ' + labels[fields[step]], 'warn'); return; }
      document.removeEventListener('click', onPick, true);
      writeStore({ selectors: picked });
      say('Alanlar kaydedildi. Artık "Formu doldur" çalışacak.', 'ok');
    }
    document.addEventListener('click', onPick, true);
  });

  reportBtn.addEventListener('click', function () {
    clearLog();
    var report = {
      url: location.href,
      forms: Array.prototype.slice.call(document.forms).map(function (form) {
        return {
          action: form.getAttribute('action'), method: form.method,
          fields: Array.prototype.slice.call(form.elements).slice(0, 80).map(function (node) {
            return [node.tagName.toLowerCase(), node.type || '', node.name || '', node.id || ''].join('|');
          })
        };
      })
    };
    var text = JSON.stringify(report, null, 2);
    input.value = text;
    say('Form yapısı yukarıya yazıldı. Alanlar tanınmıyorsa bu raporu paylaş.', 'ok');
    say(document.forms.length + ' form, ' + findRows().length + ' ders satırı tespit edildi.');
  });

  closeBtn.addEventListener('click', function () { panel.style.display = 'none'; });

  window.__bounToolboxHelper = {
    open: function () { panel.style.display = 'block'; },
    parsePlan: parsePlan, findRows: findRows, parseQuota: parseQuota
  };
  say('Hazır. Programı yapıştır ve "Formu doldur"a bas.', 'ok');
})();
