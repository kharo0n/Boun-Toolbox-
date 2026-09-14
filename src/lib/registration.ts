import { baseCode, courseSlots, normalizeCode, relatedSessions, DAY_LABELS } from './planner';
import type { Course } from './planner';

/** A lecture section as BUIS Quick Add wants it: abbreviation, number, section. */
export interface RegistrationEntry {
  abbr: string;
  code: string;
  section: string;
  display: string;
  name: string;
  credits: number | null;
  ects: number | null;
  /** LAB / P.S. sessions the plan picked for this lecture. */
  sessions: string[];
  /** Session types that still need a choice before registration. */
  missingSessions: string[];
}

export interface RegistrationPlan {
  semester: string;
  entries: RegistrationEntry[];
  warnings: string[];
}

const CODE_PATTERN = /^([A-Z]{1,6})\s*(\d{2,3}[A-Z]?)\.(\d{1,2})$/;

/** Splits `CMPE 150.01` into the three fields the Quick Add form asks for. */
export function parseCourseCode(code: string) {
  const match = CODE_PATTERN.exec(normalizeCode(code));
  if (!match || Number(match[3]) === 0) return null;
  const [, abbr, number, section] = match;
  return { abbr, code: number, section: section.padStart(2, '0') };
}

const sessionLabel = (course: Course) => {
  const slots = courseSlots(course);
  const when = slots.map(s => `${DAY_LABELS[s.day]} ${s.hour}:00`).join(' ');
  return `${course.sessionType.toUpperCase()}${when ? ` · ${when}` : ''}`;
};

/**
 * Turns the planner selection into the list of sections to register.
 * Export lecture codes; LAB/P.S. selections are planning context. Their actual
 * registration/assignment rules must be verified in BUIS for each department.
 */
export function buildRegistrationPlan(selected: Course[], catalogue: Course[], semester: string): RegistrationPlan {
  const lectures = selected.filter(c => c.sessionType === 'lecture');
  const warnings: string[] = [];
  const entries: RegistrationEntry[] = [];
  const seen = new Set<string>();

  for (const lecture of lectures) {
    const parts = parseCourseCode(lecture.code);
    if (!parts) {
      warnings.push(`${lecture.code} kod biçimi tanınmadı; bu dersi BUIS'te elle ekleyin.`);
      continue;
    }
    const dedupe = `${parts.abbr}${parts.code}.${parts.section}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const related = relatedSessions(lecture, catalogue);
    const chosen = related.filter(s => selected.some(c => c.key === s.key));
    const missing = (['lab', 'ps'] as const).filter(type =>
      related.some(s => s.sessionType === type) && !chosen.some(s => s.sessionType === type));
    if (missing.length) {
      warnings.push(`${lecture.code} için ${missing.map(m => m.toUpperCase()).join(' ve ')} oturumu seçilmedi.`);
    }
    entries.push({
      ...parts,
      display: `${parts.abbr} ${parts.code}.${parts.section}`,
      name: lecture.name,
      credits: lecture.credits ?? null,
      ects: lecture.ects ?? null,
      sessions: chosen.map(sessionLabel),
      missingSessions: missing.map(m => m.toUpperCase()),
    });
  }

  entries.sort((a, b) => a.display.localeCompare(b.display));
  const withoutHours = lectures.filter(c => !courseSlots(c).length);
  if (withoutHours.length) {
    warnings.push(`${withoutHours.map(c => c.code).join(', ')} için saat açıklanmamış; BUIS'ten doğrulayın.`);
  }
  return { semester, entries, warnings };
}

/** One `CMPE 150.01` per line — the format to paste into BUIS or keep as a note. */
export function planToText(plan: RegistrationPlan) {
  return plan.entries.map(e => e.display).join('\n');
}

/** The payload the BUIS helper script reads. Messages are keyed by `display` and only sent when non-empty. */
export function planToJson(plan: RegistrationPlan, options: { messages?: Record<string, string>; student?: StudentProfile | null } = {}) {
  const messages = options.messages || {};
  return JSON.stringify({
    source: 'boun-toolbox',
    version: 1,
    semester: plan.semester,
    ...(options.student?.department ? { student: options.student } : {}),
    courses: plan.entries.map(({ abbr, code, section, display, name }) => {
      const message = Object.hasOwn(messages, display) ? messages[display].trim().slice(0, CONSENT_MESSAGE_LIMIT) : '';
      return { abbr, code, section, display, name, ...(message ? { message } : {}) };
    }),
  }, null, 2);
}

