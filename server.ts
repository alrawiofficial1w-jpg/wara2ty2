import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Type } from '@google/genai';
import {
  EXECUTION_PIPELINE,
  getGenAI,
  executeGeminiWithResilience,
  safeParseJson,
  translateErrorToArabic,
} from './server/geminiService';
import { dictionaryProvider } from './server/dictionaryAdapter';
import {
  getTtsStatus,
  synthesizeSpeechSegment,
  formatTtsErrorResponse,
} from './server/ttsService';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Support multi-page lecture payloads and PDF documents (up to 50MB base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Express body-parser error middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      success: false,
      code: 'PAYLOAD_TOO_LARGE',
      error:
        'حجم الملفات المرفوعة كبير جداً ويتجاوز سعة الخادم المسموحة. يرجى تقليل عدد الصفحات أو ضغط الصور والمحاولة مجدداً.',
    });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({
      success: false,
      code: 'INVALID_JSON_PAYLOAD',
      error: 'تنسيق البيانات المرسلة إلى الخادم غير صالح.',
    });
  }
  next(err);
});

function cleanBase64Input(raw: string, fallbackMime = 'image/jpeg'): { data: string; mimeType: string } {
  let cleanBase64 = String(raw || '').trim();
  let actualMime = fallbackMime;
  if (cleanBase64.includes(';base64,')) {
    const parts = cleanBase64.split(';base64,');
    cleanBase64 = parts[1] || '';
    const mimeMatch = parts[0].match(/data:(.*?)$/);
    if (mimeMatch && mimeMatch[1]) {
      actualMime = mimeMatch[1];
    }
  }
  return { data: cleanBase64, mimeType: actualMime };
}

async function enrichVocabularyWithDictionary(rawVocab: any[]): Promise<any[]> {
  if (!Array.isArray(rawVocab)) return [];
  return Promise.all(
    rawVocab.map(async (v: any) => {
      const word = String(v?.word || '').trim();
      const aiMeaning = String(v?.meaning || '').trim();
      const dictHit = word ? await dictionaryProvider.lookup(word) : null;

      if (dictHit) {
        const combinedExtra = Array.from(
          new Set([
            ...dictHit.meanings.filter((m) => m !== aiMeaning),
            ...(Array.isArray(v?.additionalMeanings) ? v.additionalMeanings.map(String) : []),
          ])
        ).slice(0, 4);

        return {
          word,
          meaning: aiMeaning || dictHit.meanings[0] || '',
          context: v?.context ? String(v.context) : undefined,
          wordType: v?.wordType ? String(v.wordType) : dictHit.wordType,
          additionalMeanings: combinedExtra,
          grammarInfo: v?.grammarInfo ? String(v.grammarInfo) : dictHit.grammarInfo,
          example: v?.example ? String(v.example) : dictHit.example,
          sourceType: 'dictionary_verified' as const,
          dictionarySource: dictHit.dictionarySource,
          sourceRef: v?.sourceRef ? String(v.sourceRef) : undefined,
        };
      }

      return {
        word,
        meaning: aiMeaning,
        context: v?.context ? String(v.context) : undefined,
        wordType: v?.wordType ? String(v.wordType) : undefined,
        additionalMeanings: Array.isArray(v?.additionalMeanings)
          ? v.additionalMeanings.map(String).slice(0, 4)
          : undefined,
        grammarInfo: v?.grammarInfo ? String(v.grammarInfo) : undefined,
        example: v?.example ? String(v.example) : undefined,
        sourceType: 'ai_contextual' as const,
        dictionarySource: 'ترجمة سياقية من محتوى المحاضرة (AI)',
        sourceRef: v?.sourceRef ? String(v.sourceRef) : undefined,
      };
    })
  );
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'ok',
    app: 'Wara2ty – ورقتي',
    hasApiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    pipelineStages: EXECUTION_PIPELINE.map((s) => s.label),
    dictionaryProvider: dictionaryProvider.name,
    memoryMB: Math.round(mem.rss / (1024 * 1024)),
    time: new Date().toISOString(),
  });
});

// Official Text-to-Speech provider capabilities & verified voice catalog
app.get('/api/tts/status', async (req, res) => {
  res.json({
    success: true,
    ...(await getTtsStatus()),
  });
});

// Official Text-to-Speech synthesis endpoint (Gemini-TTS primary, optional Google Cloud TTS secondary)
app.post('/api/tts', async (req, res) => {
  try {
    const { text, locale = 'ar-EG', voiceId, speakingRate = 1.0 } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_TTS_TEXT',
        error: 'النص المطلوب تحويله إلى صوت غير متوفر.',
      });
    }

    const result = await synthesizeSpeechSegment({
      text,
      locale,
      voiceId,
      speakingRate,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    const formatted = formatTtsErrorResponse(error);
    console.error(`[TTS Error] stage=${formatted.stage} code=${formatted.code} status=${formatted.status}`);
    return res.status(formatted.status).json({
      success: false,
      code: formatted.code,
      stage: formatted.stage,
      error: formatted.error,
    });
  }
});

// Turkish–Arabic dictionary lookup endpoint
app.get('/api/dictionary/lookup', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) {
      return res.json({ success: true, exact: null, matches: [] });
    }
    const exact = await dictionaryProvider.lookup(query);
    const matches = await dictionaryProvider.searchPrefix(query, 10);
    return res.json({
      success: true,
      provider: dictionaryProvider.name,
      exact,
      matches,
    });
  } catch (error: any) {
    console.error('Dictionary lookup error:', error);
    return res.status(500).json({
      success: false,
      error: 'تعذر البحث في المعجم حالياً.',
    });
  }
});

