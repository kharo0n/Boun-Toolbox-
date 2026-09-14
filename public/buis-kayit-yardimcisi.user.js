// ==UserScript==
// @name         BOUN Toolbox — BUIS Kayıt Yardımcısı
// @namespace    https://github.com/kharo0n/Boun-Toolbox-
// @version      1.3.1
// @description  Boun Toolbox'ta hazırladığın ders programını BUIS ders ekleme formuna yazar, kontenjan ve consent durumunu gösterir, consent formunu mesajınla doldurur. Ders eklemeyi tek tıkla veya seçtiğin saatte bir kez gönderir; consent isteğini göndermeyi sana bırakır.
// @match        https://registration.boun.edu.tr/*
// @match        https://registration.bogazici.edu.tr/*
// @updateURL    https://boun-toolbox.vercel.app/buis-kayit-yardimcisi.user.js
// @downloadURL  https://boun-toolbox.vercel.app/buis-kayit-yardimcisi.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Bu script yalnızca SENİN tarayıcında, SENİN açtığın BUIS oturumunda çalışır.
 * Kullanıcı adı/şifre istemez, saklamaz, hiçbir yere göndermez.
 * Seçtiğin Quick Add düğmesine tek tıkla veya kurduğun saatte bir kez basar.
 * Consent formunda yalnızca ders seçer ve mesajı yazar; göndermez.
 */
