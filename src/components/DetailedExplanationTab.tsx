import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Sparkles,
  GraduationCap,
  Layers,
  AlertCircle,
  RefreshCw,
  Link2,
  Lightbulb,
  Info,
  MapPin,
} from 'lucide-react';
import { DetailedExplanationData, ExplanationMode } from '../types';

interface DetailedExplanationTabProps {
  lectureText: string;
  arabicTranslation: string;
  lectureTitle: string;
  cachedExplanations?: Partial<Record<ExplanationMode, DetailedExplanationData>>;
  onSaveExplanation: (mode: ExplanationMode, data: DetailedExplanationData) => void;
}

const MODES: { id: ExplanationMode; label: string; desc: string; icon: React.ComponentType<any> }[] = [
  {
    id: 'simple',
    label: 'شرح مبسّط',
    desc: 'لغة عربية سهلة ومباشرة لفهم الأساسيات بسرعة',
    icon: Lightbulb,
  },
  {
    id: 'detailed',
    label: 'شرح تفصيلي',
    desc: 'تفكيك القواعد والمصطلحات مع أمثلة من المحاضرة',
    icon: Layers,
  },
  {
    id: 'academic',
    label: 'شرح أكاديمي',
    desc: 'صياغة علمية دقيقة مع المصطلحات الأصلية والعلاقات',
    icon: GraduationCap,
  },
];

export const DetailedExplanationTab: React.FC<DetailedExplanationTabProps> = ({
  lectureText,
  arabicTranslation,
  lectureTitle,
  cachedExplanations = {},
  onSaveExplanation,
}) => {
  const [mode, setMode] = useState<ExplanationMode>('detailed');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const activeExplanation = cachedExplanations?.[mode];

  const generateExplanation = async (targetMode: ExplanationMode) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/explain-lecture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lectureText,
          arabicTranslation,
          lectureTitle,
          mode: targetMode,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success || !json.explanation) {
        throw new Error(json.error || 'تعذر توليد الشرح التفصيلي حالياً.');
      }
      onSaveExplanation(targetMode, json.explanation);
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء إعداد الشرح التفصيلي.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!activeExplanation && !isLoading && (lectureText || arabicTranslation)) {
      generateExplanation(mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="space-y-6">
      {/* Header & Mode Selector */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-black text-lg text-slate-900 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-600" />
              <span>الشرح التفصيلي للمحاضرة</span>
            </h3>
            <p className="text-xs text-slate-500">
              شرح منظم ومرتبط بمحتوى محاضرتك المرفوعة فقط، مع تمييز أي توضيح إضافي مساعد عن نص المحاضرة.
            </p>
          </div>

          {activeExplanation && (
            <button
              type="button"
              onClick={() => generateExplanation(mode)}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer self-start sm:self-auto whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>تحديث الشرح</span>
            </button>
          )}
        </div>

        {/* 3 Mode Switcher */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {MODES.map((m) => {
            const Icon = m.icon;
            const isSelected = mode === m.id;
            const isCached = Boolean(cachedExplanations?.[m.id]);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                disabled={isLoading}
                className={`text-right p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-start gap-3 ${
                  isSelected
                    ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                    : 'border-slate-200 bg-slate-50/70 hover:border-emerald-400 text-slate-800'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-emerald-500 text-slate-950' : 'bg-white border border-slate-200 text-emerald-700'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="space-y-0.5 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm">{m.label}</span>
                    {isCached && (
                      <span
                        className={`text-[10px] font-semibold ${
                          isSelected ? 'text-emerald-300' : 'text-emerald-700'
                        }`}
                      >
                        جاهز
                      </span>
                    )}
                  </div>
                  <p className={`text-[11px] leading-relaxed ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                    {m.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-2xl flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => generateExplanation(mode)}
            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="font-bold text-slate-900">جاري إعداد الشرح ({MODES.find((m) => m.id === mode)?.label})...</p>
          <p className="text-xs text-slate-500">يتم استخلاص المفاهيم والأمثلة والروابط من محتوى المحاضرة مباشرة</p>
        </div>
      )}

      {/* Explanation Body */}
      {!isLoading && activeExplanation && (
        <div className="space-y-6">
          {/* Intro */}
          {activeExplanation.intro && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-3xl p-6 text-slate-900 space-y-1.5">
              <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>مدخل الشرح</span>
              </span>
              <p className="text-sm sm:text-base leading-relaxed font-medium">{activeExplanation.intro}</p>
            </div>
          )}

          {/* Sections */}
          <div className="space-y-5">
            {activeExplanation.sections.map((sec, idx) => (
              <div
                key={idx}
                className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-7 shadow-sm space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-slate-900 text-white text-xs font-black flex items-center justify-center tabular-nums">
                      {idx + 1}
                    </span>
                    <h4 className="text-base sm:text-lg font-extrabold text-slate-900">{sec.heading}</h4>
                  </div>
                  {sec.sourceRef && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600" />
                      <span>المصدر: {sec.sourceRef}</span>
                    </span>
                  )}
                </div>

                {/* Grounded Lecture Content */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                  <span className="text-[11px] font-bold text-slate-500 block">ما ورد في المحاضرة:</span>
                  <p className="text-sm text-slate-800 leading-relaxed" dir="auto">
                    {sec.lectureBasis}
                  </p>
                </div>

                {/* Explanation */}
                <div className="space-y-1.5">
                  <span className="text-xs font-bold text-emerald-800 block">الشرح والتوضيح:</span>
                  <p className="text-sm sm:text-base text-slate-800 leading-relaxed whitespace-pre-wrap">
                    {sec.explanation}
                  </p>
                </div>

                {/* Examples */}
                {sec.examples && sec.examples.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <span className="text-xs font-bold text-slate-700 block">أمثلة من المحاضرة:</span>
                    <ul className="space-y-1.5">
                      {sec.examples.map((ex, exIdx) => (
                        <li
                          key={exIdx}
                          dir="auto"
                          className="text-xs sm:text-sm bg-emerald-50/50 border border-emerald-100 text-slate-800 px-3.5 py-2.5 rounded-xl"
                        >
                          {ex}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Clearly separated additional note */}
                {sec.additionalNote && (
                  <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200 text-blue-950 text-xs flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="block mb-0.5">توضيح إضافي مساعد (خارج نص الورقة لتسهيل الفهم):</strong>
                      <span className="leading-relaxed">{sec.additionalNote}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Topic Connections & Key Takeaways */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {activeExplanation.topicConnections.length > 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-3">
                <h5 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-emerald-600" />
                  <span>العلاقة بين موضوعات المحاضرة</span>
                </h5>
                <ul className="space-y-2 text-xs sm:text-sm text-slate-700">
                  {activeExplanation.topicConnections.map((conn, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-emerald-600 font-bold">•</span>
                      <span className="leading-relaxed">{conn}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activeExplanation.keyTakeaways.length > 0 && (
              <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-sm space-y-3">
                <h5 className="font-bold text-sm text-emerald-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  <span>أهم ما يجب استيعابه من هذه المحاضرة</span>
                </h5>
                <ul className="space-y-2 text-xs sm:text-sm text-slate-200">
                  {activeExplanation.keyTakeaways.map((tk, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-emerald-400 font-bold">✓</span>
                      <span className="leading-relaxed">{tk}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
