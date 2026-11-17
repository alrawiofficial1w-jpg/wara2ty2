import { GoogleGenAI } from '@google/genai';
import { getGenAI, isRetryableOrOverloadError, translateErrorToArabic } from './geminiService';

export type SupportedTtsLocale = 'ar-EG' | 'ar-XA' | 'tr-TR' | 'en-US';
export type TtsProviderId = 'gemini-tts' | 'google-cloud-tts';

export interface TtsVoiceOption {
  id: string;
  label: string;
  gender: 'female' | 'male';
  provider: TtsProviderId;
  locales: SupportedTtsLocale[];
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

export interface SynthesizeSegmentInput {
  text: string;
  locale: string;
  voiceId?: string;
  speakingRate?: number;
}

export interface SynthesizeSegmentResult {
  audioBase64: string;
  mimeType: string;
  provider: TtsProviderId;
  modelOrVoice: string;
  locale: SupportedTtsLocale;
  byteLength: number;
}

export class TtsServiceError extends Error {
  status: number;
  code: string;
  stage: 'validation' | 'generation' | 'decoding';

  constructor(
    message: string,
    options: { status: number; code: string; stage: 'validation' | 'generation' | 'decoding' }
  ) {
    super(message);
    this.name = 'TtsServiceError';
    this.status = options.status;
    this.code = options.code;
    this.stage = options.stage;
  }
}

const VALID_LOCALES: SupportedTtsLocale[] = ['ar-EG', 'ar-XA', 'tr-TR', 'en-US'];

// Verified prebuilt voices documented in gemini_api/references/speech_and_audio.md
const GEMINI_PREBUILT_VOICES: TtsVoiceOption[] = [
  {
    id: 'gemini:Kore',
    label: 'Kore — صوت نسائي واضح (موصى به للمحاضرات)',
    gender: 'female',
    provider: 'gemini-tts',
    locales: ['ar-EG', 'ar-XA', 'tr-TR', 'en-US'],
    recommended: true,
  },
  {
    id: 'gemini:Zephyr',
    label: 'Zephyr — صوت نسائي هادئ ودافئ',
    gender: 'female',
    provider: 'gemini-tts',
    locales: ['ar-EG', 'ar-XA', 'tr-TR', 'en-US'],
  },
  {
    id: 'gemini:Charon',
    label: 'Charon — صوت رجالي رصين وعميق',
    gender: 'male',
    provider: 'gemini-tts',
    locales: ['ar-EG', 'ar-XA', 'tr-TR', 'en-US'],
  },
  {
    id: 'gemini:Puck',
    label: 'Puck — صوت رجالي واضح ونشيط',
    gender: 'male',
    provider: 'gemini-tts',
    locales: ['ar-EG', 'ar-XA', 'tr-TR', 'en-US'],
  },
  {
    id: 'gemini:Fenrir',
    label: 'Fenrir — صوت رجالي ثابت ومعتدل',
    gender: 'male',
    provider: 'gemini-tts',
    locales: ['ar-EG', 'ar-XA', 'tr-TR', 'en-US'],
  },
];

// Official Google Cloud Text-to-Speech verified ar-XA WaveNet voices
const CLOUD_TTS_VOICES: TtsVoiceOption[] = [
  {
    id: 'cloud:ar-XA-Wavenet-A',
    label: 'Cloud WaveNet A — عربية فصحى (أنثى)',
    gender: 'female',
    provider: 'google-cloud-tts',
    locales: ['ar-XA'],
    cloudVoiceName: 'ar-XA-Wavenet-A',
  },
  {
    id: 'cloud:ar-XA-Wavenet-B',
    label: 'Cloud WaveNet B — عربية فصحى (ذكر)',
    gender: 'male',
    provider: 'google-cloud-tts',
    locales: ['ar-XA'],
    cloudVoiceName: 'ar-XA-Wavenet-B',
  },
  {
    id: 'cloud:ar-XA-Wavenet-C',
    label: 'Cloud WaveNet C — عربية فصحى (ذكر)',
    gender: 'male',
    provider: 'google-cloud-tts',
    locales: ['ar-XA'],
    cloudVoiceName: 'ar-XA-Wavenet-C',
  },
  {
    id: 'cloud:ar-XA-Wavenet-D',
    label: 'Cloud WaveNet D — عربية فصحى (أنثى)',
    gender: 'female',
    provider: 'google-cloud-tts',
    locales: ['ar-XA'],
    cloudVoiceName: 'ar-XA-Wavenet-D',
  },
];

// Cached runtime verification for optional Google Cloud TTS key
let cloudProbeCache: { checkedAt: number; key: string; valid: boolean; note?: string } | null = null;
// Bounded server-side LRU cache for identical synthesized segments (reduces RPM quota usage on replays)
const MAX_SERVER_TTS_CACHE = 40;
const serverTtsCache = new Map<string, SynthesizeSegmentResult>();

export function hasGeminiApiKey(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.trim().length > 10);
}