(function () {
  'use strict';
  var isDemo = ['localhost', '127.0.0.1', 'boun-toolbox.vercel.app'].includes(location.hostname) &&
    ['/buis-helper-demo.html', '/buis-consent-demo.html'].includes(location.pathname);
  if (!isDemo && (location.protocol !== 'https:' || !['registration.boun.edu.tr', 'registration.bogazici.edu.tr'].includes(location.hostname))) return;
  if (window.__bounToolboxHelper) { window.__bounToolboxHelper.open(); return; }

  // The userscript also runs inside BUIS's registration iframe. Avoid a second panel on its shell.
  if (document.querySelector('iframe#ifCPL')) return;

  var STORE_KEY = 'boun-toolbox:buis-helper:v2:' + location.pathname.toLowerCase();
  // Quick Add posts to another page and consent lives on its own screen, so the plan is shared across paths.
  var PLAN_KEY = 'boun-toolbox:buis-helper:plan';
  var CONSENT_JOB_KEY = 'boun-toolbox:buis-helper:consent-job';
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
  function readPlan() {
    try {
      var shared = localStorage.getItem(PLAN_KEY);
      if (typeof shared === 'string') return shared;
    } catch (e) { /* özel mod */ }
    var legacy = readStore().plan;
    return typeof legacy === 'string' ? legacy : '';
  }
  function writePlan(value) {
    try { localStorage.setItem(PLAN_KEY, value); } catch (e) { /* özel mod */ }
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
  var LEVELS = ['UNDERGRADUATE', 'GRADUATE'];
  var MESSAGE_LIMIT = 2000;
  function parseStudent(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'object' || typeof value.department !== 'string' || !value.department.trim() ||
      value.department.length > 120 || !LEVELS.includes(value.level)) throw new Error('Öğrenci bölümü/düzeyi geçersiz.');
    return { department: value.department.trim(), level: value.level };
  }

  /** Hem Toolbox JSON'unu hem de düz "CMPE 150.01" listesini kabul eder. */
  function parsePlan(text) {
    var trimmed = (text || '').trim(), source, semester, student = null;
    if (!trimmed) return { courses: [], error: 'Önce programı yapıştır.' };
    try {
      if (trimmed.charAt(0) === '{') {
        var payload = JSON.parse(trimmed);
        if (payload.source !== 'boun-toolbox' || payload.version !== 1 || !Array.isArray(payload.courses)) throw new Error('Toolbox JSON biçimi tanınmadı.');
        if (!/^\d{4}\/\d{4}-[123]$/.test(payload.semester || '')) throw new Error('Dönem bilgisi geçersiz.');
        semester = payload.semester;
        student = parseStudent(payload.student);
        source = payload.courses.map(function (c) {
          if (!c || !['abbr', 'code', 'section'].every(function (key) { return typeof c[key] === 'string'; })) throw new Error('Geçersiz ders kaydı.');
          if (c.message !== undefined && (typeof c.message !== 'string' || c.message.length > MESSAGE_LIMIT)) throw new Error('Consent mesajı geçersiz: ' + c.abbr + ' ' + c.code);
          return { line: c.abbr + ' ' + c.code + '.' + c.section, message: (c.message || '').trim() };
        });
      } else source = trimmed.split(/[\n,;]+/).filter(function (line) { return line.trim(); }).map(function (line) { return { line: line, message: '' }; });
      if (!source.length || source.length > 50) throw new Error('Liste 1–50 ders içermeli.');
      var seen = new Set();
      var courses = source.map(function (item) {
        var match = /^([A-Za-z]{1,6})\s*(\d{2,3}[A-Za-z]?)\s*[.\-/]\s*(\d{1,2})$/.exec(item.line.trim());
        if (!match || Number(match[3]) === 0) throw new Error('Geçersiz ders: ' + item.line);
        var abbr = match[1].toUpperCase(), code = match[2].toUpperCase(), section = match[3].padStart(2, '0');
        if (seen.has(abbr + code)) throw new Error('Aynı ders iki kez yazılmış: ' + abbr + code);
        seen.add(abbr + code);
        return { abbr: abbr, code: code, section: section, display: abbr + ' ' + code + '.' + section, message: item.message };
      });
      return { courses: courses, semester: semester, student: student };
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
  function attrSelector(attr, value) { return '[' + attr + '="' + String(value).replace(/["\\]/g, '\\$&') + '"]'; }
  function single(selector) {
    try { var matches = document.querySelectorAll(selector); return matches.length === 1 ? matches[0] : null; } catch (e) { return null; }
  }
  /** "abbr1", "ctl00$abbr01", "txtAbbr1_x" → the last number and what surrounds it. */
  function numbering(node) {
    for (var attr of ['name', 'id']) {
      var value = node.getAttribute(attr), match = value && /^(.*?)(\d+)(\D*)$/.exec(value);
      if (match) return { attr: attr, prefix: match[1], number: Number(match[2]), width: match[2].length, suffix: match[3] };
    }
    return null;
  }
  /** Teach mode maps one row; the rest follow its numbering or, failing that, its table layout. */
  function expandTaught(first) {
    var keys = ['abbr', 'code', 'section'], rows = [first];
    var parts = keys.map(function (key) { return numbering(first[key]); });
    if (parts.every(function (part) { return part && part.number === parts[0].number; })) {
      for (var n = parts[0].number + 1; rows.length < 50; n++) {
        var next = { index: String(rows.length + 1) };
        keys.forEach(function (key, i) {
          var part = parts[i];
          next[key] = single(attrSelector(part.attr, part.prefix + String(n).padStart(part.width, '0') + part.suffix));
        });
        if (!keys.every(function (key) { return next[key]; }) || !validRows(rows.concat([next]))) break;
        rows.push(next);
      }
      if (rows.length > 1) return rows;
    }
    var tr = first.abbr.closest('tr');
    if (!tr || !tr.contains(first.code) || !tr.contains(first.section)) return rows;
    var fieldsOf = function (row) { return Array.from(row.querySelectorAll('input[type="text"], input:not([type]), select')).filter(editable); };
    var base = fieldsOf(tr), positions = keys.map(function (key) { return base.indexOf(first[key]); });
    for (var sibling = tr.nextElementSibling; sibling && rows.length < 50; sibling = sibling.nextElementSibling) {
      var fields = fieldsOf(sibling);
      if (fields.length !== base.length) break;
      var candidate = { index: String(rows.length + 1), abbr: fields[positions[0]], code: fields[positions[1]], section: fields[positions[2]] };
      if (!validRows(rows.concat([candidate]))) break;
      rows.push(candidate);
    }
    return rows;
  }
  function findRows() {
    var taught = readStore().selectors;
    if (taught && typeof taught === 'object') {
      var first = { index: '1' };
      for (var key of ['abbr', 'code', 'section']) {
        first[key] = typeof taught[key] === 'string' ? single(taught[key]) : null;
        if (!first[key]) return [];
      }
      return validRows([first]) ? expandTaught(first) : [];
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

  function normalizeDepartment(name) { return String(name || '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]/g, ''); }

  /**
   * Applies the student's own department row first, then the ALL row, as BUIS quota tables read.
   * Without a department it can only say whether any row asks for consent.
   */
  function evaluateQuota(quota, student) {
    var rows = quota.rows.map(function (row) {
      return Object.assign({}, row, { kind: /consent/i.test(row.quota) ? 'consent' : /unlimited/i.test(row.quota) ? 'unlimited' : 'number' });
    });
    var result = { verdict: 'unknown', rows: rows, consentRows: rows.filter(function (row) { return row.kind === 'consent'; }) };
    if (!student) { if (result.consentRows.length) result.verdict = 'consent-rows'; return result; }
    var fits = function (row) { var status = row.status.toUpperCase(); return status === 'ALL' || status === student.level; };
    var exactFirst = function (a, b) { return (b.status.toUpperCase() === student.level) - (a.status.toUpperCase() === student.level); };
    var own = rows.filter(function (row) { return fits(row) && normalizeDepartment(row.department) === normalizeDepartment(student.department); }).sort(exactFirst);
    var general = rows.filter(function (row) { return fits(row) && row.department.toUpperCase() === 'ALL'; }).sort(exactFirst);
    var row = own[0] || general[0];
    if (!row) { if (rows.length) result.verdict = 'not-listed'; return result; }
    result.row = row;
    if (row.kind === 'consent') result.verdict = 'consent';
    else if (row.kind === 'unlimited') result.verdict = 'open';
    else {
      var limit = Number(row.quota), current = Number(row.current);
      if (Number.isFinite(limit) && Number.isFinite(current)) { result.left = limit - current; result.verdict = current >= limit ? 'full' : 'open'; }
    }
    return result;
  }
  function quotaLine(course, quota, student) {
    var result = evaluateQuota(quota, student), base = course.display + ' — ';
    var where = result.row ? ' (' + result.row.department + ' / ' + result.row.status + ')' : '';
    var restriction = quota.restriction ? ' · sadece: ' + quota.restriction : '';
    if (result.verdict === 'consent') return { kind: 'warn', text: '🔒 ' + base + 'consent gerekiyor' + where + restriction };
    if (result.verdict === 'full') return { kind: 'err', text: '⛔ ' + base + 'kontenjan dolu ' + result.row.current + '/' + result.row.quota + where + '; consent isteyebilirsin' + restriction };
    if (result.verdict === 'not-listed') return { kind: 'err', text: '🚫 ' + base + 'bölümüne kontenjan görünmüyor; consent gerekebilir' + restriction };
    if (result.verdict === 'open') {
      return { kind: 'ok', text: '✅ ' + base + (result.row.kind === 'unlimited' ? 'sınırsız' : 'boş yer ' + result.left + ' (' + result.row.current + '/' + result.row.quota + ')') + where + restriction };
    }
    var detail = result.rows.map(function (row) { return row.department + ' ' + row.current + '/' + row.quota; }).join(' · ');
    return { kind: 'warn', text: base + 'kapasite ' + (quota.capacity || '?') + (detail ? ' · ' + detail : '') + restriction +
      (result.consentRows.length ? ' · 🔒 bazı bölümler için consent gerekiyor; Toolbox’ta bölümünü seçersen netleşir' : '') };
  }

  function fetchQuota(course, semester) {
    if (isDemo) return Promise.reject(new Error('Deneme sayfası BUIS’e sorgu göndermez.'));
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
    '#btbx .hint{color:#5a6472;font-size:11.5px;margin-top:8px}',
    '#btbx details{margin-top:10px}#btbx summary{cursor:pointer;font-weight:600;color:#0d3b66}',
    '#btbx .consent-list .row{align-items:center}#btbx .consent-list code{flex:1 1 100%;font-size:12px}'
  ].join('') });
  document.head.appendChild(style);

  var input = el('textarea', { placeholder: 'Boun Toolbox → Kayıt Asistanı → "Kopyala" ile aldığın listeyi buraya yapıştır.\n\nCMPE 150.01\nMATH 101.02' });
  var log = el('div', { className: 'log' });
  var reportOutput = el('textarea', { readOnly: true, hidden: true, ariaLabel: 'Form raporu' });
  var submitChoice = el('select', { ariaLabel: 'BUIS ders ekleme düğmesi', disabled: true });
  var submitTargets = [];
  var inspectBtn = el('button', { className: 'act ghost', textContent: 'Formu tanı' });
  var quickBtn = el('button', { className: 'act', textContent: 'Doldur ve gönder', disabled: true });
  var reviewed = el('input', { type: 'checkbox', ariaLabel: 'Dönem, ders listesi, kredi ve tekrar seçeneklerini kontrol ettim' });
  var sendAt = el('input', { type: 'datetime-local', step: '1', ariaLabel: 'Gönderim zamanı (Türkiye)' });
  var armBtn = el('button', { className: 'act', textContent: 'Saatli gönderimi başlat', disabled: true });
  var cancelBtn = el('button', { className: 'act ghost', textContent: 'Zamanlamayı iptal et', disabled: true });
  var timerStatus = el('div', { className: 'hint', role: 'status', ariaLive: 'polite' });
  var fillBtn = el('button', { className: 'act', textContent: 'Formu doldur' });
  var quotaBtn = el('button', { className: 'act ghost', textContent: 'Kontenjan kontrol' });
  var submitBtn = el('button', { className: 'act', textContent: 'Formu gönder', disabled: true });
  var teachBtn = el('button', { className: 'act ghost', textContent: 'Alanları tanıt' });
  var reportBtn = el('button', { className: 'act ghost', textContent: 'Form raporu' });
  var closeBtn = el('button', { textContent: '×', title: 'Kapat' });
  var copyOutput = el('textarea', { readOnly: true, hidden: true, ariaLabel: 'Kopyalanacak consent mesajı' });
  var consentList = el('div', { className: 'consent-list' });

  var panel = el('div', { id: 'btbx' }, [
    el('header', {}, [el('span', { textContent: 'BOUN Toolbox · Kayıt Yardımcısı' }), closeBtn]),
    el('div', { className: 'body' }, [
      input,
      el('div', { className: 'row' }, [inspectBtn, fillBtn, quotaBtn]),
      el('div', { className: 'row' }, [teachBtn, reportBtn]),
      el('div', { className: 'row' }, [submitChoice, submitBtn]),
      el('label', { className: 'hint' }, [reviewed, ' Dönem, ders listesi, kredi ve tekrar seçeneklerini kontrol ettim.']),
      el('div', { className: 'row' }, [quickBtn]),
      el('details', {}, [el('summary', { textContent: 'Saatli gönderim' }),
        el('label', {}, ['Gönderim zamanı (Türkiye, UTC+3)', sendAt]),
        el('div', { className: 'row' }, [armBtn, cancelBtn]), timerStatus,
        el('div', { className: 'hint', textContent: 'Açık ve tanınmış form gerektirir. Bu sekmeyi görünür, bilgisayarı uyanık tut. Yenileme veya sekmeyi gizleme zamanlamayı iptal eder. BUIS yanıt süresi garanti edilemez.' })]),
      el('details', {}, [el('summary', { textContent: 'Consent isteği' }),
        el('div', { className: 'hint', textContent: 'Consent Requests ekranını aç, dersin düğmesine bas: ders seçilir ve Toolbox’ta yazdığın mesaj alana yazılır. Göndermeyi sen yaparsın; aynı şubeye en fazla 2, toplam 10 derse istek hakkın var.' }),
        consentList, copyOutput]),
      reportOutput,
      log,
      el('div', { className: 'hint', textContent: 'Gönderme tuşuna basmadan önce formu gözden geçir. Şifre/token toplanmaz. Kontenjan sorgusu ve seçtiğin ekleme işlemi yalnız BUIS’e gönderilir.' })
    ])
  ]);
  document.body.appendChild(panel);

  input.value = readPlan();
  input.addEventListener('change', function () { writePlan(input.value); });

  function say(message, kind) {
    log.insertBefore(el('div', { className: kind || '', textContent: message }), log.firstChild);
  }
  function clearLog() { log.textContent = ''; }

  // ------------------------------------------------------------------ eylemler
  var lastFill = null, scheduled = null, scheduleTimer = null;
  function stopSchedule(message) {
    if (scheduleTimer !== null) clearTimeout(scheduleTimer);
    scheduleTimer = null; scheduled = null; cancelBtn.disabled = true;
    timerStatus.textContent = message || '';
  }
  function invalidate() {
    stopSchedule(scheduled ? 'Form değişti; zamanlama iptal edildi.' : '');
    reviewed.checked = false; quickBtn.disabled = true; armBtn.disabled = true;
    lastFill = null; submitBtn.disabled = true; submitChoice.disabled = true;
    submitTargets = []; submitChoice.replaceChildren(el('option', { value: '', textContent: 'Önce formu tanı veya doldur' }));
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
  function pageBlocked() {
    var copy = document.body.cloneNode(true);
    copy.querySelectorAll('#btbx,script,style').forEach(function (node) { node.remove(); });
    return /SERVICE IS CURRENTLY CLOSED/i.test(copy.textContent) ||
      Array.from(document.querySelectorAll('input[type="password"]')).some(function (node) { return node.getClientRects().length; });
  }
  function controlState(node) {
    return JSON.stringify([node.type, node.name, node.value, node.checked, node.matches(':disabled'), node.readOnly,
      node instanceof HTMLSelectElement ? Array.from(node.selectedOptions).map(function (option) { return option.value; }) : null]);
  }
  function extraControls(form) {
    return Array.from(form.elements).filter(function (node) { return !panel.contains(node) &&
      /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName) && node.type !== 'hidden'; });
  }
  function snapshotControls(form) { return extraControls(form).map(function (node) { return { node: node, state: controlState(node) }; }); }
  function fillMatches() {
    var currentRows = findRows();
    var controls = lastFill ? extraControls(lastFill.form) : [];
    return lastFill && !pageBlocked() && lastFill.form.isConnected && lastFill.input === input.value &&
      lastFill.form.action === lastFill.action && lastFill.form.method === lastFill.method &&
      lastFill.form.target === lastFill.target && lastFill.form.enctype === lastFill.enctype &&
      currentRows.length === lastFill.rows.length && currentRows.every(function (row, index) { return ['abbr', 'code', 'section'].every(function (key) { return row[key] === lastFill.rows[index][key]; }); }) &&
      controls.length === lastFill.controls.length && controls.every(function (node, index) { return node === lastFill.controls[index].node && controlState(node) === lastFill.controls[index].state; }) &&
      validRows(lastFill.rows) && lastFill.values.every(function (entry) { return entry.node.value === entry.value; });
  }
  function optionValue(node, desired) {
    if (!(node instanceof HTMLSelectElement)) return desired;
    var options = Array.from(node.options).filter(function (option) { return !option.disabled &&
      (option.value.toUpperCase() === desired || /^\d+$/.test(desired) && /^\d+$/.test(option.value) && Number(option.value) === Number(desired)); });
    if (options.length !== 1) throw new Error('Seçenek bulunamadı veya belirsiz: ' + desired);
    return options[0].value;
  }
  var FAILURE_TEXT = /couldn'?t be added|could not be added|cannot be added|you cannot take/i;
  /** Plan sections already printed on the page, i.e. the student's current course list. Dropdown text is not a list entry. */
  function listedCourses(courses) {
    var copy = document.body.cloneNode(true);
    copy.querySelectorAll('#btbx,script,style,select,textarea').forEach(function (node) { node.remove(); });
    // textContent glues neighbouring cells ("1CMPE 150.01INTRO"); join text nodes with spaces instead.
    var walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT), parts = [];
    while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
    var text = courseText(parts.join(' '));
    return courses.filter(function (course) {
      return new RegExp('(^|[^A-Z0-9])' + course.abbr + course.code + '\\.0*' + Number(course.section) + '(?!\\d)').test(text);
    });
  }
  function prepareForm(writeValues) {
    clearLog(); invalidate();
    if (pageBlocked()) { say('BUIS kayıt servisi kapalı veya oturum açılmamış. Form açılınca yeniden dene.', 'warn'); return; }
    var parsed = parsePlan(input.value);
    if (parsed.error) { say(parsed.error, 'err'); return; }
    var rows = findRows();
    if (!rows.length) { say('Tek ve doğrulanabilir ders formu bulunamadı. Alanları tanıt veya form raporunu paylaş.', 'err'); return; }
    // After a Quick Add the page lists what was added; only the rest is written. An error page skips nothing,
    // because its message may quote the very course that failed.
    var failureShown = FAILURE_TEXT.test(pageText());
    var listed = failureShown ? [] : listedCourses(parsed.courses);
    var pending = parsed.courses.filter(function (course) { return !listed.includes(course); });
    if (!pending.length) { say('Plandaki bütün dersler listende görünüyor. Kontrol edip Send to Approval’a geçebilirsin.', 'ok'); return; }
    var batch = pending.slice(0, rows.length), later = pending.slice(rows.length);
    var form = rows[0].abbr.form, values = [];
    try {
      if (actionUrl(form).origin !== location.origin) throw new Error('Form hedefi BUIS ile aynı kökende değil.');
      rows.forEach(function (row, index) {
        ['abbr', 'code', 'section'].forEach(function (key) {
          var node = row[key], course = batch[index];
          if (!course) { if (node.value.trim()) throw new Error('Liste dışındaki satırda mevcut ders var; önce BUIS formunu kontrol et.'); return; }
          var value = optionValue(node, course[key]);
          if (node.maxLength > 0 && value.length > node.maxLength) throw new Error('Değer alan sınırını aşıyor: ' + course.display);
          if (node.value.trim() && node.value !== value) throw new Error('Dolu alanın üzerine yazılmadı; önce BUIS formunu kontrol et.');
          values.push({ node: node, value: value });
        });
      });
    } catch (error) { say(error.message, 'err'); return; }
    if (writeValues) values.forEach(function (entry) { setValue(entry.node, entry.value); flash(entry.node); });
    lastFill = { filled: writeValues, desired: values, controls: snapshotControls(form), form: form, action: form.action, method: form.method, target: form.target, enctype: form.enctype, input: input.value, rows: rows,
      values: rows.flatMap(function (row) { return ['abbr', 'code', 'section'].map(function (key) { return { node: row[key], value: row[key].value }; }); }) };
    writePlan(input.value);
    submitTargets = Array.from(form.querySelectorAll('input[type="submit"], input[type="button"], button')).filter(function (node) {
      return !panel.contains(node) && node.form === form && ['submit', 'button'].includes(node.type) && !node.matches(':disabled') && node.getClientRects().length && getComputedStyle(node).visibility === 'visible' && ADD_LABEL.test(label(node)) &&
        !node.hasAttribute('formaction') && !node.hasAttribute('formmethod') && !node.hasAttribute('formtarget');
    }).map(function (node) { return { node: node, signature: targetSignature(node) }; });
    submitChoice.replaceChildren(el('option', { value: '', textContent: 'BUIS ders ekleme düğmesini seç' }));
    submitTargets.forEach(function (target, index) { submitChoice.appendChild(el('option', { value: String(index), textContent: label(target.node) + ' (' + (target.node.id || target.node.name || index + 1) + ')' })); });
    submitChoice.disabled = !submitTargets.length;
    var names = function (courses) { return courses.map(function (course) { return course.display; }).join(', '); };
    if (failureShown) say('BUIS bir dersin eklenemediğini yazıyor; mesajı oku. Bu turda hiçbir ders atlanmadı.', 'warn');
    if (listed.length) say('Listende zaten görünen dersler atlandı: ' + names(listed), 'warn');
    if (later.length) say('Form ' + rows.length + ' satırlık; sonraki tura kalan: ' + names(later) + '. Quick Add’den sonra yeniden "Formu doldur"a bas.', 'warn');
    say(batch.length + (writeValues ? ' ders forma yazıldı: ' + names(batch) + '. Gönderme yapılmadı.' : ' ders için form tanındı; alanlar değiştirilmedi. Kredi/tekrar seçeneklerini BUIS’te kontrol et.'), 'ok');
    say(submitTargets.length ? 'Listeyi kontrol edip doğru BUIS ders ekleme düğmesini seç.' : 'Ders ekleme düğmesi doğrulanamadı; BUIS’in kendi düğmesini kullan.', 'warn');
  }
  fillBtn.addEventListener('click', function () { prepareForm(true); });
  inspectBtn.addEventListener('click', function () { prepareForm(false); });
  function updateActions() {
    var ready = !!selectedTarget();
    submitBtn.disabled = !ready || !lastFill.filled || !!scheduled;
    quickBtn.disabled = !ready || !reviewed.checked || !!scheduled;
    armBtn.disabled = !ready || !reviewed.checked || !!scheduled;
  }
  submitChoice.addEventListener('change', function () { stopSchedule(); reviewed.checked = false; updateActions(); });
  reviewed.addEventListener('change', function () { stopSchedule(); updateActions(); });
  sendAt.addEventListener('input', function () { stopSchedule('Saat değişti; yeniden başlat.'); updateActions(); });
  invalidate();

  quotaBtn.addEventListener('click', function () {
    clearLog();
    var parsed = parsePlan(input.value);
    if (parsed.error) { say(parsed.error, 'err'); return; }
    if (!parsed.semester) { say('Dönemli sorgu için Toolbox’tan Planı kopyala ile aldığın JSON’u yapıştır.', 'err'); return; }
    quotaBtn.disabled = true;
    say('Kontenjanlar sorgulanıyor…');

    // Sunucuyu yormamak için sırayla ve aralıklı sorgula.
    if (!parsed.student) say('Toolbox’ta bölümünü seçmediğin için consent/kontenjan kararı kesinleşmeyecek; tüm bölüm satırları gösterilecek.', 'warn');

    parsed.courses.reduce(function (chain, course) {
      return chain.then(function () {
        return fetchQuota(course, parsed.semester).then(function (quota) {
          var line = quotaLine(course, quota, parsed.student);
          say(line.text, line.kind);
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

  function selectedTarget() {
    var target = submitChoice.value !== '' ? submitTargets[Number(submitChoice.value)] : null;
    if (!fillMatches() || !target || !target.node.isConnected || target.node.form !== lastFill.form || target.node.matches(':disabled') || getComputedStyle(target.node).visibility !== 'visible' ||
      !target.node.getClientRects().length || target.signature !== targetSignature(target.node) || !ADD_LABEL.test(label(target.node))) return null;
    return target;
  }
  function dispatchPlan(fillFirst) {
    var started = performance.now(), target = selectedTarget();
    if (!target || !fillFirst && !lastFill.filled || fillFirst && !reviewed.checked) {
      invalidate(); say('Form, seçenekler veya düğme değişti. Yeniden tanıtıp kontrol et.', 'err'); return;
    }
    if (fillFirst) {
      lastFill.desired.forEach(function (entry) { setValue(entry.node, entry.value); });
      // A page-side synchronous value handler must not silently substitute a course.
      if (!lastFill.desired.every(function (entry) { return entry.node.value === entry.value; })) {
        invalidate(); say('Alan değerleri beklenen listeyle eşleşmedi; gönderilmedi.', 'err'); return;
      }
      lastFill.values.forEach(function (entry) { entry.value = entry.node.value; });
      lastFill.controls = snapshotControls(lastFill.form);
    }
    if (!selectedTarget()) { invalidate(); say('Form değişti; gönderilmedi.', 'err'); return; }
    var node = target.node;
    invalidate(); // Clear both manual and timed paths BEFORE invoking the actual button.
    say('Doldurma/kontrol ' + (performance.now() - started).toFixed(1) + ' ms. Seçtiğin ekleme düğmesine bir kez basılıyor; sonuç BUIS yanıtında.', 'warn');
    try { node.click(); return true; } catch (error) { say('Düğme işlemi tamamlanamadı: ' + error.message, 'err'); return false; }
  }
  submitBtn.addEventListener('click', function () { dispatchPlan(false); });
  quickBtn.addEventListener('click', function () { dispatchPlan(true); });

  function parseSendTime(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return NaN;
    var normalized = value.length === 16 ? value + ':00' : value;
    var millis = Date.parse(normalized + '+03:00');
    return Number.isFinite(millis) && new Date(millis + 10800000).toISOString().slice(0, 19) === normalized ? millis : NaN;
  }
  function tickSchedule() {
    if (!scheduled) return;
    var now = Date.now(), remaining = scheduled.at - now;
    if (document.visibilityState !== 'visible' || !selectedTarget() || !reviewed.checked || submitChoice.value !== scheduled.choice) {
      invalidate(); timerStatus.textContent = 'Sekme/form değişti; zamanlama iptal edildi.'; return;
    }
    if (Math.abs((now - scheduled.wallStart) - (performance.now() - scheduled.monotonicStart)) > 1500 || remaining < -1500) {
      invalidate(); timerStatus.textContent = 'Saat kayması veya gecikme algılandı; otomatik gönderilmedi.'; return;
    }
    if (remaining <= 0) { var sent = dispatchPlan(true); timerStatus.textContent = sent ? 'Tek gönderim tetiklendi; sonucu BUIS’te kontrol et.' : 'Gönderim tetiklenemedi; formu kontrol et.'; return; }
    timerStatus.textContent = 'Gönderime ' + Math.ceil(remaining / 1000) + ' sn · Türkiye saati ' + sendAt.value.replace('T', ' ');
    scheduleTimer = setTimeout(tickSchedule, Math.min(remaining, 200));
  }
  armBtn.addEventListener('click', function () {
    stopSchedule();
    var at = parseSendTime(sendAt.value), now = Date.now();
    if (!selectedTarget() || !reviewed.checked || document.visibilityState !== 'visible') { say('Önce açık formu tanıt, düğmeyi seç ve listeyi kontrol et.', 'err'); return; }
    if (!parsePlan(input.value).semester) { say('Saatli gönderim için dönem bilgisini taşıyan Toolbox JSON planını kullan.', 'err'); return; }
    if (!Number.isFinite(at) || at <= now || at - now > 86400000) { say('Önümüzdeki 24 saat içinde geçerli bir Türkiye saati seç.', 'err'); return; }
    scheduled = { at: at, choice: submitChoice.value, wallStart: now, monotonicStart: performance.now() };
    cancelBtn.disabled = false; updateActions(); tickSchedule();
  });
  cancelBtn.addEventListener('click', function () { stopSchedule('Zamanlama iptal edildi.'); updateActions(); });
  document.addEventListener('visibilitychange', function () { if (scheduled && document.visibilityState !== 'visible') { invalidate(); timerStatus.textContent = 'Sekme gizlendi; zamanlama iptal edildi.'; } });
  window.addEventListener('pagehide', function () { invalidate(); });

  var cancelTeaching = null;
  teachBtn.addEventListener('click', function () {
    clearLog(); invalidate();
    if (cancelTeaching) cancelTeaching();
    var fields = ['abbr', 'code', 'section'], picked = {}, step = 0;
    var labels = { abbr: 'ders kısaltması (ör. CMPE)', code: 'ders numarası (ör. 150)', section: 'şube (ör. 01)' };
    say('Sırayla tıkla: ' + labels[fields[0]], 'warn');

    function selectorFor(node) {
      var selector = node.id ? attrSelector('id', node.id) : node.name ? attrSelector('name', node.name) : null;
      return selector && single(selector) === node ? selector : null;
    }
    function onPick(event) {
      var node = event.target;
      if (!editable(node)) return;
      if (panel.contains(node)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      var selector = selectorFor(node);
      if (!selector) { say('Bu alanın benzersiz id/name değeri yok, seçilemedi.', 'err'); return; }
      if (Object.values(picked).includes(selector)) { say('Aynı alan iki kez seçilemez.', 'err'); return; }
      if (step && single(picked.abbr)?.form !== node.form) { say('Alanlar aynı formda olmalı.', 'err'); return; }
      picked[fields[step]] = selector;
      flash(node);
      step++;
      if (step < fields.length) { say('Şimdi: ' + labels[fields[step]], 'warn'); return; }
      document.removeEventListener('click', onPick, true);
      writeStore({ selectors: picked });
      var count = findRows().length;
      say('Alanlar kaydedildi: ' + count + ' ders satırı bulundu.' + (count > 1 ? ' Artık "Formu doldur" çalışacak.' : ' Diğer satırlar bulunamadı; listeyi tek ders olarak kullanabilirsin.'), count > 1 ? 'ok' : 'warn');
    }
    cancelTeaching = function () { document.removeEventListener('click', onPick, true); };
    document.addEventListener('click', onPick, true);
  });

  /** Letters → A, digits → 9: shows how option labels are built without copying course or grade text. */
  function labelShape(text) { return text.replace(/\s+/g, ' ').trim().replace(/\p{L}/gu, 'A').replace(/\d/g, '9').slice(0, 40); }
  function describeField(node) {
    var parts = [node.tagName.toLowerCase(), node.type || '', node.name || '', node.id || ''];
    if (node instanceof HTMLSelectElement) parts.push(node.options.length + ' seçenek: ' + Array.from(node.options).slice(0, 3).map(function (option) { return labelShape(option.textContent); }).join(' / '));
    if (node.getAttribute('onchange')) parts.push('onchange');
    return parts.join('|');
  }

  reportBtn.addEventListener('click', function () {
    clearLog();
    var report = {
      url: location.origin + location.pathname,
      scripts: Array.from(document.scripts).filter(function (script) { return script.src; }).map(function (script) { var url = new URL(script.src, location.href); return url.origin + url.pathname; }),
      forms: Array.prototype.slice.call(document.forms).map(function (form) {
        return {
          action: actionUrl(form).origin + actionUrl(form).pathname, method: form.method,
          fields: Array.prototype.slice.call(form.elements).filter(function (node) { return !panel.contains(node); }).slice(0, 80).map(describeField)
        };
      }),
      outsideForms: Array.from(document.querySelectorAll('input, select, textarea, button')).filter(function (node) { return !node.form && !panel.contains(node); }).slice(0, 40).map(describeField)
    };
    var text = JSON.stringify(report, null, 2);
    reportOutput.hidden = false; reportOutput.value = text;
    say('Form yapısı ayrı rapor alanına yazıldı; planın korundu. Rapor alan değerleri, parola, çerez veya URL sorgu parametreleri içermez.', 'ok');
    say(document.forms.length + ' form, ' + findRows().length + ' ders satırı tespit edildi.');
  });

  // ------------------------------------------------------------------ consent
  // BUIS: choose the abbreviation, then the course, write the message, submit.
  // Each choice may post the page back, so the job survives a reload for a few seconds.
  // Nothing here clicks a button: every request uses one of the student's limited attempts.
  var CONSENT_STEP_MS = 60000, consentTimer = null;
  function visibleControl(node) {
    return node.isConnected && !panel.contains(node) && !node.matches(':disabled') && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible';
  }
  function squash(text) { return String(text || '').toUpperCase().replace(/\s+/g, ''); }
  /** "Select CMPE 150 . 01" → "SELECT CMPE150.01": joins a course code but keeps word boundaries. */
  function courseText(text) {
    return String(text || '').toUpperCase().replace(/\s+/g, ' ').replace(/([A-Z])\s+(?=\d)/g, '$1').replace(/(\d)\s*\.\s*(?=\d)/g, '$1.');
  }
  function pageText() {
    var copy = document.body.cloneNode(true);
    copy.querySelectorAll('#btbx,script,style').forEach(function (node) { node.remove(); });
    return copy.textContent;
  }
  function readJob() {
    try {
      var job = JSON.parse(sessionStorage.getItem(CONSENT_JOB_KEY) || 'null'), age = job && Date.now() - job.at;
      var valid = job && /^[A-Z]{1,6}$/.test(job.abbr) && /^\d{2,3}[A-Z]?$/.test(job.code) && /^\d{2}$/.test(job.section) &&
        job.display === job.abbr + ' ' + job.code + '.' + job.section && typeof job.message === 'string' && job.message.length <= MESSAGE_LIMIT &&
        Number.isInteger(job.attempts) && Array.isArray(job.done) && age >= 0 && age < CONSENT_STEP_MS;
      return valid ? job : null;
    } catch (e) { return null; }
  }
  function saveJob(job) {
    try {
      if (job) sessionStorage.setItem(CONSENT_JOB_KEY, JSON.stringify(Object.assign({}, job, { at: Date.now() })));
      else sessionStorage.removeItem(CONSENT_JOB_KEY);
    } catch (e) { /* özel mod */ }
  }
  function stopConsent(message, kind) {
    if (consentTimer !== null) clearTimeout(consentTimer);
    consentTimer = null; saveJob(null);
    if (message) say(message, kind);
  }
  function selectsWith(test) {
    return Array.from(document.querySelectorAll('select')).filter(visibleControl).map(function (select) {
      return { select: select, options: Array.from(select.options).filter(function (option) { return !option.disabled && test(option); }) };
    }).filter(function (match) { return match.options.length; });
  }
  function abbrChoice(job) {
    var matches = selectsWith(function (option) {
      var label = option.textContent.replace(/\s+/g, ' ').trim();
      if (/\d/.test(label)) return false; // course lists carry numbers; abbreviation lists do not
      var token = (/^[A-Za-z]{1,6}(?![A-Za-z0-9])/.exec(label) || [''])[0].toUpperCase();
      var bracketed = (/\(\s*([A-Za-z]{1,6})\s*\)$/.exec(label) || ['', ''])[1].toUpperCase();
      return token === job.abbr || bracketed === job.abbr || squash(option.value) === job.abbr;
    });
    if (matches.length > 1) return { error: job.abbr + ' birden fazla listede var; kısaltmayı kendin seç.' };
    if (!matches.length) return {};
    return matches[0].options.length === 1 ? { select: matches[0].select, option: matches[0].options[0] } : { error: job.abbr + ' kısaltması listede birden fazla kez geçiyor; kendin seç.' };
  }
  function courseChoice(job) {
    var course = new RegExp('(^|[^A-Z0-9])' + job.abbr + job.code + '(?![A-Z0-9])');
    var sections = new RegExp('(^|[^A-Z0-9])' + job.abbr + job.code + '\\.\\d');
    var exact = new RegExp('(^|[^A-Z0-9])' + job.abbr + job.code + '\\.0*' + Number(job.section) + '(?!\\d)');
    var text = function (option) { return courseText(option.textContent) + ' | ' + courseText(option.value); };
    var matches = selectsWith(function (option) { return course.test(text(option)); });
    if (matches.length > 1) return { error: job.display + ' birden fazla listede var; dersi kendin seç.' };
    if (!matches.length) return {};
    var options = matches[0].options, exactOptions = options.filter(function (option) { return exact.test(text(option)); });
    if (exactOptions.length === 1) return { select: matches[0].select, option: exactOptions[0] };
    var listsSections = options.some(function (option) { return sections.test(text(option)); });
    if (!listsSections && options.length === 1) return { select: matches[0].select, option: options[0] };
    return { error: listsSections ? job.display + ' şubesi listede yok; başka şube istiyorsan kendin seç.' : job.display + ' için birden fazla seçenek var; kendin seç.' };
  }
  /** Returns false once BUIS has ignored or undone the selections a few times, so a reload loop stops. */
  function choose(job, step, select, option) {
    job.attempts += 1; job.done = (job.done || []).concat([step]);
    if (job.attempts > 4) return false;
    saveJob(job);
    option.selected = true;
    select.dispatchEvent(new Event('change', { bubbles: true })); // BUIS may reload here to list the courses
    return true;
  }
  function runConsent(job, deadline) {
    if (consentTimer !== null) { clearTimeout(consentTimer); consentTimer = null; }
    var text = pageText();
    if (/not\s+open|currently\s+closed/i.test(text)) return stopConsent('Consent ekranı kapalı görünüyor; açıldığında yeniden dene.', 'warn');
    if (!/consent/i.test(text) || findRows().length || Array.from(document.querySelectorAll('input[type="password"]')).some(visibleControl)) {
      return stopConsent('Bu sayfa Consent Requests ekranı değil. BUIS’te Course List Preparation → Consent Requests’i aç.', 'err');
    }
    var waitFor = function (reason) {
      if (Date.now() > deadline) return stopConsent(reason, 'err');
      saveJob(job);
      consentTimer = setTimeout(function () { runConsent(job, deadline); }, 250);
    };
    var course = courseChoice(job);
    if (course.error) return stopConsent(course.error, 'err');
    if (!course.option) {
      var abbr = abbrChoice(job);
      if (abbr.error) return stopConsent(abbr.error, 'err');
      if (!abbr.option) return stopConsent(job.abbr + ' kısaltması consent listesinde yok; bu ders consent almıyor olabilir.', 'err');
      // Even an already selected abbreviation is announced once, in case the course list loads on change.
      if ((!abbr.option.selected || !(job.done || []).includes('abbr')) && !choose(job, 'abbr', abbr.select, abbr.option)) {
        return stopConsent('BUIS seçimleri kabul etmedi; dersi kendin seç.', 'err');
      }
      return waitFor(job.display + ' ders listesinde çıkmadı; dersi kendin seç.');
    }
    if (!course.option.selected && !choose(job, 'course', course.select, course.option)) return stopConsent('BUIS seçimleri kabul etmedi; dersi kendin seç.', 'err');
    var areas = Array.from(document.querySelectorAll('textarea')).filter(function (node) { return visibleControl(node) && !node.readOnly; });
    if (areas.length > 1) return stopConsent('Birden fazla mesaj alanı var; mesajı kopyalayıp kendin yapıştır.', 'err');
    if (!areas.length) return waitFor('Mesaj alanı bulunamadı; mesajı kopyalayıp kendin yapıştır.');
    var area = areas[0];
    if (!job.message) return stopConsent(job.display + ' seçildi. Toolbox’ta mesaj yazmadığın için alan boş kaldı.', 'warn');
    if (area.maxLength > 0 && job.message.length > area.maxLength) return stopConsent('Mesaj BUIS’in ' + area.maxLength + ' karakter sınırını aşıyor; Toolbox’ta kısalt.', 'err');
    if (area.value.trim() && area.value.trim() !== job.message) return stopConsent(job.display + ' seçildi; mesaj alanı dolu olduğu için üzerine yazmadım.', 'warn');
    area.value = job.message;
    flash(area); area.focus();
    if (area.scrollIntoView) area.scrollIntoView({ block: 'center' });
    stopConsent(job.display + ' seçildi, mesajın yazıldı. Hocanın notunu okuyup göndermeyi sen yap.', 'ok');
  }
  function copyMessage(course) {
    var fallback = function () {
      copyOutput.hidden = false; copyOutput.value = course.message; copyOutput.select();
      say('Pano izni yok; mesaj alttaki kutuda seçili, Ctrl/Cmd+C ile kopyala.', 'warn');
    };
    try {
      navigator.clipboard.writeText(course.message).then(function () { say(course.display + ' mesajı panoya kopyalandı.', 'ok'); }, fallback);
    } catch (e) { fallback(); }
  }
  function renderConsent() {
    var parsed = parsePlan(input.value), courses = parsed.error ? [] : parsed.courses.filter(function (course) { return course.message; });
    consentList.replaceChildren();
    if (!courses.length) {
      consentList.appendChild(el('div', { className: 'hint', textContent: 'Toolbox’ta consent mesajı yazdığın dersler burada çıkar.' }));
      return;
    }
    courses.forEach(function (course) {
      consentList.appendChild(el('div', { className: 'row' }, [
        el('code', { textContent: course.display }),
        el('button', { className: 'act', textContent: 'Consent doldur · ' + course.display, onclick: function () {
          clearLog(); stopConsent();
          runConsent({ display: course.display, abbr: course.abbr, code: course.code, section: course.section, message: course.message, attempts: 0, done: [] }, Date.now() + 8000);
        } }),
        el('button', { className: 'act ghost', textContent: 'Mesajı kopyala · ' + course.display, onclick: function () { copyMessage(course); } })
      ]));
    });
  }
  input.addEventListener('input', renderConsent);
  renderConsent();

  closeBtn.addEventListener('click', function () { if (cancelTeaching) cancelTeaching(); stopConsent(); invalidate(); panel.style.display = 'none'; });

  window.__bounToolboxHelper = {
    open: function () { panel.style.display = 'block'; },
    parsePlan: parsePlan, findRows: findRows, parseQuota: parseQuota, parseSendTime: parseSendTime,
    evaluateQuota: evaluateQuota, quotaLine: quotaLine
  };
  if (pageBlocked()) say('BUIS kayıt servisi kapalı veya giriş gerekiyor. Kapalı ekranı aşmak için istek gönderilmez.', 'warn');
  say('Hazır. Programı yapıştır ve "Formu doldur"a bas.', 'ok');
  var pendingConsent = readJob();
  if (pendingConsent) { say('Consent adımı sürüyor: ' + pendingConsent.display); runConsent(pendingConsent, Date.now() + 8000); }
})();
