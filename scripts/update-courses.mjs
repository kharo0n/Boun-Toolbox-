import { load } from 'cheerio';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const ORIGIN = 'https://registration.bogazici.edu.tr';
export const SCHEDULE_URL = `${ORIGIN}/BUIS/General/schedule.aspx?p=semester`;
const clean = text => text.replace(/\s+/g, ' ').trim();

export function parseDays(text) {
  const compact = text.replace(/\s/g, '');
  const days = compact.match(/Th|St|Su|M|T|W|F/g) || [];
  if (days.join('') !== compact) throw new Error(`Unknown days: ${text}`);
  return days;
}

export function parseHours(text, days) {
  const compact = text.replace(/\s/g, '');
  if (!compact && !days.length) return [];
  // BUIS uses A..E for slots 10..14, and some tables use separated numbers.
  if (/[,;/\s]/.test(text.trim())) {
    const parts = text.trim().split(/[,;/\s]+/).map(Number);
    if (parts.length === days.length && parts.every(n => Number.isInteger(n) && n >= 1 && n <= 14)) return parts;
  }
  if (compact.length === days.length && /^[1-9A-E]+$/i.test(compact)) {
    return [...compact.toUpperCase()].map(c => /[A-E]/.test(c) ? c.charCodeAt(0) - 55 : Number(c));
  }
  // Do not guess ambiguous concatenated multi-digit slots.
  const solutions = [];
  function visit(offset, slots) {
    if (slots.length === days.length) {
      if (offset === compact.length) solutions.push(slots);
      return;
    }
    for (const width of [1, 2]) {
      const token = compact.slice(offset, offset + width);
      if (token.length !== width || !/^[1-9]\d?$/.test(token)) continue;
      const n = Number(token);
      if (n > 14) continue;
      visit(offset + width, [...slots, n]);
    }
  }
  visit(0, []);
  if (solutions.length !== 1) throw new Error(`Ambiguous/invalid hours: ${text} for ${days.length} days`);
  return solutions[0];
}

export function parseDepartments(html, semester) {
  const $ = load(html);
  if (!$.text().includes(semester)) throw new Error('Department semester mismatch');
  const links = new Map();
  $('a[href]').each((_, el) => {
    const url = new URL($(el).attr('href'), ORIGIN);
    if (url.origin !== ORIGIN || url.pathname !== '/scripts/sch.asp') return;
    if (url.searchParams.get('donem') !== semester) throw new Error('Department link semester mismatch');
    links.set(url.href, { name: clean($(el).text()), url: url.href });
  });
  if (!links.size) throw new Error('No department links; source may have changed');
  return [...links.values()];
}

export function parseDepartment(html, semester) {
  const $ = load(html);
  if (!$.text().includes(semester)) throw new Error('Course table semester mismatch');
  const header = $('tr.schtitle').first();
  const names = header.children('td,th').map((_, el) => clean($(el).text())).get();
  const required = ['Code.Sec', 'Name', 'Cr.', 'Ects', 'Instr.', 'Days', 'Hours', 'Rooms'];
  if (required.some(n => !names.includes(n))) throw new Error('Unrecognized course table headers');
  const records = [];
  let parent = null;
  header.closest('table').find('tr').each((_, tr) => {
    if (!$(tr).is('.schtd,.schtd2')) return;
    const cells = $(tr).children('td');
    if (cells.length !== names.length) throw new Error('Unexpected course row width');
    const cell = name => cells.eq(names.indexOf(name));
    const value = name => clean(cell(name).text());
    const code = value('Code.Sec').replace(/\s/g, '');
    const isAux = $(tr).hasClass('labps');
    if (!isAux && !code) throw new Error('Missing lecture code');
    if (code) parent = code;
    if (!parent) throw new Error('Session without parent');
    const sessionName = value('Name');
    if (isAux && !/^(LAB|P\.?S\.?)$/i.test(sessionName)) throw new Error(`Unknown session: ${sessionName}`);
    const credits = value('Cr.');
    const ects = value('Ects');
    const number = v => v === '' ? null : Number(v.replace(',', '.'));
    const record = {
      code: parent.replace(/^([A-Z$]+)(\d)/, '$1 $2'),
      name: sessionName,
      credits: isAux ? null : number(credits),
      ects: isAux ? null : number(ects),
      instructor: value('Instr.'),
      sessionType: isAux ? (/LAB/i.test(sessionName) ? 'lab' : 'ps') : 'lecture',
      days: [], hours: [], rooms: [],
      requiredFor: names.includes('Required for Dept.(*)') ? value('Required for Dept.(*)') : '',
    };
    if ([record.credits, record.ects].some(n => n !== null && (!Number.isFinite(n) || n < 0))) throw new Error(`Invalid credits: ${parent}`);
    const rawDays = value('Days'), rawHours = value('Hours'), rawRooms = value('Rooms');
    try {
      record.days = parseDays(rawDays);
      record.hours = parseHours(rawHours, record.days);
      record.rooms = rawRooms ? rawRooms.split('|').map(clean) : record.days.map(() => '');
      if (record.rooms.length !== record.days.length) {
        record.scheduleWarning = `Room/day mismatch: ${rawRooms}`;
        record.rawSchedule = { days: rawDays, hours: rawHours, rooms: rawRooms };
        record.rooms = record.days.map(() => '');
      }
    } catch (error) {
      record.days = []; record.hours = []; record.rooms = [];
      record.scheduleWarning = error.message;
      record.rawSchedule = { days: rawDays, hours: rawHours, rooms: rawRooms };
    }
    records.push(record);
  });
  return records;
}