export function getGoogleCloudTtsApiKey(): string | null {
  const raw = process.env.GOOGLE_CLOUD_TTS_API_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  // Reject empty or placeholder strings injected by template environments
  if (
    trimmed.length < 20 ||
    /^MY_|^YOUR_|PLACEHOLDER|OPTIONAL/i.test(trimmed) ||
    !trimmed.startsWith('AIza')
  ) {
    return null;
  }
  return trimmed;
}

export async function isCloudTtsActuallyUsable(): Promise<{ usable: boolean; note?: string }> {
  const key = getGoogleCloudTtsApiKey();
  if (!key) return { usable: false };

  const now = Date.now();
  if (cloudProbeCache && cloudProbeCache.key === key && now - cloudProbeCache.checkedAt < 10 * 60 * 1000) {
    return { usable: cloudProbeCache.valid, note: cloudProbeCache.note };
  }

  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/voices?languageCode=ar-XA&key=${encodeURIComponent(key)}`
    );
    const json: any = await res.json();
    const valid = res.ok && Array.isArray(json?.voices) && json.voices.length > 0;
    const note = valid
      ? undefined
      : json?.error?.message || `Google Cloud TTS verification failed (HTTP ${res.status})`;
    cloudProbeCache = { checkedAt: now, key, valid, note };
    return { usable: valid, note };
  } catch (err: any) {
    const note = err?.message || 'Unable to verify Google Cloud TTS endpoint';
    cloudProbeCache = { checkedAt: now, key, valid: false, note };
    return { usable: false, note };
  }
}

export async function getTtsStatus(): Promise<TtsStatusInfo> {
  const geminiTtsConfigured = hasGeminiApiKey();
  const cloudCheck = await isCloudTtsActuallyUsable();
  const cloudTtsConfigured = cloudCheck.usable;

  const voices: TtsVoiceOption[] = [];
  const supportedArabicLocales: { code: 'ar-EG' | 'ar-XA'; label: string; provider: TtsProviderId }[] = [];

  if (geminiTtsConfigured) {
    voices.push(...GEMINI_PREBUILT_VOICES);
    supportedArabicLocales.push(
      { code: 'ar-EG', label: 'العربية (مصر) — ar-EG', provider: 'gemini-tts' },
      { code: 'ar-XA', label: 'العربية الفصحى — ar-XA', provider: 'gemini-tts' }
    );
  }

  if (cloudTtsConfigured) {
    voices.push(...CLOUD_TTS_VOICES);
    if (!geminiTtsConfigured) {
      supportedArabicLocales.push({
        code: 'ar-XA',
        label: 'العربية الفصحى — ar-XA (Google Cloud TTS)',
        provider: 'google-cloud-tts',
      });
    }
  }

  const primaryProvider: TtsProviderId | null = geminiTtsConfigured
    ? 'gemini-tts'
    : cloudTtsConfigured
    ? 'google-cloud-tts'
    : null;

  const secondaryProvider: TtsProviderId | null =
    geminiTtsConfigured && cloudTtsConfigured ? 'google-cloud-tts' : null;

  let configurationNote: string | undefined;
  if (!geminiTtsConfigured && !cloudTtsConfigured) {
    configurationNote =
      'لم يتم ضبط مفتاح GEMINI_API_KEY أو GOOGLE_CLOUD_TTS_API_KEY صالح على الخادم لتوليد الصوت العربي الرسمي.';
  } else if (getGoogleCloudTtsApiKey() && !cloudTtsConfigured && cloudCheck.note) {
    configurationNote = `ملاحظة حول البديل الثانوي (Google Cloud TTS): ${cloudCheck.note}`;
  }

  return {
    available: Boolean(primaryProvider),
    primaryProvider,
    secondaryProvider,
    geminiTtsConfigured,
    cloudTtsConfigured,
    supportedArabicLocales,
    voices,
    configurationNote,
  };
}

export function normalizeSpeechTextServer(raw: string): string {
  return String(raw || '')
    .replace(/[*_`~#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGeminiStyleForLocale(locale: SupportedTtsLocale): string {
  switch (locale) {
    case 'ar-EG':
      return 'Read clearly in natural Egyptian Arabic (ar-EG) academic lecture narration style. Pronounce Arabic academic terminology accurately, respect punctuation pauses, and read ONLY the exact provided text without adding any extra words.';
    case 'ar-XA':
      return 'Read clearly in Modern Standard Arabic academic lecture narration style. Pronounce Arabic words with accurate articulation, respect punctuation pauses, and read ONLY the exact provided text without adding any extra words.';
    case 'tr-TR':
      return 'Read clearly in native Istanbul Turkish (tr-TR) academic pronunciation. Respect Turkish vowels and suffixes accurately, and read ONLY the exact provided text without translating or adding words.';
    case 'en-US':
      return 'Read clearly in standard American English (en-US) academic pronunciation. Read ONLY the exact provided text without adding extra words.';
  }
}