// Contextual word lookup when not found in verified dictionary
app.post('/api/dictionary/lookup', async (req, res) => {
  try {
    const { word, lectureContext } = req.body || {};
    const cleanWord = String(word || '').trim();
    if (!cleanWord) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال الكلمة المطلوبة.' });
    }

    const exact = await dictionaryProvider.lookup(cleanWord);
    if (exact) {
      return res.json({
        success: true,
        entry: {
          word: exact.word,
          meaning: exact.meanings[0] || '',
          additionalMeanings: exact.meanings.slice(1),
          wordType: exact.wordType,
          grammarInfo: exact.grammarInfo,
          example: exact.example,
          sourceType: 'dictionary_verified',
          dictionarySource: exact.dictionarySource,
        },
      });
    }

    const ai = getGenAI();
    const prompt = `
أنت معجم أكاديمي تركي-عربي دقيق في تطبيق ورقتي (Wara2ty).
المطلوب شرح الكلمة أو المصطلح التالي بدقة استناداً إلى سياق المحاضرة المرفق (إن وُجد):
الكلمة: ${cleanWord}
سياق المحاضرة: ${String(lectureContext || '').slice(0, 3000)}

ملاحظة: لا تخترع معاني غير موثوقة. وضّح نوع الكلمة، المعنى الأساسي، المعاني الإضافية إن وجدت، المعلومات الصرفية/اللواحق إن كانت تركية، ومثالاً بسيطاً.
`;
    const schema = {
      type: Type.OBJECT,
      properties: {
        word: { type: Type.STRING },
        meaning: { type: Type.STRING },
        wordType: { type: Type.STRING },
        additionalMeanings: { type: Type.ARRAY, items: { type: Type.STRING } },
        grammarInfo: { type: Type.STRING },
        context: { type: Type.STRING },
        example: { type: Type.STRING },
      },
      required: ['word', 'meaning', 'wordType'],
    };

    const { response } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson<any>(response.text || '{}');

    return res.json({
      success: true,
      entry: {
        word: String(parsed?.word || cleanWord),
        meaning: String(parsed?.meaning || ''),
        wordType: parsed?.wordType ? String(parsed.wordType) : undefined,
        additionalMeanings: Array.isArray(parsed?.additionalMeanings)
          ? parsed.additionalMeanings.map(String)
          : [],
        grammarInfo: parsed?.grammarInfo ? String(parsed.grammarInfo) : undefined,
        context: parsed?.context ? String(parsed.context) : undefined,
        example: parsed?.example ? String(parsed.example) : undefined,
        sourceType: 'ai_contextual',
        dictionarySource: 'ترجمة سياقية بالذكاء الاصطناعي (غير مدرجة في المعجم المحلي)',
      },
    });
  } catch (error: any) {
    console.error('AI dictionary lookup error:', error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});

// Main multimodal note analysis endpoint (supports single image, multi-page images, or PDF)
app.post('/api/analyze-note', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg', pages } = req.body || {};

    const inputParts: any[] = [];
    let totalPages = 1;

    if (Array.isArray(pages) && pages.length > 0) {
      if (pages.length > 10) {
        return res.status(400).json({
          success: false,
          code: 'TOO_MANY_PAGES',
          error: 'الحد الأقصى للتحليل في الجلسة الواحدة هو 10 صفحات لضمان دقة القراءة وسرعة المعالجة.',
        });
      }
      totalPages = pages.length;
      pages.forEach((p: any, idx: number) => {
        const cleaned = cleanBase64Input(p?.imageBase64 || p?.dataUrl || '', p?.mimeType || 'image/jpeg');
        if (cleaned.data && cleaned.data.length >= 50) {
          inputParts.push({ text: `--- صفحة المحاضرة رقم ${p?.pageNumber || idx + 1} ---` });
          inputParts.push({
            inlineData: {
              mimeType: cleaned.mimeType,
              data: cleaned.data,
            },
          });
        }
      });
    } else if (imageBase64 && typeof imageBase64 === 'string') {
      const cleaned = cleanBase64Input(imageBase64, mimeType);
      if (!cleaned.data || cleaned.data.length < 50) {
        return res.status(400).json({
          success: false,
          code: 'EMPTY_IMAGE',
          error: 'بيانات الملف المرفوع غير مكتملة أو تالفة. يرجى اختيار ملف آخر.',
        });
      }
      if (cleaned.mimeType === 'application/pdf') {
        inputParts.push({ text: '--- مستند محاضرة بصيغة PDF (استخرج الصفحات بالترتيب مع أرقام الصفحات) ---' });
      }
      inputParts.push({
        inlineData: {
          mimeType: cleaned.mimeType,
          data: cleaned.data,
        },
      });
    }

    if (inputParts.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_IMAGE',
        error: 'لم يتم إرفاق صورة أو ملف للتحليل. يرجى اختيار صورة المحاضرة أولاً.',
      });
    }

    const ai = getGenAI();

    const promptText = `
أنت خبير أكاديمي ومساعد دراسي متخصص في تحويل ملاحظات المحاضرات (سواء كانت صفحة واحدة أو عدة صفحات أو مستند PDF) إلى مادة دراسية رقمية منظمة ودقيقة في تطبيق "ورقتي – Wara2ty".
عدد الصفحات المرفقة في هذا الطلب: ${totalPages}.

المهام المطلوبة بدقة وأمانة علمية:
1. الرؤية الحاسوبية وقراءة النصوص (OCR) لكل صفحة:
   - اقرأ جميع الصفحات المرفقة (${totalPages} صفحة) بالترتيب الصحيح كـ "محاضرة واحدة متكاملة".
   - يجب أن تحتوي مصفوفة pages على عنصر منفصل لكل صفحة من الصفحات المرفقة (من 1 إلى ${totalPages}) مع extractedText و arabicTranslation لكل صفحة.
   - حافظ على العناوين، الفقرات، القوائم، والمعادلات، وفواصل الصفحات.
   - لا تختلق كلمات غير مقروءة أو مطموسة إطلاقاً! ضع علامة [غير واضح] عند الكلمة غير الواضحة.
   - صنّف أجزاء النص المستخرج في مصفوفة ocrSegments (بحد أدنى فقرة/جزء لكل قسم مهم) إلى:
     * "verified" (نص موثق مقروء بوضوح)
     * "needs_review" (يحتاج مراجعة الطالب بسبب خط غير منتظم أو التباس محتمل)
     * "unclear" (نص غير واضح أو مطموس)
   - لا تخترع نسباً مئوية للثقة.
2. كشف اللغة والترجمة والمحاذاة الثنائية (Bilingual Alignment):
   - حدد لغة المصدر (مثل: التركية، العربية، الإنجليزية، خليط تركي وعربي).
   - ترجم المحتوى كاملاً إلى عربية فصحى أكاديمية واضحة (arabicTranslation).
   - يجب أن تحتوي مصفوفة bilingualSections على جميع فقرات/أقسام المحاضرة متناظرة (originalText مقابل arabicTranslation مع pageNumber) لعرضها جنباً إلى جنب.
3. الجداول والرسوم التوضيحية (Tables & Diagrams):
   - إذا وجدت جداول داخل الصور أو المستند، استخرجها في قائمة tables (العنوان، الصفوف والأعمدة بالترتيب، الرؤوس headers). لا تدمج الجداول في فقرات عادية.
   - افحص جميع الصفحات بحثاً عن أي مخطط أو خط زمني (Timeline) أو رسم توضيحي أو أسهم أو صندوق بياني، وحلّله في قائمة diagrams (ما تمثله، العلاقات بين عناصرها، التسميات الظاهرة، ارتباطها بالنص). إذا كان الرسم غير واضح ضع needsManualReview: true ولا تخترع تفاصيل.
4. المعجم والمفردات التركية/الأكاديمية (vocabulary):
   - استخرج أهم الكلمات والمصطلحات في المحاضرة (5-10 مفردات) مع: word، meaning (المعنى بالعربية)، wordType (نوع الكلمة)، additionalMeanings، grammarInfo، context، example، sourceRef.
5. الملخص الأكاديمي (summary):
   - عنوان واضح، نبذة عامة، نقاط رئيسية، نصيحة امتحانية، ومراجع المصدر sourceRefs.
6. الاختبار التفاعلي المبدئي (quiz):
   - أنشئ 5 أسئلة اختيار من متعدد مبنية حصراً على محتوى المحاضرة، لكل منها 4 خيارات، correctIndex (0..3)، explanation عربي، topic، و sourceRef (مثل "صفحة 1 – قسم الأزمنة" أو "مرجع تقريبي من نص المحاضرة" ولا تخترع أرقام صفحات غير موجودة).

أرجع النتيجة حصراً بصيغة JSON مطابقة للمخطط المحدد.
`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        detectedLanguage: { type: Type.STRING },
        clarityScore: { type: Type.STRING },
        topics: { type: Type.ARRAY, items: { type: Type.STRING } },
        extractedText: { type: Type.STRING },
        arabicTranslation: { type: Type.STRING },
        pages: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pageNumber: { type: Type.INTEGER },
              title: { type: Type.STRING },
              extractedText: { type: Type.STRING },
              arabicTranslation: { type: Type.STRING },
              sourceNote: { type: Type.STRING },
            },
            required: ['pageNumber', 'extractedText', 'arabicTranslation'],
          },
        },
        ocrSegments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              text: { type: Type.STRING },
              status: { type: Type.STRING, description: 'verified | needs_review | unclear' },
              pageNumber: { type: Type.INTEGER },
              reason: { type: Type.STRING },
            },
            required: ['id', 'text', 'status'],
          },
        },
        bilingualSections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              pageNumber: { type: Type.INTEGER },
              sectionTitle: { type: Type.STRING },
              originalText: { type: Type.STRING },
              arabicTranslation: { type: Type.STRING },
            },
            required: ['id', 'originalText', 'arabicTranslation'],
          },
        },
        tables: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              pageNumber: { type: Type.INTEGER },
              headers: { type: Type.ARRAY, items: { type: Type.STRING } },
              rows: {
                type: Type.ARRAY,
                items: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              notes: { type: Type.STRING },
            },
            required: ['id', 'title', 'headers', 'rows'],
          },
        },
        diagrams: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              pageNumber: { type: Type.INTEGER },
              description: { type: Type.STRING },
              relationships: { type: Type.ARRAY, items: { type: Type.STRING } },
              labels: { type: Type.ARRAY, items: { type: Type.STRING } },
              connectionToLecture: { type: Type.STRING },
              needsManualReview: { type: Type.BOOLEAN },
            },
            required: ['id', 'title', 'description', 'connectionToLecture'],
          },
        },
        summary: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            overview: { type: Type.STRING },
            keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            examTip: { type: Type.STRING },
            sourceRefs: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['title', 'overview', 'keyPoints', 'examTip'],
        },
        vocabulary: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              meaning: { type: Type.STRING },
              wordType: { type: Type.STRING },
              additionalMeanings: { type: Type.ARRAY, items: { type: Type.STRING } },
              grammarInfo: { type: Type.STRING },
              context: { type: Type.STRING },
              example: { type: Type.STRING },
              sourceRef: { type: Type.STRING },
            },
            required: ['word', 'meaning'],
          },
        },
        quiz: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
              topic: { type: Type.STRING },
              sourceRef: { type: Type.STRING },
            },
            required: ['id', 'question', 'options', 'correctIndex', 'explanation'],
          },
        },
        uncertainSections: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        'detectedLanguage',
        'clarityScore',
        'topics',
        'extractedText',
        'arabicTranslation',
        'pages',
        'ocrSegments',
        'bilingualSections',
        'tables',
        'diagrams',
        'summary',
        'vocabulary',
        'quiz',
      ],
    };

    const { response, modelUsed } = await executeGeminiWithResilience(
      ai,
      { parts: [...inputParts, { text: promptText }] },
      responseSchema
    );

    const rawParsed = safeParseJson<any>(response.text || '{}');

    const normalizedPages =
      Array.isArray(rawParsed?.pages) && rawParsed.pages.length > 0
        ? rawParsed.pages.map((p: any, idx: number) => ({
            pageNumber: Number(p?.pageNumber || idx + 1),
            title: p?.title ? String(p.title) : `صفحة ${idx + 1}`,
            extractedText: String(p?.extractedText || ''),
            arabicTranslation: String(p?.arabicTranslation || ''),
            sourceNote: p?.sourceNote ? String(p.sourceNote) : undefined,
          }))
        : [
            {
              pageNumber: 1,
              title: rawParsed?.summary?.title ? String(rawParsed.summary.title) : 'صفحة 1',
              extractedText: String(rawParsed?.extractedText || ''),
              arabicTranslation: String(rawParsed?.arabicTranslation || ''),
            },
          ];

    let normalizedOcrSegments = Array.isArray(rawParsed?.ocrSegments)
      ? rawParsed.ocrSegments.map((seg: any, idx: number) => {
          const st = String(seg?.status || '').toLowerCase();
          const status =
            st === 'unclear' ? 'unclear' : st === 'needs_review' ? 'needs_review' : 'verified';
          return {
            id: String(seg?.id || `seg-${idx + 1}`),
            text: String(seg?.text || ''),
            status,
            pageNumber: typeof seg?.pageNumber === 'number' ? seg.pageNumber : undefined,
            reason: seg?.reason ? String(seg.reason) : undefined,
          };
        })
      : [];

    if (normalizedOcrSegments.length === 0 && rawParsed?.extractedText) {
      normalizedOcrSegments = String(rawParsed.extractedText)
        .split(/\n{1,2}/)
        .map((line: string) => line.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map((line: string, idx: number) => ({
          id: `seg-${idx + 1}`,
          text: line,
          status: line.includes('[غير واضح]') ? 'unclear' : 'verified',
        }));
    }

    let normalizedBilingual = Array.isArray(rawParsed?.bilingualSections)
      ? rawParsed.bilingualSections.map((b: any, idx: number) => ({
          id: String(b?.id || `bi-${idx + 1}`),
          pageNumber: typeof b?.pageNumber === 'number' ? b.pageNumber : undefined,
          sectionTitle: b?.sectionTitle ? String(b.sectionTitle) : undefined,
          originalText: String(b?.originalText || ''),
          arabicTranslation: String(b?.arabicTranslation || ''),
        }))
      : [];

    if (normalizedBilingual.length === 0 && normalizedPages.length > 0) {
      normalizedBilingual = normalizedPages.map((p: any, idx: number) => ({
        id: `bi-${idx + 1}`,
        pageNumber: p.pageNumber,
        sectionTitle: p.title || `صفحة ${p.pageNumber}`,
        originalText: p.extractedText,
        arabicTranslation: p.arabicTranslation,
      }));
    }

    const normalizedTables = Array.isArray(rawParsed?.tables)
      ? rawParsed.tables.map((t: any, idx: number) => ({
          id: String(t?.id || `tbl-${idx + 1}`),
          title: String(t?.title || `جدول ${idx + 1}`),
          pageNumber: typeof t?.pageNumber === 'number' ? t.pageNumber : undefined,
          headers: Array.isArray(t?.headers) ? t.headers.map(String) : [],
          rows: Array.isArray(t?.rows)
            ? t.rows.map((r: any) => (Array.isArray(r) ? r.map(String) : []))
            : [],
          notes: t?.notes ? String(t.notes) : undefined,
        }))
      : [];

    const normalizedDiagrams = Array.isArray(rawParsed?.diagrams)
      ? rawParsed.diagrams.map((d: any, idx: number) => ({
          id: String(d?.id || `diag-${idx + 1}`),
          title: String(d?.title || `مخطط توضيحي ${idx + 1}`),
          pageNumber: typeof d?.pageNumber === 'number' ? d.pageNumber : undefined,
          description: String(d?.description || ''),
          relationships: Array.isArray(d?.relationships) ? d.relationships.map(String) : [],
          labels: Array.isArray(d?.labels) ? d.labels.map(String) : [],
          connectionToLecture: String(d?.connectionToLecture || ''),
          needsManualReview: Boolean(d?.needsManualReview),
        }))
      : [];

    const enrichedVocabulary = await enrichVocabularyWithDictionary(rawParsed?.vocabulary || []);

    const normalizedData = {
      detectedLanguage: rawParsed?.detectedLanguage || 'غير محدد',
      clarityScore: rawParsed?.clarityScore || 'واضحة',
      topics: Array.isArray(rawParsed?.topics) ? rawParsed.topics.map(String) : [],
      extractedText:
        rawParsed?.extractedText ||
        normalizedPages.map((p: any) => `[صفحة ${p.pageNumber}]\n${p.extractedText}`).join('\n\n') ||
        'لم يتم العثور على نص واضح في الملف.',
      arabicTranslation:
        rawParsed?.arabicTranslation ||
        normalizedPages.map((p: any) => p.arabicTranslation).join('\n\n') ||
        '',
      pageCount: Math.max(totalPages, normalizedPages.length),
      pages: normalizedPages,
      ocrSegments: normalizedOcrSegments,
      bilingualSections: normalizedBilingual,
      tables: normalizedTables,
      diagrams: normalizedDiagrams,
      summary: {
        title: rawParsed?.summary?.title || 'ملخص المحاضرة الدراسية',
        overview: rawParsed?.summary?.overview || 'تم استخراج وتحليل محتوى المحاضرة بنجاح.',
        keyPoints: Array.isArray(rawParsed?.summary?.keyPoints)
          ? rawParsed.summary.keyPoints.map(String)
          : [],
        examTip: rawParsed?.summary?.examTip || 'راجع المصطلحات الأساسية والنقاط الرئيسية قبل الاختبار.',
        sourceRefs: Array.isArray(rawParsed?.summary?.sourceRefs)
          ? rawParsed.summary.sourceRefs.map(String)
          : [],
      },
      vocabulary: enrichedVocabulary,
      quiz: Array.isArray(rawParsed?.quiz)
        ? rawParsed.quiz.slice(0, 5).map((q: any, idx: number) => ({
            id: idx + 1,
            question: String(q?.question || `سؤال ${idx + 1}`),
            options:
              Array.isArray(q?.options) && q.options.length >= 2
                ? q.options.slice(0, 4).map(String)
                : ['الخيار الأول', 'الخيار الثاني', 'الخيار الثالث', 'الخيار الرابع'],
            correctIndex:
              typeof q?.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex <= 3
                ? q.correctIndex
                : 0,
            explanation: String(q?.explanation || 'الإجابة مستخرجة من محتوى المحاضرة.'),
            topic: q?.topic ? String(q.topic) : undefined,
            sourceRef: q?.sourceRef ? String(q.sourceRef) : undefined,
            type: 'mcq' as const,
          }))
        : [],
      uncertainSections: Array.isArray(rawParsed?.uncertainSections)
        ? rawParsed.uncertainSections.map(String)
        : [],
    };

    return res.json({
      success: true,
      modelUsed,
      data: normalizedData,
    });
  } catch (error: any) {
    console.error('Error analyzing lecture note:', error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({
      success: false,
      code: translated.code,
      retryable: translated.retryable,
      error: translated.message,
    });
  }
});