export function assembleCourses(records) {
  const courses = {}, seen = new Set(), counts = {};
  for (const record of records) {
    const signature = JSON.stringify(record);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const base = record.code.replace(/\s/g, '');
    const suffix = record.sessionType === 'lecture' ? '' : record.sessionType === 'lab' ? ' LAB' : ' P.S.';
    const group = base + suffix;
    counts[group] = (counts[group] || 0) + 1;
    const key = suffix || counts[group] > 1 ? `${group} ${counts[group]}` : group;
    courses[key] = record;
  }
  return Object.fromEntries(Object.entries(courses).sort(([a], [b]) => a.localeCompare(b)));
}

async function fetchHtml(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const type = response.headers.get('content-type') || '';
      const head = new TextDecoder().decode(bytes.slice(0, 1500));
      const encoding = /utf-8/i.test(type + head) ? 'utf-8' : 'windows-1254';
      return new TextDecoder(encoding).decode(bytes);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function updateCourses({ semester, outputDir = new URL('../src/data/', import.meta.url) } = {}) {
  const schedule = load(await fetchHtml(SCHEDULE_URL));
  const offered = schedule('select[id$="ddlSemester"] option').map((_, el) => schedule(el).attr('value')).get();
  semester ||= offered[0];
  if (!/^\d{4}\/\d{4}-[123]$/.test(semester || '') || !offered.includes(semester)) throw new Error('Semester not offered by BUIS');
  const departments = parseDepartments(await fetchHtml(`${ORIGIN}/scripts/schdepsel.asp`, {
    method: 'POST', body: new URLSearchParams({ semester }),
  }), semester);
  const records = [], coverage = [];
  for (const department of departments) {
    const rows = parseDepartment(await fetchHtml(department.url), semester);
    records.push(...rows);
    coverage.push({ ...department, rowCount: rows.length });
    console.log(`${department.name}: ${rows.length}`);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  const courses = assembleCourses(records);
  if (Object.keys(courses).length < 100) throw new Error('Unexpectedly small catalogue; existing data preserved');
  const directory = typeof outputDir === 'string' ? pathToFileURL(`${outputDir.replace(/\/$/, '')}/`) : outputDir;
  const dataPath = new URL('allCourses.json', directory);
  const metadataPath = new URL('courseMetadata.json', directory);
  try {
    const previousMeta = JSON.parse(await readFile(metadataPath, 'utf8'));
    if (previousMeta.semester === semester && Object.keys(courses).length < previousMeta.recordCount * 0.8) {
      throw new Error('Catalogue shrank by over 20%; existing data preserved');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const login = load(await fetchHtml(`${ORIGIN}/buis/Login.aspx`));
  const hssLink = login('a[href]').toArray().find(el => /HSS.*COURSE LIST/i.test(login(el).text()));
  const metadata = {
    semester, fetchedAt: new Date().toISOString(), sourceUrl: SCHEDULE_URL,
    recordCount: Object.keys(courses).length,
    sectionCount: new Set(records.filter(r => r.sessionType === 'lecture').map(r => r.code)).size,
    departmentCount: departments.length,
    scheduleWarningCount: Object.values(courses).filter(r => r.scheduleWarning).length,
    hssUrl: semester === offered[0] && hssLink ? new URL(login(hssLink).attr('href'), ORIGIN).href : `${ORIGIN}/buis/Login.aspx`,
    departments: coverage,
  };
  // Finish and validate every department before replacing either checked-in file.
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('allCourses.json.tmp', directory), JSON.stringify(courses, null, 2) + '\n');
  await writeFile(new URL('courseMetadata.json.tmp', directory), JSON.stringify(metadata, null, 2) + '\n');
  await rename(new URL('allCourses.json.tmp', directory), dataPath);
  await rename(new URL('courseMetadata.json.tmp', directory), metadataPath);
  console.log(JSON.stringify({ ...metadata, departments: undefined }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length && (args[0] !== '--semester' || args.length !== 2)) throw new Error('Usage: npm run update:courses -- [--semester 2026/2027-1]');
  await updateCourses({ semester: args[1] });
}