/**
 * Wrap raw 24kHz mono 16-bit LE PCM bytes in a standard 44-byte RIFF/WAVE header
 * if a streaming/PCM response ever lacks a WAV container.
 */
function wrapPcm16AsWav(pcmBytes: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBytes.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBytes.length, 40);
  return Buffer.concat([header, pcmBytes]);
}

/**
 * Inspect actual returned audio bytes and verify/normalize into a browser-playable MIME type.
 * Rejects empty, truncated, or unrecognizable audio payloads instead of assuming format.
 */
export function validateAndNormalizeAudioPayload(
  rawBase64: string,
  declaredMimeType: string | undefined
): { audioBase64: string; mimeType: string; byteLength: number } {
  const cleanB64 = String(rawBase64 || '')
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (!cleanB64) {
    throw new TtsServiceError('أعاد مزود الصوت استجابة فارغة بدون بيانات صوتية.', {
      status: 502,
      code: 'TTS_EMPTY_AUDIO',
      stage: 'decoding',
    });
  }

  let buf: Buffer = Buffer.from(cleanB64, 'base64');
  if (buf.length < 128) {
    throw new TtsServiceError('بيانات الصوت المستلمة غير مكتملة أو تالفة.', {
      status: 502,
      code: 'TTS_EMPTY_AUDIO',
      stage: 'decoding',
    });
  }

  const head4 = buf.subarray(0, 4).toString('ascii');
  const head8To12 = buf.subarray(8, 12).toString('ascii');
  const head3 = buf.subarray(0, 3).toString('ascii');
  const isWav = head4 === 'RIFF' && head8To12 === 'WAVE';
  const isMp3 = head3 === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  const isOgg = head4 === 'OggS';
  const isFlac = head4 === 'fLaC';
  const lowerDeclared = String(declaredMimeType || '').toLowerCase();

  if (isWav) {
    return { audioBase64: buf.toString('base64'), mimeType: 'audio/wav', byteLength: buf.length };
  }
  if (isMp3) {
    return { audioBase64: buf.toString('base64'), mimeType: 'audio/mpeg', byteLength: buf.length };
  }
  if (isOgg) {
    return { audioBase64: buf.toString('base64'), mimeType: 'audio/ogg', byteLength: buf.length };
  }
  if (isFlac) {
    return { audioBase64: buf.toString('base64'), mimeType: 'audio/flac', byteLength: buf.length };
  }

  if (lowerDeclared.includes('l16') || lowerDeclared.includes('pcm')) {
    const rateMatch = lowerDeclared.match(/rate=(\d+)/);
    const rate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    buf = wrapPcm16AsWav(buf, Number.isFinite(rate) && rate >= 8000 ? rate : 24000, 1);
    return { audioBase64: buf.toString('base64'), mimeType: 'audio/wav', byteLength: buf.length };
  }

  throw new TtsServiceError(
    `أعاد مزود الصوت صيغة غير مدعومة أو غير صالحة للتشغيل (${declaredMimeType || 'unknown'}).`,
    {
      status: 502,
      code: 'TTS_INVALID_AUDIO_FORMAT',
      stage: 'decoding',
    }
  );
}

