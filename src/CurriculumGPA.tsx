import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './CurriculumGPA.css';

interface Course {
    id: string;
    code: string;
    name: string;
    credits: number;
    type: 'fixed' | 'customInput' | 'select';
    options?: string[];
}

interface Department { id: string; name: string; }
interface Faculty { ad: string; bolumler: Department[]; }
interface AppData { fakulteler: Faculty[]; dersProgramlari: Record<string, Course[][]>; }

interface PoolCourse {
    id: string;
    code: string;
    grade: string;
    credits: number;
}

const gradePoints: Record<string, number> = {
    AA: 4.0, BA: 3.5, BB: 3.0, CB: 2.5, CC: 2.0, DC: 1.5, DD: 1.0, FF: 0.0,
};

const gradeOptions = ['AA', 'BA', 'BB', 'CB', 'CC', 'DC', 'DD', 'FF'];

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
    AA: { bg: '#1b5e20', text: '#fff' },
    BA: { bg: '#2e7d32', text: '#fff' },
    BB: { bg: '#388e3c', text: '#fff' },
    CB: { bg: '#1a237e', text: '#fff' },
    CC: { bg: '#283593', text: '#fff' },
    DC: { bg: '#303f9f', text: '#fff' },
    DD: { bg: '#0d47a1', text: '#fff' },
    FF: { bg: '#b71c1c', text: '#fff' },
};



