import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCourseCode, buildRegistrationPlan, planToText, planToJson, planByDepartment, duplicateBaseCodes } from '../src/lib/registration.ts';
import type { Course } from '../src/lib/planner.ts';

const course = (key: string, overrides: Partial<Course> = {}): Course => ({
  key, code: key, name: 'Test', instructor: 'ÖZGÜR', days: ['M'], hours: [1], rooms: ['A'],
  sessionType: 'lecture', credits: 3, ects: 5, ...overrides,
});
const plan = (selected: Course[], catalogue: Course[] = selected) =>
  buildRegistrationPlan(selected, catalogue, '2026/2027-1');

test('splits a course code into the three Quick Add fields', () => {
  assert.deepEqual(parseCourseCode('CMPE 150.01'), { abbr: 'CMPE', code: '150', section: '01' });
  assert.deepEqual(parseCourseCode('EC101.02'), { abbr: 'EC', code: '101', section: '02' });
  assert.deepEqual(parseCourseCode('PHYS 201A.03'), { abbr: 'PHYS', code: '201A', section: '03' });
});

test('pads a one-digit section and rejects codes it cannot read', () => {
  assert.equal(parseCourseCode('TK 221.1')?.section, '01');
  assert.equal(parseCourseCode('nonsense'), null);
  assert.equal(parseCourseCode(''), null);
});

test('registers lectures only and reports the chosen LAB/P.S. as context', () => {
  const lecture = course('CMPE150.01', { code: 'CMPE 150.01' });
  const lab = course('CMPE150.01 LAB', { code: 'CMPE 150.01', sessionType: 'lab', days: ['W'], hours: [5] });
  const result = plan([lecture, lab], [lecture, lab]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].display, 'CMPE 150.01');
  assert.deepEqual(result.entries[0].sessions, ['LAB · Çar 13:00']);
  assert.deepEqual(result.warnings, []);
});

test('warns when a lecture still needs a LAB choice', () => {
  const lecture = course('CMPE150.01', { code: 'CMPE 150.01' });
  const labs = [1, 2].map(n => course(`LAB${n}`, { code: 'CMPE 150.01', sessionType: 'lab' }));
  const result = plan([lecture], [lecture, ...labs]);
  assert.equal(result.entries[0].missingSessions.length, 1);
  assert.match(result.warnings.join(' '), /LAB oturumu seçilmedi/);
});

test('flags a lecture whose hours the source never published', () => {
  const lecture = course('LAW101.01', { code: 'LAW 101.01', days: [], hours: [] });
  assert.match(plan([lecture]).warnings.join(' '), /saat açıklanmamış/);
});

test('warns instead of dropping a course whose code cannot be parsed', () => {
  const odd = course('WEIRD', { code: 'WEIRD' });
  const result = plan([odd]);
  assert.equal(result.entries.length, 0);
  assert.match(result.warnings.join(' '), /kod biçimi tanınmadı/);
});

test('deduplicates repeated sections and sorts the list', () => {
  const a = course('MATH101.01', { code: 'MATH 101.01' });
  const b = course('CMPE150.01', { code: 'CMPE 150.01' });
  const result = plan([a, b, { ...a, key: 'copy' }]);
  assert.deepEqual(result.entries.map(e => e.display), ['CMPE 150.01', 'MATH 101.01']);
});

test('detects two sections of the same course', () => {
  const one = course('EC101.01', { code: 'EC 101.01' });
  const two = course('EC101.02', { code: 'EC 101.02' });
  assert.deepEqual(duplicateBaseCodes(plan([one, two])), ['EC101']);
  assert.deepEqual(duplicateBaseCodes(plan([one])), []);
});

test('text export is one plain section per line', () => {
  const a = course('CMPE150.01', { code: 'CMPE 150.01' });
  const b = course('MATH101.02', { code: 'MATH 101.02' });
  assert.equal(planToText(plan([a, b])), 'CMPE 150.01\nMATH 101.02');
  assert.equal(planToText(plan([])), '');
});

test('json export carries the fields the BUIS helper needs', () => {
  const payload = JSON.parse(planToJson(plan([course('CMPE150.01', { code: 'CMPE 150.01' })])));
  assert.equal(payload.source, 'boun-toolbox');
  assert.equal(payload.semester, '2026/2027-1');
  assert.deepEqual(payload.courses[0], { abbr: 'CMPE', code: '150', section: '01', display: 'CMPE 150.01', name: 'Test' });
});

test('groups the plan by department', () => {
  const a = course('CMPE150.01', { code: 'CMPE 150.01' });
  const b = course('CMPE160.01', { code: 'CMPE 160.01' });
  const c = course('MATH101.01', { code: 'MATH 101.01' });
  assert.deepEqual(planByDepartment(plan([a, b, c])).map(([dept, list]) => [dept, list.length]), [['CMPE', 2], ['MATH', 1]]);
});