function validateRequestedLocaleAndVoice(
  rawLocale: string,
  rawVoiceId: string | undefined,
  geminiEnabled: boolean,
  cloudKey: string | null
): {
  locale: SupportedTtsLocale;
  targetProvider: TtsProviderId;
  geminiVoiceName: string;
  cloudVoice?: { languageCode: string; name: string };
} {
  if (!VALID_LOCALES.includes(rawLocale as SupportedTtsLocale)) {
    throw new TtsServiceError(
      `اللغة أو اللهجة المطلوبة (${rawLocale}) غير مدعومة حالياً. اللهجات المدعومة: ar-EG, ar-XA, tr-TR, en-US.`,
      {
        status: 400,
        code: 'TTS_UNSUPPORTED_LOCALE',
        stage: 'validation',
      }
    );
  }

  const locale = rawLocale as SupportedTtsLocale;

  if (!geminiEnabled && !cloudKey) {
    throw new TtsServiceError(
      'خدمة التوليد الصوتي غير مضبوطة على الخادم (GEMINI_API_KEY أو GOOGLE_CLOUD_TTS_API_KEY غير متوفر).',
      {
        status: 503,
        code: 'TTS_NOT_CONFIGURED',
        stage: 'validation',
      }
    );
  }

  if (!geminiEnabled && cloudKey && locale === 'ar-EG') {
    throw new TtsServiceError(
      'اللهجة المصرية (ar-EG) تتطلب تفعيل Gemini-TTS. المتاح حالياً عبر Google Cloud TTS هو العربية الفصحى (ar-XA).',
      {
        status: 400,
        code: 'TTS_UNSUPPORTED_LOCALE',
        stage: 'validation',
      }
    );
  }

  if (rawVoiceId !== undefined && rawVoiceId !== '') {
    if (rawVoiceId.startsWith('gemini:')) {
      if (!geminiEnabled) {
        throw new TtsServiceError('الصوت المختار يتطلب تفعيل GEMINI_API_KEY على الخادم.', {
          status: 400,
          code: 'TTS_UNSUPPORTED_VOICE',
          stage: 'validation',
        });
      }
      const voiceName = rawVoiceId.slice('gemini:'.length);
      const validVoice = GEMINI_PREBUILT_VOICES.find((v) => v.id === rawVoiceId);
      if (!validVoice || !validVoice.locales.includes(locale)) {
        throw new TtsServiceError(`الصوت المحدد (${rawVoiceId}) غير مدعوم للغة (${locale}).`, {
          status: 400,
          code: 'TTS_UNSUPPORTED_VOICE',
          stage: 'validation',
        });
      }
      return { locale, targetProvider: 'gemini-tts', geminiVoiceName: voiceName };
    }

    if (rawVoiceId.startsWith('cloud:')) {
      if (!cloudKey) {
        throw new TtsServiceError('الصوت المختار من Google Cloud غير مفعّل على الخادم.', {
          status: 400,
          code: 'TTS_UNSUPPORTED_VOICE',
          stage: 'validation',
        });
      }
      const validCloud = CLOUD_TTS_VOICES.find((v) => v.id === rawVoiceId);
      if (!validCloud || !validCloud.locales.includes(locale)) {
        throw new TtsServiceError(
          `صوت Google Cloud المحدد (${rawVoiceId}) غير متوافق مع اللغة (${locale}).`,
          {
            status: 400,
            code: 'TTS_UNSUPPORTED_VOICE',
            stage: 'validation',
          }
        );
      }
      return {
        locale,
        targetProvider: 'google-cloud-tts',
        geminiVoiceName: 'Kore',
        cloudVoice: { languageCode: 'ar-XA', name: validCloud.cloudVoiceName! },
      };
    }

    throw new TtsServiceError(`معرّف الصوت المطلوب (${rawVoiceId}) غير معروف أو غير مدعوم.`, {
      status: 400,
      code: 'TTS_UNSUPPORTED_VOICE',
      stage: 'validation',
    });
  }

  if (geminiEnabled) {
    return { locale, targetProvider: 'gemini-tts', geminiVoiceName: 'Kore' };
  }

  const fallbackCloudVoice =
    locale === 'tr-TR'
      ? { languageCode: 'tr-TR', name: 'tr-TR-Wavenet-A' }
      : locale === 'en-US'
      ? { languageCode: 'en-US', name: 'en-US-Wavenet-F' }
      : { languageCode: 'ar-XA', name: 'ar-XA-Wavenet-A' };

  return {
    locale,
    targetProvider: 'google-cloud-tts',
    geminiVoiceName: 'Kore',
    cloudVoice: fallbackCloudVoice,
  };
}

