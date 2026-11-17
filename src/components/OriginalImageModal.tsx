import React, { useState, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw, Download, Eye, ChevronRight, ChevronLeft, FileText } from 'lucide-react';

interface OriginalImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  imageUrls?: string[];
  title?: string;
}

export const OriginalImageModal: React.FC<OriginalImageModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  imageUrls,
  title = 'ورقة المحاضرة الأصلية',
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [pageIdx, setPageIdx] = useState<number>(0);

  const pages = imageUrls && imageUrls.length > 0 ? imageUrls : imageUrl ? [imageUrl] : [];
  const activeUrl = pages[pageIdx] || imageUrl;

  useEffect(() => {
    setPageIdx(0);
    setZoomLevel(1);
    setRotation(0);
  }, [isOpen, imageUrl]);

  if (!isOpen || !activeUrl) return null;

  const isPdf = activeUrl.startsWith('data:application/pdf');
  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const handleReset = () => {
    setZoomLevel(1);
    setRotation(0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl text-white">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Eye className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {title} {pages.length > 1 ? `(صفحة ${pageIdx + 1} من ${pages.length})` : ''}
              </h3>
              <p className="text-xs text-slate-400">راجع الورقة الأصلية لمقارنتها مع النص المستخرج</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {pages.length > 1 && (
              <div className="flex items-center gap-1 ml-2 bg-slate-800 rounded-xl p-1">
                <button
                  type="button"
                  disabled={pageIdx === 0}
                  onClick={() => setPageIdx((p) => Math.max(0, p - 1))}
                  className="p-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  title="الصفحة السابقة"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold px-2 tabular-nums">
                  {pageIdx + 1} / {pages.length}
                </span>
                <button
                  type="button"
                  disabled={pageIdx === pages.length - 1}
                  onClick={() => setPageIdx((p) => Math.min(pages.length - 1, p + 1))}
                  className="p-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  title="الصفحة التالية"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            )}

            {!isPdf && (
              <>
                <button
                  type="button"
                  onClick={handleZoomOut}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                  title="تصغير"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-slate-400 w-11 text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={handleZoomIn}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                  title="تكبير"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleRotate}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                  title="تدوير"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition cursor-pointer"
                >
                  إعادة ضبط
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 transition cursor-pointer"
              title="إغلاق"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 bg-slate-950 flex items-center justify-center min-h-[400px]">
          {isPdf ? (
            <div className="w-full h-[65vh] flex flex-col items-center justify-center gap-4">
              <iframe
                src={activeUrl}
                title={title}
                className="w-full h-full rounded-xl border border-slate-800 bg-white"
              />
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <FileText className="w-4 h-4 text-emerald-400" />
                <span>مستند PDF الأصلي</span>
              </div>
            </div>
          ) : (
            <div
              style={{
                transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                transition: 'transform 0.2s ease-out',
              }}
              className="origin-center"
            >
              <img
                src={activeUrl}
                alt="الورقة الأصلية"
                className="max-h-[65vh] w-auto max-w-full rounded-xl shadow-2xl object-contain border border-slate-800"
              />
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-900/50 flex items-center justify-between text-xs text-slate-400">
          <span>استخدم أدوات التكبير والتنقل بين الصفحات لفحص التفاصيل</span>
          <a
            href={activeUrl}
            download={isPdf ? 'wara2ty_lecture.pdf' : `wara2ty_page_${pageIdx + 1}.jpg`}
            className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>حفظ الملف الأصلي</span>
          </a>
        </div>
      </div>
    </div>
  );
};
