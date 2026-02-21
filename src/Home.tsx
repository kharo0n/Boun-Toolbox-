// src/Home.tsx
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './Home.css';

export default function Home() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="home-container">
      <div
        className="home-background"
        style={{ transform: `scale(${1 + scrollY * 0.0005})` }}
      />

      <div className="title-card">
        <h1>BOUN TOOLBOX</h1>
        <p className="subtitle">Boğaziçi Öğrenci Araçları</p>
      </div>

      <main>
        <Link to="/gpa">
          <div className="tool-card">
            <div>💯</div>
            <h2>🧮 GPA Hesaplayıcı</h2>
            <p>Notlarını gir, dönemlik ve genel ortalamalarını anında gör.</p>
            <span>Hesapla →</span>
          </div>
        </Link>

        <Link to="/planner">
          <div className="tool-card">
            <div>📅</div>
            <h2>Course Planner</h2>
            <p>Ders programını çakışma olmadan hazırla ve planla.</p>
            <span>Planla →</span>
          </div>
        </Link>
      </main>
    </div>
  );
}