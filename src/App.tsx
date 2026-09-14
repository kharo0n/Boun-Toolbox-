import { lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './Home';

// The planner carries the whole course catalogue; GPA pages carry curricula. Load each only when opened.
const GPACalculator = lazy(() => import('./GPACalculator'));
const CoursePlanner = lazy(() => import('./CoursePlanner'));
const CurriculumGPA = lazy(() => import('./CurriculumGPA'));

function App() {
  return (
    <Router>
      <Suspense fallback={<div className="page-loading" role="status">Yükleniyor…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/gpa" element={<GPACalculator />} />
          <Route path="/planner" element={<CoursePlanner />} />
          <Route path="/curriculum" element={<CurriculumGPA />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
