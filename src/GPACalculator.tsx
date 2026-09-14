import { useState, useEffect } from 'react';
import SiteNav from './components/SiteNav';
import './GPACalculator.css';


interface Course {
  id: string;
  code: string;
  name: string;
  credits: number;
  type: 'fixed' | 'customInput' | 'select';
  options?: string[];
}

interface Department {
  id: string;
  name: string;
}

interface Faculty {
  ad: string;
  bolumler: Department[];
}

interface AppData {
  fakulteler: Faculty[];
  dersProgramlari: Record<string, Course[][]>;
}

const gradePoints: Record<string, number> = {
  AA: 4.0, BA: 3.5, BB: 3.0, CB: 2.5, CC: 2.0, DC: 1.5, DD: 1.0, FF: 0.0,
};
const gradeOptions = ['-', 'AA', 'BA', 'BB', 'CB', 'CC', 'DC', 'DD', 'FF'];

export default function GPACalculator() {
  const [loadError, setLoadError] = useState(false);
  const [courseEdits, setCourseEdits] = useState<Record<string, Partial<Course>>>({});
  const [appData, setAppData] = useState<AppData | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const [openFaculties, setOpenFaculties] = useState<Record<string, boolean>>({});

  const [grades, setGrades] = useState<Record<string, string>>({});
  const [oldGrades, setOldGrades] = useState<Record<string, string>>({});
  const [repeatMode, setRepeatMode] = useState<Record<string, boolean>>({});
  const [newElectiveCourses, setNewElectiveCourses] = useState<Record<number, Course[]>>({});

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data.json`)
      .then(res => { if (!res.ok) throw new Error('Catalogue request failed'); return res.json(); })
      .then(setAppData)
      .catch(() => setLoadError(true));
  }, []);

  const handleGradeChange = (id: string, val: string) => setGrades(prev => ({ ...prev, [id]: val }));
  const handleOldGradeChange = (id: string, val: string) => setOldGrades(prev => ({ ...prev, [id]: val }));
  const toggleRepeat = (id: string) => {
    setRepeatMode(prev => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) {
        // Clear old grade when turning off repeat
        setOldGrades(og => { const n = { ...og }; delete n[id]; return n; });
      }
      return next;
    });
  };
  const handleNameChange = (id: string, name: string) => {
    setCourseEdits(prev => ({ ...prev, [id]: { ...prev[id], name } }));
  };
  const handleCourseSelect = (id: string, code: string) => {
    setCourseEdits(prev => ({ ...prev, [id]: { ...prev[id], code } }));
  };
  const selectDept = (id: string) => {
    setSelectedDeptId(id); setGrades({}); setOldGrades({}); setRepeatMode({});
    // On a phone the faculty list sits above the curriculum; bring the chosen programme into view.
    if (window.matchMedia('(max-width: 900px)').matches) window.setTimeout(() => document.querySelector('.content-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    setNewElectiveCourses({}); setCourseEdits({});
  };

  const addNewElectiveCourse = (semesterIndex: number) => {
    const newCourse: Course = {
      id: `elective-${crypto.randomUUID()}`,
      code: '',
      name: '',
      credits: 0,
      type: 'customInput',
    };
    setNewElectiveCourses(prev => ({
      ...prev,
      [semesterIndex]: [...(prev[semesterIndex] || []), newCourse]
    }));
  };

  const toggleFaculty = (facultyName: string) => {
    setOpenFaculties(prev => ({ ...prev, [facultyName]: !prev[facultyName] }));
  };

  const calculateSPA = (courses: Course[], semesterIndex: number) => {
    let totalPoints = 0;
    let totalCredits = 0;

    for (const c of courses) {
      const g = grades[c.id];
      const p = gradePoints[g];
      if (p !== undefined) {
        totalPoints += p * c.credits;
        totalCredits += c.credits;
      }
    }

    const newCourses = newElectiveCourses[semesterIndex] || [];
    for (const c of newCourses) {
      const g = grades[c.id];
      const p = gradePoints[g];
      if (p !== undefined) {
        totalPoints += p * c.credits;
        totalCredits += c.credits;
      }
    }

    return totalCredits === 0 ? "0.00" : (totalPoints / totalCredits).toFixed(2);
  };

  const calculateTotalGPA = () => {
    if (!appData || !selectedDeptId) return "0.00";
    const allSemesters = appData.dersProgramlari[selectedDeptId];
    if (!allSemesters) return "0.00";

    let totalPoints = 0;
    let totalCredits = 0;

    allSemesters.forEach((semester, semesterIndex) => {
      semester.forEach(c => {
        const currentGrade = grades[c.id];
        const g = gradePoints[currentGrade] !== undefined ? currentGrade : repeatMode[c.id] ? oldGrades[c.id] : currentGrade;
        const p = gradePoints[g];
        if (p !== undefined) {
          totalPoints += p * c.credits;
          totalCredits += c.credits;
        }
      });

      const newCourses = newElectiveCourses[semesterIndex] || [];
      newCourses.forEach(c => {
        const currentGrade = grades[c.id];
        const g = gradePoints[currentGrade] !== undefined ? currentGrade : repeatMode[c.id] ? oldGrades[c.id] : currentGrade;
        const p = gradePoints[g];
        if (p !== undefined) {
          totalPoints += p * c.credits;
          totalCredits += c.credits;
        }
      });
    });

    return totalCredits === 0 ? "0.00" : (totalPoints / totalCredits).toFixed(2);
  };

  const currentProgram = selectedDeptId && appData ? appData.dersProgramlari[selectedDeptId] : [];

  let selectedDeptName = "";
  if (appData && selectedDeptId) {
    for (const fac of appData.fakulteler) {
      const found = fac.bolumler.find(d => d.id === selectedDeptId);
      if (found) {
        selectedDeptName = found.name;
        break;
      }
    }
  }

  const totalGPA = calculateTotalGPA();

  return (
    <div className="app-container">
      <SiteNav />
      <header className="top-header">
        <div className="header-content">
          <div className="logo-section">
            <div className="title-group">
              <h1>GPA Hesaplayıcı</h1>
              <span>{selectedDeptName || "Bölüm Seçiniz"}</span>
            </div>
          </div>
          <div className="header-right-area">
            <input
              className="search-box"
              type="text"
              placeholder="Bölüm ara…"
              aria-label="Bölüm ara"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <div className="total-gpa-card">
              <div className="gpa-label">Genel GPA</div>
              <div className="gpa-value">{totalGPA}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="main-layout">
        {loadError && <p role="alert">Bölüm verileri yüklenemedi. Lütfen sayfayı yenileyin.</p>}
        <aside className="sidebar">
          <h3>Fakülteler</h3>
          <div className="faculty-list">
            {searchTerm ? (
              <ul className="dept-list">
                {appData?.fakulteler.flatMap(f => f.bolumler)
                  .filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()))
                  .map(dept => (
                    <li key={dept.id}>
                      <button
                        className={selectedDeptId === dept.id ? "active" : ""}
                        onClick={() => { selectDept(dept.id); }}
                      >
                        {dept.name}
                      </button>
                    </li>
                  ))
                }
              </ul>
            ) : (
              appData?.fakulteler.map(fac => (
                <div key={fac.ad} className="faculty-group">
                  <button
                    className={`faculty-btn ${openFaculties[fac.ad] ? 'open' : ''}`}
                    onClick={() => toggleFaculty(fac.ad)}
                  >
                    {fac.ad}
                    <span className="arrow">▼</span>
                  </button>

                  {openFaculties[fac.ad] && (
                    <ul className="dept-list sub-list">
                      {fac.bolumler.map(dept => (
                        <li key={dept.id}>
                          <button
                            className={selectedDeptId === dept.id ? "active" : ""}
                            onClick={() => { selectDept(dept.id); }}
                          >
                            {dept.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        <main className="content-area">
          {!selectedDeptId ? (
            <div className="gpa-empty">
              <span aria-hidden="true">🧮</span>
              <h2>Bölümünü seç</h2>
              <p>Fakülte listesinden bölümünü seçtiğinde müfredatın dönem dönem gelir; notlarını girdikçe ortalaman hesaplanır.</p>
            </div>
          ) : (
            <>
              <div className="catalog-grid">
                {currentProgram && currentProgram.length > 0 ? (
                  currentProgram.map((semesterCourses, index) => {
                    const semesterNo = index + 1;
                    const spa = calculateSPA(semesterCourses, index);

                    return (
                      <div className="semester-block" key={index}>
                        <h3 className="semester-header">
                          {semesterNo === 1 ? "Birinci" : semesterNo === 2 ? "İkinci" :
                            semesterNo === 3 ? "Üçüncü" : semesterNo === 4 ? "Dördüncü" :
                              semesterNo === 5 ? "Beşinci" : semesterNo === 6 ? "Altıncı" :
                                semesterNo === 7 ? "Yedinci" : "Sekizinci"} Dönem
                        </h3>
                        <div className="table-row header-row">
                          <div className="col-code"></div>
                          <div className="col-name"></div>
                          <div className="col-credits">CRDTS</div>
                          <div className="col-grade">GRADE</div>
                        </div>
                        <div className="course-list">
                          {semesterCourses.map(course => (
                            <div key={course.id}>
                              <div className="table-row">
                                <div className="col-code">
                                  {course.type === 'select' ? (
                                    <select className="clean-select" value={courseEdits[course.id]?.code ?? ''} onChange={(e) => handleCourseSelect(course.id, e.target.value)}>
                                      <option value="">{course.code}</option>
                                      {course.options?.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                  ) : course.code}
                                </div>
                                <div className="col-name">
                                  {course.type === 'customInput' ? (
                                    <input className="clean-input" value={courseEdits[course.id]?.name ?? ''} placeholder={course.name} onChange={(e) => handleNameChange(course.id, e.target.value)} />
                                  ) : course.name}
                                </div>
                                <div className="col-credits">{course.credits}</div>
                                <div className="col-grade">
                                  <div className="grade-with-repeat">
                                    <button
                                      className={`repeat-btn${repeatMode[course.id] ? ' repeat-active' : ''}`}
                                      onClick={() => toggleRepeat(course.id)}
                                      title="Tekrar Al"
                                    >🔁</button>
                                    <select
                                      className="grade-dropdown"
                                      value={grades[course.id] || ''}
                                      onChange={(e) => handleGradeChange(course.id, e.target.value)}
                                      style={{ color: grades[course.id] && grades[course.id] !== '-' ? '#00aeef' : '#999' }}
                                    >
                                      {gradeOptions.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                  </div>
                                </div>
                              </div>
                              {repeatMode[course.id] && (
                                <div className="repeat-row">
                                  <span className="repeat-label">Eski Not (yeni not seçilene kadar genel ortalamada):</span>
                                  <select
                                    className="grade-dropdown old-grade-dropdown"
                                    value={oldGrades[course.id] || ''}
                                    onChange={(e) => handleOldGradeChange(course.id, e.target.value)}
                                    style={{ color: oldGrades[course.id] && oldGrades[course.id] !== '-' ? '#ff7043' : '#999' }}
                                  >
                                    {gradeOptions.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                  <span className="repeat-label">→ Yeni Not: <strong style={{ color: '#00aeef' }}>{grades[course.id] || '-'}</strong></span>
                                </div>
                              )}
                            </div>
                          ))}
                          {(newElectiveCourses[index] || []).map(course => (
                            <div className="table-row" key={course.id}>
                              <div className="col-code">
                                <input
                                  className="clean-input"
                                  placeholder="Kod"
                                  onChange={(e) => {
                                    const newValue = e.target.value;
                                    setNewElectiveCourses(prev => ({
                                      ...prev,
                                      [index]: prev[index].map(c => c.id === course.id ? { ...c, code: newValue } : c)
                                    }));
                                  }}
                                />
                              </div>
                              <div className="col-name">
                                <input
                                  className="clean-input"
                                  placeholder="Ders Adı"
                                  value={courseEdits[course.id]?.name ?? ''}
                                  onChange={(e) => handleNameChange(course.id, e.target.value)}
                                />
                              </div>
                              <div className="col-credits">
                                <input
                                  type="number"
                                  className="clean-input credits-input"
                                  placeholder="0"
                                  min="0"
                                  max="10"
                                  onChange={(e) => {
                                    const newValue = Math.min(10, Math.max(0, Number(e.target.value) || 0));
                                    setNewElectiveCourses(prev => ({
                                      ...prev,
                                      [index]: prev[index].map(c => c.id === course.id ? { ...c, credits: newValue } : c)
                                    }));
                                  }}
                                />
                              </div>
                              <div className="col-grade">
                                <select className="grade-dropdown" value={grades[course.id] || ''} onChange={(e) => handleGradeChange(course.id, e.target.value)} style={{ color: grades[course.id] ? '#00aeef' : '#999' }}>
                                  {gradeOptions.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div style={{ padding: '12px 0', borderTop: '1px solid #e0e0e0' }}>
                          <button
                            onClick={() => addNewElectiveCourse(index)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#00aeef',
                              cursor: 'pointer',
                              fontSize: '14px',
                              fontWeight: '600',
                              padding: '8px 0',
                              textDecoration: 'underline',
                              transition: 'color 0.2s'
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#0088cc')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#00aeef')}
                          >
                            + Yeni Ders Ekle
                          </button>
                        </div>
                        <div className="table-row total-row">
                          <div className="col-code"></div>
                          <div className="col-name" style={{ textAlign: 'right', paddingRight: '10px', color: '#00aeef', fontWeight: 'bold' }}>SPA:</div>
                          <div className="col-credits"></div>
                          <div className="col-grade spa-text">{spa}</div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "#999" }}>
                    Bu bölümün ders programı henüz eklenmemiştir.
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}