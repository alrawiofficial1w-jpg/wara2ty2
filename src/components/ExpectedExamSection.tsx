import React, { useState } from 'react';
import {
  FileQuestion,
  RefreshCw,
  CheckCircle2,
  Eye,
  AlertCircle,
  MapPin,
  Info,
} from 'lucide-react';
import { ExpectedExamQuestion } from '../types';

interface ExpectedExamSectionProps {
  lectureText: string;
  arabicTranslation: string;
  lectureTitle: string;
  expectedQuestions?: ExpectedExamQuestion[];
  onSaveExpectedQuestions: (questions: ExpectedExamQuestion[]) => void;
}

const TYPE_LABELS: Record<string, string> = {
  mcq: 'اختيار من متعدد',
  true_false: 'صح أم خطأ',
  short_answer: 'إجابة قصيرة',
  definition: 'سؤال تعريف',
  explanation: 'سؤال شرح وتوضيح',
  comparison: 'سؤال مقارنة',
};

export const ExpectedExamSection: React.FC<ExpectedExamSectionProps> = ({
  lectureText,
  arabicTranslation,
  lectureTitle,
  expectedQuestions,
  onSaveExpectedQuestions,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [studentAttempts, setStudentAttempts] = useState<Record<number, string>>({});
  const [revealedIds, setRevealedIds] = useState<Record<number, boolean>>({});

  const generateQuestions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/study-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'expected_questions',
          lectureText,
          arabicTranslation,
          lectureTitle,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'تعذر توليد الأسئلة المتوقعة.');
      }
      onSaveExpectedQuestions(json.expectedExamQuestions || []);
      setStudentAttempts({});
      setRevealedIds({});
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء توليد الأسئلة المتوقعة.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleReveal = (id: number) => {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileQuestion className="w-5 h-5 text-emerald-600" />
            <h3 className="font-black text-lg text-slate-900">أسئلة تدريبية متوقعة (شاملة ومتنوعة)</h3>
          </div>
          <p className="text-xs text-slate-500">
            أسئلة مقالية وموضوعية مقترحة بالذكاء الاصطناعي للتدريب (اختيار من متعدد، صح/خطأ، تعريف، شرح، مقارنة) — وليست أسئلة امتحان رسمية.
          </p>
        </div>

        <button
          type="button"
          onClick={generateQuestions}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{expectedQuestions?.length ? 'توليد أسئلة متوقعة جديدة' : 'توليد أسئلة متوقعة الآن'}</span>
        </button>
      </div>

      {/* Honest AI Practice Disclaimer */}
      <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200 text-blue-950 text-xs flex items-center gap-2">
        <Info className="w-4 h-4 text-blue-600 shrink-0" />
        <span>
          <strong>تنويه أكاديمي:</strong> هذه الأسئلة مُولّدة بالذكاء الاصطناعي للتدريب واختبار فهمك لمحاضرتك فقط، ولا تُعد تسريباً أو أسئلة امتحان رسمية.
        </span>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!expectedQuestions || expectedQuestions.length === 0 ? (
        <div className="text-center py-8 space-y-3">
          <p className="text-sm text-slate-600">
            اضغط على الزر بالأعلى لتوليد أسئلة تدريبية متنوعة (تعريف، شرح، مقارنة، صح أم خطأ، واختيار من متعدد) مع إجابات نموذجية.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {expectedQuestions.map((q, idx) => {
            const qId = q.id || idx + 1;
            const isRevealed = Boolean(revealedIds[qId]);
            const attemptVal = studentAttempts[qId] || '';

            return (
              <div
                key={qId}
                className="p-5 sm:p-6 rounded-2xl bg-slate-50 border border-slate-200 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-slate-900 text-white text-xs font-black flex items-center justify-center tabular-nums">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-lg">
                      {TYPE_LABELS[q.type] || 'سؤال تدريبي'}
                    </span>
                  </div>

                  {q.sourceRef && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                      <MapPin className="w-3 h-3 text-emerald-600" />
                      <span>{q.sourceRef}</span>
                    </span>
                  )}
                </div>

                <h4 className="text-base font-bold text-slate-900 leading-relaxed">{q.question}</h4>

                {/* Interactive Student Attempt */}
                {q.type === 'mcq' && q.options && q.options.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {q.options.map((opt, oIdx) => {
                      const selected = attemptVal === String(oIdx);
                      const isCorrect = isRevealed && q.correctIndex === oIdx;
                      return (
                        <button
                          key={oIdx}
                          type="button"
                          onClick={() =>
                            setStudentAttempts((prev) => ({ ...prev, [qId]: String(oIdx) }))
                          }
                          className={`text-right p-3 rounded-xl border text-xs sm:text-sm transition cursor-pointer ${
                            isCorrect
                              ? 'bg-emerald-50 border-emerald-500 text-emerald-950 font-bold'
                              : selected
                              ? 'bg-slate-900 border-slate-900 text-white font-bold'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                ) : q.type === 'true_false' ? (
                  <div className="flex items-center gap-3">
                    {['صح', 'خطأ'].map((label) => {
                      const selected = attemptVal === label;
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() =>
                            setStudentAttempts((prev) => ({ ...prev, [qId]: label }))
                          }
                          className={`px-5 py-2 rounded-xl border text-xs sm:text-sm font-bold transition cursor-pointer ${
                            selected
                              ? 'bg-slate-900 border-slate-900 text-white'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <textarea
                    rows={2}
                    value={attemptVal}
                    onChange={(e) =>
                      setStudentAttempts((prev) => ({ ...prev, [qId]: e.target.value }))
                    }
                    placeholder="اكتب محاولتك للإجابة هنا قبل كشف الإجابة النموذجية..."
                    className="w-full p-3 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                )}

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => toggleReveal(qId)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>{isRevealed ? 'إخفاء الإجابة النموذجية' : 'عرض الإجابة النموذجية والتفسير'}</span>
                  </button>
                </div>

                {isRevealed && (
                  <div className="p-4 rounded-2xl bg-emerald-50/80 border border-emerald-200 space-y-2 text-xs sm:text-sm">
                    <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>الإجابة النموذجية:</span>
                    </div>
                    <p className="text-slate-900 font-semibold leading-relaxed" dir="auto">
                      {q.modelAnswer}
                    </p>
                    <p className="text-slate-700 leading-relaxed pt-1 border-t border-emerald-200/60">
                      <strong>التفسير: </strong>
                      {q.explanation}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
