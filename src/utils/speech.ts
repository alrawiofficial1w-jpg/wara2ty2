/**
 * Multilingual Audio & Official TTS Utility for Wara2ty (ورقتي).
 *
 * Hierarchy:
 *  1. Primary: Server-side Google Gemini-TTS (`gemini-3.8-flash-lite-tts` / `gemini-3.8-flash-tts`)
 *  2. Secondary: Server-side Google Cloud Text-to-Speech (`ar-XA` / `tr-TR` / `en-US`) when configured
 *  3. Tertiary (Optional): Browser `window.speechSynthesis`, ONLY when an authentic
 *     voice matching the exact target language prefix (`ar-`, `tr-`, `en-`) actually exists.
 *
 * Never substitutes an English voice for Arabic or Turkish text.
 */

import { inferLatinLocale, SpeechLocale } from './ttsTextProcessor';

export type TtsProviderId = 'gemini-tts' | 'google-cloud-tts';
export type AudioDiagnosticStage =
  | 'generation'
  | 'validation'
  | 'decoding'
  | 'loading'
  | 'playback';

export interface TtsVoiceOption {
  id: string;
  label: string;
  gender: 'female' | 'male';
  provider: TtsProviderId;
  locales: SpeechLocale[];
  recommended?: boolean;
  cloudVoiceName?: string;
}

export interface TtsStatusInfo {
  available: boolean;
  primaryProvider: TtsProviderId | null;
  secondaryProvider: TtsProviderId | null;
  geminiTtsConfigured: boolean;
  cloudTtsConfigured: boolean;
  supportedArabicLocales: { code: 'ar-EG' | 'ar-XA'; label: string; provider: TtsProviderId }[];
  voices: TtsVoiceOption[];
  configurationNote?: string;
}

export interface VoiceAvailability {
  supported: boolean;
  hasArabic: boolean;
  hasTurkish: boolean;
  hasEnglish: boolean;
  arabicVoiceName?: string;
  turkishVoiceName?: string;
  englishVoiceName?: string;
  allVoicesCount: number;
}

export interface SpeechResult {
  started: boolean;
  provider?: TtsProviderId | 'browser';
  warning?: string;
  code?: string;
  stage?: AudioDiagnosticStage;
}

export interface GeneratedAudioAsset {
  objectUrl: string;
  mimeType: string;
  provider: TtsProviderId;
  modelOrVoice: string;
  byteLength: number;
}

export class AudioStageError extends Error {
  stage: AudioDiagnosticStage;
  code: string;

  constructor(message: string, stage: AudioDiagnosticStage, code = 'AUDIO_ERROR') {
    super(message);
    this.name = 'AudioStageError';
    this.stage = stage;
    this.code = code;
  }
}

// Client-side Blob URL cache storing real MIME types & providers
const audioAssetCache = new Map<string, GeneratedAudioAsset>();
// Deduplicate identical concurrent TTS requests (e.g., prefetch + immediate advance, or rapid clicks)
const inFlightTtsRequests = new Map<string, Promise<GeneratedAudioAsset>>();

let activeWordAudio: HTMLAudioElement | null = null;
let wordAbortController: AbortController | null = null;
let wordPlaybackToken = 0;

export function detectTextLang(text: string, detectedLectureLang?: string): SpeechLocale {
  const clean = String(text || '').trim();
  const hasArabicChars = /[\u0600-\u06FF]/.test(clean);
  const hasLatinChars = /[A-Za-zçğıİöşüÇĞÖŞÜ]/.test(clean);

  if (hasArabicChars && !hasLatinChars) {
    return 'ar-EG';
  }
  if (hasLatinChars && !hasArabicChars) {
    return inferLatinLocale(clean, detectedLectureLang);
  }

  const latinMatches = clean.match(/[A-Za-zçğıİöşüÇĞÖŞÜ]/g)?.length || 0;
  const arabicMatches = clean.match(/[\u0600-\u06FF]/g)?.length || 0;
  if (arabicMatches >= latinMatches) return 'ar-EG';
  return inferLatinLocale(clean, detectedLectureLang);
}

export function getVoiceAvailability(): VoiceAvailability {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return {
      supported: false,
      hasArabic: false,
      hasTurkish: false,
      hasEnglish: false,
      allVoicesCount: 0,
    };
  }
  const voices = window.speechSynthesis.getVoices() || [];
  const arVoice = voices.find((v) => v.lang.toLowerCase().startsWith('ar'));
  const trVoice = voices.find((v) => v.lang.toLowerCase().startsWith('tr'));
  const enVoice = voices.find((v) => v.lang.toLowerCase().startsWith('en'));

  return {
    supported: true,
    hasArabic: Boolean(arVoice),
    hasTurkish: Boolean(trVoice),
    hasEnglish: Boolean(enVoice),
    arabicVoiceName: arVoice?.name,
    turkishVoiceName: trVoice?.name,
    englishVoiceName: enVoice?.name,
    allVoicesCount: voices.length,
  };
}

