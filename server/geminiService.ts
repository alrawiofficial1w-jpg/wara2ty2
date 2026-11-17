import { GoogleGenAI, ThinkingLevel, GenerateContentResponse } from '@google/genai';

export interface ExecutionStage {
  model: string;
  useSchema: boolean;
  useLowThinking: boolean;
  timeoutMs: number;
  delayBeforeMs: number;
  label: string;
}

// Multi-stage failover pipeline using active, verified @google/genai models.
export const EXECUTION_PIPELINE: ExecutionStage[] = [
  {
    model: 'gemini-3.1-flash-lite',
    useSchema: true,
    useLowThinking: false,
    timeoutMs: 32000,
    delayBeforeMs: 0,
    label: 'gemini-3.1-flash-lite (schema)',
  },
  {
    model: 'gemini-4-hydrogen',
    useSchema: true,
    useLowThinking: true,
    timeoutMs: 38000,
    delayBeforeMs: 250,
    label: 'gemini-4-hydrogen (low-thinking + schema)',
  },
  {
    model: 'gemini-4-hydrogen',
    useSchema: false,
    useLowThinking: true,
    timeoutMs: 38000,
    delayBeforeMs: 350,
    label: 'gemini-4-hydrogen (fast json)',
  },
  {
    model: 'gemini-3.1-flash-lite',
    useSchema: false,
    useLowThinking: false,
    timeoutMs: 28000,
    delayBeforeMs: 350,
    label: 'gemini-3.1-flash-lite (fast json)',
  },
];

export function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY environment variable is not configured');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableOrOverloadError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = Number(err?.status || err?.code || err?.httpStatus || 0);

  if ([429, 500, 502, 503, 504, 404, 408].includes(status)) return true;

  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('stage_timeout') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('high demand') ||
    msg.includes('spikes in demand') ||
    msg.includes('capacity') ||
    msg.includes('too many requests') ||
    msg.includes('busy') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('not_found') ||
    msg.includes('404') ||
    msg.includes('empty text response')
  );
}

export async function executeGeminiWithResilience(
  ai: GoogleGenAI,
  contents: any,
  responseSchema?: any,
  options?: { responseMimeType?: string; systemInstruction?: string }
): Promise<{ response: GenerateContentResponse; modelUsed: string }> {
  let lastError: any = null;
  const responseMimeType = options?.responseMimeType ?? 'application/json';

  for (const stage of EXECUTION_PIPELINE) {
    if (stage.delayBeforeMs > 0) {
      await sleep(stage.delayBeforeMs);
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const config: Record<string, any> = {
        responseMimeType,
      };

      if (options?.systemInstruction) {
        config.systemInstruction = options.systemInstruction;
      }

      if (stage.useSchema && responseSchema && responseMimeType === 'application/json') {
        config.responseSchema = responseSchema;
      }

      if (stage.useLowThinking) {
        config.thinkingConfig = {
          thinkingLevel: ThinkingLevel.LOW,
        };
      }

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`STAGE_TIMEOUT after ${stage.timeoutMs}ms on ${stage.label}`));
        }, stage.timeoutMs);
      });

      const response = await Promise.race([
        ai.models.generateContent({
          model: stage.model,
          contents,
          config,
        }),
        timeoutPromise,
      ]);

      if (timeoutHandle) clearTimeout(timeoutHandle);

      if (response && response.text && response.text.trim().length > 0) {
        return { response, modelUsed: stage.label };
      }
      throw new Error('Model returned an empty text response');
    } catch (err: any) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      lastError = err;
      const canSwitch = isRetryableOrOverloadError(err);
      console.warn(
        `[Gemini Resilience] Stage "${stage.label}" encountered error (${canSwitch ? 'switching immediately' : 'fatal'}):`,
        err?.message || err
      );

      if (!canSwitch) {
        throw err;
      }
    }
  }

  throw lastError || new Error('جميع مسارات الذكاء الاصطناعي مشغولة حالياً.');
}

export function safeParseJson<T = any>(rawText: string): T {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');

    if (
      firstBrace !== -1 &&
      lastBrace > firstBrace &&
      (firstBracket === -1 || firstBrace < firstBracket)
    ) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1)) as T;
    }
    throw new Error('تعذر قراءة استجابة الذكاء الاصطناعي بتنسيق منظم.');
  }
}

export function translateErrorToArabic(error: any): {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
} {
  const rawMsg = String(error?.message || error || '');
  const lower = rawMsg.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('gemini_api_key environment variable is not configured') ||
    lower.includes('403')
  ) {
    return {
      status: 403,
      code: 'API_KEY_ERROR',
      retryable: false,
      message:
        'مفتاح خدمة الذكاء الاصطناعي (GEMINI_API_KEY) غير مضبوط أو غير صالح. يرجى التحقق منه في لوحة الإعدادات (Settings > Secrets).',
    };
  }

  if (
    lower.includes('503') ||
    lower.includes('overloaded') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('spikes in demand') ||
    lower.includes('capacity') ||
    lower.includes('busy')
  ) {
    return {
      status: 503,
      code: 'SERVER_OVERLOADED',
      retryable: true,
      message:
        'خوادم الذكاء الاصطناعي تشهد ذروة طلبات مؤقتة حالياً (503). يرجى الضغط على "إعادة المحاولة" وسيتم التحليل فوراً عبر المسار السريع.',
    };
  }

  if (
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit')
  ) {
    return {
      status: 429,
      code: 'SERVER_BUSY_QUOTA',
      retryable: true,
      message:
        'تم الوصول للحد المؤقت للطلبات في الدقيقة (429). يرجى الانتظار بضع ثوانٍ ثم الضغط على "إعادة المحاولة".',
    };
  }

  if (lower.includes('invalid argument') || lower.includes('unsupported mime')) {
    return {
      status: 400,
      code: 'INVALID_IMAGE',
      retryable: false,
      message:
        'تعذر معالجة الملف المرفوع. يرجى التأكد من أن الصورة أو المستند واضح وبصيغة JPG أو PNG أو WEBP أو PDF والمحاولة مجدداً.',
    };
  }

  return {
    status: 500,
    code: 'INTERNAL_ANALYSIS_ERROR',
    retryable: true,
    message: 'حدث خطأ مؤقت أثناء معالجة المحاضرة. يرجى الضغط على "إعادة المحاولة".',
  };
}