// Reprocess corrected OCR text into updated Arabic translation, bilingual alignment, and summary
app.post('/api/reprocess-text', async (req, res) => {
  try {
    const { correctedText, detectedLanguage } = req.body || {};
    if (!correctedText || typeof correctedText !== 'string') {
      return res.status(400).json({ success: false, error: 'النص المصحح غير متوفر.' });
    }

    const ai = getGenAI();
    const prompt = `
قام الطالب بمراجعة وتصحيح النص المستخرج من محاضرته (اللغة المكتشفة: ${detectedLanguage || 'غير محددة'}).
المطلوب إعادة إنتاج الترجمة العربية الأكاديمية (arabicTranslation)، وأقسام المحاذاة الثنائية (bilingualSections)، والملخص الدراسي (summary) بناءً حصراً على هذا النص المصحح:

النص المصحح:
${correctedText.slice(0, 20000)}
`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        arabicTranslation: { type: Type.STRING },
        bilingualSections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              pageNumber: { type: Type.INTEGER },
              sectionTitle: { type: Type.STRING },
              originalText: { type: Type.STRING },
              arabicTranslation: { type: Type.STRING },
            },
            required: ['id', 'originalText', 'arabicTranslation'],
          },
        },
        summary: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            overview: { type: Type.STRING },
            keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            examTip: { type: Type.STRING },
          },
          required: ['title', 'overview', 'keyPoints', 'examTip'],
        },
      },
      required: ['arabicTranslation', 'bilingualSections', 'summary'],
    };

    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson<any>(response.text || '{}');

    return res.json({
      success: true,
      modelUsed,
      arabicTranslation: parsed?.arabicTranslation || '',
      bilingualSections: Array.isArray(parsed?.bilingualSections) ? parsed.bilingualSections : [],
      summary: parsed?.summary || null,
    });
  } catch (error: any) {
    console.error('Error reprocessing corrected text:', error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});