export function waitForBrowserVoices(timeoutMs = 1000): Promise<VoiceAvailability> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve(getVoiceAvailability());
  }
  const current = window.speechSynthesis.getVoices() || [];
  if (current.length > 0) {
    return Promise.resolve(getVoiceAvailability());
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(getVoiceAvailability());
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

export function pickVoiceForLang(langPrefix: 'tr' | 'ar' | 'en'): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const matches = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
  if (matches.length === 0) return null;
  return (
    matches.find((v) =>
      /natural|google|microsoft|yelda|emel|salma|shakir|hoda|maged|tarik|laila/i.test(v.name)
    ) || matches[0]
  );
}

export async function fetchTtsStatus(): Promise<TtsStatusInfo> {
  const res = await fetch('/api/tts/status');
  const raw = await res.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AudioStageError('استجابة حالة خدمة الصوت غير صالحة.', 'validation', 'INVALID_STATUS_JSON');
  }
  if (!res.ok || !json.success) {
    throw new AudioStageError(
      json.error || 'تعذر التحقق من خدمة الصوت على الخادم.',
      'validation',
      json.code || 'STATUS_FAILED'
    );
  }
  return {
    available: Boolean(json.available),
    primaryProvider: json.primaryProvider || null,
    secondaryProvider: json.secondaryProvider || null,
    geminiTtsConfigured: Boolean(json.geminiTtsConfigured),
    cloudTtsConfigured: Boolean(json.cloudTtsConfigured),
    supportedArabicLocales: Array.isArray(json.supportedArabicLocales)
      ? json.supportedArabicLocales
      : [],
    voices: Array.isArray(json.voices) ? json.voices : [],
    configurationNote: json.configurationNote,
  };
}

function canBrowserPlayMimeType(mimeType: string): boolean {
  if (typeof document === 'undefined') return true;
  const probe = document.createElement('audio');
  if (typeof probe.canPlayType !== 'function') return true;
  const lower = mimeType.toLowerCase();
  if (probe.canPlayType(lower) !== '') return true;
  if (lower === 'audio/wav' && probe.canPlayType('audio/wave') !== '') return true;
  if (lower === 'audio/mpeg' && probe.canPlayType('audio/mp3') !== '') return true;
  return false;
}

