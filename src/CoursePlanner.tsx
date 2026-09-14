import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './CoursePlanner.css';
import courseData from './data/allCourses.json';
import metadata from './data/courseMetadata.json';
import { buildCatalogue, courseSlots, DAYS, DAY_LABELS, HOURS, totalCredits,
  relatedSessions, candidateConflicts, toggleCourse, readSelection, courseDescriptionUrl, normalizeCode, searchScore } from './lib/planner';
import type { Course, RawCourse } from './lib/planner';
import { buildRegistrationPlan, planToText, planToJson, duplicateBaseCodes } from './lib/registration';
import type { RegistrationPlan } from './lib/registration';

const catalogue = buildCatalogue(courseData as Record<string, RawCourse>);
const storageKey = `boun-toolbox:planner:${metadata.semester}`;
const colors = ['#e3f2fd', '#f3e5f5', '#e8f5e9', '#fff3e0', '#ffebee', '#e0f7fa', '#fff8e1', '#fce4ec'];
const colorFor = (course: { code: string; sessionType: string }) => course.sessionType === 'lab' ? '#ffcdd2' :
  course.sessionType === 'ps' ? '#c8e6c9' : colors[[...course.code].reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length];
const scheduleText = (course: Course) => courseSlots(course).map(s => `${DAY_LABELS[s.day]} ${s.hour}:00${s.room ? ` (${s.room})` : ''}`).join(' / ');