// FEATURE 1: Detailed AI Lecture Explanation (simple | detailed | academic)
app.post('/api/explain-lecture', async (req, res) => {
  try {
    const { lectureText, lectureTitle, arabicTranslation, mode = 'detailed' } = req.body || {};
    if (!lectureText && !arabicTranslation) {
      return res.status(400).json({ success: false, error: 'محتوى المحاضرة غير متوفر للشرح.' });
    }

    const modeInstructions: Record<string, string> = {
      simple:
        'اشرح بأسلوب مبسط جداً وواضح مناسب للمبتدئين بالعربية، مع تقسيم الفقرات وتبسيط المصطلحات الصعبة وأمثلة مباشرة من المحاضرة.',
      detailed:
        'قدم شرحاً تفصيلياً متدرجاً يغطي كل مفاهيم وقواعد المحاضرة، ويفكك المصطلحات والقواعد النحوية أو العلمية بأمثلة من المحاضرة ويوضح الروابط بين الموضوعات.',
      academic:
        'قدم شرحاً أكاديمياً معمقاً ودقيقاً باللغة العربية الفصحى العلمية مع الحفاظ على المصطلحات الأصلية وتحليل العلاقات والبنية العلمية للمحاضرة.',
    };

    const selectedMode = ['simple', 'detailed', 'academic'].includes(mode) ? mode : 'detailed';
    const ai = getGenAI();

    const prompt = `
أنت أستاذ جامعي ومساعد دراسي في تطبيق ورقتي (Wara2ty).
المطلوب إعداد "الشرح التفصيلي للمحاضرة" بالنمط المطلوب: (${selectedMode}).
توجيه النمط: ${modeInstructions[selectedMode]}

قواعد صارمة للأمانة العلمية:
1. اعتمد على محتوى المحاضرة المرفق فقط. لا تضف معلومات غير مدعومة أو خارج سياق المحاضرة.
2. افصل بوضوح في كل قسم بين:
   - lectureBasis: ما ورد فعلاً في المحاضرة.
   - explanation: الشرح التوضيحي للطالب.
   - additionalNote: (اختياري) أي توضيح إضافي مساعد خارج النص يُصنّف صراحةً كمعلومة إضافية مساعدة.
3. أضف أمثلة مستمدة من المحاضرة، وأبرز العلاقة بين الموضوعات (topicConnections)، والمعلومات الأساسية للفهم (keyTakeaways).
4. أرفق مرجع المصدر (sourceRef) لكل قسم (مثل: "صفحة 1 – قسم القواعد" أو "مرجع تقريبي من النص" دون اختلاق أرقام صفحات).

عنوان المحاضرة: ${lectureTitle || ''}
النص المستخرج من المحاضرة:
${String(lectureText || '').slice(0, 16000)}

الترجمة العربية المرجعية:
${String(arabicTranslation || '').slice(0, 8000)}
`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        mode: { type: Type.STRING },
        intro: { type: Type.STRING },
        sections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              heading: { type: Type.STRING },
              lectureBasis: { type: Type.STRING },
              explanation: { type: Type.STRING },
              additionalNote: { type: Type.STRING },
              examples: { type: Type.ARRAY, items: { type: Type.STRING } },
              sourceRef: { type: Type.STRING },
            },
            required: ['heading', 'lectureBasis', 'explanation'],
          },
        },
        topicConnections: { type: Type.ARRAY, items: { type: Type.STRING } },
        keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['intro', 'sections', 'topicConnections', 'keyTakeaways'],
    };

    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson<any>(response.text || '{}');

    return res.json({
      success: true,
      modelUsed,
      explanation: {
        mode: selectedMode,
        intro: String(parsed?.intro || ''),
        sections: Array.isArray(parsed?.sections) ? parsed.sections : [],
        topicConnections: Array.isArray(parsed?.topicConnections) ? parsed.topicConnections : [],
        keyTakeaways: Array.isArray(parsed?.keyTakeaways) ? parsed.keyTakeaways : [],
      },
    });
  } catch (error: any) {
    console.error('Explain lecture error:', error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});