function base64ToAudioBlobUrl(
  base64: string,
  mimeType: string
): { objectUrl: string; byteLength: number } {
  const normalizedB64 = String(base64 || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (!normalizedB64) {
    throw new AudioStageError('بيانات الصوت المستلمة فارغة.', 'decoding', 'TTS_EMPTY_AUDIO');
  }

  let binaryString: string;
  try {
    binaryString = atob(normalizedB64);
  } catch {
    throw new AudioStageError('تعذر فك ترميز ملف الصوت المستلم.', 'decoding', 'TTS_BASE64_DECODE_FAILED');
  }

  const len = binaryString.length;
  if (len < 128) {
    throw new AudioStageError('حجم ملف الصوت المستلم غير مكتمل أو تالف.', 'decoding', 'TTS_TRUNCATED_AUDIO');
  }

  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const safeMime = mimeType || 'audio/wav';
  if (!canBrowserPlayMimeType(safeMime)) {
    throw new AudioStageError(
      `صيغة الصوت (${safeMime}) غير مدعومة في هذا المتصفح.`,
      'decoding',
      'UNSUPPORTED_AUDIO_FORMAT'
    );
  }

  const blob = new Blob([bytes], { type: safeMime });
  return {
    objectUrl: URL.createObjectURL(blob),
    byteLength: len,
  };
}

/**
 * Release a cached object URL cleanly if it is no longer needed or failed playback.
 */
export function evictCachedAudioAsset(params: {
  text: string;
  locale: SpeechLocale;
  voiceId?: string;
}): void {
  const cacheKey = `${params.locale}|${params.voiceId || 'default'}|${params.text.trim()}`;
  const existing = audioAssetCache.get(cacheKey);
  if (existing) {
    try {
      URL.revokeObjectURL(existing.objectUrl);
    } catch {
      // ignore
    }
    audioAssetCache.delete(cacheKey);
  }
}

export async function requestServerTtsAudio(params: {
  text: string;
  locale: SpeechLocale;
  voiceId?: string;
  speakingRate?: number;
  signal?: AbortSignal;
}): Promise<GeneratedAudioAsset> {
  const cleanText = String(params.text || '').trim();
  if (!cleanText) {
    throw new AudioStageError('النص المطلوب تحويله إلى صوت فارغ.', 'validation', 'EMPTY_TTS_TEXT');
  }

  const cacheKey = `${params.locale}|${params.voiceId || 'default'}|${cleanText}`;
  const cached = audioAssetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Note: If an external signal aborts while awaiting a shared request, reject cleanly for the caller
  let promise = inFlightTtsRequests.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw new AudioStageError(
          'انقطع الاتصال بالشبكة أثناء توليد الصوت. يرجى التحقق من الإنترنت والمحاولة مجدداً.',
          'generation',
          'NETWORK_OFFLINE'
        );
      }

      const fetchController = new AbortController();
      const timeoutHandle = setTimeout(() => fetchController.abort(), 35000);

      let res: Response;
      try {
        res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: fetchController.signal,
          body: JSON.stringify({
            text: cleanText,
            locale: params.locale,
            voiceId: params.voiceId,
            // Client playbackRate controls speed dynamically without fragmenting cache
            speakingRate: 1.0,
          }),
        });
      } catch (fetchErr: any) {
        clearTimeout(timeoutHandle);
        if (fetchErr?.name === 'AbortError') {
          throw new AudioStageError(
            'انتهت مهلة الاتصال بالخادم أثناء توليد الصوت. يرجى المحاولة مجدداً.',
            'generation',
            'TTS_TIMEOUT'
          );
        }
        throw new AudioStageError(
          'انقطع الاتصال بالشبكة أثناء توليد الصوت. يرجى المحقق من الاتصال والمحاولة مجدداً.',
          'generation',
          'NETWORK_ERROR'
        );
      } finally {
        clearTimeout(timeoutHandle);
      }

      const rawText = await res.text();
      let json: any;
      try {
        json = JSON.parse(rawText);
      } catch {
        throw new AudioStageError(
          'تعذر قراءة استجابة خدمة الصوت من الخادم.',
          'validation',
          'INVALID_TTS_JSON'
        );
      }

      if (!res.ok || !json?.success || !json?.audioBase64) {
        const errStage: AudioDiagnosticStage =
          json?.stage === 'validation'
            ? 'validation'
            : json?.stage === 'decoding'
            ? 'decoding'
            : 'generation';
        throw new AudioStageError(
          json?.error || `تعذر توليد الصوت (HTTP ${res.status}).`,
          errStage,
          json?.code || `HTTP_${res.status}`
        );
      }

      const resolvedMime = String(json.mimeType || 'audio/wav');
      const { objectUrl, byteLength } = base64ToAudioBlobUrl(json.audioBase64, resolvedMime);

      if (audioAssetCache.size >= 80) {
        const oldestKey = audioAssetCache.keys().next().value;
        if (oldestKey) {
          const oldest = audioAssetCache.get(oldestKey);
          if (oldest) {
            try {
              URL.revokeObjectURL(oldest.objectUrl);
            } catch {
              // ignore
            }
          }
          audioAssetCache.delete(oldestKey);
        }
      }

      const asset: GeneratedAudioAsset = {
        objectUrl,
        mimeType: resolvedMime,
        provider: json.provider || 'gemini-tts',
        modelOrVoice: json.modelOrVoice || params.voiceId || 'default',
        byteLength,
      };
      audioAssetCache.set(cacheKey, asset);
      return asset;
    })();

    inFlightTtsRequests.set(cacheKey, promise);
    promise.finally(() => {
      inFlightTtsRequests.delete(cacheKey);
    });
  }

  if (!params.signal) {
    return promise;
  }

  if (params.signal.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  return new Promise<GeneratedAudioAsset>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    params.signal!.addEventListener('abort', onAbort, { once: true });
    promise!.then(
      (res) => {
        params.signal?.removeEventListener('abort', onAbort);
        resolve(res);
      },
      (err) => {
        params.signal?.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

/**
 * Browser-only SpeechSynthesis fallback. Strictly checks that an authentic voice matching
 * the requested language prefix exists and NEVER substitutes an English voice for Arabic or Turkish.
 */
export function speakSingleText(
  text: string,
  preferredLang?: SpeechLocale | 'auto',
  rate = 0.95,
  onEnd?: () => void
): SpeechResult {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return {
      started: false,
      stage: 'validation',
      code: 'BROWSER_TTS_UNSUPPORTED',
      warning: 'متصفحك الحالي لا يدعم القراءة الصوتية المباشرة.',
    };
  }

  const cleanText = String(text || '').trim();
  if (!cleanText) {
    return {
      started: false,
      stage: 'validation',
      code: 'EMPTY_TTS_TEXT',
      warning: 'لا يوجد نص متاح للقراءة.',
    };
  }

  const targetLang: SpeechLocale =
    preferredLang && preferredLang !== 'auto' ? preferredLang : detectTextLang(cleanText);
  const langPrefix = targetLang.startsWith('tr')
    ? 'tr'
    : targetLang.startsWith('en')
    ? 'en'
    : 'ar';

  const voices = window.speechSynthesis.getVoices() || [];
  const matchedVoice = pickVoiceForLang(langPrefix);

  if (!matchedVoice) {
    const labelMap = {
      ar: 'العربية (ar-EG / ar-XA)',
      tr: 'التركية (tr-TR)',
      en: 'الإنجليزية (en-US)',
    };
    return {
      started: false,
      stage: 'validation',
      code: 'NO_BROWSER_VOICE',
      warning:
        voices.length === 0
          ? `لا تتوفر أصوات متصفح محلية حالياً للغة ${labelMap[langPrefix]}.`
          : `لا يتوفر صوت باللغة ${labelMap[langPrefix]} على متصفحك لتفادي النطق بلهجة غير صحيحة.`,
    };
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = targetLang;
  utterance.rate = rate;
  utterance.voice = matchedVoice;
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }

  window.speechSynthesis.speak(utterance);
  return { started: true, provider: 'browser' };
}

/**
 * Single word / short phrase playback used in Vocabulary cards:
 * uses server Gemini-TTS / Cloud TTS first, falling back to browser SpeechSynthesis
 * only if a verified matching browser voice exists.
 */
export async function speakWordWithOfficialTts(
  text: string,
  preferredLang: SpeechLocale | 'auto' = 'auto',
  voiceId?: string,
  detectedLectureLang?: string,
  onEnd?: () => void
): Promise<SpeechResult> {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    return { started: false, stage: 'validation', warning: 'لا يوجد نص متاح للقراءة.' };
  }

  const targetLocale: SpeechLocale =
    preferredLang !== 'auto' ? preferredLang : detectTextLang(cleanText, detectedLectureLang);

  const token = ++wordPlaybackToken;
  stopSpeech();

  const controller = new AbortController();
  wordAbortController = controller;

  try {
    const audioRes = await requestServerTtsAudio({
      text: cleanText,
      locale: targetLocale,
      voiceId,
      signal: controller.signal,
    });
    if (token !== wordPlaybackToken) {
      return { started: false };
    }

    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = audioRes.objectUrl;
    activeWordAudio = audio;

    audio.onended = () => {
      if (token === wordPlaybackToken) {
        activeWordAudio = null;
        onEnd?.();
      }
    };
    audio.onerror = () => {
      if (token === wordPlaybackToken) {
        activeWordAudio = null;
        onEnd?.();
      }
    };

    try {
      await audio.play();
      return { started: true, provider: audioRes.provider };
    } catch (playErr: any) {
      if (playErr?.name === 'NotAllowedError') {
        onEnd?.();
        return {
          started: false,
          stage: 'playback',
          code: 'AUTOPLAY_BLOCKED',
          warning: 'المتصفح منع تشغيل الصوت تلقائياً. يرجى الضغط مرة أخرى على أيقونة الصوت.',
        };
      }
      throw new AudioStageError(
        'تعذر تشغيل ملف الصوت في المتصفح.',
        'playback',
        playErr?.name || 'PLAY_FAILED'
      );
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || token !== wordPlaybackToken) {
      return { started: false };
    }
    const fallback = speakSingleText(cleanText, targetLocale, 0.95, onEnd);
    if (fallback.started) {
      return fallback;
    }
    onEnd?.();
    return {
      started: false,
      stage: err instanceof AudioStageError ? err.stage : 'generation',
      code: err instanceof AudioStageError ? err.code : 'TTS_FAILED',
      warning:
        err?.message ||
        fallback.warning ||
        'تعذر تشغيل الصوت عبر الخادم، ولا يتوفر صوت مطابق مثبت في المتصفح.',
    };
  }
}

export function pauseSpeech(): void {
  if (activeWordAudio && !activeWordAudio.paused) {
    activeWordAudio.pause();
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.pause();
  }
}

export function resumeSpeech(): void {
  if (activeWordAudio && activeWordAudio.paused) {
    activeWordAudio.play().catch(() => {});
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.resume();
  }
}

export function stopSpeech(): void {
  if (wordAbortController) {
    wordAbortController.abort();
    wordAbortController = null;
  }
  if (activeWordAudio) {
    try {
      activeWordAudio.onended = null;
      activeWordAudio.onerror = null;
      activeWordAudio.pause();
      activeWordAudio.removeAttribute('src');
      activeWordAudio.load();
    } catch {
      // ignore
    }
    activeWordAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
