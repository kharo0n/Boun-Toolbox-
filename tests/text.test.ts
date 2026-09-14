import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, semesterLabel } from '../src/lib/text.ts';
import courses from '../src/data/allCourses.json' with { type: 'json' };

test('capitalised BUIS course names become readable without breaking Turkish letters', () => {
  assert.equal(displayName('INTRODUCTION TO COMPUTING'), 'Introduction to Computing');
  assert.equal(displayName('TÜRK DİLİ I'), 'Türk Dili I');
  assert.equal(displayName('PRINCIPLES OF ATATÜRK AND HISTORY OF TURKISH REVOLUTION II'), 'Principles of Atatürk and History of Turkish Revolution II');
  assert.equal(displayName('IE-OR MODELS'), 'IE-OR Models');
  assert.equal(displayName('Already Mixed'), 'Already Mixed');
  assert.equal(semesterLabel('2026/2027-1'), '2026/2027 Güz');
  assert.equal(semesterLabel('2026/2027-2'), '2026/2027 Bahar');
});

test('every catalogue name keeps its letters when recased', () => {
  const fold = (text: string) => text.toLocaleUpperCase('tr-TR').replace(/[İI]/g, 'I');
  for (const course of Object.values(courses as Record<string, { name: string }>)) {
    assert.equal(fold(displayName(course.name)), fold(course.name), course.name);
    assert.doesNotMatch(displayName(course.name), /i̇/, course.name); // no combining dot from wrong locale
  }
});
