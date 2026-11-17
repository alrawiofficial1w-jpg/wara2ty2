import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Headphones,
  Play,
  Pause,
  Square,
  Volume2,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  RotateCcw,
  SkipForward,
  Loader2,
  Sparkles,
  Languages,
  Mic,
  RefreshCw,
} from 'lucide-react';
import { AnalysisData } from '../types';
import {
  AudioStageError,
  evictCachedAudioAsset,
  fetchTtsStatus,
  getVoiceAvailability,
  pickVoiceForLang,
  requestServerTtsAudio,
  stopSpeech,
  TtsStatusInfo,
  VoiceAvailability,
  waitForBrowserVoices,
} from '../utils/speech';
import {
  segmentMultilingualLectureText,
  SpeechLocale,
  SpeechSubSegment,
} from '../utils/ttsTextProcessor';

interface AudioLessonTabProps {
  data: AnalysisData;
}

interface LectureAudioSection {
  id: string;
  label: string;
  description: string;
  forcedLocale: SpeechLocale | 'auto';
  langBadge: string;
  text: string;
  isPrimaryArabic?: boolean;
}

interface FailedSegmentState {
  sectionIndex: number;
  subIdx: number;
  langLabel: string;
  textPreview: string;
  message: string;
  code?: string;
}

const SPEED_OPTIONS = [0.75, 0.9, 1.0, 1.15, 1.25];
// Minimal valid silent WAV used solely inside a direct click gesture to unlock Safari/iOS audio element
const SILENT_UNLOCK_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const AudioLessonTab: React.FC<AudioLessonTabProps> = ({ data }) => {
  const [ttsStatus, setTtsStatus] = useState<TtsStatusInfo | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);
  const [browserVoices, setBrowserVoices] = useState<VoiceAvailability>(() => getVoiceAvailability());

  // Student voice & locale preferences
  const [arabicLocale, setArabicLocale] = useState<'ar-EG' | 'ar-XA'>('ar-EG');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('gemini:Kore');
  const [speed, setSpeed] = useState<number>(1.0);

  // Playback engine state
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
  const [activeSectionIndex, setActiveSectionIndex] = useState<number | null>(null);
  const [activeSubSegment, setActiveSubSegment] = useState<{
    index: number;
    total: number;
    locale: SpeechLocale;
    langLabel: string;
    textPreview: string;
    providerLabel: string;
  } | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [failedSegment, setFailedSegment] = useState<FailedSegmentState | null>(null);

  // Persistent single HTMLAudioElement + cancellation refs to avoid mobile autoplay blocks and races
  const playerAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef<boolean>(false);
  const usingBrowserSpeechRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackTokenRef = useRef<number>(0);
  const speedRef = useRef<number>(speed);
  const voiceRef = useRef<string>(selectedVoiceId);
  const activeQueueRef = useRef<{
    sectionIndex: number;
    continueToNextSection: boolean;
    subSegments: SpeechSubSegment[];
    currentSubIdx: number;
  } | null>(null);

  useEffect(() => {
    speedRef.current = speed;
    if (playerAudioRef.current) {
      playerAudioRef.current.defaultPlaybackRate = speed;
      playerAudioRef.current.playbackRate = speed;
    }
  }, [speed]);

  useEffect(() => {
    voiceRef.current = selectedVoiceId;
  }, [selectedVoiceId]);

  const ensureAudioElement = (): HTMLAudioElement => {
    if (!playerAudioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      playerAudioRef.current = audio;
    }
    return playerAudioRef.current;
  };

  /**
   * Synchronously primes the persistent HTMLAudioElement on direct user tap/click so
   * asynchronous segment loads and sequential multi-language transitions are permitted on mobile/iOS.
   */
  const unlockAudioOnGesture = () => {
    if (audioUnlockedRef.current || typeof window === 'undefined') return;
    try {
      const audio = ensureAudioElement();
      if (!audio.src || audio.paused) {
        audio.src = SILENT_UNLOCK_WAV;
        const p = audio.play();
        if (p && typeof p.then === 'function') {
          p.then(() => {
            audio.pause();
            audioUnlockedRef.current = true;
          }).catch(() => {
            // Safe no-op: later play() call will handle NotAllowedError explicitly if needed
          });
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let mounted = true;

    const initProviders = async () => {
      try {
        const [serverStatus, browserAvail] = await Promise.all([
          fetchTtsStatus().catch(() => null),
          waitForBrowserVoices(1000),
        ]);
        if (!mounted) return;
        setBrowserVoices(browserAvail);

        if (serverStatus) {
          setTtsStatus(serverStatus);
          if (serverStatus.supportedArabicLocales.length > 0) {
            const hasEgyptian = serverStatus.supportedArabicLocales.some(
              (l) => l.code === 'ar-EG'
            );
            setArabicLocale(hasEgyptian ? 'ar-EG' : serverStatus.supportedArabicLocales[0].code);
          }
          const recVoice =
            serverStatus.voices.find((v) => v.recommended) || serverStatus.voices[0];
          if (recVoice) {
            setSelectedVoiceId(recVoice.id);
          }
        }
      } finally {
        if (mounted) setIsLoadingStatus(false);
      }
    };

    initProviders();

    const onVoicesChanged = () => setBrowserVoices(getVoiceAvailability());
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    }

    return () => {
      mounted = false;
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      }
      teardownPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cancel active audio immediately if lecture data changes (e.g. user opens another lecture or edits OCR text)
  const lectureSignature = `${data.summary?.title || ''}|${(data.arabicTranslation || '').length}|${(data.extractedText || '').length}`;
  useEffect(() => {
    teardownPlayback();
    setStatus('idle');
    setActiveSectionIndex(null);
    setWarning(null);
    setFailedSegment(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureSignature]);

  // Filter voices so only voices valid for the selected Arabic locale are displayed
  const availableArabicVoices = useMemo(() => {
    if (!ttsStatus?.voices?.length) return [];
    return ttsStatus.voices.filter((v) => v.locales.includes(arabicLocale));
  }, [ttsStatus, arabicLocale]);

  useEffect(() => {
    if (availableArabicVoices.length > 0) {
      const stillValid = availableArabicVoices.some((v) => v.id === selectedVoiceId);
      if (!stillValid) {
        const nextRec =
          availableArabicVoices.find((v) => v.recommended) || availableArabicVoices[0];
        setSelectedVoiceId(nextRec.id);
      }
    }
  }, [availableArabicVoices, selectedVoiceId]);

  const sections: LectureAudioSection[] = useMemo(() => {
    const list: LectureAudioSection[] = [];
    const isSourceArabicOnly =
      /عرب|arab/i.test(data.detectedLanguage || '') &&
      !/ترك|turk|إنجليز|english/i.test(data.detectedLanguage || '');

    // Primary Arabic Lecture Section: "المحاضرة باللغة العربية"
    const arabicLectureText = (
      data.arabicTranslation ||
      (isSourceArabicOnly ? data.extractedText : '') ||
      data.summary?.overview ||
      ''
    ).trim();

    if (arabicLectureText) {
      list.push({
        id: 'arabic_lecture',
        label: 'المحاضرة باللغة العربية',
        description:
          'قراءة المحتوى العربي الكامل للمحاضرة بصوت عربي معتمد مع الحفاظ على نطق المصطلحات الأجنبية بلغتها الأصلية.',
        forcedLocale: 'auto',
        langBadge: arabicLocale === 'ar-EG' ? 'العربية (مصر) + مصطلحات' : 'العربية الفصحى + مصطلحات',
        text: arabicLectureText,
        isPrimaryArabic: true,
      });
    }

    if (data.summary?.overview) {
      list.push({
        id: 'overview',
        label: 'مقدمة وملخص المحاضرة',
        description: 'عنوان المحاضرة والفكرة العامة بالعربية',
        forcedLocale: 'auto',
        langBadge: 'العربية',
        text: `${data.summary.title}. ${data.summary.overview}`,
      });
    }

    if (data.summary?.keyPoints?.length) {
      list.push({
        id: 'keypoints',
        label: 'النقاط الأساسية للمحاضرة',
        description: `${data.summary.keyPoints.length} نقاط رئيسية مرتبة للمراجعة`,
        forcedLocale: 'auto',
        langBadge: 'العربية',
        text: data.summary.keyPoints.map((p, i) => `النقطة ${i + 1}: ${p}`).join('. '),
      });
    }

    const isTurkish = /ترك|turk/i.test(data.detectedLanguage || '');
    const isEnglish = /إنجليز|انجليز|english/i.test(data.detectedLanguage || '');

    if (data.extractedText && !isSourceArabicOnly) {
      list.push({
        id: 'original',
        label: isTurkish
          ? 'النص الأصلي للمحاضرة (بالتركية)'
          : isEnglish
          ? 'النص الأصلي للمحاضرة (بالإنجليزية)'
          : 'النص الأصلي المستخرج',
        description: 'قراءة النص الأصلي مع تمييز اللغة أوتوماتيكياً لكل فقرة',
        forcedLocale: 'auto',
        langBadge: isTurkish ? 'التركية / متعدد' : isEnglish ? 'الإنجليزية' : 'متعدد اللغات',
        text: data.extractedText,
      });
    }

    if (data.vocabulary?.length) {
      const vocabSnippet = data.vocabulary
        .slice(0, 12)
        .map((v) => `${v.word}. ${v.meaning}`)
        .join('. ');
      list.push({
        id: 'vocab',
        label: `مراجعة المفردات والمصطلحات (${Math.min(data.vocabulary.length, 12)} كلمة)`,
        description: 'نطق الكلمة بلغتها الأصلية متبوعاً بمعناها بالعربية',
        forcedLocale: 'auto',
        langBadge: 'ثنائي اللغة',
        text: vocabSnippet,
      });
    }

    return list;
  }, [data, arabicLocale]);

  const clearAudioListeners = (audio: HTMLAudioElement) => {
    audio.onloadedmetadata = null;
    audio.oncanplay = null;
    audio.ontimeupdate = null;
    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
    audio.onplay = null;
  };

  const teardownPlayback = () => {
    playbackTokenRef.current += 1;
    usingBrowserSpeechRef.current = false;
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (playerAudioRef.current) {
      try {
        clearAudioListeners(playerAudioRef.current);
        playerAudioRef.current.pause();
        playerAudioRef.current.removeAttribute('src');
        playerAudioRef.current.load();
      } catch {
        // ignore
      }
    }
    stopSpeech();
    activeQueueRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    setActiveSubSegment(null);
  };

  const resolveEffectiveVoiceId = (locale: SpeechLocale, preferredVoice: string): string | undefined => {
    if (locale.startsWith('ar')) {
      return preferredVoice;
    }
    if (!ttsStatus?.voices?.length) return undefined;
    // Use selected voice if it supports the target non-Arabic locale; otherwise let server pick default
    const matching = ttsStatus.voices.find(
      (v) => v.id === preferredVoice && v.locales.includes(locale)
    );
    return matching?.id;
  };

  const playWithBrowserFallback = (
    subSeg: SpeechSubSegment,
    token: number,
    onDone: () => void,
    onFail: (reason: string) => void
  ) => {
    const avail = getVoiceAvailability();
    const prefix = subSeg.locale.startsWith('tr')
      ? 'tr'
      : subSeg.locale.startsWith('en')
      ? 'en'
      : 'ar';
    const voice = pickVoiceForLang(prefix);

    if (!avail.supported || !voice) {
      onFail(
        prefix === 'ar'
          ? 'خدمة التوليد الصوتي على الخادم تعذر استخدامها لهذا المقطع، ولا يتوفر صوت عربي محلي (ar-) في متصفحك.'
          : `لا يتوفر صوت محلي للغة (${subSeg.locale}) على المتصفح، وتعذر التوليد عبر الخادم.`
      );
      return;
    }

    usingBrowserSpeechRef.current = true;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(subSeg.text);
    utter.lang = subSeg.locale;
    utter.voice = voice;
    utter.rate = speedRef.current;

    utter.onend = () => {
      usingBrowserSpeechRef.current = false;
      if (playbackTokenRef.current !== token) return;
      onDone();
    };
    utter.onerror = () => {
      usingBrowserSpeechRef.current = false;
      if (playbackTokenRef.current !== token) return;
      onFail('تعذر إتمام القراءة الصوتية عبر المتصفح.');
    };

    setStatus('playing');
    setActiveSubSegment((prev) =>
      prev ? { ...prev, providerLabel: `صوت المتصفح (${voice.lang})` } : null
    );
    window.speechSynthesis.speak(utter);
  };

  const loadAudioAndPlay = async (
    audio: HTMLAudioElement,
    objectUrl: string,
    token: number
  ): Promise<void> => {
    clearAudioListeners(audio);
    audio.src = objectUrl;
    audio.preload = 'auto';

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanupWait = () => {
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('loadeddata', onReady);
        audio.removeEventListener('error', onError);
        clearTimeout(loadTimer);
      };
      const onReady = () => {
        if (settled) return;
        settled = true;
        cleanupWait();
        resolve();
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanupWait();
        const mediaErr = audio.error;
        const code =
          mediaErr?.code === 4
            ? 'MEDIA_SRC_NOT_SUPPORTED'
            : mediaErr?.code === 2
            ? 'MEDIA_NETWORK_ERROR'
            : 'MEDIA_DECODE_ERROR';
        reject(
          new AudioStageError(
            mediaErr?.code === 4
              ? 'صيغة الصوت المرجعة غير مدعومة في هذا المتصفح.'
              : 'تعذر تحميل وفك ترميز ملف الصوت في المتصفح.',
            'loading',
            code
          )
        );
      };

      const loadTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupWait();
        reject(
          new AudioStageError('استغرق تحميل ملف الصوت وقتاً أطول من المعتاد.', 'loading', 'LOAD_TIMEOUT')
        );
      }, 15000);

      audio.addEventListener('canplay', onReady);
      audio.addEventListener('loadeddata', onReady);
      audio.addEventListener('error', onError);
      audio.load();
    });

    if (playbackTokenRef.current !== token) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Re-apply playback speed AFTER load() because browsers reset rate when src changes
    audio.defaultPlaybackRate = speedRef.current;
    audio.playbackRate = speedRef.current;
    setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    setCurrentTime(audio.currentTime || 0);

    try {
      await audio.play();
    } catch (playErr: any) {
      if (playErr?.name === 'NotAllowedError') {
        throw new AudioStageError(
          'حظر المتصفح التشغيل التلقائي للصوت. اضغط على «استئناف التشغيل» لمتابعة الاستماع.',
          'playback',
          'AUTOPLAY_BLOCKED'
        );
      }
      if (playErr?.name === 'AbortError') {
        throw playErr;
      }
      throw new AudioStageError(
        'تعذر بدء تشغيل الصوت. اضغط على «استئناف التشغيل» أو أعد المحاولة.',
        'playback',
        playErr?.name || 'PLAYBACK_FAILED'
      );
    }
  };

  const playSubSegment = async (subIdx: number, token: number) => {
    const queue = activeQueueRef.current;
    if (!queue || playbackTokenRef.current !== token) return;

    queue.currentSubIdx = subIdx;

    if (subIdx >= queue.subSegments.length) {
      if (queue.continueToNextSection && queue.sectionIndex + 1 < sections.length) {
        startSectionPlayback(queue.sectionIndex + 1, true);
      } else {
        usingBrowserSpeechRef.current = false;
        setStatus('idle');
        setActiveSectionIndex(null);
        setActiveSubSegment(null);
        setCurrentTime(0);
        setDuration(0);
        activeQueueRef.current = null;
      }
      return;
    }

    const subSeg = queue.subSegments[subIdx];
    const effectiveVoiceId = resolveEffectiveVoiceId(subSeg.locale, voiceRef.current);

    setFailedSegment(null);
    setWarning(null);
    setStatus('loading');
    setCurrentTime(0);
    setDuration(0);
    setActiveSubSegment({
      index: subIdx + 1,
      total: queue.subSegments.length,
      locale: subSeg.locale,
      langLabel: subSeg.langLabel,
      textPreview: subSeg.text,
      providerLabel:
        ttsStatus?.primaryProvider === 'google-cloud-tts' ? 'Google Cloud TTS' : 'Gemini-TTS',
    });

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    const prefetchNext = () => {
      const nextSeg = queue.subSegments[subIdx + 1];
      if (!nextSeg) return;
      requestServerTtsAudio({
        text: nextSeg.text,
        locale: nextSeg.locale,
        voiceId: resolveEffectiveVoiceId(nextSeg.locale, voiceRef.current),
      }).catch(() => {});
    };

    try {
      if (!ttsStatus?.available) {
        throw new AudioStageError(
          'خدمة التوليد الصوتي على الخادم غير مفعّلة.',
          'validation',
          'SERVER_TTS_UNCONFIGURED'
        );
      }

      const audioData = await requestServerTtsAudio({
        text: subSeg.text,
        locale: subSeg.locale,
        voiceId: effectiveVoiceId,
        signal: controller.signal,
      });

      if (playbackTokenRef.current !== token) return;

      const audio = ensureAudioElement();

      const providerDisplay =
        audioData.provider === 'google-cloud-tts'
          ? `Google Cloud TTS (${audioData.modelOrVoice})`
          : `Gemini-TTS (${audioData.modelOrVoice.split(':')[1] || 'Kore'})`;

      setActiveSubSegment({
        index: subIdx + 1,
        total: queue.subSegments.length,
        locale: subSeg.locale,
        langLabel: subSeg.langLabel,
        textPreview: subSeg.text,
        providerLabel: providerDisplay,
      });

      try {
        await loadAudioAndPlay(audio, audioData.objectUrl, token);
      } catch (mediaErr: any) {
        if (mediaErr instanceof AudioStageError && mediaErr.stage === 'loading') {
          // Evict corrupt/unplayable cached Blob URL if audio loading failed
          evictCachedAudioAsset({
            text: subSeg.text,
            locale: subSeg.locale,
            voiceId: effectiveVoiceId,
          });
        }
        throw mediaErr;
      }

      if (playbackTokenRef.current !== token) return;

      // Bind live runtime listeners after playback legitimately starts
      audio.onloadedmetadata = () => {
        if (playbackTokenRef.current === token) {
          setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
        }
      };

      audio.ontimeupdate = () => {
        if (playbackTokenRef.current === token) {
          setCurrentTime(audio.currentTime || 0);
        }
      };

      audio.onpause = () => {
        if (playbackTokenRef.current === token && !audio.ended) {
          setStatus('paused');
        }
      };

      audio.onplay = () => {
        if (playbackTokenRef.current === token) {
          setStatus('playing');
        }
      };

      audio.onended = () => {
        if (playbackTokenRef.current !== token) return;
        playSubSegment(subIdx + 1, token);
      };

      audio.onerror = () => {
        if (playbackTokenRef.current !== token) return;
        console.warn('[AudioPlayer] Runtime playback error on sub-segment', subIdx + 1);
        setStatus('paused');
        setFailedSegment({
          sectionIndex: queue.sectionIndex,
          subIdx,
          langLabel: subSeg.langLabel,
          textPreview: subSeg.text,
          message: 'توقف تشغيل المقطع بسبب خطأ في التشغيل. يمكنك إعادة المحاولة أو التخطي.',
          code: 'RUNTIME_MEDIA_ERROR',
        });
      };

      usingBrowserSpeechRef.current = false;
      setStatus('playing');
      if (prefetchTimerRef.current) {
        clearTimeout(prefetchTimerRef.current);
      }
      prefetchTimerRef.current = setTimeout(() => {
        if (playbackTokenRef.current === token) {
          prefetchNext();
        }
      }, 1500);
    } catch (err: any) {
      if (err?.name === 'AbortError' || playbackTokenRef.current !== token) return;

      // If browser blocked autoplay (e.g. mobile Safari restriction), preserve ready audio in 'paused' state
      if (err instanceof AudioStageError && err.code === 'AUTOPLAY_BLOCKED') {
        setStatus('paused');
        setWarning(err.message);
        return;
      }

      const stageLabel = err instanceof AudioStageError ? err.stage : 'generation';
      console.warn(`[AudioPlayer] stage=${stageLabel} code=${err?.code || 'ERR'}:`, err?.message);

      // Browser SpeechSynthesis tertiary fallback strictly only for matching native voice
      playWithBrowserFallback(
        subSeg,
        token,
        () => playSubSegment(subIdx + 1, token),
        (fallbackReason) => {
          const baseMsg =
            err instanceof AudioStageError && err.code === 'SERVER_TTS_UNCONFIGURED'
              ? fallbackReason
              : err?.message || 'تعذر توليد هذا المقطع الصوتي.';
          // Keep the queue & position intact so the student can retry or skip this segment
          setStatus('paused');
          setFailedSegment({
            sectionIndex: queue.sectionIndex,
            subIdx,
            langLabel: subSeg.langLabel,
            textPreview: subSeg.text,
            message: `${baseMsg} (${fallbackReason})`,
            code: err?.code,
          });
        }
      );
    }
  };

  const startSectionPlayback = (
    sectionIndex: number,
    continueToNextSection: boolean,
    overrideLocale?: 'ar-EG' | 'ar-XA',
    overrideVoiceId?: string
  ) => {
    const sec = sections[sectionIndex];
    if (!sec) return;

    unlockAudioOnGesture();
    teardownPlayback();
    setWarning(null);
    setFailedSegment(null);

    if (overrideVoiceId) {
      voiceRef.current = overrideVoiceId;
    }

    const subSegments = segmentMultilingualLectureText(sec.text, {
      arabicLocale: overrideLocale || arabicLocale,
      detectedLanguage: data.detectedLanguage,
      forcedLocale: sec.forcedLocale,
    });

    if (subSegments.length === 0) {
      setWarning('لا يوجد نص قابل للقراءة في هذا القسم.');
      setStatus('idle');
      setActiveSectionIndex(null);
      return;
    }

    const token = ++playbackTokenRef.current;
    setActiveSectionIndex(sectionIndex);
    activeQueueRef.current = {
      sectionIndex,
      continueToNextSection,
      subSegments,
      currentSubIdx: 0,
    };

    playSubSegment(0, token);
  };

  const handleLocaleChange = (newLocale: 'ar-EG' | 'ar-XA') => {
    if (newLocale === arabicLocale) return;
    setArabicLocale(newLocale);

    // Ensure voice switches cleanly if current voice doesn't support the newly selected locale
    let nextVoice = selectedVoiceId;
    if (ttsStatus?.voices?.length) {
      const matching = ttsStatus.voices.filter((v) => v.locales.includes(newLocale));
      if (matching.length > 0 && !matching.some((v) => v.id === selectedVoiceId)) {
        nextVoice = (matching.find((v) => v.recommended) || matching[0]).id;
        setSelectedVoiceId(nextVoice);
        voiceRef.current = nextVoice;
      }
    }

    // Cancel stale playback and synchronize with new dialect
    if (activeSectionIndex !== null) {
      const wasActive = status === 'playing' || status === 'loading';
      const idx = activeSectionIndex;
      const chain = activeQueueRef.current?.continueToNextSection ?? false;
      if (wasActive) {
        startSectionPlayback(idx, chain, newLocale, nextVoice);
      } else {
        teardownPlayback();
        setStatus('idle');
        setActiveSectionIndex(null);
      }
    }
  };

  const handleVoiceChange = (newVoiceId: string) => {
    setSelectedVoiceId(newVoiceId);
    voiceRef.current = newVoiceId;

    if (activeSectionIndex !== null) {
      const wasActive = status === 'playing' || status === 'loading';
      const idx = activeSectionIndex;
      const chain = activeQueueRef.current?.continueToNextSection ?? false;
      if (wasActive) {
        startSectionPlayback(idx, chain, arabicLocale, newVoiceId);
      } else {
        teardownPlayback();
        setStatus('idle');
        setActiveSectionIndex(null);
      }
    }
  };

  const handlePlayAll = async () => {
    if (status === 'loading' || status === 'playing') {
      return; // Guard against duplicate playback on rapid/repeated Play clicks
    }

    unlockAudioOnGesture();
    setWarning(null);

    if (status === 'paused' && activeQueueRef.current) {
      if (failedSegment) {
        handleRetryFailedSegment();
        return;
      }

      const audio = playerAudioRef.current;
      if (usingBrowserSpeechRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.resume();
        setStatus('playing');
        return;
      }

      if (audio && audio.src && audio.src !== SILENT_UNLOCK_WAV) {
        try {
          audio.defaultPlaybackRate = speedRef.current;
          audio.playbackRate = speedRef.current;
          await audio.play();
          setStatus('playing');
        } catch (err: any) {
          if (err?.name === 'NotAllowedError') {
            setWarning('المتصفح قيّد استئناف التشغيل. اضغط مرة أخرى على زر الاستئناف.');
          } else {
            // Re-run current sub-segment cleanly if element source expired
            playSubSegment(activeQueueRef.current.currentSubIdx, playbackTokenRef.current);
          }
        }
        return;
      }
    }

    startSectionPlayback(0, true);
  };

  const handlePause = () => {
    if (status !== 'playing') return;
    if (usingBrowserSpeechRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
      setStatus('paused');
      return;
    }
    const audio = playerAudioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
    setStatus('paused');
  };

  const handleStop = () => {
    teardownPlayback();
    setFailedSegment(null);
    setWarning(null);
    setStatus('idle');
    setActiveSectionIndex(null);
  };

  const handleReplaySection = () => {
    const idx = activeSectionIndex !== null ? activeSectionIndex : 0;
    const continueChain = activeQueueRef.current?.continueToNextSection ?? false;
    startSectionPlayback(idx, continueChain);
  };

  const handleSkipNextSection = () => {
    const currentIdx = activeSectionIndex !== null ? activeSectionIndex : -1;
    const nextIdx = currentIdx + 1;
    if (nextIdx < sections.length) {
      const continueChain = activeQueueRef.current?.continueToNextSection ?? true;
      startSectionPlayback(nextIdx, continueChain);
    }
  };

  const handleRetryFailedSegment = () => {
    if (!failedSegment || !activeQueueRef.current) return;
    unlockAudioOnGesture();
    const targetSub = failedSegment.subIdx;
    setFailedSegment(null);
    const token = playbackTokenRef.current;
    playSubSegment(targetSub, token);
  };

  const handleSkipFailedSegment = () => {
    if (!failedSegment || !activeQueueRef.current) return;
    unlockAudioOnGesture();
    const nextSub = failedSegment.subIdx + 1;
    setFailedSegment(null);
    const token = playbackTokenRef.current;
    playSubSegment(nextSub, token);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = parseFloat(e.target.value);
    const audio = playerAudioRef.current;
    if (audio && Number.isFinite(targetTime) && audio.duration > 0) {
      audio.currentTime = Math.min(Math.max(0, targetTime), audio.duration);
      setCurrentTime(audio.currentTime);
    }
  };

  const hasAnyArabicMethod = Boolean(ttsStatus?.available) || browserVoices.hasArabic;

  return (
    <div className="space-y-6">
      {/* Main Audio Lesson Header & Player Card */}
      <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-7 shadow-sm space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
              <Headphones className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-lg">المحاضرة الصوتية متعددة اللغات</h3>
                {ttsStatus?.available && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-lg">
                    <Sparkles className="w-3 h-3" />
                    <span>
                      {ttsStatus.primaryProvider === 'gemini-tts'
                        ? 'Google Gemini-TTS (معتمد)'
                        : 'Google Cloud TTS (معتمد)'}
                    </span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                استمع للمحاضرة باللغة العربية مع نطق دقيق للمصطلحات التركية والإنجليزية في موضعها الطبيعي داخل الجمل.
              </p>
            </div>
          </div>

          {/* Transport Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {status === 'loading' ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500/70 text-slate-950 text-xs font-black cursor-wait"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري تحضير الصوت...</span>
              </button>
            ) : status === 'playing' ? (
              <button
                type="button"
                onClick={handlePause}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black cursor-pointer"
              >
                <Pause className="w-4 h-4" />
                <span>إيقاف مؤقت</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePlayAll}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black cursor-pointer"
              >
                <Play className="w-4 h-4" />
                <span>{status === 'paused' ? 'استئناف التشغيل' : 'تشغيل المحاضرة الصوتية'}</span>
              </button>
            )}

            {(activeSectionIndex !== null || status !== 'idle') && (
              <>
                <button
                  type="button"
                  onClick={handleReplaySection}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 cursor-pointer"
                  title="إعادة تشغيل القسم الحالي"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">إعادة القسم</span>
                </button>

                {activeSectionIndex !== null && activeSectionIndex + 1 < sections.length && (
                  <button
                    type="button"
                    onClick={handleSkipNextSection}
                    className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 cursor-pointer"
                    title="الانتقال إلى القسم التالي"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">القسم التالي</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 text-xs font-bold border border-rose-800/60 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>إيقاف</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Live Playback Progress Bar & Current Sub-Segment Info */}
        {(status !== 'idle' || activeSubSegment) && (
          <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700/80 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-emerald-400">
                  {activeSectionIndex !== null ? sections[activeSectionIndex]?.label : ''}
                </span>
                {activeSubSegment && (
                  <>
                    <span className="text-slate-400">·</span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-900 text-slate-200 text-[11px] font-semibold">
                      مقطع {activeSubSegment.index}/{activeSubSegment.total} ({activeSubSegment.langLabel})
                    </span>
                    <span className="text-[11px] text-slate-400">{activeSubSegment.providerLabel}</span>
                  </>
                )}
              </div>

              <span className="text-slate-300 font-mono text-[11px] tabular-nums">
                {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
              </span>
            </div>

            {/* Seekable Progress Bar */}
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.1}
              value={duration > 0 ? Math.min(currentTime, duration) : 0}
              onChange={handleSeek}
              disabled={duration <= 0 || usingBrowserSpeechRef.current}
              aria-label="شريط تقدم الصوت"
              className="w-full h-2 rounded-lg appearance-none bg-slate-700 accent-emerald-400 cursor-pointer disabled:cursor-default"
            />

            {activeSubSegment?.textPreview && (
              <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed" dir="auto">
                {activeSubSegment.textPreview}
              </p>
            )}
          </div>
        )}

        {/* Voice, Dialect & Speed Settings */}
        <div className="pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {/* Arabic Dialect / Locale Selector */}
          <div className="space-y-1.5">
            <label className="text-slate-400 flex items-center gap-1.5 font-semibold">
              <Languages className="w-4 h-4 text-emerald-400" />
              <span>لهجة الصوت العربي:</span>
            </label>
            {ttsStatus?.supportedArabicLocales?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {ttsStatus.supportedArabicLocales.map((loc) => (
                  <button
                    key={loc.code}
                    type="button"
                    onClick={() => handleLocaleChange(loc.code)}
                    className={`px-3 py-1.5 rounded-xl font-bold cursor-pointer transition text-xs ${
                      arabicLocale === loc.code
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {loc.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-slate-400">
                {browserVoices.hasArabic
                  ? `صوت المتصفح المحلي (${browserVoices.arabicVoiceName})`
                  : 'غير مفعّل على الخادم'}
              </p>
            )}
          </div>

          {/* Verified Voice Selector (Male & Female when supported) */}
          <div className="space-y-1.5">
            <label
              htmlFor="wara2ty-voice-select"
              className="text-slate-400 flex items-center gap-1.5 font-semibold"
            >
              <Mic className="w-4 h-4 text-emerald-400" />
              <span>اختيار الصوت العربي المعتمد:</span>
            </label>
            {availableArabicVoices.length > 0 ? (
              <select
                id="wara2ty-voice-select"
                value={selectedVoiceId}
                onChange={(e) => handleVoiceChange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                {availableArabicVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            ) : (
              <div className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-xs">
                {isLoadingStatus
                  ? 'جاري فحص الأصوات المتاحة...'
                  : browserVoices.hasArabic
                  ? `صوت متصفح محلي: ${browserVoices.arabicVoiceName}`
                  : 'لا توجد أصوات عربية متاحة حالياً'}
              </div>
            )}
          </div>

          {/* Speed Selector */}
          <div className="space-y-1.5">
            <span className="text-slate-400 flex items-center gap-1.5 font-semibold">
              <Gauge className="w-4 h-4 text-emerald-400" />
              <span>سرعة القراءة:</span>
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {SPEED_OPTIONS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => setSpeed(rate)}
                  className={`px-2.5 py-1.5 rounded-xl font-bold tabular-nums cursor-pointer transition ${
                    speed === rate
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Provider & Language Detection Summary Footer */}
        <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-300">
          <div className="flex flex-wrap items-center gap-4">
            <span
              className={`inline-flex items-center gap-1.5 ${
                hasAnyArabicMethod ? 'text-emerald-400' : 'text-amber-300'
              }`}
            >
              {hasAnyArabicMethod ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
              <span>
                الصوت العربي ({arabicLocale}):{' '}
                {ttsStatus?.geminiTtsConfigured
                  ? 'متوفر عبر Gemini-TTS'
                  : ttsStatus?.cloudTtsConfigured
                  ? 'متوفر عبر Google Cloud TTS'
                  : browserVoices.hasArabic
                  ? 'متوفر عبر صوت المتصفح المحلي'
                  : 'غير مفعّل — يتطلب ضبط GEMINI_API_KEY أو GOOGLE_CLOUD_TTS_API_KEY'}
              </span>
            </span>

            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                التركية والإنجليزية:{' '}
                {ttsStatus?.available
                  ? 'فصل لغوي تلقائي (Gemini-TTS)'
                  : browserVoices.hasTurkish || browserVoices.hasEnglish
                  ? 'صوت متصفح مطابق'
                  : 'بانتظار التفعيل'}
              </span>
            </span>
          </div>

          {ttsStatus?.cloudTtsConfigured && (
            <span className="text-slate-400">البديل الثانوي: Google Cloud TTS مفعّل</span>
          )}
        </div>
      </div>

      {/* Segment-Level Failure Recovery Banner (preserves queue without corrupting playback) */}
      {failedSegment && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 text-xs sm:text-sm space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1 min-w-0">
              <p className="font-bold">
                تعذر تشغيل المقطع رقم {failedSegment.subIdx + 1} ({failedSegment.langLabel}) في قسم «
                {sections[failedSegment.sectionIndex]?.label}»
              </p>
              <p className="text-xs text-rose-800 leading-relaxed">{failedSegment.message}</p>
              <p className="text-xs text-slate-600 line-clamp-1" dir="auto">
                {failedSegment.textPreview}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pr-7">
            <button
              type="button"
              onClick={handleRetryFailedSegment}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>إعادة محاولة المقطع</span>
            </button>
            <button
              type="button"
              onClick={handleSkipFailedSegment}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 text-xs font-bold cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" />
              <span>تخطي للمقطع التالي</span>
            </button>
          </div>
        </div>
      )}

      {/* Actionable Warning when autoplay is blocked or provider is unconfigured */}
      {!failedSegment && (warning || (!isLoadingStatus && !hasAnyArabicMethod)) && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 text-xs sm:text-sm flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            {warning ||
              ttsStatus?.configurationNote ||
              'لتشغيل القراءة العربية المعتمدة، تأكد من ضبط GEMINI_API_KEY (أو GOOGLE_CLOUD_TTS_API_KEY) في إعدادات الخادم.'}
          </p>
        </div>
      )}

      {/* Playlist Sections */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-sm space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <h4 className="font-bold text-base text-slate-900">أقسام الاستماع المتاحة</h4>
          <span className="text-[11px] text-slate-500">
            يُقسم النص المختلط (عربي + تركي/إنجليزي) تلقائياً لضمان نطق كل لغة بصوتها المناسب
          </span>
        </div>

        <div className="space-y-3">
          {sections.map((sec, idx) => {
            const isActive = activeSectionIndex === idx;
            return (
              <div
                key={sec.id}
                className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 transition ${
                  isActive
                    ? 'bg-emerald-50 border-emerald-400 shadow-xs'
                    : sec.isPrimaryArabic
                    ? 'bg-emerald-50/35 border-emerald-200 hover:bg-emerald-50/60'
                    : 'bg-slate-50 border-slate-200 hover:bg-white'
                }`}
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black text-sm sm:text-base text-slate-900">
                      {sec.label}
                    </span>
                    <span className="text-[11px] font-bold text-emerald-700 bg-white border border-emerald-200 px-2.5 py-0.5 rounded-lg">
                      {sec.langBadge}
                    </span>
                    {sec.isPrimaryArabic && (
                      <span className="text-[11px] font-bold text-slate-900 bg-emerald-200/70 px-2 py-0.5 rounded-lg">
                        القسم الأساسي
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600">{sec.description}</p>
                  <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed" dir="auto">
                    {sec.text}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    disabled={isActive && status === 'loading'}
                    onClick={() => startSectionPlayback(idx, false)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap transition ${
                      isActive && status === 'playing'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    {isActive && status === 'loading' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>
                      {isActive && status === 'loading'
                        ? 'جاري التحضير...'
                        : isActive && status === 'playing'
                        ? 'قيد التشغيل'
                        : 'استماع للقسم'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
