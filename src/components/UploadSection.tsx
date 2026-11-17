import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  UploadCloud,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  FileText,
  AlertCircle,
  CheckCircle2,
  Zap,
  ArrowUp,
  ArrowDown,
  Plus,
  Layers,
} from 'lucide-react';
import { SAMPLE_NOTES, getSampleNotePages } from '../utils/sampleNotes';
import {
  optimizeImageForAnalysis,
  readPdfAsDataUrl,
  formatBytesArabic,
} from '../utils/imageOptimizer';
import { UploadedPageInput } from '../types';

interface UploadSectionProps {
  onAnalyze: (pages: UploadedPageInput[]) => void;
  isLoading: boolean;
  initialPages?: UploadedPageInput[];
}

export const UploadSection: React.FC<UploadSectionProps> = ({
  onAnalyze,
  isLoading,
  initialPages = [],
}) => {
  const [pages, setPages] = useState<UploadedPageInput[]>(initialPages);
  const [activePreviewIdx, setActivePreviewIdx] = useState<number>(0);
  const [compressionNotice, setCompressionNotice] = useState<string | null>(null);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialPages && initialPages.length > 0) {
      setPages(initialPages);
      setActivePreviewIdx(0);
    }
  }, [initialPages]);

  const handleProcessFiles = useCallback(
    async (fileList: FileList | File[], appendMode: boolean) => {
      setErrorMessage(null);
      setCompressionNotice(null);

      const files = Array.from(fileList);
      if (files.length === 0) return;

      const validImageMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      const hasPdf = files.some((f) => f.type.toLowerCase() === 'application/pdf');

      if (hasPdf && (files.length > 1 || (appendMode && pages.length > 0))) {
        setErrorMessage('يمكن رفع ملف PDF واحد كامل للمحاضرة (لا يمكن دمجه مع صور منفصلة في نفس الجلسة).');
        return;
      }

      const maxPages = 10;
      const existingCount = appendMode ? pages.length : 0;
      if (existingCount + files.length > maxPages) {
        setErrorMessage(`الحد الأقصى هو ${maxPages} صفحات في المحاضرة الواحدة لضمان سرعة وجودة التحليل.`);
        return;
      }

      setIsOptimizing(true);
      const added: UploadedPageInput[] = [];
      let totalOrig = 0;
      let totalOpt = 0;

      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const mime = file.type.toLowerCase();

          if (mime === 'application/pdf') {
            if (file.size > 14 * 1024 * 1024) {
              throw new Error(
                'حجم ملف الـ PDF يتجاوز الحد المسموح (14 ميغابايت). يرجى ضغط الملف أو رفع صور الصفحات.'
              );
            }
            const pdfRes = await readPdfAsDataUrl(file);
            added.push({
              id: `pdf_${Date.now()}`,
              pageNumber: 1,
              name: file.name,
              dataUrl: pdfRes.dataUrl,
              mimeType: 'application/pdf',
              sizeLabel: `مستند PDF · ${formatBytesArabic(pdfRes.sizeBytes)}`,
            });
          } else if (validImageMimes.includes(mime)) {
            if (file.size > 35 * 1024 * 1024) {
              throw new Error(`حجم الصورة "${file.name}" يتجاوز 35 ميغابايت.`);
            }
            const result = await optimizeImageForAnalysis(file);
            totalOrig += result.originalSizeBytes;
            totalOpt += result.optimizedSizeBytes;

            added.push({
              id: `img_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
              pageNumber: existingCount + added.length + 1,
              name: file.name,
              dataUrl: result.dataUrl,
              mimeType: result.mimeType,
              sizeLabel: `${formatBytesArabic(result.optimizedSizeBytes)} (${result.width}×${result.height})`,
            });
          } else {
            throw new Error(
              `صيغة الملف "${file.name}" غير مدعومة. يرجى استخدام JPG أو PNG أو WEBP أو PDF.`
            );
          }
        }

        const nextPages = (appendMode ? [...pages, ...added] : added).map((p, idx) => ({
          ...p,
          pageNumber: idx + 1,
        }));
        setPages(nextPages);
        setActivePreviewIdx(appendMode ? pages.length : 0);

        if (totalOrig > totalOpt && totalOrig > 0) {
          const savedPercent = Math.round(((totalOrig - totalOpt) / totalOrig) * 100);
          if (savedPercent >= 15) {
            setCompressionNotice(
              `تم تحسين وضغط الصور تلقائياً من ${formatBytesArabic(totalOrig)} إلى ${formatBytesArabic(
                totalOpt
              )} (توفير ${savedPercent}%) لتسريع التحليل.`
            );
          }
        }
      } catch (err: any) {
        setErrorMessage(err?.message || 'تعذر قراءة الملفات المرفوعة.');
      } finally {
        setIsOptimizing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [pages]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleProcessFiles(e.dataTransfer.files, pages.length > 0 && pages[0].mimeType !== 'application/pdf');
      }
    },
    [handleProcessFiles, pages]
  );

  const handleMovePage = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= pages.length) return;
    const copy = [...pages];
    const [moved] = copy.splice(idx, 1);
    copy.splice(target, 0, moved);
    const renumbered = copy.map((p, i) => ({ ...p, pageNumber: i + 1 }));
    setPages(renumbered);
    setActivePreviewIdx(target);
  };

  const handleRemovePage = (idx: number) => {
    const next = pages
      .filter((_, i) => i !== idx)
      .map((p, i) => ({ ...p, pageNumber: i + 1 }));
    setPages(next);
    setActivePreviewIdx((prev) => Math.max(0, Math.min(prev, next.length - 1)));
  };

  const handleClearAll = () => {
    setPages([]);
    setActivePreviewIdx(0);
    setCompressionNotice(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSelectSample = (sampleId: string) => {
    setErrorMessage(null);
    setCompressionNotice(null);
    const samplePages = getSampleNotePages(sampleId);
    if (samplePages.length > 0) {
      setPages(samplePages);
      setActivePreviewIdx(0);
    }
  };

  const handleSubmitAnalysis = () => {
    if (pages.length === 0) {
      setErrorMessage('يرجى رفع صورة أو ملف محاضرة أولاً للبدء بالتحليل.');
      return;
    }
    onAnalyze(pages);
  };

  const activePageItem = pages[activePreviewIdx];
  const isPdfUpload = pages.length === 1 && pages[0].mimeType === 'application/pdf';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-8">
      {/* Page Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 text-emerald-700 text-xs font-bold">
          <UploadCloud className="w-4 h-4" />
          <span>الخطوة 1 · رفع ورقة أو ملف المحاضرة</span>
        </div>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
          ارفع صور محاضرتك أو مستند PDF أو اختر نموذجاً
        </h2>
        <p className="text-slate-600 text-sm sm:text-base max-w-2xl mx-auto">
          يدعم Wara2ty صفحة واحدة أو محاضرة كاملة متعددة الصفحات (حتى 10 صور بصيغ JPG, PNG, WEBP) أو ملف PDF (حتى 14 ميغابايت) مع حفظ ترتيب الصفحات.
        </p>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-2xl flex items-center gap-3 text-sm">
          <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
          <p>{errorMessage}</p>
        </div>
      )}

      {/* Smart Compression Notice */}
      {compressionNotice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 p-3.5 rounded-2xl flex items-center gap-3 text-xs sm:text-sm">
          <Zap className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <p>{compressionNotice}</p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleProcessFiles(
              e.target.files,
              pages.length > 0 && pages[0].mimeType !== 'application/pdf'
            );
          }
        }}
      />

      {/* Main Upload / Preview Area */}
      {pages.length === 0 ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onClick={() => !isOptimizing && fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-3xl p-8 sm:p-14 text-center cursor-pointer transition-all duration-200 ${
            isDragging
              ? 'border-emerald-500 bg-emerald-50/80 scale-[1.01]'
              : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50/60 shadow-sm'
          }`}
        >
          <div className="space-y-4 max-w-md mx-auto">
            <div className="w-20 h-20 mx-auto rounded-3xl bg-slate-100 text-slate-700 flex items-center justify-center shadow-inner">
              <UploadCloud className={`w-10 h-10 text-emerald-600 ${isOptimizing ? 'animate-bounce' : ''}`} />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                {isOptimizing ? 'جاري تجهيز وضغط الصفحات...' : 'اسحب وأفلت صور المحاضرة أو ملف PDF هنا'}
              </h3>
              <p className="text-sm text-slate-500">
                يمكنك تحديد صورة واحدة أو عدة صفحات دفعة واحدة بالترتيب
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-xs text-slate-500 font-medium">
              <span>JPG</span>
              <span>·</span>
              <span>PNG</span>
              <span>·</span>
              <span>WEBP</span>
              <span>·</span>
              <span>PDF (حتى 14MB)</span>
              <span>·</span>
              <span>حتى 10 صفحات</span>
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled={isOptimizing}
                className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold shadow-md hover:bg-slate-800 transition whitespace-nowrap"
              >
                {isOptimizing ? 'يرجى الانتظار...' : 'تحديد صور أو ملف من الجهاز'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Preview Box (Single / Multi-page / PDF) */
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                {pages.length > 1 ? <Layers className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-base">
                  {isPdfUpload
                    ? pages[0].name
                    : pages.length > 1
                    ? `محاضرة متعددة الصفحات (${pages.length} صفحات)`
                    : pages[0].name || 'صورة الملاحظات المختارة'}
                </h4>
                <p className="text-xs text-slate-500 tabular-nums">
                  {activePageItem?.sizeLabel || 'جاهزة للتحليل'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isPdfUpload && pages.length < 10 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading || isOptimizing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 text-xs font-bold transition whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة صفحات أخرى</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isLoading || isOptimizing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold transition whitespace-nowrap cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>مسح الكل</span>
              </button>
            </div>
          </div>

          {/* Multi-page Reorder Strip */}
          {pages.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-bold text-slate-700">ترتيب صفحات المحاضرة (سيتم تحليلها متصلة بنفس التسلسل):</span>
                <span className="tabular-nums">{pages.length} / 10 صفحات</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {pages.map((p, idx) => (
                  <div
                    key={p.id}
                    onClick={() => setActivePreviewIdx(idx)}
                    className={`p-2.5 rounded-2xl border-2 transition cursor-pointer space-y-2 ${
                      idx === activePreviewIdx
                        ? 'border-emerald-500 bg-emerald-50/40'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="relative h-24 rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center">
                      <img src={p.dataUrl} alt={p.name} className="h-full w-full object-cover" />
                      <span className="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-lg bg-slate-900/90 text-white text-[10px] font-black tabular-nums">
                        صفحة {idx + 1}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMovePage(idx, -1);
                          }}
                          className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-30 cursor-pointer"
                          title="تقديم الصفحة"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === pages.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMovePage(idx, 1);
                          }}
                          className="p-1 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-30 cursor-pointer"
                          title="تأخير الصفحة"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemovePage(idx);
                        }}
                        className="p-1 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer"
                        title="حذف الصفحة"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Page / PDF Display */}
          {activePageItem && (
            <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-900/5 max-h-[500px] flex items-center justify-center p-2">
              {activePageItem.mimeType === 'application/pdf' ? (
                <div className="w-full py-12 text-center space-y-2">
                  <FileText className="w-12 h-12 text-emerald-600 mx-auto" />
                  <p className="font-bold text-slate-900">{activePageItem.name}</p>
                  <p className="text-xs text-slate-500">{activePageItem.sizeLabel} — جاهز للاستخراج والتحليل متعدد الصفحات</p>
                </div>
              ) : (
                <img
                  src={activePageItem.dataUrl}
                  alt={`معاينة صفحة ${activePreviewIdx + 1}`}
                  className="max-h-[460px] w-auto object-contain rounded-xl shadow-inner"
                />
              )}
            </div>
          )}

          {/* Action Bar */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                {pages.length > 1
                  ? `سيتم تحليل جميع الصفحات (${pages.length}) كمحاضرة واحدة متكاملة مع حفظ أرقام الصفحات`
                  : 'سيتم استخراج النص والترجمة والمعجم والملخص والاختبار والجداول والمخططات'}
              </span>
            </div>

            <button
              type="button"
              onClick={handleSubmitAnalysis}
              disabled={isLoading || isOptimizing}
              className={`w-full sm:w-auto px-8 py-3.5 rounded-2xl font-black text-base flex items-center justify-center gap-3 transition-all cursor-pointer shadow-lg whitespace-nowrap ${
                isLoading || isOptimizing
                  ? 'bg-slate-400 text-white cursor-not-allowed'
                  : 'bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-slate-950 shadow-emerald-500/25 hover:shadow-xl'
              }`}
            >
              <Sparkles className="w-5 h-5" />
              <span>
                {pages.length > 1 ? `حلّل المحاضرة (${pages.length} صفحات)` : 'حلّل المحاضرة بالذكاء الاصطناعي'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* SAMPLE QUICK SELECTION GRID */}
      <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-7 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-emerald-600" />
          <h4 className="text-base font-bold text-slate-900">
            أو جرّب أحد النماذج التعليمية الجاهزة (تشمل محاضرة تركية متعددة الصفحات مع جدول ومخطط):
          </h4>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SAMPLE_NOTES.map((sample) => (
            <button
              key={sample.id}
              type="button"
              onClick={() => handleSelectSample(sample.id)}
              disabled={isLoading || isOptimizing}
              className="text-right p-4 rounded-2xl bg-white border border-slate-200 hover:border-emerald-500 hover:bg-emerald-50/40 transition-all text-xs space-y-1.5 group cursor-pointer"
            >
              <span className="font-bold text-slate-900 block group-hover:text-emerald-700 transition">
                {sample.title}
              </span>
              <span className="text-[11px] text-slate-500 block">
                {sample.subject} · {sample.badge}
              </span>
              <span className="text-[11px] text-slate-500 line-clamp-2 block">
                {sample.description}
              </span>
              <span className="inline-block text-[11px] text-emerald-700 font-bold pt-1">
                اختر هذا النموذج ←
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