// FEATURE 2: Ask Your Lecture – اسأل محاضرتك
app.post('/api/ask-lecture', async (req, res) => {
  try {
    const { question, lectureText, arabicTranslation, lectureTitle, history = [] } = req.body || {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ success: false, error: 'يرجى كتابة سؤالك أولاً.' });
    }
    if (!lectureText && !arabicTranslation) {
      return res.status(400).json({ success: false, error: 'محتوى المحاضرة غير متوفر للإجابة.' });
    }

    const ai = getGenAI();
    const recentHistory = Array.isArray(history)
      ? history
          .slice(-6)
          .map((m: any) => `${m.role === 'user' ? 'الطالب' : 'المساعد'}: ${String(m.content || '')}`)
          .join('\n')
      : '';

    const prompt = `
أنت مساعد دراسي مخصص حصراً للمحاضرة الحالية فقط ("اسأل محاضرتك" في تطبيق ورقتي).
لا تتصرف كمحادثة عامة خارج موضوع المحاضرة.

قواعد صارمة:
1. استخدم محتوى المحاضرة التالي كمصدر أساسي وحيد للإجابة.
2. إذا لم يكن الجواب موجوداً في المحاضرة المرفوعة، أخبر الطالب بوضوح وصدق (اجعل notFoundInLecture = true واكتب بوضوح في answer أن هذه المعلومة غير واردة في المحاضرة المرفوعة).
3. إذا استخدمت أي معرفة عامة مساعدة لتوضيح مفهوم ورد في المحاضرة، ضعها حصراً في الحقل المنفصل additionalExplanation ولا تخلطها مع محتوى المحاضرة.
4. اذكر المرجع من المحاضرة في sourceRef (رقم الصفحة أو القسم، أو وضّح أنه مرجع تقريبي).

عنوان المحاضرة: ${lectureTitle || ''}
محتوى المحاضرة المستخرج:
${String(lectureText || '').slice(0, 15000)}

الترجمة العربية:
${String(arabicTranslation || '').slice(0, 7000)}

سجل المحادثة السابق:
${recentHistory || 'لا يوجد'}

سؤال الطالب الحالي:
${question}
`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        answer: { type: Type.STRING },
        additionalExplanation: { type: Type.STRING },
        sourceRef: { type: Type.STRING },
        notFoundInLecture: { type: Type.BOOLEAN },
      },
      required: ['answer', 'notFoundInLecture'],
    };

    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson<any>(response.text || '{}');

    return res.json({
      success: true,
      modelUsed,
      reply: {
        answer: String(parsed?.answer || ''),
        additionalExplanation: parsed?.additionalExplanation ? String(parsed.additionalExplanation) : undefined,
        sourceRef: parsed?.sourceRef ? String(parsed.sourceRef) : undefined,
        notFoundInLecture: Boolean(parsed?.notFoundInLecture),
      },
    });
  } catch (error: any) {
    console.error('Ask lecture error:', error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});

