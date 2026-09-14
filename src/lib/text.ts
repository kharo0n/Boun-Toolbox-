const TURKISH_LETTERS = /[ÇĞİÖŞÜçğıöşü]/;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 've', 'ile']);
const ROMAN = /^(?=[IVXL]+$)L?X{0,3}(IX|IV|V?I{0,3})$/;
const lower = (word: string) => word.toLocaleLowerCase(TURKISH_LETTERS.test(word) ? 'tr-TR' : 'en-US');
const upperFirst = (word: string) => word.charAt(0).toLocaleUpperCase(TURKISH_LETTERS.test(word) ? 'tr-TR' : 'en-US') + word.slice(1);

/**
 * BUIS prints course names in capitals. "INTRODUCTION TO COMPUTING" → "Introduction to Computing",
 * "TÜRK DİLİ I" → "Türk Dili I". Turkish casing only applies to words that carry Turkish letters,
 * so English words keep their dotted i. Roman numerals and short codes stay as they are.
 */
export function displayName(name: string) {
  if (!name || name !== name.toUpperCase()) return name;
  return name.split(/(\s+|-|\/|\(|\))/).map((part, i, parts) => {
    if (!/[A-Za-zÇĞİÖŞÜ]/.test(part)) return part;
    const word = lower(part);
    if (i > 0 && /^\s+$/.test(parts[i - 1]) && SMALL_WORDS.has(word)) return word;
    if (ROMAN.test(part) || part.length <= 2) return part; // II, IE, EC
    return upperFirst(word);
  }).join('');
}

export function semesterLabel(semester: string) {
  const [years, term] = semester.split('-');
  return `${years} ${term === '1' ? 'Güz' : term === '2' ? 'Bahar' : 'Yaz'}`;
}

export function formatUpdated(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}
