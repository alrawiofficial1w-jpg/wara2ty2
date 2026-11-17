import React, { useState, useEffect } from 'react';
import {
  ClipboardList,
  Download,
  RefreshCw,
  AlertTriangle,
  CheckSquare,
  Square,
  AlertCircle,
  BookOpen,
  Sparkles,
  MapPin,
} from 'lucide-react';
import { RevisionSheetData, VocabItem } from '../types';
import { exportRevisionSheetToPDF } from '../utils/pdfExport';

interface RevisionSheetTabProps {
  lectureText: string;
  arabicTranslation: string;
  lectureTitle: string;
  summary: any;
  vocabulary: VocabItem[];
  revisionSheet?: RevisionSheetData;
  onSaveRevisionSheet: (sheet: RevisionSheetData) => void;
}

export const RevisionSheetTab: React.FC<RevisionSheetTabProps> = ({
  lectureText,
  arabicTranslation,
  lectureTitle,
  summary,
  vocabulary,
  revisionSheet,
  onSaveRevisionSheet,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});

  const fetchRevisionSheet = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/study-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'revision_sheet',
          lectureText,
          arabicTranslation,
          lectureTitle,
          summary,
          vocabulary,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success || !json.revisionSheet) {
        throw new Error(json.error || 'تعذر إعداد ورقة المراجعة النهائية.');
      }
      onSaveRevisionSheet(json.revisionSheet);
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء إعداد ورقة المراجعة.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!revisionSheet && !isLoading && (lectureText || arabicTranslation)) {
      fetchRevisionSheet();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCheck = (idx: number) => {
    setCheckedItems((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-slate-900 text-white rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-lg">ورقة المراجعة النهائية</h3>
            <p className="text-xs text-slate-300">
              ملخص مكثف ومرتب للمذاكرة السريعة ليلة الامتحان — منفصل عن الملخص التفصيلي للدرس.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {revisionSheet && (
            <button
              type="button"
              onClick={() => exportRevisionSheetToPDF(revisionSheet, lectureTitle)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition cursor-pointer whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              <span>تصدير ورقة المراجعة PDF</span>
            </button>
          )}
          <button
            type="button"
            onClick={fetchRevisionSheet}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>تحديث الورقة</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading && (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-3">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
          <p className="font-bold text-slate-900">جاري تكثيف المحاضرة في ورقة مراجعة نهائية...</p>
        </div>
      )}

      {!isLoading && revisionSheet && (
        <div className="space-y-6">
          {/* Main Ideas + Important Rules */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-3">
              <h4 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>الأفكار الرئيسية</span>
              </h4>
              <ul className="space-y-2 text-sm text-slate-700">
                {revisionSheet.mainIdeas.map((idea, i) => (
                  <li key={i} className="flex items-start gap-2.5 bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="w-5 h-5 rounded-md bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed">{idea}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-3">
              <h4 className="font-extrabold text-base text-slate-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-600" />
                <span>القواعد المهمة</span>
              </h4>
              <ul className="space-y-2 text-sm text-slate-700">
                {revisionSheet.importantRules.map((rule, i) => (
                  <li key={i} className="flex items-start gap-2 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                    <span className="text-emerald-700 font-black">•</span>
                    <span className="leading-relaxed" dir="auto">{rule}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Definitions */}
          {revisionSheet.definitions?.length > 0 && (
            <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
              <h4 className="font-extrabold text-base text-slate-900">التعريفات والمصطلحات الأساسية</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {revisionSheet.definitions.map((def, i) => (
                  <div key={i} className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900" dir="auto">{def.term}</span>
                      {def.sourceRef && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-semibold">
                          <MapPin className="w-3 h-3" />
                          {def.sourceRef}
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">{def.definition}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key Examples & Quick Comparisons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {revisionSheet.keyExamples?.length > 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-3">
                <h4 className="font-extrabold text-base text-slate-900">أمثلة مفتاحية للحفظ</h4>
                <ul className="space-y-2 text-xs sm:text-sm text-slate-700">
                  {revisionSheet.keyExamples.map((ex, i) => (
                    <li key={i} dir="auto" className="p-3 rounded-xl bg-slate-50 border border-slate-200/80">
                      {ex}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {revisionSheet.comparisons?.length > 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-3">
                <h4 className="font-extrabold text-base text-slate-900">مقارنات سريعة</h4>
                <div className="space-y-2.5">
                  {revisionSheet.comparisons.map((cmp, i) => (
                    <div key={i} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1">
                      <div className="font-bold text-slate-900">
                        {cmp.itemA} <span className="text-emerald-600 mx-1">↔</span> {cmp.itemB}
                      </div>
                      <p className="text-slate-600 leading-relaxed">{cmp.difference}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Watch-out Points & Interactive Checklist */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {revisionSheet.watchOutPoints?.length > 0 && (
              <div className="bg-amber-50/70 rounded-3xl border border-amber-200 p-6 space-y-3">
                <h4 className="font-extrabold text-base text-amber-950 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>نقاط تستحق انتباهاً إضافياً</span>
                </h4>
                <ul className="space-y-2 text-xs sm:text-sm text-amber-900">
                  {revisionSheet.watchOutPoints.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="font-bold">!</span>
                      <span className="leading-relaxed">{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {revisionSheet.checklist?.length > 0 && (
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-3">
                <h4 className="font-extrabold text-base text-slate-900">قائمة المراجعة النهائية (تحقق قبل الاختبار)</h4>
                <div className="space-y-2">
                  {revisionSheet.checklist.map((item, idx) => {
                    const done = Boolean(checkedItems[idx]);
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleCheck(idx)}
                        className={`w-full text-right p-3 rounded-xl border flex items-center gap-2.5 text-xs sm:text-sm transition cursor-pointer ${
                          done
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-900 line-through'
                            : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-white'
                        }`}
                      >
                        {done ? (
                          <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span>{item}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