function isTtsRetryableError(err: any): boolean {
  if (isRetryableOrOverloadError(err)) return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('empty audio') ||
    msg.includes('tts_empty_audio') ||
    msg.includes('internal') ||
    msg.includes('500') ||
    msg.includes('try again')
  );
}

async function synthesizeWithGeminiTts(
  ai: GoogleGenAI,
  text: string,
  locale: SupportedTtsLocale,
  voiceName: string
): Promise<SynthesizeSegmentResult> {
  const attempts: { model: string; delayMs: number }[] = [
    { model: 'gemini-3.8-flash-lite-tts', delayMs: 0 },
    { model: 'gemini-3.8-flash-tts', delayMs: 250 },
    { model: 'gemini-3.8-flash-tts', delayMs: 900 },
  ];
  const style = getGeminiStyleForLocale(locale);
  let lastErr: any = null;

  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await new Promise((r) => setTimeout(r, attempt.delayMs));
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`STAGE_TIMEOUT after 30000ms on ${attempt.model}`));
        }, 30000);
      });

      const response = await Promise.race([
        ai.models.generateContent({
          model: attempt.model,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text,
                  speechMetadata: {
                    style,
                  },
                } as any,
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        }),
        timeoutPromise,
      ]);

      if (timer) clearTimeout(timer);

      const parts = response.candidates?.[0]?.content?.parts || [];
      const audioPart = parts.find((p: any) => p?.inlineData?.data);
      const inlineData = audioPart?.inlineData;

      if (!inlineData?.data) {
        throw new TtsServiceError(`Empty audio returned by ${attempt.model}`, {
          status: 502,
          code: 'TTS_EMPTY_AUDIO',
          stage: 'generation',
        });
      }

      const normalized = validateAndNormalizeAudioPayload(inlineData.data, inlineData.mimeType);
      return {
        audioBase64: normalized.audioBase64,
        mimeType: normalized.mimeType,
        provider: 'gemini-tts',
        modelOrVoice: `${attempt.model}:${voiceName}`,
        locale,
        byteLength: normalized.byteLength,
      };
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      lastErr = err;
      console.warn(
        `[Gemini-TTS] stage=${err?.stage || 'generation'} model=${attempt.model} locale=${locale} voice=${voiceName} status=${err?.status || ''} msg=${err?.message || err}`
      );
      if (!isTtsRetryableError(err)) {
        break;
      }
    }
  }

  if (lastErr instanceof TtsServiceError) {
    throw lastErr;
  }
  throw lastErr || new Error('فشل توليد الصوت عبر Gemini-TTS');
}

async function synthesizeWithGoogleCloudTts(
  apiKey: string,
  text: string,
  locale: SupportedTtsLocale,
  voice: { languageCode: string; name: string },
  speakingRate = 1.0
): Promise<SynthesizeSegmentResult> {
  const clampedRate = Math.min(2.0, Math.max(0.5, Number(speakingRate) || 1.0));

  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: voice.languageCode,
          name: voice.name,
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: clampedRate,
        },
      }),
    }
  );

  const json: any = await res.json();
  if (!res.ok || !json?.audioContent) {
    const errMsg = json?.error?.message || `Google Cloud TTS HTTP ${res.status}`;
    throw new TtsServiceError(`Google Cloud TTS: ${errMsg}`, {
      status: 502,
      code: 'CLOUD_TTS_ERROR',
      stage: 'generation',
    });
  }

  const normalized = validateAndNormalizeAudioPayload(json.audioContent, 'audio/mpeg');
  return {
    audioBase64: normalized.audioBase64,
    mimeType: normalized.mimeType,
    provider: 'google-cloud-tts',
    modelOrVoice: voice.name,
    locale,
    byteLength: normalized.byteLength,
  };
}

