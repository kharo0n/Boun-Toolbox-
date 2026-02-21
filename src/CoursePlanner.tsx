import React, { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import './CoursePlanner.css';
import courseDataRaw from './data/allCourses.json';

type SessionType = 'lecture' | 'lab' | 'ps';

interface RawCourse {
  code: string;
  name: string;
  credits?: number;
  ects?: number;
  days: string[] | null;
  hours: number[] | null;
  instructor: string;
  rooms?: string[];
}

interface ProcessedCourse extends RawCourse {
  uniqueKey: string;
  conflictCount: number;
  sessionType: SessionType;
}

interface PlanItem {
  uniqueId: string;
  code: string;
  name: string;
  day: string;
  startHour: number;
  duration: number;
  color: string;
  instructor: string;
  room: string;
  sessionType: SessionType;
}

const SLOT_TO_HOUR = (slot: number) => slot + 8;
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const DAYS_MAP: Record<string, string> = {
  "M": "Monday", "T": "Tuesday", "W": "Wednesday", "Th": "Thursday", "F": "Friday", "St": "Saturday", "Su": "Sunday"
};
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const COLORS = ["#e3f2fd", "#f3e5f5", "#e8f5e9", "#fff3e0", "#ffebee", "#e0f7fa", "#fff8e1", "#fce4ec"];
const LAB_COLOR = "#ffcdd2"; // Light red for labs
const PS_COLOR = "#c8e6c9"; // Light green for problem sessions

const DAY_LABELS = {
  "Monday": "M", "Tuesday": "T", "Wednesday": "W", "Thursday": "Th", "Friday": "F", "Saturday": "St", "Sunday": "Su"
};

// Helper function to detect session type from course key
const getSessionType = (key: string): SessionType => {
  if (key.includes(' LAB ') || key.endsWith(' LAB')) return 'lab';
  if (key.includes(' P.S. ') || key.endsWith(' P.S.')) return 'ps';
  return 'lecture';
};

export default function CoursePlanner() {
  const [searchTerm, setSearchTerm] = useState("");
  const [addedCourses, setAddedCourses] = useState<PlanItem[]>([]);
  const [filterMode, _setFilterMode] = useState<"ALL" | "NO_CONFLICT">("ALL");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  // Export calendar as PNG
  const exportAsPNG = async () => {
    if (!calendarRef.current) return;
    setShowExportMenu(false);

    try {
      const canvas = await html2canvas(calendarRef.current, {
        backgroundColor: '#1a1a2e',
        scale: 2,
      });
      const link = document.createElement('a');
      link.download = 'ders-programi.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (error) {
      console.error('PNG export failed:', error);
      alert('PNG olarak kaydetme başarısız oldu.');
    }
  };

  // Export calendar as PDF
  const exportAsPDF = async () => {
    if (!calendarRef.current) return;
    setShowExportMenu(false);

    try {
      const canvas = await html2canvas(calendarRef.current, {
        backgroundColor: '#1a1a2e',
        scale: 2,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save('ders-programi.pdf');
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('PDF olarak kaydetme başarısız oldu.');
    }
  };
  const allCoursesList = useMemo(() => {
    const grouped: Record<string, ProcessedCourse> = {};

    Object.entries(courseDataRaw).forEach(([key, val]) => {
      const raw = val as RawCourse;
      const sessionType = getSessionType(key);
      const code = raw.code.trim();

      // For LAB and P.S. entries, keep them as separate items
      if (sessionType !== 'lecture') {
        grouped[key] = {
          ...raw,
          code: code,
          uniqueKey: key,
          days: raw.days || [],
          hours: raw.hours || [],
          rooms: raw.rooms || [],
          conflictCount: 0,
          sessionType
        };
        return;
      }

      // For regular lectures, group by code
      if (!grouped[code]) {
        grouped[code] = {
          ...raw,
          code: code,
          uniqueKey: code,
          days: [],
          hours: [],
          rooms: [],
          conflictCount: 0,
          sessionType: 'lecture'
        };
      }

      // Merge Schedule if exists
      if (raw.days && raw.hours) {
        grouped[code].days = [...(grouped[code].days || []), ...raw.days];
        grouped[code].hours = [...(grouped[code].hours || []), ...raw.hours];
        if (raw.rooms) {
          grouped[code].rooms = [...(grouped[code].rooms || []), ...raw.rooms];
        } else {
          const emptyRooms = new Array(raw.days.length).fill("");
          grouped[code].rooms = [...(grouped[code].rooms || []), ...emptyRooms];
        }
      }
    });

    return Object.values(grouped);
  }, []);

  const getConflictCount = (course: RawCourse) => {
    if (!course.days || !course.hours) return 0;
    let conflicts = 0;

    for (let i = 0; i < course.days.length; i++) {
      const day = DAYS_MAP[course.days[i]];
      const hour = SLOT_TO_HOUR(course.hours[i]);
      if (!day) continue;

      const isConflict = addedCourses.some(item =>
        item.code !== course.code && // Ignore self
        item.day === day &&
        hour >= item.startHour &&
        hour < item.startHour + item.duration
      );
      if (isConflict) conflicts++;
    }
    return conflicts;
  };



  const filteredCourses = useMemo(() => {
    let results: ProcessedCourse[] = [];
    const lowerTerm = searchTerm.trim().toLowerCase();

    if (searchTerm === "QUICK_TK") {
      results = allCoursesList.filter(c => c.code.startsWith("TK"));
    } else if (searchTerm === "QUICK_HTR") {
      results = allCoursesList.filter(c => c.code.startsWith("HTR"));
    } else if (lowerTerm.length >= 1) {

      if (lowerTerm.length < 3) {
        results = allCoursesList.filter(c => c.code.toLowerCase().includes(lowerTerm));
      } else {
        results = allCoursesList.filter(c =>
          c.code.toLowerCase().includes(lowerTerm) ||
          c.name.toLowerCase().includes(lowerTerm)
        );
      }

    } else {
      return [];
    }

    // Filter out LAB/P.S. sessions from search results - they auto-add with main course
    const lecturesOnly = results.filter(c => c.sessionType === 'lecture');

    const resultsWithConflicts = lecturesOnly.map(course => ({
      ...course,
      conflictCount: getConflictCount(course)
    }));



    const finalResults = filterMode === "NO_CONFLICT"
      ? resultsWithConflicts.filter(c => c.conflictCount === 0)
      : resultsWithConflicts;

    return finalResults.sort((a, b) => {
      if (a.conflictCount !== b.conflictCount) return a.conflictCount - b.conflictCount;

      const aStarts = a.code.toLowerCase().startsWith(lowerTerm);
      const bStarts = b.code.toLowerCase().startsWith(lowerTerm);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      return a.code.localeCompare(b.code);
    }).slice(0, 100);

  }, [searchTerm, allCoursesList, addedCourses, filterMode]);

  const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  const getColorForSession = (sessionType: SessionType) => {
    if (sessionType === 'lab') return LAB_COLOR;
    if (sessionType === 'ps') return PS_COLOR;
    return getRandomColor();
  };

  // Build URL for course description page on registration site
  const getCourseDescriptionUrl = (code: string) => {
    // code format: "MIS 214.01" or "BIO 106.01"
    // URL format: course=MIS%20214&section=01&term=2025/2026-2
    const trimmedCode = code.trim();
    const dotIndex = trimmedCode.lastIndexOf('.');

    if (dotIndex === -1) return null;

    const courseWithoutSection = trimmedCode.substring(0, dotIndex); // "MIS 214"
    const section = trimmedCode.substring(dotIndex + 1); // "01"
    const term = "2025/2026-2"; // Current semester

    const encodedCourse = encodeURIComponent(courseWithoutSection);
    return `https://registration.bogazici.edu.tr/scripts/schedule/coursedescription.asp?course=${encodedCourse}&section=${section}&term=${term}`;
  };

  const addCourseItems = (course: ProcessedCourse, planItems: PlanItem[], color: string) => {
    if (!course.days || !course.hours || course.days.length === 0) {
      return false;
    }

    for (let i = 0; i < course.days.length; i++) {
      const realDay = DAYS_MAP[course.days[i]];
      const realHour = SLOT_TO_HOUR(course.hours[i]);
      if (!realDay) continue;

      planItems.push({
        uniqueId: Math.random().toString(36).substr(2, 9),
        code: course.code,
        name: course.name,
        day: realDay,
        startHour: realHour,
        duration: 1,
        color: color,
        instructor: course.instructor,
        room: course.rooms ? course.rooms[i] : "",
        sessionType: course.sessionType
      });
    }
    return true;
  };

  const addCourse = (course: ProcessedCourse) => {
    if (!course.days || !course.hours || course.days.length === 0) {
      alert("Bu dersin tanımlı bir programı yok.");
      return;
    }

    const newPlanItems: PlanItem[] = [];
    const baseColor = getColorForSession(course.sessionType);

    // Add the main course
    addCourseItems(course, newPlanItems, baseColor);

    // If this is a lecture, find and add related LAB/P.S. sessions
    if (course.sessionType === 'lecture') {
      const courseCode = course.code.trim();

      // Find related LAB and P.S. sessions
      const relatedSessions = allCoursesList.filter(c => {
        if (c.sessionType === 'lecture') return false;
        // Match by course code (e.g., "BIO 106.01" matches "BIO106.01 LAB 1")
        const relatedCode = c.code.trim();
        return relatedCode === courseCode;
      });

      // Add all related LAB/P.S. sessions
      relatedSessions.forEach(session => {
        const sessionColor = getColorForSession(session.sessionType);
        addCourseItems(session, newPlanItems, sessionColor);
      });
    }

    setAddedCourses([...addedCourses, ...newPlanItems]);
  };

  const removeCourse = (uniqueId: string) => {
    setAddedCourses(addedCourses.filter(c => c.uniqueId !== uniqueId));
  };

  const removeCourseByCode = (code: string) => {
    setAddedCourses(addedCourses.filter(c => c.code !== code));
  };

  const formatSchedule = (course: RawCourse) => {
    if (!course.days || !course.hours) return "";
    return course.days.map((d, i) => {
      const dayName = DAYS_MAP[d];
      const time = course.hours ? `${course.hours[i] + 8}:00` : '';
      return `${dayName} (${time})`;
    }).join(" / ");
  };

  return (
    <div className="planner-container">
      <header className="planner-header">
        <div className="header-left">
          <Link to="/" className="back-btn">← Ana Menü</Link>
          <h1>📅 Course Planner</h1>
        </div>
      </header>



      <div className="planner-layout">
        {/* LEFT: CALENDAR */}
        <main className="planner-calendar">
          <div className="calendar-header-title">Schedule</div>
          <div className="calendar-grid" ref={calendarRef}>
            <div className="header-cell time-col"></div>
            {DAYS.map(day => (
              <div key={day} className="header-cell day-col">{DAY_LABELS[day as keyof typeof DAY_LABELS]}</div>
            ))}

            {HOURS.map(hour => (
              <React.Fragment key={hour}>
                <div className="time-cell">{hour}:00</div>
                {DAYS.map(day => (
                  <div key={`${day}-${hour}`} className="grid-cell">
                    {addedCourses
                      .filter(c => c.day === day && c.startHour === hour)
                      .map(c => (
                        <div
                          key={c.uniqueId}
                          className={`course-block ${c.sessionType === 'lab' ? 'lab-block' : ''} ${c.sessionType === 'ps' ? 'ps-block' : ''}`}
                          style={{ backgroundColor: c.color }}
                          title={`${c.code}\n${c.name}\n${c.day} ${c.startHour}:00${c.sessionType !== 'lecture' ? ` (${c.sessionType.toUpperCase()})` : ''}`}
                        >
                          <div className="cb-code">
                            {c.code}
                            {c.sessionType === 'lab' && <span className="session-badge lab-badge">LAB</span>}
                            {c.sessionType === 'ps' && <span className="session-badge ps-badge">P.S.</span>}
                          </div>
                          <button className="remove-x" onClick={() => removeCourse(c.uniqueId)}>×</button>
                        </div>
                      ))
                    }
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
          <div className="calendar-footer">
            <button className="footer-btn clear-btn" onClick={() => setAddedCourses([])}>
              🗑️ Programı Temizle
            </button>
            <div className="export-dropdown">
              <button
                className="footer-btn export-btn"
                onClick={() => setShowExportMenu(!showExportMenu)}
              >
                📤 Export ▼
              </button>
              {showExportMenu && (
                <div className="export-menu">
                  <button onClick={exportAsPNG}>🖼️ PNG olarak kaydet</button>
                  <button onClick={exportAsPDF}>📄 PDF olarak kaydet</button>
                </div>
              )}
            </div>
          </div>
        </main>

        {/* RIGHT: SEARCH & CONTROLS */}
        <aside className="planner-controls">
          <div className="search-header-row">
            <h3>Search Course</h3>
            <span className="credit-info">Total Credit: Local(0) - ECTS(0)</span>
          </div>

          <div className="search-section">
            <input
              type="text"
              placeholder="Search (e.g. MIS, CMPE)..."
              value={searchTerm.startsWith("QUICK") ? "" : searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="course-search-input"
            />
            <div className="quick-buttons">
              <button className="quick-btn" onClick={() => setSearchTerm("QUICK_TK")}>TK</button>
              <button className="quick-btn" onClick={() => setSearchTerm("QUICK_HTR")}>HTR</button>
            </div>
          </div>

          <div className="search-results-grid">
            {filteredCourses.map((course) => {
              const hasConflict = course.conflictCount > 0;
              const isAdded = addedCourses.some(ac => ac.code === course.code);

              return (
                <div
                  key={course.uniqueKey}
                  className={`course-card ${isAdded ? 'added' : ''}`}
                >
                  <div className="card-header">
                    <div className="course-code-title">
                      <strong>{course.code}</strong>
                      <span className="credits">Local {course.credits} - ECTS {course.ects}</span>
                    </div>
                    <div className="card-actions">
                      <button
                        className="resource-btn"
                        onClick={() => {
                          const url = getCourseDescriptionUrl(course.code);
                          if (url) window.open(url, '_blank');
                        }}
                        title="Ders Detay Sayfası"
                      >
                        Syllabus
                      </button>
                      <button
                        className={`action-btn ${isAdded ? 'added-btn' : 'add-btn'}`}
                        onClick={() => isAdded ? removeCourseByCode(course.code) : addCourse(course)}
                      >
                        {isAdded ? "Added" : "Add"}
                      </button>
                    </div>
                  </div>

                  <div className="card-body">
                    <div className="course-long-name">{course.name}</div>
                    <div className="instructor-name">{course.instructor}</div>
                    <div className="schedule-text">
                      {formatSchedule(course)}
                    </div>
                  </div>

                  {hasConflict && (
                    <div className="conflict-warning">⚠️ Conflict</div>
                  )}
                </div>
              );
            })}
            {filteredCourses.length === 0 && (
              <div className="no-results">Type something to search...</div>

            )}
          </div>
        </aside>

      </div>

      {/* HSS-UNRE List Button - Independent of Schedule */}
      <div className="hss-unre-section">
        <button
          className="hss-unre-btn"
          onClick={() => window.open('https://mediastore.cc.bogazici.edu.tr/web/userfiles/files/HSS%20Courses%20-%202025_2026%20Spring%20List-12_02_2026.pdf', '_blank')}
        >
          📚 HSS-UNRE Listesi
        </button>
      </div>
    </div>
  );
}