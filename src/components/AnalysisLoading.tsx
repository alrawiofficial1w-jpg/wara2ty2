import React, { useEffect, useState } from 'react';
import { Sparkles, Scan, FileSearch, CheckCircle, Languages, HelpCircle, Zap } from 'lucide-react';

interface AnalysisLoadingProps {
  retryNotice?: string | null;
  pageCount?: number;
}

export const AnalysisLoading: React.FC<AnalysisLoadingProps> = ({
  retryNotice = null,
  pageCount = 1,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(0);

  const steps = [
    {
      title: pageCount > 1 ? `قراءة ${pageCount} صفحات بالرؤية الحاسوبية` : 'فحص الصورة بالرؤية الحاسوبية',
      desc: 'استخراج النصوص، فحص الجداول والرسوم التوضيحية، وتمييز الكلمات غير الواضحة...',
      icon: Scan,
    },
    {
      title: 'الكشف عن اللغة والترجمة والمحاذاة الثنائية',
      desc: 'التعرف على المفردات التركية والأجنبية وتوليد الترجمة العربية الأكاديمية...',
      icon: Languages,
    },
    {
      title: 'إثراء المعجم التركي–العربي والمصطلحات',
      desc: 'بناء معجم دراسي مع ربط المداخل الموثقة والسياق في المحاضرة...',
      icon: FileSearch,
    },
    {
      title: 'توليد الملخص الموحّد وبنك الأسئلة التدريبية',
      desc: 'صياغة ملخص مركز للدرس و5 أسئلة اختيار من متعدد مرتبطة بمصادرها...',
      icon: HelpCircle,
    },
  ];

  useEffect(() => {
    const timer1 = setTimeout(() => setCurrentStep(1), 1800);
    const timer2 = setTimeout(() => setCurrentStep(2), 3800);
    const timer3 = setTimeout(() => setCurrentStep(3), 6200);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-10">
      <div className="relative w-28 h-28 mx-auto flex items-center justify-center">
        <div className="relative z-10 w-24 h-24 rounded-3xl bg-slate-900 border border-slate-800 text-white flex items-center justify-center shadow-2xl">
          <Scan className="w-10 h-10 text-emerald-400 animate-bounce" />
          <Sparkles className="w-5 h-5 text-emerald-300 absolute -top-2 -right-2 fill-emerald-300" />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-2xl sm:text-3xl font-black text-slate-900">
          {pageCount > 1
            ? `جاري تحليل المحاضرة كاملة (${pageCount} صفحات)...`
            : 'جاري تحليل محاضرتك بواسطة الذكاء الاصطناعي...'}
        </h3>
        <p className="text-slate-500 text-sm max-w-md mx-auto">
          يقوم محرك Wara2ty بربط الصفحات معاً واستخراج النصوص والجداول والمخططات بدقة عالية.
        </p>
      </div>

      {retryNotice && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2.5">
          <Zap className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{retryNotice}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm text-right space-y-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const isDone = index < currentStep;
          const isCurrent = index === currentStep;

          return (
            <div
              key={index}
              className={`flex items-start gap-3.5 p-3 rounded-2xl transition-all duration-300 ${
                isCurrent
                  ? 'bg-emerald-50/70 border border-emerald-200'
                  : isDone
                  ? 'bg-slate-50 opacity-80'
                  : 'opacity-40'
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  isDone
                    ? 'bg-emerald-600 text-white'
                    : isCurrent
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'bg-slate-200 text-slate-500'
                }`}
              >
                {isDone ? <CheckCircle className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
              </div>
              <div className="space-y-0.5 flex-1">
                <h4 className="text-sm font-bold text-slate-900">{step.title}</h4>
                <p className="text-xs text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-4 rounded-2xl bg-slate-100 border border-slate-200/80 text-xs text-slate-600">
        <strong className="text-slate-900">نصيحة ورقتي:</strong> يتم تمييز الكلمات غير الواضحة بوضوح لتتمكن من مراجعتها وتصحيحها قبل توليد المراجعة النهائية.
      </div>
    </div>
  );
};
