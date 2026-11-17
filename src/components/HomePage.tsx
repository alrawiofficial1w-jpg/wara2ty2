import React from 'react';
import {
  FileText,
  Languages,
  HelpCircle,
  Upload,
  Cpu,
  GraduationCap,
  Sparkles,
  ArrowLeft,
  CheckCircle,
  Eye,
  Award,
  BookOpen,
  FolderOpen,
} from 'lucide-react';
import { SAMPLE_NOTES } from '../utils/sampleNotes';

interface HomePageProps {
  onStartNow: () => void;
  onSelectSample: (sampleId: string) => void;
  hasSavedSession?: boolean;
  savedTitle?: string;
  onResumeSavedSession?: () => void;
  savedLecturesCount?: number;
  onOpenLibrary?: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  onStartNow,
  onSelectSample,
  hasSavedSession = false,
  savedTitle,
  onResumeSavedSession,
  savedLecturesCount = 0,
  onOpenLibrary,
}) => {
  return (
    <div className="space-y-24 py-8">
      {/* HERO SECTION */}
      <section className="relative overflow-hidden pt-6 pb-12 lg:pt-12">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-emerald-500/10 via-teal-500/10 to-blue-600/10 blur-3xl -z-10 rounded-full pointer-events-none" />

        <div className="max-w-5xl mx-auto text-center px-4 sm:px-6 space-y-8">
          <div className="inline-flex items-center gap-2 text-emerald-700 text-xs sm:text-sm font-bold">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            <span>محاضراتك في مكان واحد، ومذاكرتك بطريقة أذكى</span>
          </div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-slate-900 tracking-tight leading-[1.2] sm:leading-[1.15]">
            حوّل محاضراتك إلى <br className="hidden sm:inline" />
            <span className="bg-gradient-to-l from-emerald-600 via-teal-600 to-slate-900 bg-clip-text text-transparent">
              ملاحظات جاهزة للمذاكرة
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-base sm:text-xl text-slate-600 leading-relaxed font-normal">
            تطبيق <strong className="text-slate-900 font-bold">ورقتي (Wara2ty)</strong> يحوّل صور المحاضرات والمستندات متعددة الصفحات إلى نصوص دقيقة، ترجمة عربية، معجم تركي–عربي، شرح تفصيلي، أوراق مراجعة، وخرائط ذهنية واختبارات تفاعلية.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <button
              onClick={onStartNow}
              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-lg flex items-center justify-center gap-3 shadow-xl shadow-slate-900/20 hover:shadow-2xl hover:scale-[1.01] active:scale-95 transition-all cursor-pointer group whitespace-nowrap"
            >
              <div className="w-7 h-7 rounded-lg bg-emerald-500 text-slate-950 flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <span>ابدأ الآن</span>
              <ArrowLeft className="w-5 h-5 text-emerald-400 group-hover:-translate-x-1 transition-transform" />
            </button>

            {hasSavedSession && onResumeSavedSession ? (
              <button
                onClick={onResumeSavedSession}
                className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-emerald-50 hover:bg-emerald-100 text-emerald-900 font-bold text-base border border-emerald-200 transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <BookOpen className="w-4 h-4 text-emerald-700" />
                <span>استكمال المحاضرة: {savedTitle ? savedTitle.slice(0, 24) : 'آخر نتيجة'}</span>
              </button>
            ) : (
              <a
                href="#how-it-works"
                className="w-full sm:w-auto px-6 py-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-700 font-semibold text-base border border-slate-200 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Eye className="w-4 h-4 text-slate-500" />
                <span>كيف يعمل ورقتي؟</span>
              </a>
            )}

            {savedLecturesCount > 0 && onOpenLibrary && (
              <button
                type="button"
                onClick={onOpenLibrary}
                className="w-full sm:w-auto px-5 py-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-800 font-bold text-sm border border-slate-200 transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap tabular-nums"
              >
                <FolderOpen className="w-4 h-4 text-emerald-600" />
                <span>مكتبة محاضراتي ({savedLecturesCount})</span>
              </button>
            )}
          </div>

          <div className="pt-6 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs sm:text-sm text-slate-500 font-medium">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>يدعم خط اليد، تعدد الصفحات، والـ PDF</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>معجم تركي–عربي وترجمة ثنائية متجاورة</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>شرح تفصيلي، خرائط ذهنية، واختبارات متقدمة</span>
            </div>
          </div>
        </div>
      </section>

      {/* QUICK TRY SAMPLES SECTION */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="bg-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
          <div className="relative z-10 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-emerald-400">
                  تجربة سريعة وفورية
                </span>
                <h3 className="text-xl sm:text-2xl font-bold mt-1">ليس لديك صورة ورقة الآن؟ جرب نموذجاً جاهزاً!</h3>
                <p className="text-slate-300 text-sm mt-1">
                  اختر إحدى نماذج الملاحظات الجامعية التركية (تشمل نموذجاً متعدد الصفحات للأزمنة التركية مع جدول ومخطط):
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
              {SAMPLE_NOTES.map((sample) => (
                <div
                  key={sample.id}
                  onClick={() => onSelectSample(sample.id)}
                  className="bg-slate-800/90 hover:bg-slate-800 border border-slate-700 hover:border-emerald-500/60 rounded-2xl p-5 text-right transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="text-xs text-emerald-400 font-medium">
                      {sample.subject} · {sample.badge}
                    </div>
                    <h4 className="font-bold text-sm text-white group-hover:text-emerald-300 transition-colors">
                      {sample.title}
                    </h4>
                    <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                      {sample.description}
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-700/60 flex items-center justify-between text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">
                    <span>تحليل هذا النموذج</span>
                    <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* THREE MAIN FEATURES */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center space-y-3 mb-12">
          <span className="text-emerald-700 font-bold text-sm">
            مزايا حصرية للطلاب
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
            منظومة متكاملة لفهم محاضراتك
          </h2>
          <p className="text-slate-600 max-w-xl mx-auto text-sm sm:text-base">
            صُمم ورقتي ليتجاوز برامج الـ OCR التقليدية، عبر الجمع بين الفهم اللغوي والتحليل الأكاديمي العميق.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white rounded-3xl p-8 border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
                <FileText className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">
                قراءة النصوص والجداول والمخططات
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                قراءة دقيقة لخط اليد والمستندات متعددة الصفحات والـ PDF، مع استخراج الجداول والرسوم التوضيحية وتمييز الكلمات غير الواضحة للمراجعة.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-blue-700">
              <CheckCircle className="w-4 h-4 text-blue-600" />
              <span>تعديل النص الفوري وشرح أي جزء محدد</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-8 border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                <Languages className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">
                الترجمة الثنائية والمعجم التركي–العربي
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                عرض متجاور للنص الأصلي والترجمة العربية، مع معجم أكاديمي يوضح اللواحق ونوع الكلمة وسياقها وقراءة صوتية مخصصة للتركية والعربية.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-emerald-700">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>دعم تركي LTR وعربي RTL متقن</span>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-8 border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
                <HelpCircle className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">
                الشرح التفصيلي وأوراق المراجعة والاختبارات
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                اسأل محاضرتك، استعرض الشرح المبسط أو الأكاديمي، جداول المقارنة، الخريطة الذهنية، ورقة المراجعة النهائية، و6 أنماط اختبار تفاعلية.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-purple-700">
              <CheckCircle className="w-4 h-4 text-purple-600" />
              <span>تصدير PDF عربي واضح ومصادر مرتبطة بالدرس</span>
            </div>
          </div>
        </div>
      </section>

      {/* THREE-STEP EXPLANATION */}
      <section id="how-it-works" className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="bg-slate-100/70 rounded-3xl p-8 sm:p-12 border border-slate-200">
          <div className="text-center space-y-3 mb-12">
            <span className="text-xs font-bold text-slate-500">طريقة العمل البسيطة</span>
            <h2 className="text-3xl font-extrabold text-slate-900">
              ثلاث خطوات تفصلك عن مادتك الدراسية المنظمة
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 relative text-right space-y-3">
              <div className="w-10 h-10 rounded-xl bg-slate-900 text-white font-black flex items-center justify-center text-lg tabular-nums">
                1
              </div>
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                <Upload className="w-4 h-4" />
                <span>الخطوة الأولى: ارفع المحاضرة</span>
              </div>
              <h4 className="text-lg font-bold text-slate-900">صورة واحدة، عدة صفحات، أو PDF</h4>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                ارفع صور دفترك أو ملف الـ PDF ورتب الصفحات بسهولة قبل بدء التحليل.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 relative text-right space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white font-black flex items-center justify-center text-lg tabular-nums">
                2
              </div>
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm">
                <Cpu className="w-4 h-4" />
                <span>الخطوة الثانية: التحليل الذكي</span>
              </div>
              <h4 className="text-lg font-bold text-slate-900">معالجة شاملة مع مراجعة الدقة</h4>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                استخراج النصوص والجداول والمخططات، الترجمة، وإثراء المعجم مع مرجعية الصفحات.
              </p>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-slate-200/80 relative text-right space-y-3">
              <div className="w-10 h-10 rounded-xl bg-teal-600 text-white font-black flex items-center justify-center text-lg tabular-nums">
                3
              </div>
              <div className="flex items-center gap-2 text-teal-700 font-bold text-sm">
                <GraduationCap className="w-4 h-4" />
                <span>الخطوة الثالثة: افهم وراجع واختبر</span>
              </div>
              <h4 className="text-lg font-bold text-slate-900">شرح، محادثة، مراجعة، وتصدير PDF</h4>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                اسأل محاضرتك، استمع للدرس الصوتي، راجع ورقة الامتحان النهائية، وحل الاختبارات التفاعلية.
              </p>
            </div>
          </div>

          <div className="mt-10 text-center">
            <button
              onClick={onStartNow}
              className="px-8 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base shadow-lg shadow-emerald-600/20 transition cursor-pointer whitespace-nowrap"
            >
              ابدأ الخطوة الأولى الآن
            </button>
          </div>
        </div>
      </section>

      {/* TARGET USERS FOCUS */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="bg-slate-900 text-white rounded-3xl p-8 sm:p-12 relative overflow-hidden">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 text-emerald-400 text-xs font-bold">
              <Award className="w-4 h-4" />
              <span>مخصص لطلاب الجامعات التركية والعربية</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-black">
              هل تدرس باللغة التركية أو لغة أجنبية؟ ورقتي صُنع لأجلك.
            </h3>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
              ورقتي يجمع بين استخراج خط اليد، والترجمة الأكاديمية المتجاورة، والشرح التفصيلي بالعربية، والمعجم التركي–العربي، وأوراق المراجعة النهائية حتى تذاكر محاضرتك بثقة واستيعاب كامل.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
