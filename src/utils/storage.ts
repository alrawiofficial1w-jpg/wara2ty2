import { AnalysisData, SavedLectureRecord, VocabItem } from '../types';

const STORAGE_KEY_RESULT = 'wara2ty_latest_analysis_v1';
const STORAGE_KEY_IMAGE = 'wara2ty_latest_image_v1';
const STORAGE_KEY_TIMESTAMP = 'wara2ty_latest_timestamp_v1';
const STORAGE_KEY_LIBRARY = 'wara2ty_lectures_library_v1';
const STORAGE_KEY_SAVED_VOCAB = 'wara2ty_saved_vocab_v1';

export interface SavedSession {
  data: AnalysisData;
  image: string | null;
  savedAt: string | null;
}

export function saveAnalysisSession(data: AnalysisData, imageBase64: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const nowIso = new Date().toISOString();

  try {
    window.localStorage.setItem(STORAGE_KEY_RESULT, JSON.stringify(data));
    window.localStorage.setItem(STORAGE_KEY_TIMESTAMP, nowIso);
  } catch (err) {
    console.warn('Could not save analysis result to localStorage:', err);
    try {
      window.localStorage.removeItem(STORAGE_KEY_IMAGE);
      window.localStorage.setItem(STORAGE_KEY_RESULT, JSON.stringify(data));
      window.localStorage.setItem(STORAGE_KEY_TIMESTAMP, nowIso);
    } catch {
      // Ignore if localStorage is disabled
    }
  }

  if (imageBase64) {
    try {
      if (imageBase64.length < 2_500_000) {
        window.localStorage.setItem(STORAGE_KEY_IMAGE, imageBase64);
      } else {
        window.localStorage.removeItem(STORAGE_KEY_IMAGE);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY_IMAGE);
    }
  }
}

export function loadAnalysisSession(): SavedSession | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;

  try {
    const rawResult = window.localStorage.getItem(STORAGE_KEY_RESULT);
    if (!rawResult) return null;

    const parsed = JSON.parse(rawResult) as AnalysisData;
    if (!parsed || !parsed.extractedText || !parsed.summary) {
      return null;
    }

    const savedImage = window.localStorage.getItem(STORAGE_KEY_IMAGE);
    const savedAt = window.localStorage.getItem(STORAGE_KEY_TIMESTAMP);

    return {
      data: parsed,
      image: savedImage || null,
      savedAt: savedAt || null,
    };
  } catch (err) {
    console.warn('Failed to load saved session from localStorage:', err);
    return null;
  }
}

export function clearAnalysisSession(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_RESULT);
    window.localStorage.removeItem(STORAGE_KEY_IMAGE);
    window.localStorage.removeItem(STORAGE_KEY_TIMESTAMP);
  } catch {
    // Ignore
  }
}

// --- Connected Saved Lectures Library (Local Browser Persistence) ---

export function loadLecturesLibrary(): SavedLectureRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_LIBRARY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLecturesLibrary(list: SavedLectureRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const trimmed = list.slice(0, 20);
  try {
    window.localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(trimmed));
  } catch {
    // If quota is tight, strip preview images from older lectures and retry
    try {
      const stripped = trimmed.map((item, idx) =>
        idx === 0 ? item : { ...item, previewImage: null }
      );
      window.localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(stripped));
    } catch {
      try {
        const noImages = trimmed.map((item) => ({ ...item, previewImage: null }));
        window.localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(noImages.slice(0, 10)));
      } catch {
        // Ignore if storage completely full
      }
    }
  }
}

export function saveLectureToLibrary(
  data: AnalysisData,
  previewImage: string | null,
  options?: { id?: string; subject?: string; tags?: string[] }
): SavedLectureRecord {
  const existing = loadLecturesLibrary();
  const now = new Date().toISOString();
  const title = data.summary?.title || 'محاضرة بدون عنوان';

  const id =
    options?.id ||
    existing.find((l) => l.title === title && l.data?.extractedText === data.extractedText)?.id ||
    `lec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const prev = existing.find((l) => l.id === id);

  const record: SavedLectureRecord = {
    id,
    title,
    subject: options?.subject || prev?.subject || data.topics?.[0] || 'مادة دراسية عامة',
    tags: options?.tags || prev?.tags || (data.topics || []).slice(0, 4),
    detectedLanguage: data.detectedLanguage || 'غير محدد',
    savedAt: prev?.savedAt || now,
    updatedAt: now,
    pageCount: data.pageCount || data.pages?.length || 1,
    data,
    previewImage:
      previewImage && previewImage.length < 400_000 ? previewImage : prev?.previewImage || null,
  };

  const next = [record, ...existing.filter((l) => l.id !== id)];
  persistLecturesLibrary(next);
  return record;
}

export function updateLectureMetadata(
  id: string,
  updates: { title?: string; subject?: string; tags?: string[] }
): SavedLectureRecord[] {
  const existing = loadLecturesLibrary();
  const next = existing.map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      title: updates.title !== undefined ? updates.title : item.title,
      subject: updates.subject !== undefined ? updates.subject : item.subject,
      tags: updates.tags !== undefined ? updates.tags : item.tags,
      updatedAt: new Date().toISOString(),
      data:
        updates.title !== undefined
          ? { ...item.data, summary: { ...item.data.summary, title: updates.title } }
          : item.data,
    };
  });
  persistLecturesLibrary(next);
  return next;
}

export function deleteLectureFromLibrary(id: string): SavedLectureRecord[] {
  const existing = loadLecturesLibrary();
  const next = existing.filter((l) => l.id !== id);
  persistLecturesLibrary(next);
  return next;
}

// --- Saved Vocabulary Bookmarks ---

export function loadSavedVocabulary(): VocabItem[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SAVED_VOCAB);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function toggleSaveVocabWord(item: VocabItem): { saved: VocabItem[]; isNowSaved: boolean } {
  const existing = loadSavedVocabulary();
  const exists = existing.some((v) => v.word.toLowerCase() === item.word.toLowerCase());
  const next = exists
    ? existing.filter((v) => v.word.toLowerCase() !== item.word.toLowerCase())
    : [item, ...existing];
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY_SAVED_VOCAB, JSON.stringify(next.slice(0, 200)));
    } catch {
      // Ignore quota errors
    }
  }
  return { saved: next, isNowSaved: !exists };
}