export default function CoursePlanner() {
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>(() => readSelection(localStorage, storageKey, catalogue));
  const [noConflict, setNoConflict] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const resultsScroll = useRef(0);
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(selectedKeys)); }
    catch { setStorageError(true); }
  }, [selectedKeys]);
  useLayoutEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = resultsScroll.current;
  }, [selectedKeys]);
  const selected = useMemo(() => catalogue.filter(c => selectedKeys.includes(c.key)), [selectedKeys]);
  const slots = useMemo(() => selected.flatMap(courseSlots), [selected]);
  const credits = totalCredits(selected);
  const registrationPlan = useMemo(() => buildRegistrationPlan(selected, catalogue, metadata.semester), [selected]);
  const days = DAYS.filter(day => !['St', 'Su'].includes(day) || slots.some(s => s.day === day));
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
  const toggle = (course: Course) => setSelectedKeys(keys => toggleCourse(keys, course, catalogue));
  const remove = (course: Course) => setSelectedKeys(keys => course.sessionType === 'lecture'
    ? keys.filter(key => !catalogue.some(c => c.key === key && normalizeCode(c.code) === normalizeCode(course.code)))
    : keys.filter(key => key !== course.key));

  const exportCalendar = async (format: 'png' | 'pdf') => {
    if (!calendarRef.current || exporting) return;
    setShowExportMenu(false); setExporting(true); setMessage('');
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(calendarRef.current, {
        backgroundColor: '#ffffff', scale: 2,
        onclone: doc => {
          const grid = doc.querySelector<HTMLElement>('.calendar-grid');
          if (grid) { grid.style.height = 'auto'; grid.style.overflow = 'visible'; grid.style.flex = 'none'; }
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

  return <div className="planner-container">
    <header className="planner-header"><div className="header-left">
      <Link to="/" className="back-btn">← Ana Menü</Link><h1>📅 Course Planner</h1>
    </div><div className="data-status"><strong>{metadata.semester} · {metadata.semester.endsWith('-1') ? 'Güz' : metadata.semester.endsWith('-2') ? 'Bahar' : 'Yaz'}</strong>
      <span>{metadata.sectionCount} şube · Güncelleme: {new Date(metadata.fetchedAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</span>
      <a href={metadata.sourceUrl} target="_blank" rel="noreferrer">Resmî ders programı</a></div></header>
    <div className="planner-notice">Ders saatleri değişebilir; kayıt öncesinde BUIS’i kontrol edin. Birden fazla LAB/P.S. varsa uygun oturumu seçin.</div>
    {storageError && <p role="status" className="planner-notice">Tarayıcı kaydına erişilemiyor. Programınız bu sekme açıkken korunur.</p>}
    {message && <p role="alert" className="planner-notice">{message}</p>}
    <div className="planner-layout">
      <main className="planner-calendar">
        <div className="calendar-header-title">Haftalık program {conflicts > 0 && <span role="status">· ⚠️ {conflicts} saatte çakışma</span>}</div>
        <div className="calendar-scroll"><div className="calendar-grid" ref={calendarRef} style={{ gridTemplateColumns: `48px repeat(${days.length}, minmax(85px, 1fr))` }}>
          <div className="header-cell">Saat</div>{days.map(day => <div key={day} className="header-cell">{DAY_LABELS[day]}</div>)}
          {HOURS.map(hour => <React.Fragment key={hour}><div className="time-cell">{hour}:00</div>{days.map(day => {
            const items = slots.filter(s => s.day === day && s.hour === hour);
            return <div key={`${day}-${hour}`} className={`grid-cell ${items.length > 1 ? 'conflict-cell' : ''}`}>
              {items.map(s => <div key={s.key} className={`course-block ${s.sessionType}-block`} style={{ backgroundColor: colorFor(s) }} title={`${s.code} ${s.name}\n${s.instructor}\n${s.room}`}>
                <strong>{s.code}</strong><span>{s.sessionType !== 'lecture' ? s.sessionType.toUpperCase() : ''} {s.room}</span>
                <button className="remove-x" aria-label={`${s.code} ${s.sessionType} kaldır`} data-html2canvas-ignore onClick={() => { const course = catalogue.find(c => c.key === s.courseKey); if (course) remove(course); }}>×</button>
              </div>)}
            </div>;
          })}</React.Fragment>)}
        </div></div>
        <div className="calendar-footer"><button className="footer-btn clear-btn" onClick={() => setSelectedKeys([])}>🗑️ Programı Temizle</button>
          <button className="footer-btn assistant-btn" onClick={() => setShowAssistant(true)}>🎓 Kayıt Asistanı</button>
          <div className="export-dropdown"><button className="footer-btn export-btn" disabled={exporting} onClick={() => setShowExportMenu(!showExportMenu)}>{exporting ? 'Hazırlanıyor…' : '📤 Export ▼'}</button>
            {showExportMenu && <div className="export-menu"><button onClick={() => void exportCalendar('png')}>PNG olarak kaydet</button><button onClick={() => void exportCalendar('pdf')}>PDF olarak kaydet</button></div>}
          </div></div>
        <div className="selected-courses"><h3>Seçilen dersler ({selected.filter(c => c.sessionType === 'lecture').length})</h3>
          {selected.filter(c => c.sessionType === 'lecture').map(c => <div key={c.key} className="selected-course"><button className="selected-code" onClick={() => setSearch(c.code)}>{c.code}</button><span>{!courseSlots(c).length ? ' · Saat açıklanmamış' : ''}</span><button onClick={() => remove(c)} aria-label={`${c.code} dersini kaldır`}>Kaldır</button></div>)}
          {!selected.length && <p>Arama sonuçlarından ders ekleyin.</p>}
        </div>
      </main>
      <aside className="planner-controls"><div className="search-header-row"><h3>Ders ara</h3><span className="credit-info">Toplam kredi: Yerel {credits.local} · AKTS {credits.ects}</span></div>
        <div className="search-section"><input aria-label="Ders ara" placeholder="Ders kodu, adı veya öğretim üyesi…" value={search} onChange={e => setSearch(e.target.value)} className="course-search-input" />
          <div className="quick-buttons"><button className="quick-btn" onClick={() => setSearch('TK ')}>TK</button><button className="quick-btn" onClick={() => setSearch('HTR')}>HTR</button></div></div>
        <label className="conflict-filter"><input type="checkbox" checked={noConflict} onChange={e => setNoConflict(e.target.checked)} /> Yalnızca çakışmayan dersler</label>
        <div className="search-results-grid" ref={resultsRef}
          onScroll={e => { resultsScroll.current = e.currentTarget.scrollTop; }}>{filtered.slice(0, 100).map(({ course, conflicts }) => {
          const added = selectedKeys.includes(course.key), related = relatedSessions(course, catalogue);
          return <article key={course.key} className={`course-card ${added ? 'added' : ''}`}>
            <div className="card-header"><div className="course-code-title"><strong>{course.code}</strong><span className="credits">Yerel {course.credits ?? '—'} · AKTS {course.ects ?? '—'}</span></div>
              <div className="card-actions"><a className="resource-btn" href={courseDescriptionUrl(course.code, metadata.semester) || metadata.sourceUrl} target="_blank" rel="noreferrer">Syllabus</a>
                <button className={`action-btn ${added ? 'added-btn' : 'add-btn'}`} onClick={() => toggle(course)}>{added ? 'Kaldır' : 'Ekle'}</button></div></div>
            <div className="card-body"><div className="course-long-name">{course.name}</div><div className="instructor-name">{course.instructor}</div>
              <div className="schedule-text">{scheduleText(course) || 'Ders saati henüz açıklanmamış.'}</div>
              {course.scheduleWarning && <div className="conflict-warning">Kaynakta saat/derslik bilgisi eksik; BUIS’ten doğrulayın.</div>}
              {course.requiredFor && <small>Bölüm bilgisi: {course.requiredFor}</small>}
              {related.length > 0 && <div className="session-options"><strong>LAB / P.S.</strong>{related.map(session => <label key={session.key}>
                <input type="checkbox" disabled={!added} checked={selectedKeys.includes(session.key)} onChange={() => toggle(session)} />
                <span>{session.sessionType.toUpperCase()} · {scheduleText(session) || 'Saat açıklanmamış'}{session.requiredFor ? ` · ${session.requiredFor}` : ''}{session.scheduleWarning ? ' · BUIS’ten doğrulayın' : ''}
                  {candidateConflicts(session, catalogue, selected) > 0 ? ' · ⚠️ Çakışıyor' : ''}</span></label>)}
                {!added && <small>Oturum seçmek için önce dersi ekleyin.</small>}
                {added && (['lab', 'ps'] as const).some(type => related.some(s => s.sessionType === type) && !related.some(s => s.sessionType === type && selectedKeys.includes(s.key))) && <small className="conflict-warning">LAB/P.S. seçimi eksik; uygun oturumu seçin.</small>}
              </div>}
            </div>{conflicts > 0 && <div className="conflict-warning">⚠️ {conflicts} saatte çakışma</div>}
          </article>;
        })}{!filtered.length && <div className="no-results">{search.trim() ? 'Aramanıza uygun ders bulunamadı.' : 'Ders aramak için kod, ad veya öğretim üyesi yazın.'}</div>}
          {filtered.length > 100 && <p className="no-results">{filtered.length} sonuçtan ilk 100 gösteriliyor. Aramanızı daraltın.</p>}
        </div></aside>
    </div>
    {showAssistant && <RegistrationAssistant plan={registrationPlan} onClose={() => setShowAssistant(false)} />}
    <div className="hss-unre-section"><a className="hss-unre-btn" href={metadata.hssUrl} target="_blank" rel="noreferrer">📚 HSS-UNRE Listesi</a></div>
  </div>;
}

function RegistrationAssistant({ plan, onClose }: { plan: RegistrationPlan; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const text = planToText(plan);
  const duplicates = duplicateBaseCodes(plan);
  const helperUrl = `${import.meta.env.BASE_URL}buis-kayit-yardimcisi.user.js`;

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(label); }
    catch { setCopied('Kopyalanamadı — metni seçip elle kopyalayın.'); }
  };
  const download = () => {
    const blob = new Blob([planToJson(plan)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `kayit-plani-${plan.semester.replace('/', '-')}.json`;
    link.click(); URL.revokeObjectURL(link.href);
  };

  return <div className="assistant-backdrop" role="dialog" aria-modal="true" aria-label="Kayıt asistanı" onClick={onClose}>
    <div className="assistant-panel" onClick={e => e.stopPropagation()}>
      <header><h3>🎓 Kayıt Asistanı</h3><button className="assistant-close" onClick={onClose} aria-label="Kapat">×</button></header>

      {!plan.entries.length && <p className="assistant-empty">Henüz ders seçmediniz. Programınızı oluşturduktan sonra buraya dönün.</p>}

      {plan.entries.length > 0 && <>
        <p className="assistant-lead">{plan.entries.length} ders · BUIS ders ekleme ekranı için hazırlanan plan.</p>
        <ol className="assistant-list">{plan.entries.map(entry => <li key={entry.display}>
          <code>{entry.display}</code>
          <span className="assistant-name">{entry.name}</span>
          {entry.sessions.map(session => <small key={session}> · {session}</small>)}
          {entry.missingSessions.length > 0 && <small className="assistant-warn"> · {entry.missingSessions.join('/')} seçilmedi</small>}
        </li>)}</ol>

        {duplicates.length > 0 && <p className="assistant-warn">⚠️ Aynı dersin birden fazla şubesi seçili: {duplicates.join(', ')}</p>}
        {plan.warnings.map(warning => <p key={warning} className="assistant-warn">⚠️ {warning}</p>)}

        <div className="assistant-actions">
          <button className="footer-btn" onClick={() => void copy(planToJson(plan), 'Dönemli kayıt planı kopyalandı.')}>📋 Planı kopyala</button>
          <button className="footer-btn" onClick={() => void copy(text, 'Ders listesi kopyalandı.')}>📋 Listeyi kopyala</button>
          <button className="footer-btn" onClick={download}>⬇️ JSON indir</button>
        </div>
        {copied && <p role="status" className="assistant-copied">{copied}</p>}

        <details className="assistant-help">
          <summary>BUIS kayıt yardımcısını kullan</summary>
          <p className="assistant-note">Gerçek ders ekleme ekranıyla doğrulama bekleniyor. Kayıt saatinde otomatik gönderim henüz desteklenmiyor.</p>
          <ol>
            <li>Tampermonkey / Violentmonkey kurun ve <a href={helperUrl} target="_blank" rel="noreferrer">kayıt yardımcısı script’ini</a> ekleyin. (Alternatif: script’i kopyalayıp BUIS sekmesinde tarayıcı konsoluna yapıştırın.)</li>
            <li>BUIS’e kendiniz giriş yapıp ders ekleme ekranını açın; sağ üstte panel çıkar.</li>
            <li><strong>Planı kopyala</strong> ile dönem bilgisini de alıp panele yapıştırın, <strong>Formu doldur</strong>’a basın.</li>
            <li><strong>Kontenjan kontrol</strong> ile şubelerin doluluğunu görebilirsiniz.</li>
            <li>Formu gözden geçirin, panelden BUIS ders ekleme düğmesini seçip <strong>Formu gönder</strong>’e basın. Ardından BUIS’in sonucunu kontrol edin.</li>
          </ol>
          <p className="assistant-note">Yardımcı şifrenizi toplamaz. Kontenjan sorgusu ve seçtiğiniz ders ekleme işlemi kendi BUIS oturumunuzdan BUIS’e gönderilir. LAB/P.S. seçimleri programlama amaçlıdır; BUIS’te ayrıca işlem gerekebilir.</p>
        </details>
      </>}
    </div>
  </div>;
}
