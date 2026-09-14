import { Link, NavLink } from 'react-router-dom';
import metadata from '../data/courseMetadata.json';
import { semesterLabel } from '../lib/text';

export default function SiteNav() {
  return <nav className="site-nav" aria-label="Ana menü">
    <div className="site-nav-inner">
      <Link to="/" className="site-brand" aria-label="BOUN Toolbox ana sayfa">
        <span className="site-brand-mark" aria-hidden="true">🎓</span><span className="site-brand-text">BOUN Toolbox</span>
      </Link>
      <div className="site-links">
        <NavLink to="/planner">Ders Programı</NavLink>
        <NavLink to="/gpa">GPA</NavLink>
        <NavLink to="/curriculum">Curriculum GPA</NavLink>
      </div>
      <span className="site-term">{semesterLabel(metadata.semester)} dersleri</span>
    </div>
  </nav>;
}
