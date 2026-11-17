export type SpeechLocale = 'ar-EG' | 'ar-XA' | 'tr-TR' | 'en-US';

export interface SpeechSubSegment {
  id: string;
  text: string;
  locale: SpeechLocale;
  langLabel: string;
}

const LOCALE_LABELS: Record<SpeechLocale, string> = {
  'ar-EG': 'العربية (مصر)',
  'ar-XA': 'العربية الفصحى',
  'tr-TR': 'التركية',
  'en-US': 'الإنجليزية',
};

const TURKISH_DIACRITICS_RE = /[çğıİöşüÇĞÖŞÜ]/;
const ARABIC_CHAR_RE = /[\u0600-\u06FF]/;
const LATIN_LETTER_RE = /[A-Za-zçğıİöşüÇĞÖŞÜ]/;

const TURKISH_COMMON_TOKENS = new Set([
  'zaman',
  'zamanlar',
  'genis',
  'simdiki',
  'gecmis',
  'gelecek',
  'fiil',
  'fiiller',
  'kok',
  'ek',
  'ekler',
  'cumle',
  'ornek',
  'olumlu',
  'olumsuz',
  'sayfa',
  'dun',
  'yarin',
  'bugun',
  'her',
  'sabah',
  'ders',
  'sinav',
  'kural',
  'ozne',
  'yuklem',
  'turkce',
  'turkcede',
  'edebiyat',
  'sindirim',
  'mide',
  'bagirsak',
  'karaciger',
  'ile',
  'icin',
  'veya',
  'ama',
  'fakat',
  'gibi',
  'kadar',
  'sonra',
  'once',
  'uzere',
  'calisirim',
  'yaziyorum',
  'gidecegim',
  'okurum',
  'bitti',
  'gelmek',
  'gitmek',
  'yapmak',
  'okumak',
  'yazmak',
  'bilmek',
  'almak',
  'vermek',
  'gormek',
  'demek',
  'istemek',
  'sevmek',
  'evet',
  'hayir',
  'merhaba',
  'lutfen',
  'kitap',
  'okul',
  'sinif',
  'kelime',
  'gramer',
  'soru',
  'cevap',
  'konu',
  'dersler',
  'kalem',
  'masa',
  'su',
  'ekmek',
  'insan',
  'hayat',
  'bilgi',
  'tarih',
  'turkiye',
  'istanbul',
  'ankara',
]);

const ENGLISH_COMMON_TOKENS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'into',
  'machine',
  'learning',
  'deep',
  'neural',
  'network',
  'networks',
  'data',
  'model',
  'models',
  'system',
  'systems',
  'algorithm',
  'algorithms',
  'function',
  'database',
  'server',
  'client',
  'api',
  'cloud',
  'protein',
  'enzyme',
  'enzymes',
  'acid',
  'acids',
  'cell',
  'cells',
  'timeline',
  'diagram',
  'table',
  'example',
  'examples',
  'past',
  'now',
  'present',
  'future',
  'note',
  'notes',
  'summary',
  'software',
  'hardware',
  'analysis',
  'process',
]);

/**
 * Clean lecture text for natural speech synthesis without altering its meaning
 * or omitting paragraphs. Removes markdown formatting markers and extra spacing
 * while keeping punctuation and natural sentence/paragraph pauses intact.
 */
export function prepareSpeechText(raw: string): string {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ' '))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\[صفحة\s*(\d+)\]/g, 'صفحة $1.')
    .replace(/\[غير واضح\]/g, 'جزء غير واضح.')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Infer whether a predominantly Latin-script span is Turkish (tr-TR) or English (en-US).
 */
export function inferLatinLocale(
  span: string,
  detectedLectureLang?: string
): 'tr-TR' | 'en-US' {
  if (TURKISH_DIACRITICS_RE.test(span)) {
    return 'tr-TR';
  }

  const words = span
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

  let trScore = 0;
  let enScore = 0;

  for (const w of words) {
    if (TURKISH_COMMON_TOKENS.has(w)) trScore += 2;
    if (ENGLISH_COMMON_TOKENS.has(w)) enScore += 2;
  }

  // Common Turkish tense suffix notations
  if (/-(?:i?yor|acak|ecek|m[iıuü]ş|m[iıuü]s|d[iıuü]|lar|ler)\b/i.test(span)) {
    trScore += 2;
  }

  if (trScore > enScore) return 'tr-TR';
  if (enScore > trScore) return 'en-US';

  const langHint = (detectedLectureLang || '').toLowerCase();
  const hintsTurkish = /ترك|turk/.test(langHint);
  const hintsEnglish = /إنجليز|انجليز|english/.test(langHint);

  // Common English multi-word capitalization or well-known tech acronyms default to English
  if (hintsEnglish && !hintsTurkish) return 'en-US';
  if (hintsTurkish && !hintsEnglish) {
    // Even in Turkish-Arabic lectures, uppercase acronyms like PDF/DNA/CPU or English phrases read better in English unless clearly Turkish
    if (/^[A-Z0-9\-\/]{2,8}$/.test(span.trim())) return 'en-US';
    return 'tr-TR';
  }

  return 'en-US';
}