export async function synthesizeSpeechSegment(
  input: SynthesizeSegmentInput
): Promise<SynthesizeSegmentResult> {
  const cleanText = normalizeSpeechTextServer(input.text);
  if (!cleanText) {
    throw new TtsServiceError('النص المطلوب تحويله إلى صوت فارغ.', {
      status: 400,
      code: 'EMPTY_TTS_TEXT',
      stage: 'validation',
    });
  }

  const boundedText = cleanText.slice(0, 1500);
  const cloudCheck = await isCloudTtsActuallyUsable();
  const cloudKey = cloudCheck.usable ? getGoogleCloudTtsApiKey() : null;
  const geminiEnabled = hasGeminiApiKey();

  const { locale, targetProvider, geminiVoiceName, cloudVoice } = validateRequestedLocaleAndVoice(
    String(input.locale || 'ar-EG'),
    input.voiceId,
    geminiEnabled,
    cloudKey
  );

  const cacheKey = `${locale}|${targetProvider}:${
    targetProvider === 'google-cloud-tts' ? cloudVoice?.name : geminiVoiceName
  }|${boundedText}`;
  const cached = serverTtsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const storeInCache = (res: SynthesizeSegmentResult): SynthesizeSegmentResult => {
    if (serverTtsCache.size >= MAX_SERVER_TTS_CACHE) {
      const oldestKey = serverTtsCache.keys().next().value;
      if (oldestKey) serverTtsCache.delete(oldestKey);
    }
    serverTtsCache.set(cacheKey, res);
    return res;
  };

  if (targetProvider === 'google-cloud-tts' && cloudKey && cloudVoice) {
    return storeInCache(
      await synthesizeWithGoogleCloudTts(
        cloudKey,
        boundedText,
        locale,
        cloudVoice,
        input.speakingRate
      )
    );
  }

  const ai = getGenAI();
  try {
    return storeInCache(await synthesizeWithGeminiTts(ai, boundedText, locale, geminiVoiceName));
  } catch (geminiErr: any) {
    // Only fall back to Cloud TTS when Cloud TTS is actually verified as working
    if (cloudKey && locale !== 'ar-EG') {
      try {
        const cloudFallbackVoice =
          locale === 'tr-TR'
            ? { languageCode: 'tr-TR', name: 'tr-TR-Wavenet-A' }
            : locale === 'en-US'
            ? { languageCode: 'en-US', name: 'en-US-Wavenet-F' }
            : { languageCode: 'ar-XA', name: 'ar-XA-Wavenet-A' };
        return storeInCache(
          await synthesizeWithGoogleCloudTts(
            cloudKey,
            boundedText,
            locale,
            cloudFallbackVoice,
            input.speakingRate
          )
        );
      } catch (cloudErr: any) {
        console.warn('[Cloud-TTS Fallback] failed:', cloudErr?.message || cloudErr);
        // Re-throw primary Gemini error rather than masking it with fallback error
        throw geminiErr;
      }
    }
    throw geminiErr;
  }
}

export function formatTtsErrorResponse(err: any): {
  status: number;
  code: string;
  stage: string;
  error: string;
} {
  if (err instanceof TtsServiceError) {
    return {
      status: err.status,
      code: err.code,
      stage: err.stage,
      error: err.message,
    };
  }

  const msg = String(err?.message || err || '');
  const lower = msg.toLowerCase();

  if (lower.includes('404') || lower.includes('not_found')) {
    return {
      status: 502,
      code: 'TTS_MODEL_UNAVAILABLE',
      stage: 'generation',
      error:
        'تعذر الوصول إلى نموذج التحويل الصوتي في Gemini حالياً. يمكنك التحقق من إعداد Google Cloud TTS أو أصوات المتصفح.',
    };
  }

  const translated = translateErrorToArabic(err);
  return {
    status: translated.status,
    code: translated.code,
    stage: 'generation',
    error: translated.message,
  };
}