// FEATURE 3: Explain Selected Section – اشرح الجزء المحدد
app.post('/api/explain-selection', async (req, res) => {
  try {
    const { selectedText, lectureText, lectureTitle, detectedLanguage } = req.body || {};
    if (!selectedText || typeof selectedText !== 'string' || !selectedText.trim()) {
      return res.status(400).json({ success: false, error: 'يرجى تحديد كلمة أو جملة أو فقرة من النص أولاً.' });
    }

    const ai = getGenAI();
    const prompt = `
اختار الطالب جزءاً محدداً من نص المحاضرة ليشرحه تطبيق ورقتي بسرعة دون إعادة تحليل المحاضرة كاملة.
اللغة المكتشفة للمحاضرة: ${detectedLanguage || 'غير محددة'}
عنوان المحاضرة: ${lectureTitle || ''}

الجزء المحدد من الطالب:
"${selectedText.trim().slice(0, 2000)}"

سياق المحاضرة الكامل:
${String(lectureText || '').slice(0, 12000)}

المطلوب:
1. ترجمة الجزء المحدد إلى العربية إن كان بلغة أجنبية (أو صياغة واضحة إن كان عربياً).
2. شرح المعنى بوضوح وبساطة بالعربية.
3. تفكيك الكلمات أو المصطلحات الصعبة داخل الجزء المحدد.
4. شرح أي قاعدة نحوية أو مصطلح علمي/تقني يظهر في هذا الجزء ضمن سياق المحاضرة.
5. تقديم مثال مناسب (مستمد من المحاضرة إن أمكن).
6. ربط هذا الجزء المحدد ببقية المحاضرة وبيان مصدره التقريبي أو الدقيق (sourceRef).
`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        selectedText: { type: Type.STRING },
        translation: { type: Type.STRING },
        explanation: { type: Type.STRING },
        vocabularyBreakdown: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              meaning: { type: Type.STRING },
            },
            required: ['word', 'meaning'],
          },
        },
        grammarOrTechNote: { type: Type.STRING },
        example: { type: Type.STRING },
        connectionToLecture: { type: Type.STRING },
        sourceRef: { type: Type.STRING },
      },
      required: ['selectedText', 'translation', 'explanation', 'vocabularyBreakdown', 'connectionToLecture'],
    };

    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson<any>(response.text || '{}');

    return res.json({
      success: true,
      modelUsed,
      result: {
        selectedText: String(parsed?.selectedText || selectedText.trim()),
        translation: String(parsed?.translation || ''),
        explanation: String(parsed?.explanation || ''),
        vocabularyBreakdown: Array.isArray(parsed?.vocabularyBreakdown)
          ? parsed.vocabularyBreakdown
          : [],
        grammarOrTechNote: parsed?.grammarOrTechNote ? String(parsed.grammarOrTechNote) : undefined,
        example: parsed?.example ? String(parsed.example) : undefined,
        connectionToLecture: String(parsed?.connectionToLecture || ''),
        sourceRef: parsed?.sourceRef ? String(parsed.sourceRef) : undefined,
      },
    });
  } catch (error: any) {
    console.error('Explain selection error:', error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});

