import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './CoursePlanner.css';
import SiteNav from './components/SiteNav';
import courseData from './data/allCourses.json';
import metadata from './data/courseMetadata.json';
import { buildCatalogue, courseSlots, DAYS, DAY_LABELS, HOURS, totalCredits,
  relatedSessions, candidateConflicts, toggleCourse, readSelection, courseDescriptionUrl, normalizeCode, searchScore } from './lib/planner';
import type { Course, RawCourse } from './lib/planner';
import { buildRegistrationPlan, planToText, planToJson, duplicateBaseCodes, consentTemplate, consentIssues, helperBookmarklet, CONSENT_MESSAGE_LIMIT } from './lib/registration';
import type { RegistrationEntry, RegistrationPlan, StudentProfile, StudentLevel } from './lib/registration';
import { displayName, formatUpdated, semesterLabel } from './lib/text';

const catalogue = buildCatalogue(courseData as Record<string, RawCourse>);
const storageKey = `boun-toolbox:planner:${metadata.semester}`;
const profileKey = 'boun-toolbox:registration-profile';
const consentKey = `boun-toolbox:consent:${metadata.semester}`;
const departmentNames = [...new Set(metadata.departments.map(d => d.name))].sort((a, b) => a.localeCompare(b));
function readJson<T>(key: string, valid: (value: unknown) => value is T, fallback: T): T {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) || 'null'); return valid(value) ? value : fallback; }
  catch { return fallback; }
}
const isProfile = (value: unknown): value is StudentProfile => !!value && typeof value === 'object' &&
  departmentNames.includes((value as StudentProfile).department) && ['UNDERGRADUATE', 'GRADUATE'].includes((value as StudentProfile).level);
const isMessages = (value: unknown): value is Record<string, string> => !!value && typeof value === 'object' && !Array.isArray(value) &&
  Object.values(value).every(message => typeof message === 'string');

/** Background and accent per course; LAB/P.S. share their lecture's colour and are drawn dashed. */
const palette = [['#e8f1fd', '#1d74d8'], ['#f1ebfd', '#7c4ddb'], ['#e7f6ec', '#1f9254'], ['#fff1df', '#d9822b'],
  ['#fdebef', '#d6456b'], ['#e2f5f6', '#138a94'], ['#fbf5da', '#a67f00'], ['#eceffd', '#4656c9']];
const colorFor = (code: string) => palette[[...normalizeCode(code)].reduce((s, c) => s + c.charCodeAt(0), 0) % palette.length];
const slotText = (course: Course) => courseSlots(course).map(s => `${DAY_LABELS[s.day]} ${s.hour}:00${s.room ? ` · ${s.room}` : ''}`).join('  /  ');
const missingTypes = (course: Course, keys: string[]) => {
  const related = relatedSessions(course, catalogue);
  return (['lab', 'ps'] as const).filter(type => related.some(s => s.sessionType === type) && !related.some(s => s.sessionType === type && keys.includes(s.key)));
};
const EXAMPLES = ['CMPE 150', 'MATH 101', 'EC 101', 'HTR'];
type Tab = 'search' | 'program' | 'selected';
interface Toast { text: string; action?: { label: string; run: () => void } }

