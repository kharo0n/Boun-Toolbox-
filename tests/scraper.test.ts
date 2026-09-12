import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDays, parseHours, parseDepartments, parseDepartment, assembleCourses } from '../scripts/update-courses.mjs';
const headers = ['Code.Sec', 'Desc.', 'Name', 'Cr.', 'Ects', 'Quota', 'Instr.', 'Days', 'Hours', 'Rooms'];
const row = (cells: string[], aux = false) => `<tr class="schtd${aux ? ' labps' : ''}">${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
const html = (rows: string) => `<p>Semester: 2026/2027-1</p><table><tr class="schtitle">${headers.map(h => `<td>${h}</td>`).join('')}</tr>${rows}</table>`;
const main = ['CMPE101.01', '', 'COMPUTING', '3', '5', '', 'ÖZGÜR', 'ThThSt', '9AB', 'A | B | C'];

test('BUIS day and hour notation including 10..14', () => {
  assert.deepEqual(parseDays('MThStSu'), ['M', 'Th', 'St', 'Su']);
  assert.deepEqual(parseHours('9ABCDE', ['M','M','M','M','M','M']), [9,10,11,12,13,14]);
  assert.deepEqual(parseHours('10 11 12', ['M','M','M']), [10,11,12]);
  assert.deepEqual(parseHours('101112', ['M','M','M']), [10,11,12]);
  assert.throws(() => parseHours('111', ['M','M'])); assert.throws(() => parseDays('XYZ'));
});
test('header-based parsing, Unicode and lab parent association', () => {
  const records = parseDepartment(html(row(main) + row(['', '', 'LAB', '', '', '', 'STAFF', 'F', 'E', 'D'], true)), '2026/2027-1');
  assert.equal(records[0].instructor, 'ÖZGÜR'); assert.deepEqual(records[0].hours, [9,10,11]);
  assert.equal(records[1].code, 'CMPE 101.01'); assert.equal(records[1].sessionType, 'lab'); assert.equal(records[1].credits, null);
});
test('malformed rooms preserve known meeting times and expose warning', () => {
  const cells = [...main]; cells[9] = 'A | B';
  const [record] = parseDepartment(html(row(cells)), '2026/2027-1');
  assert.deepEqual(record.days, ['Th','Th','St']); assert.deepEqual(record.hours, [9,10,11]);
  assert.deepEqual(record.rooms, ['','','']); assert.ok(record.scheduleWarning);
});
test('ambiguous hours never fabricate schedule', () => {
  const cells = [...main]; cells[7] = 'MM'; cells[8] = '111';
  const [record] = parseDepartment(html(row(cells)), '2026/2027-1');
  assert.deepEqual(record.days, []); assert.ok(record.scheduleWarning); assert.equal(record.rawSchedule.hours, '111');
});
test('rejects source errors, wrong semesters and missing department lists', () => {
  assert.throws(() => parseDepartment('Login', '2026/2027-1'));
  assert.throws(() => parseDepartment(html(row(main)), '2025/2026-2'));
  assert.throws(() => parseDepartments('2026/2027-1', '2026/2027-1'));
  assert.throws(() => parseDepartments('<p>2026/2027-1</p><a href="/scripts/sch.asp?donem=2025/2026-2">X</a>', '2026/2027-1'));
});
test('deduplicates source rows without losing distinct sessions', () => {
  const rows = parseDepartment(html(row(main) + row(main)), '2026/2027-1');
  assert.equal(Object.keys(assembleCourses(rows)).length, 1);
});
test('checked-in data matches metadata, every auxiliary has a parent and slots align', () => {
  const data = JSON.parse(readFileSync(new URL('../src/data/allCourses.json', import.meta.url), 'utf8'));
  const meta = JSON.parse(readFileSync(new URL('../src/data/courseMetadata.json', import.meta.url), 'utf8'));
  const records = Object.values(data) as Array<{ code: string; sessionType: string; days: string[]; hours: number[]; rooms: string[] }>;
  assert.equal(records.length, meta.recordCount); assert.equal(meta.departments.length, meta.departmentCount);
  const parentCodes = new Set(records.filter(c => c.sessionType === 'lecture').map(c => c.code));
  assert.equal(parentCodes.size, meta.sectionCount);
  for (const record of records) {
    assert.ok(parentCodes.has(record.code)); assert.equal(record.days.length, record.hours.length); assert.equal(record.days.length, record.rooms.length);
    assert.ok(record.hours.every(h => Number.isInteger(h) && h >= 1 && h <= 14));
  }
});