// FEATURES 4, 5, 8, 11: Smart Comparisons, Expected Exam Questions, Revision Sheet, Mind Map
app.post('/api/study-tools', async (req, res) => {
  try {
    const { tool, lectureText, arabicTranslation, lectureTitle, summary, vocabulary } = req.body || {};

    if (!lectureText && !arabicTranslation) {
      return res.status(400).json({ success: false, error: 'محتوى المحاضرة غير متوفر.' });
    }

    const ai = getGenAI();
    const contextBlock = `
عنوان المحاضرة: ${lectureTitle || ''}
النص المستخرج (المعتمد بعد أي تعديل للطالب):
${String(lectureText || '').slice(0, 15000)}

الترجمة العربية:
${String(arabicTranslation || '').slice(0, 7000)}

الملخص: ${typeof summary === 'object' ? JSON.stringify(summary) : String(summary || '')}
`;

    if (tool === 'comparisons') {
      const prompt = `
حدد المفاهيم أو الأزمنة أو القواعد أو المصطلحات المتقابلة التي يمكن مقارنتها داخل المحاضرة المرفقة فقط (مثل الأزمنة التركية، أو النظريات، أو المصطلحات المتشابهة).
شروط صارمة:
- لا تخترع مقارنات غير موجودة في المحاضرة، ولا تملأ خانات ناقصة بافتراضات غير مدعومة!
- إذا لم تتوفر معلومة لعنصر في الجدول اكتب "غير مذكور في المحاضرة" واذكر التفاصيل الناقصة في missingDetailsNote.
- أضف الأعمدة المناسبة مثل: المفهوم، التعريف، الخصائص الأساسية، الاستخدام، الأمثلة، الفروقات.
- اذكر المرجع sourceRef.
${contextBlock}
`;
      const schema = {
        type: Type.OBJECT,
        properties: {
          tables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                sourceRef: { type: Type.STRING },
                columns: { type: Type.ARRAY, items: { type: Type.STRING } },
                rows: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                missingDetailsNote: { type: Type.STRING },
              },
              required: ['id', 'title', 'columns', 'rows'],
            },
          },
        },
        required: ['tables'],
      };

      const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
      const parsed = safeParseJson<any>(response.text || '{}');
      return res.json({
        success: true,
        modelUsed,
        comparisonTables: Array.isArray(parsed?.tables) ? parsed.tables : [],
      });
    }

    if (tool === 'revision_sheet') {
      const prompt = `
صمم "ورقة المراجعة النهائية" (Revision Sheet) المركزة وسريعة القراءة قبل الامتحان استناداً حصراً لمحتوى المحاضرة:
تشمل: الأفكار الرئيسية، التعريفات المهمة مع sourceRef، المصطلحات الأساسية، القواعد المهمة، أبرز الأمثلة، المقارنات السريعة، نقاط تستحق انتباهاً إضافياً، وقائمة مراجعة نهائية (checklist).
${contextBlock}
المفردات: ${JSON.stringify(Array.isArray(vocabulary) ? vocabulary.slice(0, 20) : [])}
`;
      const schema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          mainIdeas: { type: Type.ARRAY, items: { type: Type.STRING } },
          definitions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING },
                definition: { type: Type.STRING },
                sourceRef: { type: Type.STRING },
              },
              required: ['term', 'definition'],
            },
          },
          essentialTerms: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                meaning: { type: Type.STRING },
              },
              required: ['word', 'meaning'],
            },
          },
          importantRules: { type: Type.ARRAY, items: { type: Type.STRING } },
          keyExamples: { type: Type.ARRAY, items: { type: Type.STRING } },
          comparisons: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                itemA: { type: Type.STRING },
                itemB: { type: Type.STRING },
                difference: { type: Type.STRING },
              },
              required: ['itemA', 'itemB', 'difference'],
            },
          },
          watchOutPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
          checklist: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'title',
          'mainIdeas',
          'definitions',
          'essentialTerms',
          'importantRules',
          'keyExamples',
          'watchOutPoints',
          'checklist',
        ],
      };

      const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
      const parsed = safeParseJson<any>(response.text || '{}');
      return res.json({
        success: true,
        modelUsed,
        revisionSheet: parsed,
      });
    }

    if (tool === 'expected_questions') {
      const prompt = `
أنشئ مجموعة من 6 أسئلة تدريبية متوقعة (AI-generated practice / potential exam questions) متنوعة الأنواع بناءً حصراً على المحاضرة المرفقة:
تشمل تنوعاً من الأنواع: mcq، true_false، short_answer، definition، explanation، comparison.
ملاحظة: لا تدّعِ أنها أسئلة امتحان رسمية حقيقية؛ هي أسئلة تدريبية مقترحة بالذكاء الاصطناعي.
أرفق لكل سؤال: modelAnswer (الإجابة النموذجية)، explanation (التفسير)، و sourceRef (مرجع الصفحة/القسم أو مرجع تقريبي).
${contextBlock}
`;
      const schema = {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                type: {
                  type: Type.STRING,
                  description: 'mcq | true_false | short_answer | definition | explanation | comparison',
                },
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                booleanAnswer: { type: Type.BOOLEAN },
                modelAnswer: { type: Type.STRING },
                explanation: { type: Type.STRING },
                sourceRef: { type: Type.STRING },
              },
              required: ['id', 'type', 'question', 'modelAnswer', 'explanation'],
            },
          },
        },
        required: ['questions'],
      };

      const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
      const parsed = safeParseJson<any>(response.text || '{}');
      return res.json({
        success: true,
        modelUsed,
        expectedExamQuestions: Array.isArray(parsed?.questions) ? parsed.questions : [],
      });
    }

    if (tool === 'mind_map') {
      const prompt = `
أنشئ بنية "خريطة ذهنية" (Mind Map) هرمية واضحة بالعربية تعكس الهيكل الفعلي للمحاضرة المرفقة فقط دون إضافة مواضيع غير واردة فيها.
تشمل الموضوع الرئيسي centralTopic، وفروعاً رئيسية branches (مع sourceRef)، وتحت كل فرع نقاطاً فرعية children (title و details مختصرة).
${contextBlock}
`;
      const schema = {
        type: Type.OBJECT,
        properties: {
          centralTopic: { type: Type.STRING },
          branches: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                sourceRef: { type: Type.STRING },
                children: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      details: { type: Type.STRING },
                    },
                    required: ['title'],
                  },
                },
              },
              required: ['id', 'title', 'children'],
            },
          },
        },
        required: ['centralTopic', 'branches'],
      };

      const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
      const parsed = safeParseJson<any>(response.text || '{}');
      return res.json({
        success: true,
        modelUsed,
        mindMap: parsed,
      });
    }

    return res.status(400).json({ success: false, error: 'الأداة المطلوبة غير معروفة.' });
  } catch (error: any) {
    console.error('Study tool generation error:', error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});