/** Groups the plan by department so a long list is easier to check by eye. */
export function planByDepartment(plan: RegistrationPlan) {
  const groups = new Map<string, RegistrationEntry[]>();
  for (const entry of plan.entries) {
    groups.set(entry.abbr, [...(groups.get(entry.abbr) || []), entry]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Guards against registering two sections of the same course. */
export function duplicateBaseCodes(plan: RegistrationPlan) {
  const counts = new Map<string, number>();
  for (const entry of plan.entries) {
    const key = baseCode(`${entry.abbr}${entry.code}`);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].filter(([, n]) => n > 1).map(([code]) => code);
}

export type StudentLevel = 'UNDERGRADUATE' | 'GRADUATE';
/** The helper reads a course's quota table with this: own department row first, then ALL. */
export interface StudentProfile { department: string; level: StudentLevel }
/** BUIS accepts consent requests for at most this many courses per registration period. */
export const CONSENT_COURSE_LIMIT = 10;
export const CONSENT_MESSAGE_LIMIT = 2000;

const SMALL_WORDS = new Set(['AND', 'OF', 'FOR', 'IN', 'TO', 'THE', 'WITH', '&']);
/** COMPUTER ENGINEERING → Computer Engineering; keeps roman numerals such as II. */
export function titleCase(text: string) {
  return text.replace(/\s*&\s*/g, ' & ').trim().split(/\s+/).map((word, i) => {
    if (/^[IVX]+$/.test(word)) return word;
    if (i > 0 && SMALL_WORDS.has(word.toUpperCase())) return word.toLowerCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

export function consentTemplate(entry: RegistrationEntry, student?: StudentProfile | null) {
  const course = entry.name ? `${entry.display} (${titleCase(entry.name)})` : entry.display;
  const who = student?.department
    ? ` I am ${student.level === 'GRADUATE' ? 'a graduate' : 'an undergraduate'} student in ${titleCase(student.department)}.`
    : '';
  return `Dear Professor,\n\nI would like to take ${course} this semester and kindly request your consent.${who}\n\nThank you for your consideration.\nBest regards,`;
}

/** Problems that would make BUIS refuse, or the helper skip, a consent request. */
export function consentIssues(plan: RegistrationPlan, messages: Record<string, string>) {
  const marked = plan.entries.filter(entry => Object.hasOwn(messages, entry.display));
  const issues: string[] = [];
  if (marked.length > CONSENT_COURSE_LIMIT) {
    issues.push(`BUIS en fazla ${CONSENT_COURSE_LIMIT} derse consent isteği kabul ediyor; ${marked.length} ders işaretli.`);
  }
  for (const entry of marked) {
    const text = messages[entry.display].trim();
    if (!text) issues.push(`${entry.display} için consent mesajı boş.`);
    else if (text.length > CONSENT_MESSAGE_LIMIT) issues.push(`${entry.display} consent mesajı ${CONSENT_MESSAGE_LIMIT} karakteri aşıyor.`);
  }
  return issues;
}

/**
 * A bookmark that opens the BUIS helper without a userscript manager. Course List Preparation lives in
 * the same-origin `#ifCPL` frame, so the script is added there when it exists. BUIS sends no script-src CSP.
 */
export function helperBookmarklet(scriptUrl: string) {
  const source = `(function(){var u=${JSON.stringify(scriptUrl)}+'?b='+Date.now();` +
    `var f=document.getElementById('ifCPL'),d=null;try{d=f&&f.contentDocument}catch(e){}` +
    `var t=d&&d.body?d:document,w=t.defaultView;` +
    `if(w.__bounToolboxHelper){w.__bounToolboxHelper.open();return}` +
    `var s=t.createElement('script');s.src=u;t.body.appendChild(s)})()`;
  return `javascript:${source}`;
}
