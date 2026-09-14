import { Link } from 'react-router-dom';
import SiteNav from './components/SiteNav';
import metadata from './data/courseMetadata.json';
import { formatUpdated, semesterLabel } from './lib/text';
import './Home.css';

const tools = [
  {
    to: '/planner', icon: '📅', title: 'Ders Programı', cta: 'Programı hazırla',
    text: 'Ders ara, çakışmaları anında gör, LAB/P.S. oturumunu seç.',
    points: ['Kayıt Asistanı ile BUIS Quick Add’e aktar', 'Consent mesajlarını önceden hazırla', 'Programı PNG veya PDF olarak kaydet'],
  },
  {
    to: '/gpa', icon: '🧮', title: 'GPA Hesaplayıcı', cta: 'GPA hesapla',
    text: 'Bölümünü seç, notlarını gir; dönem ve genel ortalaman hemen hesaplansın.',
    points: ['Tekrar alınan dersleri hesaba katar', 'Bölüm müfredatıyla hazır gelir'],
  },
  {
    to: '/curriculum', icon: '📋', title: 'Curriculum GPA', cta: 'Müfredatı aç',
    text: 'Seçmelileri müfredattaki yerlerine sürükle, müfredat ortalamanı gör.',
    points: ['Zorunlu ve seçmeli dersleri ayrı gösterir', 'Ders havuzunu kendin oluşturursun'],
  },
];

const steps = [
  { title: 'Programını kur', text: 'Ders Programı’nda dersleri ekle, çakışma ve eksik LAB/P.S. uyarılarını temizle.' },
  { title: 'Planı kopyala', text: 'Kayıt Asistanı’nda bölümünü seç, istersen consent mesajı yaz, “Planı kopyala”ya bas.' },
  { title: 'BUIS’te doldur', text: 'Yer imi veya Tampermonkey ile yardımcıyı aç: “Formu doldur”, sonra BUIS’in Quick Add düğmesi.' },
];

export default function Home() {
  return <div className="home">
    <SiteNav />
    <header className="home-hero">
      <div className="home-hero-inner">
        <p className="home-eyebrow">Boğaziçi öğrencileri için ücretsiz araçlar</p>
        <h1>Ders programını kur, kayıt günü klavyeye dokunmadan doldur.</h1>
        <p className="home-lead">
          {semesterLabel(metadata.semester)} için {metadata.sectionCount.toLocaleString('tr-TR')} şube güncel.
          Çakışmaları gör, planını BUIS’e aktar, ortalamanı hesapla.
        </p>
        <div className="home-cta">
          <Link className="btn btn-primary btn-lg" to="/planner">Programı hazırla →</Link>
          <Link className="btn btn-lg home-btn-light" to="/gpa">GPA hesapla</Link>
        </div>
      </div>
    </header>

    <main className="home-main">
      <section className="home-tools" aria-label="Araçlar">
        {tools.map((tool, i) => <Link key={tool.to} to={tool.to} className={`home-tool ${i === 0 ? 'is-featured' : ''}`}>
          <span className="home-tool-icon" aria-hidden="true">{tool.icon}</span>
          <h2>{tool.title}</h2>
          <p>{tool.text}</p>
          <ul>{tool.points.map(point => <li key={point}>{point}</li>)}</ul>
          <span className="home-tool-cta">{tool.cta} →</span>
        </Link>)}
      </section>

      <section className="home-steps" aria-labelledby="steps-title">
        <h2 id="steps-title">Kayıt günü üç adım</h2>
        <ol>{steps.map((step, i) => <li key={step.title}>
          <span className="home-step-no" aria-hidden="true">{i + 1}</span>
          <div><h3>{step.title}</h3><p>{step.text}</p></div>
        </li>)}</ol>
      </section>
    </main>

    <footer className="home-footer">
      <p>Ders verisi <a href={metadata.sourceUrl} target="_blank" rel="noreferrer">resmî BUIS ders programından</a> alınır · Son güncelleme {formatUpdated(metadata.fetchedAt)}</p>
      <p>BOUN Toolbox öğrenci projesidir; Boğaziçi Üniversitesi’nin resmî sitesi değildir. Kayıt öncesinde bilgileri BUIS’ten doğrulayın.</p>
    </footer>
  </div>;
}
