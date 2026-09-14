import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../public/buis-kayit-yardimcisi.user.js', import.meta.url), 'utf8');
const row = (n: number) => `<input name="abbr${n}"><input name="code${n}"><input name="section${n}">`;
const form = (fields = row(1), buttons = '<button id="delete">Delete</button><button id="add">Quick Add</button>') => `<form method="post" action="/fixture-add.aspx">${fields}${buttons}</form>`;
function fixture(t: TestContext, html = form(), saved = '{}', setup: (w: JSDOM['window']) => void = () => {}) {
  // Synthetic form, no BUIS session or network. Layout is mocked because jsdom has none.
  const dom = new JSDOM(html, { url: 'https://registration.boun.edu.tr/buis/Fixture.aspx?token=URL_SECRET', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'getClientRects', { value() { return this.hidden || this.style.display === 'none' ? [] : [{}]; } });
  w.localStorage.setItem('boun-toolbox:buis-helper:v2:/buis/fixture.aspx', saved);
  setup(w);
  let submissions = 0, networkCalls = 0;
  w.fetch = () => { networkCalls++; throw new Error('Network forbidden in fixture'); };
  w.HTMLFormElement.prototype.submit = () => { throw new Error('Raw submit must never be used'); };
  w.document.addEventListener('submit', (event: Event) => { event.preventDefault(); submissions++; });
  w.eval(script);
  const d: Document = w.document;
  const button = (name: string) => {
    const result = Array.from(d.querySelectorAll<HTMLButtonElement>('#btbx button')).find(b => b.textContent === name);
    assert.ok(result, `Missing helper button ${name}`);
    return result;
  };
  const input = d.querySelector<HTMLTextAreaElement>('#btbx textarea')!;
  const choice = d.querySelector<HTMLSelectElement>('#btbx select')!;
  const setPlan = (value = 'CMPE 150.01') => { input.value = value; input.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const fill = (value = 'CMPE 150.01') => { setPlan(value); button('Formu doldur').click(); };
  const choose = () => { choice.value = '0'; choice.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const field = (name: string) => d.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  return { w, d, button, input, choice, fill, choose, setPlan, field, submissions: () => submissions, networkCalls: () => networkCalls };
}

test('fill does not post back; only explicitly selected Quick Add submits once', t => {
  const f = fixture(t);
  let changes = 0, deletes = 0;
  f.d.querySelector('form')!.addEventListener('change', () => changes++);
  f.d.querySelector('#delete')!.addEventListener('click', () => deletes++);
  f.fill();
  assert.equal(f.field('abbr1').value, 'CMPE');
  assert.equal(changes, 0);
  assert.equal(f.submissions(), 0);
  assert.equal(f.button('Formu gönder').disabled, true);
  assert.equal(f.choice.options.length, 2);
  f.choose();
  f.button('Formu gönder').click();
  f.button('Formu gönder').click();
  assert.equal(f.submissions(), 1);
  assert.equal(deletes, 0);
});

test('advisor approval cannot be mistaken for course addition', t => {
  const f = fixture(t, form(row(1), '<button>Send to advisor</button>'));
  f.fill();
  assert.equal(f.button('Formu gönder').disabled, true);
  assert.equal(f.choice.disabled, true);
  assert.equal(f.submissions(), 0);
});

for (const input of ['CMPE 150.01\ninvalid', 'CMPE 150.01\nCMPE 150.02', 'CMPE 150.00', '{"source":"elsewhere","courses":[]}', '{"source":"boun-toolbox","version":1,"semester":"2026/2027-1","courses":[null]}']) {
  test(`malformed plan rejects the whole fill: ${input}`, t => {
    const f = fixture(t); f.fill(input);
    assert.equal(f.field('abbr1').value, '');
    assert.equal(f.button('Formu gönder').disabled, true);
  });
}

const log = (f: ReturnType<typeof fixture>) => f.d.querySelector('#btbx .log')!.textContent!;

test('a plan longer than the form fills the rows it has and names the rest', t => {
  const f = fixture(t); f.fill('CMPE 150.01\nMATH 101.01');
  assert.equal(f.field('abbr1').value, 'CMPE');
  assert.match(log(f), /sonraki tura kalan: MATH 101\.01/);
  assert.equal(f.submissions(), 0);
});

test('sections already on the course list are skipped, so the next round writes the rest', t => {
  const f = fixture(t, '<table><tr><td>CMPE 150 . 01</td><td>INTRODUCTION TO COMPUTING</td></tr></table>' + form(row(1) + row(2)));
  f.fill('CMPE 150.01\nMATH 101.01\nPHYS 101.02');
  assert.equal(f.field('abbr1').value, 'MATH');
  assert.equal(f.field('abbr2').value, 'PHYS');
  assert.match(log(f), /zaten görünen dersler atlandı: CMPE 150\.01/);
});

test('another section, a dropdown entry or an error message is not mistaken for a listed course', t => {
  for (const page of ['<p>CMPE 150.02</p>', '<select><option>CMPE 150.01 AA</option></select>', "<p>CMPE 150.01 course couldn't be added to your list</p>"]) {
    const f = fixture(t, page + form(row(1)));
    f.fill('CMPE 150.01');
    assert.equal(f.field('abbr1').value, 'CMPE', page);
  }
});

test('nothing is written when every planned section is already listed', t => {
  const f = fixture(t, '<p>CMPE150.01</p><p>MATH 101.1</p>' + form(row(1) + row(2)));
  f.fill('CMPE 150.01\nMATH 101.01');
  assert.equal(f.field('abbr1').value, '');
  assert.match(log(f), /bütün dersler listende/);
});

function teach(f: ReturnType<typeof fixture>, nodes: HTMLElement[]) {
  f.button('Alanları tanıt').click();
  for (const node of nodes) node.dispatchEvent(new f.w.MouseEvent('click', { bubbles: true, cancelable: true }));
}

test('teach mode follows the numbering of the taught row to fill every row', t => {
  const rows = [1, 2, 3].map(n => `<input name="ctl00$txtKisa${n}"><input name="ctl00$txtNo${n}"><input name="ctl00$txtSube${n}">`).join('');
  const f = fixture(t, form(rows));
  const nodes = ['ctl00$txtKisa1', 'ctl00$txtNo1', 'ctl00$txtSube1'].map(name => f.field(name));
  teach(f, nodes);
  assert.match(log(f), /3 ders satırı bulundu/);
  f.fill('CMPE 150.01\nMATH 101.02\nEC 101.01');
  assert.equal(f.field('ctl00$txtKisa3').value, 'EC');
  assert.equal(f.field('ctl00$txtSube2').value, '02');
});

test('teach mode falls back to the table layout when later rows have no names', t => {
  const f = fixture(t, form('<table><tr><td><input id="k"></td><td><input id="n"></td><td><input id="s"></td></tr><tr><td><input></td><td><input></td><td><input></td></tr><tr><td colspan="3">Not a row</td></tr></table>'));
  teach(f, ['k', 'n', 's'].map(id => f.d.getElementById(id)!));
  assert.match(log(f), /2 ders satırı bulundu/);
  f.fill('CMPE 150.01\nMATH 101.02');
  const inputs = f.d.querySelectorAll<HTMLInputElement>('form tr:nth-child(2) input');
  assert.deepEqual(Array.from(inputs).map(i => i.value), ['MATH', '101', '02']);
});

test('plan is shared across BUIS pages so it survives the Quick Add post', t => {
  const f = fixture(t, form(), '{"plan":"OLD 101.01"}', w => w.localStorage.setItem('boun-toolbox:buis-helper:plan', 'CMPE 150.01'));
  assert.equal(f.input.value, 'CMPE 150.01');
  const legacy = fixture(t, form(), '{"plan":"MATH 101.01"}');
  assert.equal(legacy.input.value, 'MATH 101.01');
});

test('occupied field anywhere prevents all writes', t => {
  const f = fixture(t, form(row(1) + row(2)));
  f.field('code2').value = '999';
  f.fill();
  assert.equal(f.field('abbr1').value, '');
  assert.equal(f.field('code2').value, '999');
});

test('unknown table layouts and cross-form fields are not guessed', t => {
  for (const html of ['<form><table><tr><td><input name="a"><input name="b"><input type="password"></td></tr></table></form>', '<form><input name="abbr1"><input name="code1"></form><form><input name="section1"></form>', form(row(1)) + form(row(2))]) {
    const f = fixture(t, html); f.fill();
    assert.equal(f.button('Formu gönder').disabled, true);
    assert.equal(Array.from(f.d.querySelectorAll<HTMLInputElement>('form input')).some(n => n.value), false);
  }
});

test('missing select option prevents earlier fields from being written', t => {
  const f = fixture(t, form('<input name="abbr1"><input name="code1"><select name="section1"><option value=""></option><option value="2">2</option></select>'));
  f.fill(); assert.equal(f.field('abbr1').value, '');
});

test('select maps padded section to actual available value', t => {
  const f = fixture(t, form('<input name="abbr1"><input name="code1"><select name="section1"><option value=""></option><option value="1">1</option></select>'));
  f.fill(); assert.equal(f.field('section1').value, '1');
});

for (const mutation of ['plan', 'field', 'action', 'button', 'rows', 'target']) {
  test(`changed ${mutation} prevents submission`, t => {
    const f = fixture(t); f.fill(); f.choose();
    if (mutation === 'plan') f.setPlan('MATH 101.01');
    if (mutation === 'field') f.field('code1').value = '160';
    if (mutation === 'action') f.d.querySelector('form')!.action = 'https://example.com';
    if (mutation === 'button') f.d.querySelector('#add')!.textContent = 'Delete';
    if (mutation === 'rows') f.d.querySelector('form')!.insertAdjacentHTML('beforeend', row(2));
    if (mutation === 'target') f.d.querySelector('form')!.target = '_blank';
    f.button('Formu gönder').click();
    assert.equal(f.submissions(), 0);
    assert.equal(f.button('Formu gönder').disabled, true);
  });
}

test('report preserves plan and excludes field values and URL secrets', t => {
  const f = fixture(t, '<script src="/bundle.js?token=SCRIPT_SECRET"></script>' + form(row(1) + '<input type="hidden" name="__VIEWSTATE" value="STATE_SECRET"><input type="password" value="PASSWORD_SECRET">'));
  f.d.querySelector('form')!.action = '/add.aspx?token=ACTION_SECRET';
  f.setPlan(); f.button('Form raporu').click();
  const report = f.d.querySelector<HTMLTextAreaElement>('[aria-label="Form raporu"]')!.value;
  assert.equal(f.input.value, 'CMPE 150.01');
  assert.doesNotMatch(report, /URL_SECRET|SCRIPT_SECRET|STATE_SECRET|PASSWORD_SECRET|ACTION_SECRET/);
  assert.match(report, /__VIEWSTATE/);
});

test('null persisted state loads without crashing and plain list cannot query wrong semester', t => {
  const f = fixture(t, form(), 'null');
  f.setPlan(); f.button('Kontenjan kontrol').click();
  assert.equal(f.networkCalls(), 0);
  assert.match(f.d.querySelector('#btbx .log')!.textContent!, /Dönemli sorgu/);
});

test('login response is rejected as an unrecognized quota response', t => {
  const f = fixture(t);
  assert.throws(() => f.w.__bounToolboxHelper.parseQuota('<form>UserName<input type="password"></form>'), /Kontenjan tablosu tanınmadı/);
});

test('reset buttons and disabled fieldsets cannot trigger registration', t => {
  const f = fixture(t, form(row(1), '<button type="reset">Quick Add</button><fieldset disabled><button>Quick Add</button></fieldset>'));
  f.fill();
  assert.equal(f.choice.disabled, true);
  assert.equal(f.submissions(), 0);
});

test('disabled fieldset course fields are not editable', t => {
  const f = fixture(t, form('<fieldset disabled>' + row(1) + '</fieldset>'));
  f.fill();
  assert.equal(f.field('abbr1').value, '');
});

const jsonPlan = JSON.stringify({ source: 'boun-toolbox', version: 1, semester: '2026/2027-1', courses: [{ abbr: 'CMPE', code: '150', section: '01' }, { abbr: 'MATH', code: '101', section: '02' }] });
function readyFast(t: TestContext, html = form(row(1) + row(2))) {
  const f = fixture(t, html);
  f.setPlan(jsonPlan);
  f.button('Formu tanı').click();
  f.choose();
  const review = f.d.querySelector<HTMLInputElement>('#btbx input[type="checkbox"]')!;
  review.click();
  return { ...f, review };
}
function fakeClock(f: ReturnType<typeof fixture>) {
  let wall = Date.parse('2026-09-15T09:59:50+03:00'), mono = 0;
  let callback: (() => void) | undefined;
  Object.defineProperty(f.w.Date, 'now', { value: () => wall });
  Object.defineProperty(f.w.performance, 'now', { value: () => mono });
  f.w.setTimeout = (fn: () => void) => { callback = fn; return 1; };
  f.w.clearTimeout = () => { callback = undefined; };
  const time = f.d.querySelector<HTMLInputElement>('#btbx input[type="datetime-local"]')!;
  time.value = '2026-09-15T10:00:00';
  return { time, advance(ms: number, monotonicMs = ms) { wall += ms; mono += monotonicMs; const fn = callback; callback = undefined; fn?.(); } };
}

test('fast path leaves fields untouched during preparation, fills and submits both courses once', t => {
  const f = readyFast(t);
  assert.equal(f.field('abbr1').value, '');
  assert.equal(f.submissions(), 0);
  assert.equal(f.button('Formu gönder').disabled, true);
  f.button('Doldur ve gönder').click();
  f.button('Doldur ve gönder').click();
  assert.equal(f.field('abbr1').value, 'CMPE');
  assert.equal(f.field('code2').value, '101');
  assert.equal(f.field('section2').value, '02');
  assert.equal(f.submissions(), 1);
  assert.equal(f.networkCalls(), 0);
});

test('a changed repeat/credit selection prevents fast submission, including silent JS changes', t => {
  const f = readyFast(t, form(row(1) + row(2) + '<input type="checkbox" name="noncredit">'));
  f.d.querySelector<HTMLInputElement>('[name="noncredit"]')!.checked = true;
  f.button('Doldur ve gönder').click();
  assert.equal(f.submissions(), 0);
  assert.equal(f.field('abbr1').value, '');
});

test('closed service never offers a send path even if old inputs remain', t => {
  const f = readyFast(t, '<h1>SERVICE IS CURRENTLY CLOSED!</h1>' + form(row(1) + row(2)));
  assert.equal(f.button('Doldur ve gönder').disabled, true);
  assert.equal(f.button('Saatli gönderimi başlat').disabled, true);
  assert.equal(f.field('abbr1').value, '');
});

test('BUIS wrapper leaves the helper to its inner registration frame', t => {
  const dom = new JSDOM('<iframe id="ifCPL" src="about:blank"></iframe>', { url: 'https://registration.boun.edu.tr/buis/manage/ObikasASPFrame.aspx', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(script);
  assert.equal(dom.window.document.querySelector('#btbx'), null);
});

test('timer waits until the chosen instant then fills and submits once', t => {
  const f = readyFast(t), clock = fakeClock(f);
  f.button('Saatli gönderimi başlat').click();
  assert.equal(f.button('Doldur ve gönder').disabled, true);
  clock.advance(9900);
  assert.equal(f.submissions(), 0);
  assert.equal(f.field('abbr1').value, '');
  clock.advance(100);
  clock.advance(1000);
  assert.equal(f.submissions(), 1);
  assert.equal(f.field('code2').value, '101');
});

for (const scenario of ['cancel', 'plan edit', 'button change', 'late wake', 'clock jump', 'hidden', 'pagehide', 'closed']) {
  test(`scheduled submission stops on ${scenario}`, t => {
    const f = readyFast(t), clock = fakeClock(f);
    f.button('Saatli gönderimi başlat').click();
    if (scenario === 'cancel') f.button('Zamanlamayı iptal et').click();
    if (scenario === 'plan edit') f.setPlan('MATH101.01');
    if (scenario === 'button change') f.d.querySelector('#add')!.textContent = 'Send to approval';
    if (scenario === 'hidden') { Object.defineProperty(f.d, 'visibilityState', { value: 'hidden' }); f.d.dispatchEvent(new f.w.Event('visibilitychange')); }
    if (scenario === 'pagehide') f.w.dispatchEvent(new f.w.Event('pagehide'));
    if (scenario === 'closed') f.d.body.insertAdjacentHTML('afterbegin', '<p>SERVICE IS CURRENTLY CLOSED!</p>');
    clock.advance(scenario === 'late wake' ? 13000 : 10000, scenario === 'clock jump' ? 300 : scenario === 'late wake' ? 13000 : 10000);
    assert.equal(f.submissions(), 0);
    assert.equal(f.field('abbr1').value, '');
  });
}

test('time parser is explicitly Turkey time and rejects normalized invalid dates', t => {
  const f = fixture(t);
  const parse = f.w.__bounToolboxHelper.parseSendTime;
  assert.equal(parse('2026-09-15T10:00:00'), Date.parse('2026-09-15T07:00:00Z'));
  assert.equal(parse('2026-09-15T10:00'), Date.parse('2026-09-15T07:00:00Z'));
  assert.ok(Number.isNaN(parse('2026-02-30T10:00:00')));
  assert.ok(Number.isNaN(parse('not a date')));
});

test('already passed time does not submit or arm', t => {
  const f = readyFast(t), clock = fakeClock(f);
  clock.time.value = '2026-09-15T09:00:00';
  f.button('Saatli gönderimi başlat').click();
  clock.advance(60000);
  assert.equal(f.submissions(), 0);
  assert.equal(f.button('Zamanlamayı iptal et').disabled, true);
});

test('forged manual send event cannot submit a preview with unfilled fields', t => {
  const f = readyFast(t);
  f.button('Formu gönder').dispatchEvent(new f.w.MouseEvent('click'));
  assert.equal(f.submissions(), 0);
});

test('unknown origin cannot install the helper outside the explicit demo page', t => {
  const dom = new JSDOM(form(), { url: 'https://example.com/buis/Fixture.aspx', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(script);
  assert.equal(dom.window.document.querySelector('#btbx'), null);
});

// ------------------------------------------------------------------ quota and consent verdicts
const quotaPage = (name: string) => readFileSync(new URL(`./fixtures/quota-${name}.html`, import.meta.url), 'utf8');

test('real BUIS quota tables resolve to a verdict for the student’s department', t => {
  const f = fixture(t), helper = f.w.__bounToolboxHelper;
  const verdict = (page: string, department: string | null, level = 'UNDERGRADUATE') =>
    helper.evaluateQuota(helper.parseQuota(quotaPage(page)), department ? { department, level } : null);
  assert.equal(verdict('CMPE150', 'COMPUTER ENGINEERING').verdict, 'consent');
  const civil = verdict('CMPE150', 'CIVIL ENGINEERING');
  assert.equal(civil.verdict, 'open'); assert.equal(civil.row.kind, 'unlimited');
  assert.equal(verdict('CMPE150', 'COMPUTER ENGINEERING', 'GRADUATE').verdict, 'not-listed');
  assert.equal(verdict('CMPE150', null).verdict, 'consent-rows');
  const history = verdict('HIST105', 'HISTORY');
  assert.equal(history.verdict, 'open'); assert.equal(history.left, 4);
  assert.equal(verdict('HIST105', 'POLITICAL SCIENCE & INTERNATIONAL RELATIONS').verdict, 'open');
  assert.equal(verdict('HIST105', 'MANAGEMENT').verdict, 'not-listed');
  assert.equal(verdict('PSY101', 'COMPUTER ENGINEERING').verdict, 'open');
  assert.equal(verdict('PSY101', null).verdict, 'unknown');
});

test('department row wins over ALL, and a filled numeric quota reads as full', t => {
  const f = fixture(t), helper = f.w.__bounToolboxHelper;
  const quota = { capacity: '40', restriction: null, rows: [
    { department: 'ALL', status: 'ALL', quota: '30', current: '2' },
    { department: 'ECONOMICS', status: 'ALL', quota: '5', current: '5' },
    { department: 'ECONOMICS', status: 'UNDERGRADUATE', quota: 'Consent Of Instructor', current: '0' },
  ] };
  assert.equal(helper.evaluateQuota(quota, { department: 'ECONOMICS', level: 'UNDERGRADUATE' }).verdict, 'consent');
  assert.equal(helper.evaluateQuota(quota, { department: 'ECONOMICS', level: 'GRADUATE' }).verdict, 'full');
  assert.equal(helper.evaluateQuota(quota, { department: 'HISTORY', level: 'GRADUATE' }).verdict, 'open');
  assert.match(helper.quotaLine({ display: 'EC 101.01' }, quota, { department: 'ECONOMICS', level: 'GRADUATE' }).text, /dolu 5\/5.*consent isteyebilirsin/);
});

test('plan carries the student profile and consent messages, and rejects bad ones', t => {
  const f = fixture(t), parse = f.w.__bounToolboxHelper.parsePlan;
  const plan = (extra: object, course: object = {}) => JSON.stringify({ source: 'boun-toolbox', version: 1, semester: '2026/2027-1', ...extra,
    courses: [{ abbr: 'CMPE', code: '150', section: '01', ...course }] });
  const ok = parse(plan({ student: { department: 'CIVIL ENGINEERING', level: 'UNDERGRADUATE' } }, { message: '  Dear Professor  ' }));
  assert.equal(JSON.stringify(ok.student), '{"department":"CIVIL ENGINEERING","level":"UNDERGRADUATE"}');
  assert.equal(ok.courses[0].message, 'Dear Professor');
  assert.match(parse(plan({ student: { department: 'CE', level: 'PHD' } })).error, /bölümü\/düzeyi/);
  assert.match(parse(plan({}, { message: 'x'.repeat(2001) })).error, /Consent mesajı/);
  assert.match(parse(plan({}, { message: 42 })).error, /Consent mesajı/);
});

// ------------------------------------------------------------------ consent form
const consentPlan = JSON.stringify({ source: 'boun-toolbox', version: 1, semester: '2026/2027-1', courses: [
  { abbr: 'CMPE', code: '150', section: '01', message: 'Dear Professor, I kindly request your consent.' },
  { abbr: 'MATH', code: '101', section: '02' },
] });
const consentPage = (extra = '') => `<h2>Consent Requests</h2><form method="post" action="/scripts/consentsend.asp">
  <select name="abbr"><option value="">--</option><option>CMPE</option><option>MATH</option></select>
  <select name="course"><option value="">--</option></select>
  <textarea name="msg"></textarea><button id="send">Submit</button><button id="cancel">Cancel Request</button></form>${extra}`;
const courses: Record<string, string[]> = { CMPE: ['CMPE 150.01 - INTRODUCTION TO COMPUTING', 'CMPE 150.02 - INTRODUCTION TO COMPUTING'], MATH: ['MATH 101.02 - CALCULUS I'] };
function consentFixture(t: TestContext, html = consentPage(), setup: (w: JSDOM['window']) => void = () => {}) {
  const f = fixture(t, html, '{}', setup);
  let clicks = 0;
  f.d.querySelectorAll('form button').forEach(b => b.addEventListener('click', () => clicks++));
  const abbr = f.d.querySelector<HTMLSelectElement>('[name="abbr"]'), course = f.d.querySelector<HTMLSelectElement>('[name="course"]');
  abbr?.addEventListener('change', () => { // BUIS-like dependent list, filled without a reload
    course!.innerHTML = '<option value="">--</option>' + (courses[abbr.value] || []).map((label, i) => `<option value="${i + 1}">${label}</option>`).join('');
  });
  f.setPlan(consentPlan);
  const area = () => f.d.querySelector<HTMLTextAreaElement>('[name="msg"]')!;
  return { ...f, abbr, course, area, clicks: () => clicks, wait: (ms = 700) => new Promise(resolve => f.w.setTimeout(resolve, ms)) };
}

test('consent helper picks the abbreviation, the exact section and writes the message without sending', async t => {
  const f = consentFixture(t);
  assert.throws(() => f.button('Consent doldur · MATH 101.02'), /Missing helper button/); // no message, no button
  f.button('Consent doldur · CMPE 150.01').click();
  await f.wait();
  assert.equal(f.abbr!.value, 'CMPE');
  assert.equal(f.course!.selectedOptions[0].textContent, 'CMPE 150.01 - INTRODUCTION TO COMPUTING');
  assert.equal(f.area().value, 'Dear Professor, I kindly request your consent.');
  assert.equal(f.clicks(), 0);
  assert.equal(f.submissions(), 0);
  assert.equal(f.w.sessionStorage.getItem('boun-toolbox:buis-helper:consent-job'), null);
});

test('consent helper resumes after BUIS reloads the page with the abbreviation chosen', async t => {
  const job = { display: 'CMPE 150.01', abbr: 'CMPE', code: '150', section: '01', message: 'Hello', attempts: 1, done: ['abbr'] };
  const page = consentPage().replace('<option>CMPE</option>', '<option selected>CMPE</option>')
    .replace('<option value="">--</option></select>\n  <textarea', '<option value="">--</option><option value="9">CMPE 150.01 - INTRO</option></select>\n  <textarea');
  const f = consentFixture(t, page, w => w.sessionStorage.setItem('boun-toolbox:buis-helper:consent-job', JSON.stringify({ ...job, at: Date.now() })));
  assert.equal(f.course!.value, '9');
  assert.equal(f.area().value, 'Hello');
  assert.equal(f.clicks(), 0);
});

test('a stale or forged consent job is ignored after reload', t => {
  for (const job of [
    { display: 'CMPE 150.01', abbr: 'CMPE', code: '150', section: '01', message: 'Hello', attempts: 1, done: [], at: Date.now() - 120000 },
    { display: 'CMPE 150.01', abbr: 'CMPE|.*', code: '150', section: '01', message: 'Hello', attempts: 1, done: [], at: Date.now() },
  ]) {
    const f = consentFixture(t, consentPage(), w => w.sessionStorage.setItem('boun-toolbox:buis-helper:consent-job', JSON.stringify(job)));
    assert.equal(f.abbr!.value, '');
    assert.equal(f.area().value, '');
  }
});

test('a page that keeps undoing the selection stops after a few attempts', t => {
  const job = { display: 'CMPE 150.01', abbr: 'CMPE', code: '150', section: '01', message: 'Hello', attempts: 4, done: ['abbr', 'course', 'abbr', 'course'], at: Date.now() };
  const page = consentPage().replace('<option value="">--</option></select>\n  <textarea', '<option value="">--</option><option value="9">CMPE 150.01 - INTRO</option></select>\n  <textarea');
  const f = consentFixture(t, page, w => w.sessionStorage.setItem('boun-toolbox:buis-helper:consent-job', JSON.stringify(job)));
  assert.equal(f.area().value, '');
  assert.match(log(f), /seçimleri kabul etmedi/);
});

test('consent helper refuses unclear choices and never overwrites a typed message', async t => {
  const missingSection = consentFixture(t);
  courses.CMPE.splice(0, 1);
  t.after(() => courses.CMPE.unshift('CMPE 150.01 - INTRODUCTION TO COMPUTING'));
  missingSection.button('Consent doldur · CMPE 150.01').click();
  await missingSection.wait();
  assert.equal(missingSection.course!.value, '');
  assert.equal(missingSection.area().value, '');
  assert.match(log(missingSection), /şubesi listede yok/);

  const typed = consentFixture(t);
  typed.area().value = 'My own words';
  courses.CMPE.unshift('CMPE 150.01 - INTRODUCTION TO COMPUTING');
  typed.button('Consent doldur · CMPE 150.01').click();
  await typed.wait();
  courses.CMPE.shift();
  assert.equal(typed.area().value, 'My own words');
  assert.match(log(typed), /üzerine yazmadım/);
});

test('consent helper does nothing on the Quick Add screen or a closed consent page', t => {
  const quickAdd = consentFixture(t, '<p>Consent Requests</p>' + form(row(1) + '<select name="rcourse1"><option>CMPE 150.01</option><option>CMPE</option></select>'));
  quickAdd.button('Consent doldur · CMPE 150.01').click();
  assert.match(log(quickAdd), /Consent Requests ekranı değil/);
  assert.equal(quickAdd.field('rcourse1').selectedIndex, 0);
  const closed = consentFixture(t, consentPage('<p>Consent Entry Is Not Open !</p>'));
  closed.button('Consent doldur · CMPE 150.01').click();
  assert.equal(closed.abbr!.value, '');
  assert.match(log(closed), /kapalı/);
});

test('form report shows how dropdown labels are built without their text', t => {
  const f = consentFixture(t);
  f.button('Form raporu').click();
  const report = f.d.querySelector<HTMLTextAreaElement>('[aria-label="Form raporu"]')!.value;
  assert.match(report, /select\|select-one\|abbr\|\|3 seçenek: -- \/ AAAA \/ AAAA/);
  assert.doesNotMatch(report, /CMPE|Dear Professor/);
});

// ------------------------------------------------------------------ multi-round Quick Add
const QUICK_JOB = 'boun-toolbox:buis-helper:quickadd-job', PLAN = 'boun-toolbox:buis-helper:plan';
const eightPlan = JSON.stringify({ source: 'boun-toolbox', version: 1, semester: '2026/2027-1', courses: [
  ['CMPE', '150', '01'], ['MATH', '101', '02'], ['EC', '101', '01'], ['HIST', '105', '01'], ['PHYS', '121', '01'], ['CHEM', '105', '01'], ['TK', '221', '01'], ['PSY', '101', '01'],
].map(([abbr, code, section]) => ({ abbr, code, section })) });
const listing = (...codes: string[]) => `<table>${codes.map(code => `<tr><td>${code}</td><td>Course</td></tr>`).join('')}</table>`;
/** A page BUIS returns after Quick Add: the list so far plus a fresh form, with the tab's storage carried over. */
function reloaded(t: TestContext, page: string, job: object | null, plan = eightPlan) {
  return fixture(t, page, '{}', w => {
    w.localStorage.setItem(PLAN, plan);
    if (job) w.sessionStorage.setItem(QUICK_JOB, JSON.stringify({ at: Date.now(), ...job }));
  });
}
const rows5 = form([1, 2, 3, 4, 5].map(row).join(''));
const job = (f: ReturnType<typeof fixture>) => JSON.parse(f.w.sessionStorage.getItem(QUICK_JOB) || 'null');

test('eight courses on a five-row form: one confirmation sends five, the reloaded page sends the other three', t => {
  const first = fixture(t, rows5);
  first.setPlan(eightPlan); first.button('Formu tanı').click(); first.choose();
  first.d.querySelector<HTMLInputElement>('#btbx input[type="checkbox"]')!.click();
  assert.match(log(first), /sonraki tura kalan: CHEM 105\.01, TK 221\.01, PSY 101\.01\. Quick Add’den sonra sayfa yenilenince kendiliğinden eklenecek/);
  first.button('Doldur ve gönder').click();
  assert.equal(first.submissions(), 1);
  const saved = job(first);
  assert.deepEqual([saved.round, saved.listed, saved.tried.length, saved.button.label], [1, 0, 5, 'Quick Add']);

  const second = reloaded(t, listing('CMPE 150.01', 'MATH 101.02', 'EC 101.01', 'HIST 105.01', 'PHYS 121.01') + rows5, saved);
  assert.equal(second.submissions(), 1, 'second round sent without another click');
  assert.deepEqual([1, 2, 3].map(n => second.field(`abbr${n}`).value), ['CHEM', 'TK', 'PSY']);
  assert.equal(second.field('abbr4').value, '');
  assert.match(log(second), /Tur 2: listende 5\/8 ders var; CHEM 105\.01, TK 221\.01, PSY 101\.01 ekleniyor/);
  assert.equal(job(second).tried.length, 8);

  const third = reloaded(t, listing('CMPE 150.01', 'MATH 101.02', 'EC 101.01', 'HIST 105.01', 'PHYS 121.01', 'CHEM 105.01', 'TK 221.01', 'PSY 101.01') + rows5, job(second));
  assert.equal(third.submissions(), 0);
  assert.match(log(third), /8 dersin hepsi listende görünüyor/);
  assert.equal(job(third), null);
});

test('pressing BUIS’s own Quick Add after "Formu doldur" also starts the rounds', t => {
  const f = fixture(t, form(row(1) + row(2)));
  f.fill(eightPlan);
  const add = f.d.querySelector<HTMLButtonElement>('#add')!;
  add.click();
  assert.equal(f.submissions(), 1);
  const saved = job(f);
  assert.ok(saved, 'job saved from the submit event');
  assert.deepEqual(saved.tried, ['CMPE 150.01', 'MATH 101.02']);
});

test('a course that was sent but did not appear is not sent again', t => {
  const previous = { plan: eightPlan, button: { name: '', label: 'Quick Add' }, listed: 0, round: 1, tried: ['CMPE 150.01', 'MATH 101.02', 'EC 101.01', 'HIST 105.01', 'PHYS 121.01'] };
  const f = reloaded(t, listing('CMPE 150.01', 'MATH 101.02', 'EC 101.01', 'PHYS 121.01') + rows5, previous);
  assert.equal(f.submissions(), 1);
  assert.deepEqual([1, 2, 3, 4].map(n => f.field(`abbr${n}`).value), ['CHEM', 'TK', 'PSY', '']);
  assert.match(log(f), /tekrar denenmedi: HIST 105\.01/);
});

test('rounds stop on an error message, no progress, a changed plan, a stale job or when switched off', t => {
  const previous = { plan: eightPlan, button: { name: '', label: 'Quick Add' }, listed: 0, round: 1, tried: ['CMPE 150.01', 'MATH 101.02', 'EC 101.01', 'HIST 105.01', 'PHYS 121.01'] };
  const five = listing('CMPE 150.01', 'MATH 101.02', 'EC 101.01', 'HIST 105.01', 'PHYS 121.01');
  const cases: [string, ReturnType<typeof fixture>, RegExp][] = [
    ['error', reloaded(t, "<p>MATH 101.02 course couldn't be added to your list</p>" + five + rows5, previous), /eklenemediğini yazıyor/],
    ['no progress', reloaded(t, rows5, previous), /yeni ders görünmüyor/],
    ['changed plan', reloaded(t, five + rows5, previous, 'CMPE 150.01'), /Plan değiştiği/],
    ['different button', reloaded(t, five + form([1, 2, 3, 4, 5].map(row).join(''), '<button>Add Selected Course</button>'), previous), /Quick Add düğmesi/],
    ['stale', reloaded(t, five + rows5, { ...previous, at: Date.now() - 10 * 60000 }), /Hazır/],
  ];
  for (const [name, f, expected] of cases) {
    assert.equal(f.submissions(), 0, name);
    assert.equal(f.field('abbr1').value, '', name);
    assert.match(log(f), expected, name);
  }
  const off = fixture(t, rows5, '{}', w => w.localStorage.setItem('boun-toolbox:buis-helper:auto-continue', 'off'));
  off.setPlan(eightPlan); off.button('Formu tanı').click(); off.choose();
  off.d.querySelector<HTMLInputElement>('#btbx input[type="checkbox"]')!.click();
  off.button('Doldur ve gönder').click();
  assert.equal(off.submissions(), 1);
  assert.equal(job(off), null);
  assert.match(log(off), /yeniden "Formu doldur"a bas/);
});