export default function CoursePlanner() {
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => readSelection(localStorage, storageKey, catalogue));
  const [noConflict, setNoConflict] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [tab, setTab] = useState<Tab>(() => selectedKeys.length ? 'program' : 'search');
  const [toast, setToast] = useState<Toast | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const resultsScroll = useRef(0);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(selectedKeys)); }
    catch { setStorageError(true); }
  }, [selectedKeys]);
  useLayoutEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = resultsScroll.current;
  }, [selectedKeys]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.action ? 7000 : 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
      if (event.key === '/' && !typing && !showAssistant) { event.preventDefault(); setTab('search'); searchRef.current?.focus(); }
      if (event.key === 'Escape') setShowExportMenu(false);
    };
    const onClick = (event: MouseEvent) => { if (exportRef.current && !exportRef.current.contains(event.target as Node)) setShowExportMenu(false); };
    window.addEventListener('keydown', onKey); document.addEventListener('mousedown', onClick);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [showAssistant]);

  const selected = useMemo(() => catalogue.filter(c => selectedKeys.includes(c.key)), [selectedKeys]);
  const lectures = selected.filter(c => c.sessionType === 'lecture');
  const slots = useMemo(() => selected.flatMap(courseSlots), [selected]);
  const credits = totalCredits(selected);
  const registrationPlan = useMemo(() => buildRegistrationPlan(selected, catalogue, metadata.semester), [selected]);
  const missingCount = registrationPlan.entries.filter(entry => entry.missingSessions.length).length;
  const days = DAYS.filter(day => !['St', 'Su'].includes(day) || slots.some(s => s.day === day));
  // Evening rows only appear once something is scheduled there.
  const hours = HOURS.filter(hour => hour <= Math.max(17, ...slots.map(s => s.hour)));
  // Ordering depends only on the query: picking a course must not reshuffle the list under the cursor.
  const ordered = useMemo(() => catalogue
    .filter(c => c.sessionType === 'lecture' && search.trim())
    .map(course => ({ course, score: searchScore(course, search) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || a.course.code.localeCompare(b.course.code))
    .map(c => c.course), [search]);
  const filtered = useMemo(() => ordered
    .map(course => ({ course, conflicts: candidateConflicts(course, catalogue, selected) }))
    .filter(c => !noConflict || c.conflicts === 0), [ordered, noConflict, selected]);
  const cellCounts = new Map<string, number>();
  slots.forEach(s => { const key = `${s.day}:${s.hour}`; cellCounts.set(key, (cellCounts.get(key) || 0) + 1); });
  const conflicts = [...cellCounts.values()].filter(n => n > 1).length;

  const toggle = (course: Course) => {
    const adding = !selectedKeys.includes(course.key);
    setSelectedKeys(keys => toggleCourse(keys, course, catalogue));
    if (adding && course.sessionType === 'lecture') {
      setToast({ text: `${course.code} programa eklendi.`, action: window.matchMedia('(max-width: 900px)').matches ? { label: 'Programı gör', run: () => setTab('program') } : undefined });
    }
  };
  const remove = (course: Course) => setSelectedKeys(keys => course.sessionType === 'lecture'
    ? keys.filter(key => !catalogue.some(c => c.key === key && normalizeCode(c.code) === normalizeCode(course.code)))
    : keys.filter(key => key !== course.key));
  const clearAll = () => {
    const previous = selectedKeys;
    setSelectedKeys([]);
    setToast({ text: 'Program temizlendi.', action: { label: 'Geri al', run: () => setSelectedKeys(previous) } });
  };
  const showInSearch = (course: Course) => { setSearch(course.code); setTab('search'); };

  const exportCalendar = async (format: 'png' | 'pdf') => {
    if (!calendarRef.current || exporting) return;
    setShowExportMenu(false); setExporting(true); setMessage('');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(calendarRef.current, {
        backgroundColor: '#ffffff', scale: 2,
        onclone: doc => {
          const grid = doc.querySelector<HTMLElement>('.cp-grid');
          if (grid) { grid.style.height = 'auto'; grid.style.overflow = 'visible'; grid.style.minWidth = '860px'; }
        },
      });
      const filename = `ders-programi-${metadata.semester.replace('/', '-')}`;
      if (format === 'png') {
        const link = document.createElement('a'); link.download = `${filename}.png`;
        link.href = canvas.toDataURL('image/png'); link.click();
      } else {
        const { default: jsPDF } = await import('jspdf');
        const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height); pdf.save(`${filename}.pdf`);
      }
    } catch { setMessage('Program dışa aktarılamadı. Lütfen yeniden deneyin.'); }
    finally { setExporting(false); }
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'search', label: 'Ders ara' }, { id: 'program', label: 'Program' }, { id: 'selected', label: 'Seçilenler', count: lectures.length },
  ];

  return <div className="cp">
    <SiteNav />
    <header className="cp-toolbar">
      <div className="cp-toolbar-inner">
        <div className="cp-heading">
          <h1>Ders Programı</h1>
          <p>{semesterLabel(metadata.semester)} · {metadata.sectionCount.toLocaleString('tr-TR')} şube · {formatUpdated(metadata.fetchedAt)} güncellendi ·{' '}
            <a href={metadata.sourceUrl} target="_blank" rel="noreferrer">Resmî program ↗</a> ·{' '}
            <a href={metadata.hssUrl} target="_blank" rel="noreferrer">HSS-UNRE listesi ↗</a></p>
        </div>
        <div className="cp-stats" aria-live="polite">
          <span className="cp-stat"><strong>{lectures.length}</strong> ders</span>
          <span className="cp-stat"><strong>{credits.local}</strong> kredi</span>
          <span className="cp-stat"><strong>{credits.ects}</strong> AKTS</span>
          {conflicts > 0 && <span className="badge badge-danger">⚠️ {conflicts} saatte çakışma</span>}
          {missingCount > 0 && <span className="badge badge-warn">{missingCount} derste LAB/P.S. eksik</span>}
          {lectures.length > 0 && !conflicts && !missingCount && <span className="badge badge-ok">✓ Çakışma yok</span>}
        </div>
        <div className="cp-actions">
          <button className="btn btn-primary" disabled={!lectures.length} onClick={() => setShowAssistant(true)}>🎓 Kayıt Asistanı</button>
          <div className="cp-menu" ref={exportRef}>
            <button className="btn btn-secondary" aria-haspopup="menu" aria-expanded={showExportMenu} disabled={exporting || !selected.length}
              onClick={() => setShowExportMenu(open => !open)}>{exporting ? 'Hazırlanıyor…' : 'Dışa aktar ▾'}</button>
            {showExportMenu && <div className="cp-menu-list" role="menu">
              <button role="menuitem" onClick={() => void exportCalendar('png')}>PNG olarak kaydet</button>
              <button role="menuitem" onClick={() => void exportCalendar('pdf')}>PDF olarak kaydet</button>
            </div>}
          </div>
          <button className="btn btn-danger-quiet" disabled={!selected.length} onClick={clearAll}>Temizle</button>
        </div>
      </div>
    </header>

    {(storageError || message) && <div className="cp-notices">
      {storageError && <p role="status">Tarayıcı kaydına erişilemiyor. Programın bu sekme açıkken korunur.</p>}
      {message && <p role="alert">{message}</p>}
    </div>}

    <div className="cp-tabs" role="tablist" aria-label="Görünüm">
      {tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
        {item.label}{item.count !== undefined && <span className="cp-tab-count">{item.count}</span>}
      </button>)}
    </div>

    <div className="cp-layout" data-tab={tab}>
      <aside className="cp-search" aria-label="Ders ara">
        <div className="cp-search-box">
          <div className="cp-input-wrap">
            <span aria-hidden="true">🔍</span>
            <input ref={searchRef} aria-label="Ders ara" placeholder="Kod, ders adı veya öğretim üyesi" value={search}
              onChange={e => setSearch(e.target.value)} />
            {search && <button className="cp-clear" aria-label="Aramayı temizle" onClick={() => { setSearch(''); searchRef.current?.focus(); }}>×</button>}
            <kbd className="cp-kbd" aria-hidden="true">/</kbd>
          </div>
          <div className="cp-chips">
            <button className="cp-chip" onClick={() => setSearch('TK ')}>TK</button>
            <button className="cp-chip" onClick={() => setSearch('HTR')}>HTR</button>
            <label className={`cp-chip ${noConflict ? 'is-on' : ''}`}>
              <input type="checkbox" checked={noConflict} onChange={e => setNoConflict(e.target.checked)} /> Yalnızca çakışmayanlar
            </label>
          </div>
          {search.trim() && <p className="cp-count">{filtered.length ? `${filtered.length} sonuç${filtered.length > 100 ? ' · ilk 100 gösteriliyor' : ''}` : 'Sonuç yok'}</p>}
        </div>

        <div className="cp-results" ref={resultsRef} onScroll={e => { resultsScroll.current = e.currentTarget.scrollTop; }}>
          {filtered.slice(0, 100).map(({ course, conflicts: cardConflicts }) => {
            const added = selectedKeys.includes(course.key), related = relatedSessions(course, catalogue);
            const missing = added ? missingTypes(course, selectedKeys) : [];
            const [bg, accent] = colorFor(course.code);
            return <article key={course.key} className={`cp-card ${added ? 'is-added' : ''}`} style={added ? { borderLeftColor: accent, background: bg } : undefined}>
              <div className="cp-card-top">
                <div className="cp-card-title">
                  <span className="cp-code">{course.code}</span>
                  <span className="cp-name">{displayName(course.name)}</span>
                </div>
                <button className={`btn btn-sm ${added ? 'btn-secondary' : 'btn-primary'}`} aria-pressed={added} onClick={() => toggle(course)}
                  aria-label={`${course.code} ${added ? 'programdan kaldır' : 'programa ekle'}`}>{added ? 'Kaldır' : '+ Ekle'}</button>
              </div>
              <div className="cp-card-meta">
                <span>{course.instructor || 'Öğretim üyesi açıklanmamış'}</span>
                <span>{slotText(course) || 'Saat açıklanmamış'}</span>
              </div>
              <div className="cp-card-tags">
                {added && <span className="badge badge-ok">✓ Programda</span>}
                <span className="badge badge-info">{course.credits ?? '—'} kredi · {course.ects ?? '—'} AKTS</span>
                {cardConflicts > 0 && <span className="badge badge-danger">⚠️ {cardConflicts} saatte çakışma</span>}
                {course.scheduleWarning && <span className="badge badge-warn">Saat/derslik eksik, BUIS’ten doğrula</span>}
                {course.requiredFor && <span className="cp-dept">Bölüm: {course.requiredFor}</span>}
                <a className="cp-syllabus" href={courseDescriptionUrl(course.code, metadata.semester) || metadata.sourceUrl} target="_blank" rel="noreferrer">Ders tanımı ↗</a>
              </div>
              {related.length > 0 && <div className="cp-sessions">
                <div className="cp-sessions-head">
                  <strong>LAB / P.S.</strong>
                  {!added && <span>{related.length} oturum · eklediğinde seçebilirsin</span>}
                  {added && (missing.length ? <span className="badge badge-warn">{missing.map(m => m.toUpperCase()).join(' ve ')} seç</span> : <span className="badge badge-ok">Seçildi</span>)}
                </div>
                {added && related.map(session => {
                  const clash = candidateConflicts(session, catalogue, selected) > 0;
                  return <label key={session.key} className={`cp-session ${selectedKeys.includes(session.key) ? 'is-on' : ''}`}>
                    <input type="checkbox" checked={selectedKeys.includes(session.key)} onChange={() => toggle(session)} />
                    <span><strong>{session.sessionType.toUpperCase()}</strong> {slotText(session) || 'Saat açıklanmamış'}
                      {session.requiredFor && <em> · {session.requiredFor}</em>}
                      {session.scheduleWarning && <em> · BUIS’ten doğrula</em>}</span>
                    {clash && <span className="badge badge-danger">Çakışıyor</span>}
                  </label>;
                })}
              </div>}
            </article>;
          })}
          {!search.trim() && <div className="cp-empty">
            <p><strong>Ders aramaya başla.</strong> Kod, ders adı ya da öğretim üyesi yazabilirsin.</p>
            <div className="cp-chips">{EXAMPLES.map(example => <button key={example} className="cp-chip" onClick={() => setSearch(example)}>{example}</button>)}</div>
          </div>}
          {search.trim() && !filtered.length && <div className="cp-empty"><p>“{search.trim()}” için ders bulunamadı{noConflict ? ' (çakışanlar gizli)' : ''}.</p></div>}
        </div>
      </aside>

      <main className="cp-main">
        <section className="cp-panel cp-program" aria-label="Haftalık program">
          <div className="cp-panel-head">
            <h2>Haftalık program</h2>
            {conflicts > 0 && <span className="badge badge-danger">⚠️ {conflicts} saatte çakışma</span>}
          </div>
          <div className="cp-grid-scroll">
            <div className="cp-grid" ref={calendarRef} style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
              <div className="cp-grid-head" />{days.map(day => <div key={day} className="cp-grid-head">{DAY_LABELS[day]}</div>)}
              {hours.map(hour => <React.Fragment key={hour}>
                <div className="cp-grid-time">{hour}:00</div>
                {days.map(day => {
                  const items = slots.filter(s => s.day === day && s.hour === hour);
                  return <div key={`${day}-${hour}`} className={`cp-grid-cell ${items.length > 1 ? 'is-conflict' : ''}`}>
                    {items.map(s => {
                      const [bg, accent] = colorFor(s.code);
                      return <div key={s.key} className={`cp-block ${s.sessionType !== 'lecture' ? 'is-session' : ''}`} style={{ background: bg, borderColor: accent }}
                        title={`${s.code} ${displayName(s.name)}\n${s.instructor}\n${s.room}`}>
                        <strong>{s.code}</strong>
                        <span>{s.sessionType !== 'lecture' ? `${s.sessionType.toUpperCase()} · ` : ''}{s.room}</span>
                        <button className="cp-block-x" aria-label={`${s.code} ${s.sessionType} kaldır`} data-html2canvas-ignore
                          onClick={() => { const course = catalogue.find(c => c.key === s.courseKey); if (course) remove(course); }}>×</button>
                      </div>;
                    })}
                  </div>;
                })}
              </React.Fragment>)}
            </div>
          </div>
          {!selected.length && <p className="cp-grid-empty">Programın boş. <button className="cp-link" onClick={() => { setTab('search'); searchRef.current?.focus(); }}>Ders ara</button> ve ekle.</p>}
        </section>

        <section className="cp-panel cp-selected" aria-label="Seçilen dersler">
          <div className="cp-panel-head">
            <h2>Seçilen dersler <span className="cp-tab-count">{lectures.length}</span></h2>
            {lectures.length > 0 && <button className="btn btn-sm btn-primary" onClick={() => setShowAssistant(true)}>🎓 Kayıt Asistanı</button>}
          </div>
          {lectures.map(course => {
            const [bg, accent] = colorFor(course.code), missing = missingTypes(course, selectedKeys);
            const sessions = relatedSessions(course, catalogue).filter(s => selectedKeys.includes(s.key));
            return <div key={course.key} className="cp-row" style={{ borderLeftColor: accent, background: bg }}>
              <div className="cp-row-main">
                <button className="cp-link cp-code" onClick={() => showInSearch(course)} title="Aramada göster">{course.code}</button>
                <span className="cp-name">{displayName(course.name)}</span>
                <small>{slotText(course) || 'Saat açıklanmamış'}{sessions.map(s => `  ·  ${s.sessionType.toUpperCase()} ${slotText(s)}`).join('')}</small>
              </div>
              <div className="cp-row-side">
                <span className="cp-row-credit">{course.credits ?? '—'} kr</span>
                {missing.length > 0 && <button className="badge badge-warn cp-badge-btn" onClick={() => showInSearch(course)}>{missing.map(m => m.toUpperCase()).join('/')} seç</button>}
                <button className="btn btn-sm btn-danger-quiet" onClick={() => remove(course)} aria-label={`${course.code} dersini kaldır`}>Kaldır</button>
              </div>
            </div>;
          })}
          {!lectures.length && <p className="cp-muted">Henüz ders eklemedin.</p>}
        </section>
      </main>
    </div>

    {lectures.length > 0 && <div className="cp-mobile-bar">
      <span><strong>{lectures.length}</strong> ders · <strong>{credits.local}</strong> kredi{conflicts > 0 ? ' · ⚠️' : ''}</span>
      <button className="btn btn-primary" onClick={() => setShowAssistant(true)}>🎓 Kayıt Asistanı</button>
    </div>}

    {toast && <div className="cp-toast" role="status">
      <span>{toast.text}</span>
      {toast.action && <button onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}
    </div>}

    {showAssistant && <RegistrationAssistant plan={registrationPlan} onClose={() => setShowAssistant(false)} />}
  </div>;
}