// FEATURE 13: Advanced Quiz Modes (quick, comprehensive, difficult, vocabulary, true_false, exam_simulation)
app.post('/api/generate-quiz', async (req, res) => {
  try {
    const { lectureText, lectureTitle, summary, vocabulary, mode = 'quick' } = req.body || {};

    if (!lectureText && !summary) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_LECTURE_CONTENT',
        error: 'نص المحاضرة غير متوفر لتوليد الأسئلة.',
      });
    }

    const modeSpecs: Record<string, { count: number; instructions: string }> = {
      quick: {
        count: 5,
        instructions: 'اختبار سريع من 5 أسئلة اختيار من متعدد للمراجعة السريعة.',
      },
      comprehensive: {
        count: 8,
        instructions: 'اختبار شامل من 8 أسئلة اختيار من متعدد يغطي جميع أقسام وأفكار المحاضرة.',
      },
      difficult: {
        count: 6,
        instructions: 'اختبار أسئلة عميقة وصعبة (6 أسئلة) تتطلب فهماً تحليلياً وربطاً بين قواعد ومفاهيم المحاضرة.',
      },
      vocabulary: {
        count: 6,
        instructions: 'اختبار مفردات ومصطلحات (6 أسئلة) يركز على معاني الكلمات التركية/الأكاديمية وسياقها في المحاضرة.',
      },
      true_false: {
        count: 6,
        instructions:
          'اختبار صح أم خطأ (6 عبارات) مبنية بدقة على المحاضرة. يجب أن تكون options = ["صح", "خطأ"] فقط و correctIndex = 0 للصح أو 1 للخطأ.',
      },
      exam_simulation: {
        count: 8,
        instructions: 'محاكاة اختبار جامعي من 8 أسئلة اختيار من متعدد متنوعة الصعوبة ومبنية حصراً على المحاضرة.',
      },
    };

    const spec = modeSpecs[mode] || modeSpecs.quick;
    const ai = getGenAI();

    const prompt = `
أنت خبير أكاديمي وواضع اختبارات في تطبيق "ورقتي – Wara2ty".
النمط المطلوب: ${mode} — ${spec.instructions}

الشروط الإلزامية:
1. الأسئلة مبنية 100% على محتوى المحاضرة المرفق فقط.
2. في الاختيار من متعدد، لكل سؤال 4 خيارات واضحة. وفي نمط صح/خطأ، الخياران هما ["صح", "خطأ"].
3. اذكر شرحاً تعليمياً بالعربية (explanation)، والموضوع الفرعي (topic) لتحديد نقاط الضعف، ومرجع المصدر في المحاضرة (sourceRef).

عنوان المحاضرة: ${lectureTitle || ''}
ملخص المحاضرة: ${typeof summary === 'object' ? JSON.stringify(summary) : summary || ''}
المفردات: ${JSON.stringify(Array.isArray(vocabulary) ? vocabulary.slice(0, 15) : [])}

نص المحاضرة:
${String(lectureText || '').slice(0, 15000)}
`;

    const quizSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.INTEGER },
          question: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          correctIndex: { type: Type.INTEGER },
          explanation: { type: Type.STRING },
          topic: { type: Type.STRING },
          sourceRef: { type: Type.STRING },
        },
        required: ['id', 'question', 'options', 'correctIndex', 'explanation'],
      },
    };

    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, quizSchema);
    const parsedPayload = safeParseJson<any>(response.text || '[]');
    const rawQuestions = Array.isArray(parsedPayload)
      ? parsedPayload
      : Array.isArray(parsedPayload?.questions)
      ? parsedPayload.questions
      : Array.isArray(parsedPayload?.quiz)
      ? parsedPayload.quiz
      : [];

    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      throw new Error('لم يرجع النموذج قائمة أسئلة صالحة.');
    }

    const isTrueFalse = mode === 'true_false';
    const normalizedQuestions = rawQuestions.slice(0, spec.count).map((q: any, idx: number) => {
      const opts = isTrueFalse
        ? ['صح', 'خطأ']
        : Array.isArray(q?.options) && q.options.length >= 2
        ? q.options.slice(0, 4).map(String)
        : ['الخيار الأول', 'الخيار الثاني', 'الخيار الثالث', 'الخيار الرابع'];

      const maxIdx = opts.length - 1;
      const correctIdx =
        typeof q?.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex <= maxIdx
          ? q.correctIndex
          : 0;

      return {
        id: idx + 1,
        question: String(q?.question || `سؤال ${idx + 1}`),
        options: opts,
        correctIndex: correctIdx,
        explanation: String(q?.explanation || 'الإجابة الصحيحة مستمدة من شرح المحاضرة.'),
        topic: q?.topic ? String(q.topic) : undefined,
        sourceRef: q?.sourceRef ? String(q.sourceRef) : undefined,
        type: isTrueFalse ? ('true_false' as const) : ('mcq' as const),
      };
    });

    return res.json({
      success: true,
      modelUsed,
      mode,
      questions: normalizedQuestions,
    });
  } catch (error: any) {
    console.error('Error generating quiz questions:', error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({
      success: false,
      code: translated.code,
      retryable: translated.retryable,
      error: translated.message,
    });
  }
});

// FEATURE 16: Compare & Combine Review across multiple saved lectures
app.post('/api/compare-lectures', async (req, res) => {
  try {
    const { lectures } = req.body || {};
    if (!Array.isArray(lectures) || lectures.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'يرجى تحديد محاضرتين على الأقل للمقارنة والمراجعة المشتركة.',
      });
    }

    const ai = getGenAI();
    const condensed = lectures.slice(0, 4).map((l: any, i: number) => ({
      index: i + 1,
      title: String(l?.title || `محاضرة ${i + 1}`),
      summary: l?.summary || {},
      excerpt: String(l?.extractedText || '').slice(0, 3500),
    }));

    const prompt = `
أنت مساعد دراسي ذكي في تطبيق ورقتي.
قارن بين المحاضرات المحفوظة التالية وأعد مراجعة مجمعة تربط بينها بدقة دون اختلاق معلومات غير موجودة فيها:
${JSON.stringify(condensed)}
`;

    const schema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        sharedConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
        keyDifferences: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING },
              details: { type: Type.STRING },
            },
            required: ['topic', 'details'],
          },
        },
        combinedChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
        studyAdvice: { type: Type.STRING },
      },
      required: ['title', 'sharedConcepts', 'keyDifferences', 'combinedChecklist', 'studyAdvice'],
    };

    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson<any>(response.text || '{}');

    return res.json({
      success: true,
      modelUsed,
      review: parsed,
    });
  } catch (error: any) {
    console.error('Compare lectures error:', error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});

// Configure Vite middleware in dev or static files in production
async function startServer() {
  const distPath = path.resolve(__dirname, 'dist');
  const indexHtmlPath = path.resolve(distPath, 'index.html');
  const hasDist = fs.existsSync(indexHtmlPath);

  const isCompiledServer = __filename.endsWith('.js');
  const isExplicitProduction = process.env.NODE_ENV === 'production';
  const isProduction = (isExplicitProduction || isCompiledServer) && hasDist;

  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      console.log('Vite middleware mounted in development mode');
    } catch (viteErr) {
      console.warn('Could not initialize Vite middleware, falling back to static files:', viteErr);
      if (hasDist) {
        app.use(express.static(distPath));
        app.get('*', (req, res) => res.sendFile(indexHtmlPath));
      }
    }
  } else {
    if (hasDist) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(indexHtmlPath);
      });
      console.log(`Serving static production files from: ${distPath}`);
    } else {
      console.warn('Warning: dist/index.html was not found. Serving fallback page.');
      app.get('*', (req, res) => {
        res.status(200).send(`
          <!DOCTYPE html>
          <html lang="ar" dir="rtl">
            <head><meta charset="UTF-8"><title>Wara2ty – ورقتي</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h2>تطبيق ورقتي – Wara2ty</h2>
              <p>الخادم يعمل بنجاح على المنفذ ${PORT}. يرجى تشغيل بناء واجهة المستخدم (npm run build).</p>
            </body>
          </html>
        `);
      });
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Wara2ty server is running at http://0.0.0.0:${PORT} [mode: ${isProduction ? 'production' : 'development'}]`);
  });

  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;

  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server gracefully');
    server.close(() => {
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server gracefully');
    server.close(() => {
      process.exit(0);
    });
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
