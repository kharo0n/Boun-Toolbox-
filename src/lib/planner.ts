export type SessionType = 'lecture' | 'lab' | 'ps';
export interface RawCourse {
  code: string; name: string; credits?: number | null; ects?: number | null;
  days: string[] | null; hours: number[] | null; rooms?: string[] | null;
  instructor: string; sessionType?: SessionType; requiredFor?: string;
  scheduleWarning?: string; rawSchedule?: { days: string; hours: string; rooms: string };
}
export interface Course extends RawCourse { key: string; sessionType: SessionType; }
export interface PlanItem {
  key: string; courseKey: string; code: string; name: string;
  day: string; hour: number; room: string; instructor: string; sessionType: SessionType;
}
export const DAYS = ['M', 'T', 'W', 'Th', 'F', 'St', 'Su'];
export const DAY_LABELS: Record<string, string> = { M: 'Pzt', T: 'Sal', W: 'Çar', Th: 'Per', F: 'Cum', St: 'Cmt', Su: 'Paz' };
export const HOURS = Array.from({ length: 14 }, (_, i) => i + 9);
export const normalizeCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();
export const baseCode = (code: string) => normalizeCode(code).split('.')[0];
const sessionType = (key: string): SessionType => /\bLAB\b/i.test(key) ? 'lab' : /P\.S\./i.test(key) ? 'ps' : 'lecture';

export function buildCatalogue(raw: Record<string, RawCourse>): Course[] {
  const courses = new Map<string, Course>();
  for (const [rawKey, record] of Object.entries(raw)) {
    const type = record.sessionType || sessionType(rawKey);
    const key = type === 'lecture' ? normalizeCode(record.code) : rawKey;
    const existing = courses.get(key);
    if (existing) {
      existing.days = [...(existing.days || []), ...(record.days || [])];
      existing.hours = [...(existing.hours || []), ...(record.hours || [])];
      existing.rooms = [...(existing.rooms || []), ...(record.rooms || (record.days || []).map(() => ''))];
      if (record.scheduleWarning) existing.scheduleWarning = record.scheduleWarning;
      if (record.instructor && !existing.instructor.split(' / ').includes(record.instructor)) existing.instructor += ` / ${record.instructor}`;
    } else courses.set(key, { ...record, key, sessionType: type,
      days: [...(record.days || [])], hours: [...(record.hours || [])], rooms: [...(record.rooms || (record.days || []).map(() => ''))] });
  }
  return [...courses.values()];
}

export function courseSlots(course: Course): PlanItem[] {
  const seen = new Set<string>();
  return (course.days || []).flatMap((day, i) => {
    const slot = course.hours?.[i];
    if (!DAYS.includes(day) || !Number.isInteger(slot) || slot! < 1 || slot! > 14) return [];
    const key = `${course.key}:${day}:${slot}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ key, courseKey: course.key, code: course.code, name: course.name, day, hour: slot! + 8,
      room: course.rooms?.[i] || '', instructor: course.instructor, sessionType: course.sessionType }];
  });
}

export function relatedSessions(course: Course, catalogue: Course[]) {
  return catalogue.filter(c => c.sessionType !== 'lecture' && normalizeCode(c.code) === normalizeCode(course.code));
}
export function defaultBundle(course: Course, catalogue: Course[]) {
  if (course.sessionType !== 'lecture') return [course];
  const related = relatedSessions(course, catalogue);
  return [course, ...(['lab', 'ps'] as const).flatMap(type => {
    const choices = related.filter(c => c.sessionType === type);
    return choices.length === 1 ? choices : [];
  })];
}

export function toggleCourse(keys: string[], course: Course, catalogue: Course[]): string[] {
  const byKey = new Map(catalogue.map(c => [c.key, c]));
  const hasCourse = keys.includes(course.key);
  if (course.sessionType === 'lecture') {
    const kept = keys.filter(key => baseCode(byKey.get(key)?.code || key) !== baseCode(course.code));
    return hasCourse ? kept : [...kept, ...defaultBundle(course, catalogue).map(c => c.key)];
  }
  if (hasCourse) return keys.filter(key => key !== course.key);
  return [...keys, course.key];
}

export function conflictCount(candidates: Course[], selected: Course[]): number {
  const occupied = new Set(selected.flatMap(courseSlots).map(s => `${s.day}:${s.hour}`));
  const candidateMeetings = new Map<string, Set<string>>();
  for (const slot of candidates.flatMap(courseSlots)) {
    const key = `${slot.day}:${slot.hour}`;
    const sessions = candidateMeetings.get(key) || new Set<string>();
    sessions.add(slot.courseKey); candidateMeetings.set(key, sessions);
  }
  return [...candidateMeetings].filter(([key, sessions]) => occupied.has(key) || sessions.size > 1).length;
}
export function candidateConflicts(course: Course, catalogue: Course[], selected: Course[]) {
  // A new section replaces the existing section; its own old hours do not conflict.
  const others = selected.filter(c => course.sessionType === 'lecture'
    ? baseCode(c.code) !== baseCode(course.code)
    : c.key !== course.key);
  const candidates = course.sessionType === 'lecture' && selected.some(c => c.key === course.key)
    ? selected.filter(c => normalizeCode(c.code) === normalizeCode(course.code))
    : defaultBundle(course, catalogue);
  return conflictCount(candidates, others);
}
export function totalCredits(selected: Course[]) {
  const seen = new Set<string>();
  return selected.reduce((sum, c) => {
    const code = baseCode(c.code);
    if (c.sessionType !== 'lecture' || seen.has(code)) return sum;
    seen.add(code);
    return { local: sum.local + (c.credits ?? 0), ects: sum.ects + (c.ects ?? 0) };
  }, { local: 0, ects: 0 });
}
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** True when the term begins a word, so "mis" no longer matches "bioche(mis)try". */
const startsWord = (text: string, term: string) => {
  for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(text[i - 1])) return true;
  }
  return false;
};
/**
 * How well a course answers the query; 0 means no match.
 * The code outranks everything else, so typing a department code lists that department
 * instead of burying it under name matches.
 */
export function searchScore(course: Course, query: string): number {
  const term = fold(query.trim());
  if (!term) return 0;
  const code = fold(normalizeCode(course.code)), codeTerm = term.replace(/\s/g, '');
  if (code === codeTerm) return 100;
  if (code.startsWith(codeTerm)) return 90;
  if (code.includes(codeTerm)) return 70;
  if (startsWord(fold(course.name), term)) return 40;
  if (startsWord(fold(course.instructor), term)) return 30;
  return 0;
}
export const matchesSearch = (course: Course, query: string) => searchScore(course, query) > 0;
export function courseDescriptionUrl(code: string, semester: string) {
  const normalized = normalizeCode(code), dot = normalized.lastIndexOf('.');
  if (dot < 0) return null;
  const params = new URLSearchParams({ course: normalized.slice(0, dot), section: normalized.slice(dot + 1), term: semester });
  return `https://registration.bogazici.edu.tr/scripts/schedule/coursedescription.asp?${params}`;
}
export function readSelection(storage: Pick<Storage, 'getItem'>, key: string, catalogue: Course[]) {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(value)) return [];
    const allowed = new Set(catalogue.map(c => c.key));
    return [...new Set(value.filter((k): k is string => typeof k === 'string' && allowed.has(k)))];
  } catch { return []; }
}
