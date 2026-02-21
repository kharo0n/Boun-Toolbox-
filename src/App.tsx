
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './Home';
import GPACalculator from './GPACalculator';
import CoursePlanner from './CoursePlanner';
import CurriculumGPA from './CurriculumGPA';

import './GPACalculator.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />

        <Route path="/gpa" element={<GPACalculator />} />

        <Route path="/planner" element={<CoursePlanner />} />
        <Route path="/curriculum" element={<CurriculumGPA />} />
      </Routes>
    </Router>
  );
}

export default App;