/**
 * Split text into mixed-language sub-segments preserving exact lecture order.
 * Arabic sentences remain grouped naturally up to ~550 chars; embedded Turkish
 * or English phrases are isolated cleanly so each language gets its verified voice.
 */
export function segmentMultilingualLectureText(
  rawText: string,
  options: {
    arabicLocale: 'ar-EG' | 'ar-XA';
    detectedLanguage?: string;
    forcedLocale?: SpeechLocale | 'auto';
  }
): SpeechSubSegment[] {
  const cleaned = prepareSpeechText(rawText);
  if (!cleaned) return [];

  if (options.forcedLocale && options.forcedLocale !== 'auto') {
    return chunkLongText(cleaned, 550).map((chunk, idx) => ({
      id: `seg-${idx}-${options.forcedLocale}`,
      text: chunk,
      locale: options.forcedLocale as SpeechLocale,
      langLabel: LOCALE_LABELS[options.forcedLocale as SpeechLocale],
    }));
  }

  // First split by paragraph and sentence punctuation to avoid overly long requests
  const sentenceLikeUnits = cleaned
    .split(/(?<=[.!؟?\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const rawSpans: { text: string; locale: SpeechLocale }[] = [];

  // Match contiguous Latin/Turkish runs starting strictly with a letter
  const latinSpanRegex =
    /[A-Za-zçğıİöşüÇĞÖŞÜ](?:[A-Za-z0-9çğıİöşüÇĞÖŞÜ\s\-\/'’&()+]*[A-Za-zçğıİöşüÇĞÖŞÜ0-9)])?|[A-Za-zçğıİöşüÇĞÖŞÜ]{2,}/g;

  for (const unit of sentenceLikeUnits) {
    const hasAr = ARABIC_CHAR_RE.test(unit);
    const hasLat = LATIN_LETTER_RE.test(unit);

    if (hasAr && !hasLat) {
      rawSpans.push({ text: unit, locale: options.arabicLocale });
      continue;
    }

    if (hasLat && !hasAr) {
      rawSpans.push({
        text: unit,
        locale: inferLatinLocale(unit, options.detectedLanguage),
      });
      continue;
    }

    // Mixed sentence: split along Latin/Turkish spans while keeping Arabic punctuation & context smooth
    let lastIdx = 0;
    latinSpanRegex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = latinSpanRegex.exec(unit)) !== null) {
      const matchStart = match.index;
      const matchText = match[0].trim();
      const matchEnd = match.index + match[0].length;

      // Ignore tiny standalone symbols or single-letter punctuation noise
      if (!LATIN_LETTER_RE.test(matchText) || matchText.replace(/[^A-Za-zçğıİöşüÇĞÖŞÜ]/g, '').length < 2) {
        continue;
      }

      if (matchStart > lastIdx) {
        const beforeAr = unit.slice(lastIdx, matchStart).trim();
        if (beforeAr && /[\u0600-\u06FF0-9]/.test(beforeAr)) {
          rawSpans.push({ text: beforeAr, locale: options.arabicLocale });
        }
      }

      rawSpans.push({
        text: matchText,
        locale: inferLatinLocale(matchText, options.detectedLanguage),
      });
      lastIdx = matchEnd;
    }

    if (lastIdx < unit.length) {
      const tail = unit.slice(lastIdx).trim();
      if (tail && /[\u0600-\u06FF0-9]/.test(tail)) {
        rawSpans.push({ text: tail, locale: options.arabicLocale });
      }
    }
  }

  // Merge adjacent spans that share the same locale up to ~550 chars
  const merged: SpeechSubSegment[] = [];
  for (const span of rawSpans) {
    const txt = span.text.trim();
    if (!txt) continue;

    const prev = merged[merged.length - 1];
    if (prev && prev.locale === span.locale && prev.text.length + 1 + txt.length <= 550) {
      prev.text = `${prev.text} ${txt}`;
    } else {
      for (const chunk of chunkLongText(txt, 550)) {
        merged.push({
          id: `seg-${merged.length}-${span.locale}`,
          text: chunk,
          locale: span.locale,
          langLabel: LOCALE_LABELS[span.locale],
        });
      }
    }
  }

  return merged;
}

function chunkLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const words = text.split(/\s+/);
  let current = '';

  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = w;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