export default function CurriculumGPA() {
    const [appData, setAppData] = useState<AppData | null>(null);
    const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
    const [openFaculties, setOpenFaculties] = useState<Record<string, boolean>>({});
    const [searchTerm, setSearchTerm] = useState('');
    const [grades, setGrades] = useState<Record<string, string>>({}); // fixed course grades
    const [coursePool, setCoursePool] = useState<PoolCourse[]>([]);
    const [slotAssignments, setSlotAssignments] = useState<Record<string, string>>({}); // slotCourseId -> poolCourse.id
    const [newCode, setNewCode] = useState('');
    const [newGrade, setNewGrade] = useState('AA');
    const [newCredits, setNewCredits] = useState(3);
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        fetch('/data.json').then(r => r.json()).then(setAppData).catch(console.error);
    }, []);

    const toggleFaculty = (name: string) =>
        setOpenFaculties(prev => ({ ...prev, [name]: !prev[name] }));

    const selectDept = (id: string) => {
        setSelectedDeptId(id);
        setGrades({});
        setSlotAssignments({});
    };

    /* ── GPA CALCULATION ── */
    const calculateGPA = () => {
        if (!appData || !selectedDeptId) return '0.00';
        const allSemesters = appData.dersProgramlari[selectedDeptId];
        if (!allSemesters) return '0.00';
        let totalPoints = 0, totalCredits = 0;

        allSemesters.forEach(semester => {
            semester.forEach(course => {
                if (course.type === 'fixed') {
                    const p = gradePoints[grades[course.id]];
                    if (p !== undefined) { totalPoints += p * course.credits; totalCredits += course.credits; }
                } else {
                    const pc = coursePool.find(c => c.id === slotAssignments[course.id]);
                    if (pc) {
                        const p = gradePoints[pc.grade];
                        if (p !== undefined) { totalPoints += p * pc.credits; totalCredits += pc.credits; }
                    }
                }
            });
        });

        return totalCredits === 0 ? '0.00' : (totalPoints / totalCredits).toFixed(2);
    };

    /* ── POOL ── */
    const addToPool = () => {
        if (!newCode.trim()) return;
        setCoursePool(prev => [...prev, {
            id: `pool-${Date.now()}-${Math.random()}`,
            code: newCode.trim().toUpperCase(),
            grade: newGrade,
            credits: newCredits,
        }]);
        setNewCode('');
    };

    const removeFromPool = (id: string) => {
        setCoursePool(prev => prev.filter(c => c.id !== id));
        setSlotAssignments(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(k => { if (next[k] === id) delete next[k]; });
            return next;
        });
    };

    /* ── DRAG & DROP ── */
    const handleSlotDrop = (slotId: string, e: React.DragEvent) => {
        e.preventDefault();
        if (!draggedId) return;
        setSlotAssignments(prev => ({ ...prev, [slotId]: draggedId }));
        setDraggedId(null);
        setDragging(false);
    };

    const handleSlotDragStart = (courseId: string, poolId: string) => {
        // dragging from a filled slot back
        setDraggedId(poolId);
        setDragging(true);
        setSlotAssignments(prev => {
            const next = { ...prev };
            delete next[courseId];
            return next;
        });
    };

    /* ── UTILS ── */
    const getDeptName = () => {
        if (!appData || !selectedDeptId) return '';
        for (const f of appData.fakulteler) {
            const d = f.bolumler.find(d => d.id === selectedDeptId);
            if (d) return d.name;
        }
        return '';
    };

    const groupRows = (courses: Course[]): Course[][] => {
        const rows: Course[][] = [];
        for (let i = 0; i < courses.length; i += 3) rows.push(courses.slice(i, i + 3));
        return rows;
    };

    const currentProgram = selectedDeptId && appData ? appData.dersProgramlari[selectedDeptId] : null;
    const gpa = calculateGPA();

    return (
        <div className="curric-container">
            {/* HEADER */}
            <header className="curric-header">
                <div className="curric-header-left">
                    <Link to="/gpa" className="curric-back-btn">← GPA Hesaplayıcı</Link>
                    <h1>📋 Curriculum GPA</h1>
                    {selectedDeptId && <span className="curric-dept-name">{getDeptName()}</span>}
                </div>
                <div className="curric-gpa-card">
                    <div className="curric-gpa-label">CURRICULUM GPA</div>
                    <div className="curric-gpa-value">{gpa}</div>
                </div>
            </header>

            <div className="curric-layout">
                {/* SIDEBAR */}
                <aside className="curric-sidebar">
                    <h3>FAKÜLTELER</h3>
                    <input
                        className="curric-search"
                        placeholder="Bölüm Ara..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                    <div className="curric-faculty-list">
                        {searchTerm ? (
                            <ul className="curric-dept-list">
                                {appData?.fakulteler.flatMap(f => f.bolumler)
                                    .filter(d => d.name.toLowerCase().includes(searchTerm.toLowerCase()))
                                    .map(dept => (
                                        <li key={dept.id}>
                                            <button
                                                className={selectedDeptId === dept.id ? 'active' : ''}
                                                onClick={() => selectDept(dept.id)}
                                            >{dept.name}</button>
                                        </li>
                                    ))}
                            </ul>
                        ) : (
                            appData?.fakulteler.map(fac => (
                                <div key={fac.ad} className="curric-faculty-group">
                                    <button
                                        className={`curric-faculty-btn ${openFaculties[fac.ad] ? 'open' : ''}`}
                                        onClick={() => toggleFaculty(fac.ad)}
                                    >
                                        {fac.ad} <span className="arrow">▼</span>
                                    </button>
                                    {openFaculties[fac.ad] && (
                                        <ul className="curric-dept-list curric-sub-list">
                                            {fac.bolumler.map(dept => (
                                                <li key={dept.id}>
                                                    <button
                                                        className={selectedDeptId === dept.id ? 'active' : ''}
                                                        onClick={() => selectDept(dept.id)}
                                                    >{dept.name}</button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </aside>

                {/* MAIN GRID */}
                <main className="curric-grid-area">
                    {!selectedDeptId ? (
                        <div className="curric-placeholder">
                            <span>📋</span>
                            <p>Sol taraftan bir bölüm seçin</p>
                        </div>
                    ) : !currentProgram || currentProgram.length === 0 ? (
                        <div className="curric-placeholder"><p>Bu bölümün programı henüz eklenmemiştir.</p></div>
                    ) : (
                        currentProgram.map((semCourses, semIdx) => (
                            <div key={semIdx} className="curric-semester">
                                <div className="curric-sem-header">Semester {semIdx + 1}</div>
                                <div className="curric-sem-grid">
                                    {groupRows(semCourses).map((row, rIdx) => (
                                        <div key={rIdx} className="curric-row">
                                            {row.map(course => {
                                                const isElective = course.type !== 'fixed';
                                                const grade = !isElective ? grades[course.id] : undefined;
                                                const assignedPc = isElective ? coursePool.find(c => c.id === slotAssignments[course.id]) : undefined;
                                                const colorStyle = grade && GRADE_COLORS[grade]
                                                    ? { backgroundColor: GRADE_COLORS[grade].bg, color: GRADE_COLORS[grade].text }
                                                    : {};
                                                const assignedColorStyle = assignedPc && GRADE_COLORS[assignedPc.grade]
                                                    ? { backgroundColor: GRADE_COLORS[assignedPc.grade].bg, color: '#fff' }
                                                    : {};

                                                return (
                                                    <div key={course.id} className="curric-pair">
                                                        <div className="curric-label">
                                                            {isElective
                                                                ? (course.type === 'select' && course.options
                                                                    ? course.options[0]?.split(' ')[0] || 'ELEC.'
                                                                    : course.code || 'ELEC.')
                                                                : course.code
                                                            }
                                                        </div>

                                                        {isElective ? (
                                                            /* ELECTIVE DROP SLOT */
                                                            <div
                                                                className={`curric-box elective-slot ${dragging ? 'droppable' : ''} ${assignedPc ? 'filled' : 'empty'}`}
                                                                onDragOver={e => e.preventDefault()}
                                                                onDrop={e => handleSlotDrop(course.id, e)}
                                                                draggable={!!assignedPc}
                                                                onDragStart={assignedPc ? () => handleSlotDragStart(course.id, assignedPc.id) : undefined}
                                                                style={assignedPc ? assignedColorStyle : {}}
                                                            >
                                                                {assignedPc
                                                                    ? `${assignedPc.code} [${assignedPc.grade}-${assignedPc.credits}]`
                                                                    : ''}
                                                            </div>
                                                        ) : (
                                                            /* FIXED COURSE BOX */
                                                            <div
                                                                className={`curric-box fixed-course ${grade ? 'graded' : 'ungraded'}`}
                                                                style={colorStyle}
                                                            >
                                                                <span className="curric-box-text">
                                                                    {grade ? `${course.code} [${grade}-${course.credits}]` : 'N/A'}
                                                                </span>
                                                                <select
                                                                    className="curric-grade-overlay"
                                                                    value={grade || ''}
                                                                    onChange={e => setGrades(prev => ({ ...prev, [course.id]: e.target.value }))}
                                                                >
                                                                    <option value="">-</option>
                                                                    {gradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
                                                                </select>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </main>

                {/* COURSES PANEL */}
                <aside className="courses-panel">
                    <h3>COURSES</h3>

                    {/* Add Course Form */}
                    <div className="pool-form">
                        <input
                            className="pool-code-input"
                            placeholder="Ders Kodu"
                            value={newCode}
                            onChange={e => setNewCode(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addToPool()}
                        />
                        <div className="pool-form-row">
                            <select value={newGrade} onChange={e => setNewGrade(e.target.value)} className="pool-grade-select">
                                {gradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                            <input
                                type="number" min="1" max="10"
                                value={newCredits}
                                onChange={e => setNewCredits(parseInt(e.target.value) || 3)}
                                className="pool-credits-input"
                            />
                            <button onClick={addToPool} className="pool-add-btn">+</button>
                        </div>
                    </div>

                    <div className="pool-hint">← Elective slotlarına sürükle bırak</div>

                    {/* Pool List */}
                    <div className="pool-list">
                        {coursePool.length === 0 && (
                            <div className="pool-empty">Henüz ders eklemediniz</div>
                        )}
                        {coursePool.map(pc => {
                            const isAssigned = Object.values(slotAssignments).includes(pc.id);
                            const cs = GRADE_COLORS[pc.grade] || { bg: '#9e9e9e', text: '#fff' };
                            return (
                                <div
                                    key={pc.id}
                                    className={`pool-item ${isAssigned ? 'pool-assigned' : ''}`}
                                    draggable={!isAssigned}
                                    onDragStart={() => { setDraggedId(pc.id); setDragging(true); }}
                                    onDragEnd={() => { setDragging(false); if (!Object.values(slotAssignments).includes(pc.id)) setDraggedId(null); }}
                                    style={{ backgroundColor: cs.bg, color: cs.text, opacity: isAssigned ? 0.55 : 1 }}
                                >
                                    <span className="pool-item-text">{pc.code} [{pc.grade}-{pc.credits}]</span>
                                    <button className="pool-remove-btn" onClick={() => removeFromPool(pc.id)}>×</button>
                                </div>
                            );
                        })}
                    </div>
                </aside>
            </div>
        </div>
    );
}
