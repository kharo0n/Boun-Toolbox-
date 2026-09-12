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
  if (!match) return null;
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
 * Only lectures are registered; LAB/P.S. rows ride along with their lecture,
 * so they are reported as context rather than as separate entries.
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

/** The payload the BUIS helper script reads. */
export function planToJson(plan: RegistrationPlan) {
  return JSON.stringify({
    source: 'boun-toolbox',
    version: 1,
    semester: plan.semester,
    courses: plan.entries.map(({ abbr, code, section, display, name }) => ({ abbr, code, section, display, name })),
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
