import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogue, courseSlots, defaultBundle, toggleCourse, candidateConflicts, totalCredits, matchesSearch, searchScore, readSelection, courseDescriptionUrl, DAYS, HOURS } from '../src/lib/planner.ts';
import type { Course } from '../src/lib/planner.ts';
const course = (key: string, overrides: Partial<Course> = {}): Course => ({ key, code: key, name: 'Test', instructor: 'ÖZGÜR', days: ['M'], hours: [1], rooms: ['A'], sessionType: 'lecture', credits: 3, ects: 5, ...overrides });

test('merges split lecture rows, normalizes spacing, and deduplicates meetings', () => {
  const list = buildCatalogue({ a: course('AD  101.01'), b: course('AD 101.01', { days: ['M', 'T'], hours: [1, 2], rooms: ['A', 'B'] }) });
  assert.equal(list.length, 1); assert.equal(list[0].key, 'AD101.01');
  assert.equal(courseSlots(list[0]).length, 2);
});
test('weekend and late slots are represented, invalid slots ignored', () => {
  const slots = courseSlots(course('A', { days: ['St', 'Su', 'M', 'X'], hours: [12, 14, 0, 2] }));
  assert.deepEqual(slots.map(s => [s.day, s.hour]), [['St', 20], ['Su', 22]]);
  assert.ok(slots.every(s => DAYS.includes(s.day) && HOURS.includes(s.hour)));
});
test('auto includes a single lab, requires user choice for multiple labs', () => {
  const main = course('CMPE101.01'), lab = course('LAB1', { code: main.code, sessionType: 'lab' });
  assert.deepEqual(defaultBundle(main, [main, lab]).map(c => c.key), [main.key, lab.key]);
  assert.deepEqual(defaultBundle(main, [main, lab, { ...lab, key: 'LAB2' }]).map(c => c.key), [main.key]);
});
test('related LAB conflicts are counted before adding lecture', () => {
  const main = course('CMPE101.01'), lab = course('LAB', { code: main.code, sessionType: 'lab', days: ['F'], hours: [3] });
  const other = course('MATH101.01', { days: ['F'], hours: [3] });
  assert.equal(candidateConflicts(main, [main, lab, other], [other]), 1);
});
test('replacing a section removes old lecture and auxiliary meetings', () => {
  const main = course('CMPE101.01'), next = course('CMPE101.02'), lab = course('LAB', { code: main.code, sessionType: 'lab' });
  const result = toggleCourse([main.key, lab.key], next, [main, next, lab]);
  assert.deepEqual(result, [next.key]); assert.equal(candidateConflicts(next, [main, next], [main]), 0);
});
test('removal deletes entire course; independent sessions can be explicitly selected', () => {
  const main = course('CMPE101.01'), lab = course('LAB1', { code: main.code, sessionType: 'lab' }), lab2 = { ...lab, key: 'LAB2' };
  const list = [main, lab, lab2];
  assert.deepEqual(toggleCourse([main.key, lab.key], lab2, list), [main.key, lab.key, lab2.key]);
  assert.deepEqual(toggleCourse([main.key, lab.key, lab2.key], main, list), []);
});
test('credits counted once, auxiliary and duplicate sections excluded', () => {
  const main = course('CMPE101.01');
  assert.deepEqual(totalCredits([main, course('CMPE101.02'), course('LAB', { code: main.code, sessionType: 'lab', credits: 3 }), course('TK101.01', { credits: 0, ects: null })]), { local: 3, ects: 5 });
});
test('unscheduled courses remain selectable and count for credit', () => {
  const main = course('CMPE599.01', { days: null, hours: null });
  assert.deepEqual(toggleCourse([], main, [main]), [main.key]); assert.equal(totalCredits([main]).local, 3);
});
test('search supports compact codes, Turkish names and literal punctuation', () => {
  const main = course('AD  101.01'); assert.ok(matchesSearch(main, 'ad101')); assert.ok(matchesSearch(main, 'AD 101'));
  assert.ok(matchesSearch(main, 'ozgur')); assert.equal(matchesSearch(main, '['), false);
});
test('storage rejects malformed data and prunes stale keys', () => {
  const list = [course('A')];
  for (const text of ['null', '{}', '[', '42']) assert.deepEqual(readSelection({ getItem: () => text }, 'key', list), []);
  assert.deepEqual(readSelection({ getItem: () => '["A","A","OLD",2]' }, 'key', list), ['A']);
  assert.deepEqual(readSelection({ getItem: () => { throw new Error('blocked'); } }, 'key', list), []);
});
test('syllabus URL uses dataset semester and canonical code', () => {
  const url = new URL(courseDescriptionUrl('AD  101.01', '2026/2027-1')!);
  assert.equal(url.searchParams.get('course'), 'AD101'); assert.equal(url.searchParams.get('term'), '2026/2027-1');
});
test('selected lecture conflict state follows selected labs, not default labs', () => {
  const main = course('CMPE101.01'), lab = course('LAB', { code: main.code, sessionType: 'lab', days: ['F'], hours: [3] });
  const other = course('MATH101.01', { days: ['F'], hours: [3] });
  assert.equal(candidateConflicts(main, [main, lab, other], [main, other]), 0);
  assert.equal(candidateConflicts(main, [main, lab, other], [main, lab, other]), 1);
});
test('internal lecture/lab clashes are included in conflict filter', () => {
  const main = course('CMPE101.01'), lab = course('LAB', { code: main.code, sessionType: 'lab' });
  assert.equal(candidateConflicts(main, [main, lab], []), 1);
});

test('course code outranks name and instructor matches', () => {
  const mis = course('MIS125.01', { code: 'MIS 125.01', name: 'INFORMATION SYSTEMS' });
  const econ = course('AD211.01', { code: 'AD 211.01', name: 'FINANCIAL ACCOUNTING FOR ECONOMISTS' });
  assert.ok(searchScore(mis, 'mis') > searchScore(econ, 'mis'));
});

test('a term buried inside a word is not a match', () => {
  const bio = course('BIO301.01', { code: 'BIO 301.01', name: 'BIOCHEMISTRY I' });
  assert.equal(searchScore(bio, 'mis'), 0);
  assert.equal(matchesSearch(bio, 'mis'), false);
  assert.ok(matchesSearch(bio, 'bioche'));
});

test('scores rank exact code above prefix above partial', () => {
  const c = course('CMPE150.01', { code: 'CMPE 150.01' });
  assert.equal(searchScore(c, 'cmpe150.01'), 100);
  assert.equal(searchScore(c, 'cmpe'), 90);
  assert.equal(searchScore(c, '150'), 70);
  assert.equal(searchScore(c, ''), 0);
});

test('name and instructor still match at a word boundary', () => {
  const c = course('MATH101.01', { code: 'MATH 101.01', name: 'CALCULUS I', instructor: 'ÖZLEM BEYARSLAN' });
  assert.equal(searchScore(c, 'calculus'), 40);
  assert.equal(searchScore(c, 'beyarslan'), 30);
  assert.equal(searchScore(c, 'ozlem'), 30);
});
