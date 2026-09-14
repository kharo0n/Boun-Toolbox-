import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../public/buis-kayit-yardimcisi.user.js', import.meta.url), 'utf8');
const row = (n: number) => `<input name="abbr${n}"><input name="code${n}"><input name="section${n}">`;
const form = (fields = row(1), buttons = '<button id="delete">Delete</button><button id="add">Quick Add</button>') => `<form method="post" action="/fixture-add.aspx">${fields}${buttons}</form>`;
function fixture(t: TestContext, html = form(), saved = '{}') {
  // Synthetic form, no BUIS session or network. Layout is mocked because jsdom has none.
  const dom = new JSDOM(html, { url: 'https://registration.boun.edu.tr/buis/Fixture.aspx?token=URL_SECRET', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'getClientRects', { value() { return this.hidden || this.style.display === 'none' ? [] : [{}]; } });
  w.localStorage.setItem('boun-toolbox:buis-helper:v2:/buis/fixture.aspx', saved);
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

test('over-capacity plan is not partially filled', t => {
  const f = fixture(t); f.fill('CMPE 150.01\nMATH 101.01');
  assert.equal(f.field('abbr1').value, '');
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