/** React refuses javascript: URLs in JSX, so the draggable bookmark receives its href after mount. */
function HelperBookmark({ code }: { code: string }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => { link.current?.setAttribute('href', code); }, [code]);
  return <a ref={link} className="ra-bookmark" title="Yer imleri çubuğuna sürükle" onClick={e => e.preventDefault()}>🎓 BUIS Yardımcısı</a>;
}

function RegistrationAssistant({ plan, onClose }: { plan: RegistrationPlan; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const [manualCopy, setManualCopy] = useState<{ label: string; value: string } | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const [method, setMethod] = useState<'bookmark' | 'userscript'>('bookmark');
  const [profile, setProfile] = useState<StudentProfile | null>(() => readJson(profileKey, isProfile, null));
  const [messages, setMessages] = useState<Record<string, string>>(() => readJson(consentKey, isMessages, {}));
  const closeRef = useRef<HTMLButtonElement>(null);
  // The parent passes a new closure on every render; keep it out of the mount effect so focus does not jump.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    try { if (profile) localStorage.setItem(profileKey, JSON.stringify(profile)); else localStorage.removeItem(profileKey); } catch { /* özel mod */ }
  }, [profile]);
  useEffect(() => {
    try { localStorage.setItem(consentKey, JSON.stringify(messages)); } catch { /* özel mod */ }
  }, [messages]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(''), 4000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const text = planToText(plan);
  const json = planToJson(plan, { messages, student: profile });
  const duplicates = duplicateBaseCodes(plan);
  const issues = consentIssues(plan, messages);
  const helperUrl = `${import.meta.env.BASE_URL}buis-kayit-yardimcisi.user.js`;
  const bookmarklet = helperBookmarklet(new URL(helperUrl, window.location.href).href);
  const consentCount = plan.entries.filter(entry => Object.hasOwn(messages, entry.display)).length;
  const warnings = [...duplicates.map(code => `Aynı dersin birden fazla şubesi seçili: ${code}`), ...plan.warnings, ...issues];
  const setDepartment = (department: string) => setProfile(department ? { department, level: profile?.level || 'UNDERGRADUATE' } : null);
  const setLevel = (level: StudentLevel) => setProfile(profile && { ...profile, level });
  const toggleConsent = (entry: RegistrationEntry) => setMessages(current => {
    const next = { ...current };
    if (Object.hasOwn(next, entry.display)) delete next[entry.display];
    else next[entry.display] = consentTemplate(entry, profile);
    return next;
  });

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); setManualCopy(null); }
    catch { setManualCopy({ label, value }); } // clipboard blocked (in-app browsers, some phones): show the text instead
  };
  useEffect(() => { manualRef.current?.select(); }, [manualCopy]);
  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `kayit-plani-${plan.semester.replace('/', '-')}.json`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  return <div className="ra-backdrop" onMouseDown={onClose}>
    <div className="ra-panel" role="dialog" aria-modal="true" aria-labelledby="ra-title" onMouseDown={e => e.stopPropagation()}>
      <header className="ra-head">
        <div>
          <h2 id="ra-title">🎓 Kayıt Asistanı</h2>
          <p>{semesterLabel(plan.semester)} · {plan.entries.length} ders · BUIS Quick Add için plan</p>
        </div>
        <button ref={closeRef} className="ra-close" onClick={onClose} aria-label="Kapat">×</button>
      </header>

      {!plan.entries.length && <p className="ra-body cp-muted">Henüz ders seçmedin. Programını oluşturduktan sonra buraya dön.</p>}

      {plan.entries.length > 0 && <div className="ra-body">
        <section className="ra-step">
          <h3><span className="ra-no">1</span> Planını kontrol et</h3>
          <div className="ra-profile">
            <label>Bölümün
              <select value={profile?.department || ''} onChange={e => setDepartment(e.target.value)}>
                <option value="">Seçilmedi</option>
                {departmentNames.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label>Düzey
              <select value={profile?.level || 'UNDERGRADUATE'} disabled={!profile} onChange={e => setLevel(e.target.value as StudentLevel)}>
                <option value="UNDERGRADUATE">Lisans</option>
                <option value="GRADUATE">Lisansüstü</option>
              </select>
            </label>
          </div>
          <p className="ra-note">Bölümünü seçersen BUIS’teki yardımcı her ders için “consent gerekiyor / boş yer var / dolu” der.</p>

          <ul className="ra-list">{plan.entries.map(entry => {
            const marked = Object.hasOwn(messages, entry.display);
            return <li key={entry.display} className={marked ? 'is-open' : ''}>
              <div className="ra-entry">
                <div className="ra-entry-main">
                  <span className="cp-code">{entry.display}</span>
                  <span className="cp-name">{displayName(entry.name)}</span>
                  {(entry.sessions.length > 0 || entry.missingSessions.length > 0) && <small>
                    {entry.sessions.join(' · ')}
                    {entry.missingSessions.length > 0 && <span className="badge badge-warn">{entry.missingSessions.join('/')} seçilmedi</span>}
                  </small>}
                </div>
                <button type="button" className={`btn btn-sm ${marked ? 'btn-quiet' : 'btn-secondary'}`} aria-expanded={marked} onClick={() => toggleConsent(entry)}>
                  {marked ? 'Consent mesajını kaldır' : '✉️ Consent mesajı'}
                </button>
              </div>
              {marked && <textarea className="ra-consent" rows={6} maxLength={CONSENT_MESSAGE_LIMIT} value={messages[entry.display]}
                aria-label={`${entry.display} consent mesajı`} onChange={e => setMessages(current => ({ ...current, [entry.display]: e.target.value }))} />}
            </li>;
          })}</ul>
          {consentCount > 0 && <p className="ra-note">Şablonu kendine göre düzenle: neden bu dersi istediğini ve adını ekle. Kısa “consent pls” yerine düzgün bir istek yazman tavsiye ediliyor.</p>}
          {warnings.map(warning => <p key={warning} className="ra-warn">⚠️ {warning}</p>)}
        </section>

        <section className="ra-step">
          <h3><span className="ra-no">2</span> Planı kopyala</h3>
          <div className="ra-copy">
            <button className="btn btn-primary btn-lg" onClick={() => void copy(json, 'Plan kopyalandı. BUIS’teki yardımcı paneline yapıştır.')}>📋 Planı kopyala</button>
            <button className="btn btn-secondary" onClick={() => void copy(text, 'Ders listesi kopyalandı.')}>Düz liste</button>
            <button className="btn btn-secondary" onClick={download}>JSON indir</button>
          </div>
          <p className="ra-note">Plan {[`${plan.entries.length} dersi`, profile && 'bölümünü', consentCount > 0 && `${consentCount} consent mesajını`, 'dönemi'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' ve $1')} taşır.</p>
          {manualCopy && <div className="ra-manual">
            <p>Tarayıcı panoya erişime izin vermedi. Metin seçili; <kbd>Ctrl/Cmd</kbd>+<kbd>C</kbd> ile kopyala.</p>
            <textarea ref={manualRef} readOnly rows={5} value={manualCopy.value} aria-label="Kopyalanacak metin" onFocus={e => e.currentTarget.select()} />
            <button className="btn btn-sm btn-quiet" onClick={() => setManualCopy(null)}>Kapat</button>
          </div>}
        </section>

        <section className="ra-step">
          <h3><span className="ra-no">3</span> BUIS’te yardımcıyı aç</h3>
          <div className="ra-seg" role="tablist" aria-label="Kurulum yolu">
            <button role="tab" aria-selected={method === 'bookmark'} className={method === 'bookmark' ? 'is-active' : ''} onClick={() => setMethod('bookmark')}>Yer imi · eklentisiz</button>
            <button role="tab" aria-selected={method === 'userscript'} className={method === 'userscript' ? 'is-active' : ''} onClick={() => setMethod('userscript')}>Tampermonkey</button>
          </div>
          {method === 'bookmark' ? <div className="ra-method">
            <ol>
              <li>Bu düğmeyi yer imleri çubuğuna <strong>sürükle</strong> (çubuk gizliyse Ctrl/Cmd+Shift+B):
                <div className="ra-bookmark-row"><HelperBookmark code={bookmarklet} />
                  <button className="btn btn-sm btn-quiet" onClick={() => void copy(bookmarklet, 'Yer imi kodu kopyalandı. Yeni yer imi ekleyip adres alanına yapıştır.')}>Sürükleyemiyorum, kodu kopyala</button></div>
              </li>
              <li>BUIS’te ekran açıkken yer imine bas; sağ üstte panel açılır.</li>
              <li>Quick Add turlarında yardımcı kendini yeniden yükler; başka bir sayfaya geçersen yer imine yeniden bas. Planın saklı kalır.</li>
            </ol>
            <p className="ra-note">Yer imi bilgisayardaki Chrome, Edge, Firefox ve Safari içindir; kaydı telefondan değil bilgisayardan yapman daha rahat olur.</p>
          </div> : <div className="ra-method">
            <ol>
              <li>Tarayıcına Tampermonkey veya Violentmonkey eklentisini kur.</li>
              <li><a href={helperUrl} target="_blank" rel="noreferrer">Kayıt yardımcısı script’ini</a> aç ve “Yükle”ye bas (1.4.0, kendini günceller).</li>
              <li>Chrome’da panel çıkmazsa eklentinin ayrıntılarından “Kullanıcı komut dosyalarına izin ver”i aç.</li>
            </ol>
          </div>}
        </section>

        <section className="ra-step">
          <h3><span className="ra-no">4</span> Kayıt günü</h3>
          <ol className="ra-day">
            <li><strong>Hemen şimdi:</strong> panele planı yapıştır. Kayıt açılmadan, giriş sayfasında da olur. <em>Kontenjan kontrol</em> consent ve boş yeri gösterir.</li>
            <li><strong>Kayıt açılınca:</strong> Course List Preparation’da <em>Formu doldur</em>, sonra BUIS’in <em>Quick Add</em> düğmesi. Form 8 ders almıyorsa kalanlar sayfa yenilenince <em>kendiliğinden</em> eklenir; her ders en fazla bir kez gönderilir, BUIS hata yazarsa durur.</li>
            <li><strong>Consent:</strong> Consent Requests ekranında panelden dersin düğmesine bas; ders seçilir, mesajın yazılır, <em>göndermeyi sen yaparsın</em>. Onay 24 saat geçerli.</li>
            <li><strong>Son:</strong> sonucu BUIS’ten kontrol et, danışman onayı için <em>Send to Approval</em>.</li>
          </ol>
          <p className="ra-note">
            <a href={`${import.meta.env.BASE_URL}buis-helper-demo.html`} target="_blank" rel="noreferrer">8 dersi eklemeyi dene ↗</a> ·{' '}
            <a href={`${import.meta.env.BASE_URL}buis-consent-demo.html`} target="_blank" rel="noreferrer">Consent’i dene ↗</a> ·
            Yardımcı canlı BUIS formunda henüz denenmedi; tanımazsa panelden “Form raporu” al. Şifre toplamaz, istek yalnız kendi BUIS oturumundan gider.
          </p>
        </section>
      </div>}

      {copied && <div className="ra-toast" role="status">{copied}</div>}
    </div>
  </div>;
}
