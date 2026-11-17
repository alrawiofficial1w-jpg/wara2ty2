import React, { useState, useEffect } from 'react';
import {
  FileText,
  Languages,
  BookMarked,
  Sparkles,
  HelpCircle,
  Copy,
  Check,
  Download,
  Eye,
  RefreshCw,
  Home,
  Save,
  AlertTriangle,
  BookOpen,
  MessageSquareText,
  Table2,
  ClipboardList,
  Headphones,
  Layers,
  MapPin,
  Columns,
  Wand2,
  Image as ImageIcon,
  CheckCircle2,
  X,
  Loader2,
} from 'lucide-react';
import {
  AnalysisData,
  ComparisonTable,
  DetailedExplanationData,
  ExpectedExamQuestion,
  ExplanationMode,
  MindMapData,
  QuizQuestion,
  RevisionSheetData,
  SelectionExplanation,
} from '../types';
import { QuizCard } from './QuizCard';
import { exportStudyMaterialToPDF } from '../utils/pdfExport';
import { OriginalImageModal } from './OriginalImageModal';
import { DetailedExplanationTab } from './DetailedExplanationTab';
import { AskLectureTab } from './AskLectureTab';
import { VocabularyTab } from './VocabularyTab';
import { ComparisonAndMindMapTab } from './ComparisonAndMindMapTab';
import { RevisionSheetTab } from './RevisionSheetTab';
import { ExpectedExamSection } from './ExpectedExamSection';
import { AudioLessonTab } from './AudioLessonTab';

interface ResultsViewProps {
  data: AnalysisData;
  originalImage: string | null;
  originalImages?: string[];
  onAnalyzeAnother: () => void;
  onGoHome: () => void;
  onUpdateExtractedText: (newText: string) => void;
  onUpdateQuiz?: (newQuiz: QuizQuestion[]) => void;
  onUpdateAnalysisData?: (updater: (prev: AnalysisData) => AnalysisData) => void;
}

type TabType =
  | 'summary'
  | 'extracted'
  | 'translation'
  | 'explanation'
  | 'vocabulary'
  | 'ask'
  | 'comparisons'
  | 'revision'
  | 'quiz'
  | 'audio';

export const ResultsView: React.FC<ResultsViewProps> = ({
  data,
  originalImage,
  originalImages,
  onAnalyzeAnother,
  onGoHome,
  onUpdateExtractedText,
  onUpdateQuiz,
  onUpdateAnalysisData,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('summary');
  const [isEditingText, setIsEditingText] = useState<boolean>(false);
  const [editedText, setEditedText] = useState<string>(data.extractedText);
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [isImageModalOpen, setIsImageModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Extracted text enhancements
  const [activePageView, setActivePageView] = useState<number | 'all'>('all');
  const [showInlineCompare, setShowInlineCompare] = useState<boolean>(false);
  const [isReprocessing, setIsReprocessing] = useState<boolean>(false);

  // Bilingual view mode (Feature 12)
  const [bilingualMode, setBilingualMode] = useState<'arabic' | 'original' | 'side_by_side'>('side_by_side');

  // Explain Selected Section (Feature 3)
  const [selectedSnippet, setSelectedSnippet] = useState<string>('');
  const [isExplainingSelection, setIsExplainingSelection] = useState<boolean>(false);
  const [selectionResult, setSelectionResult] = useState<SelectionExplanation | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => {
    setEditedText(data.extractedText);
  }, [data.extractedText]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const handleCopy = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    showToast(`تم نسخ ${type} إلى الحافظة بنجاح!`);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleSaveTextEdit = () => {
    onUpdateExtractedText(editedText);
    setIsEditingText(false);
    showToast('تم حفظ التعديلات على النص! ستُستخدم النسخة المصححة في جميع الأدوات القادمة.');
  };

  const handleReprocessFromCorrectedText = async () => {
    setIsReprocessing(true);
    try {
      const response = await fetch('/api/reprocess-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correctedText: editedText,
          detectedLanguage: data.detectedLanguage,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'تعذر تحديث الترجمة والملخص.');
      }
      if (onUpdateAnalysisData) {
        onUpdateAnalysisData((prev) => ({
          ...prev,
          extractedText: editedText,
          arabicTranslation: json.arabicTranslation || prev.arabicTranslation,
          bilingualSections: json.bilingualSections?.length ? json.bilingualSections : prev.bilingualSections,
          summary: json.summary ? { ...prev.summary, ...json.summary } : prev.summary,
          // Invalidate stale cached derivations so they regenerate from corrected text
          detailedExplanations: undefined,
          comparisonTables: undefined,
          revisionSheet: undefined,
          expectedExamQuestions: undefined,
          mindMap: undefined,
          textEditedSinceAnalysis: false,
        }));
      }
      showToast('تم تحديث الترجمة والملخص بناءً على النص المصحح بنجاح!');
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث الترجمة حالياً.');
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleTextMouseUp = () => {
    const sel = window.getSelection()?.toString().trim() || '';
    if (sel.length >= 2) {
      setSelectedSnippet(sel.slice(0, 1500));
    }
  };

  const handleExplainSelection = async (snippetToExplain?: string) => {
    const target = (snippetToExplain ?? selectedSnippet).trim();
    if (!target) return;
    setIsExplainingSelection(true);
    setSelectionError(null);
    try {
      const response = await fetch('/api/explain-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedText: target,
          lectureText: editedText,
          lectureTitle: data.summary.title,
          detectedLanguage: data.detectedLanguage,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success || !json.result) {
        throw new Error(json.error || 'تعذر شرح الجزء المحدد.');
      }
      setSelectionResult(json.result);
    } catch (err: any) {
      setSelectionError(err?.message || 'حدث خطأ أثناء شرح الجزء المحدد.');
    } finally {
      setIsExplainingSelection(false);
    }
  };

  const handleDownloadPDF = () => {
    showToast('جاري إعداد وتحميل ملف الـ PDF الدراسي...');
    exportStudyMaterialToPDF(data, data.summary.title);
  };

  const updateData = (updater: (prev: AnalysisData) => AnalysisData) => {
    if (onUpdateAnalysisData) onUpdateAnalysisData(updater);
  };

  const allOriginalPages = originalImages && originalImages.length > 0 ? originalImages : originalImage ? [originalImage] : [];
  const isTurkishSource = /ترك|turk/i.test(data.detectedLanguage || '');

  const tabs: { id: TabType; label: string; icon: React.ComponentType<any>; color: string }[] = [
    { id: 'summary', label: 'الملخص الذكي', icon: Sparkles, color: 'text-emerald-400' },
    { id: 'extracted', label: 'النص المستخرج (OCR)', icon: FileText, color: 'text-blue-400' },
    { id: 'translation', label: 'الترجمة الثنائية', icon: Languages, color: 'text-emerald-400' },
    { id: 'explanation', label: 'الشرح التفصيلي', icon: BookOpen, color: 'text-teal-400' },
    { id: 'vocabulary', label: `المعجم (${data.vocabulary?.length || 0})`, icon: BookMarked, color: 'text-amber-400' },
    { id: 'ask', label: 'اسأل محاضرتك', icon: MessageSquareText, color: 'text-emerald-400' },
    { id: 'comparisons', label: 'المقارنات والخريطة', icon: Table2, color: 'text-sky-400' },
    { id: 'revision', label: 'ورقة المراجعة', icon: ClipboardList, color: 'text-emerald-400' },
    { id: 'quiz', label: 'الاختبارات والأسئلة', icon: HelpCircle, color: 'text-purple-400' },
    { id: 'audio', label: 'المحاضرة الصوتية', icon: Headphones, color: 'text-emerald-400' },
  ];

  const displayedExtractedText =
    activePageView === 'all'
      ? editedText
      : data.pages?.find((p) => p.pageNumber === activePageView)?.extractedText || editedText;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-sm font-semibold border border-slate-700">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Action & Navigation Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-6 shadow-sm">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-semibold">
            <span className="text-emerald-700 font-bold">اللغة المكتشفة: {data.detectedLanguage}</span>
            <span aria-hidden="true">·</span>
            <span>وضوح الخط: {data.clarityScore}</span>
            {(data.pageCount || 1) > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-700 font-bold tabular-nums">{data.pageCount} صفحات</span>
              </>
            )}
            {data.topics && data.topics.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{data.topics.join(' · ')}</span>
              </>
            )}
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900">
            {data.summary.title || 'نتائج تحليل المحاضرة'}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 no-print">
          {allOriginalPages.length > 0 && (
            <button
              type="button"
              onClick={() => setIsImageModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition cursor-pointer whitespace-nowrap"
            >
              <Eye className="w-4 h-4 text-slate-600" />
              <span>معاينة الورقة الأصلية</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleDownloadPDF}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black shadow-sm transition cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>تنزيل ملخص PDF</span>
          </button>

          <button
            type="button"
            onClick={onAnalyzeAnother}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-4 h-4" />
            <span>تحليل محاضرة أخرى</span>
          </button>

          <button
            type="button"
            onClick={onGoHome}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 text-xs font-semibold transition cursor-pointer"
            title="العودة للرئيسية"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Notice if student edited OCR text and can update derived translation/summary */}
      {data.textEditedSinceAnalysis && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm no-print">
          <div className="flex items-center gap-2.5 text-amber-950">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>
              <strong>لقد قمت بتعديل النص المستخرج:</strong> ستستخدم جميع الأدوات القادمة (الشرح، الأسئلة، المقارنة، المراجعة) نصك المصحح تلقائياً. يمكنك أيضاً تحديث الترجمة والملخص الآن.
            </span>
          </div>
          <button
            type="button"
            disabled={isReprocessing}
            onClick={handleReprocessFromCorrectedText}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReprocessing ? 'animate-spin' : ''}`} />
            <span>{isReprocessing ? 'جاري التحديث...' : 'تحديث الترجمة والملخص'}</span>
          </button>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-200 no-print">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                active
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? tab.color : 'text-slate-500'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: ACADEMIC SUMMARY + EXTRACTED TABLES + DIAGRAMS */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-500">
                <span className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-emerald-600" />
                  <span>النبذة العامة للمحاضرة</span>
                </span>
                {data.summary.sourceRefs && data.summary.sourceRefs.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{data.summary.sourceRefs.join(' · ')}</span>
                  </span>
                )}
              </div>
              <p className="text-base sm:text-lg text-slate-800 leading-relaxed font-medium bg-slate-50 p-5 rounded-2xl border border-slate-100">
                {data.summary.overview}
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>أبرز النقاط والمفاهيم الأساسية:</span>
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.summary.keyPoints.map((point, index) => (
                  <div
                    key={index}
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-start gap-3"
                  >
                    <span className="w-6 h-6 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5 tabular-nums">
                      {index + 1}
                    </span>
                    <p className="text-sm text-slate-700 leading-relaxed font-medium">{point}</p>
                  </div>
                ))}
              </div>
            </div>

            {data.summary.examTip && (
              <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-950 flex items-start gap-3.5">
                <Sparkles className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h5 className="font-bold text-sm text-emerald-900">نصيحة ذهبية للامتحان:</h5>
                  <p className="text-sm text-emerald-800 leading-relaxed">{data.summary.examTip}</p>
                </div>
              </div>
            )}
          </div>

          {/* Extracted Tables (Feature 10) */}
          {data.tables && data.tables.length > 0 && (
            <div className="space-y-4">
              {data.tables.map((tbl, tIdx) => (
                <div key={tbl.id || tIdx} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Table2 className="w-5 h-5 text-emerald-600" />
                      <h4 className="font-bold text-base text-slate-900">{tbl.title}</h4>
                      {tbl.pageNumber && (
                        <span className="text-xs font-semibold text-emerald-700">(صفحة {tbl.pageNumber})</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const txt = `${tbl.headers.join(' | ')}\n${tbl.rows.map((r) => r.join(' | ')).join('\n')}`;
                        handleCopy(txt, 'الجدول');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer self-start sm:self-auto"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>نسخ الجدول</span>
                    </button>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="w-full text-right text-xs sm:text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-900 text-white">
                          {tbl.headers.map((h, i) => (
                            <th key={i} className="p-3 font-bold border-l border-slate-700 last:border-l-0" dir="auto">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tbl.rows.map((row, rIdx) => (
                          <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                            {tbl.headers.map((_, cIdx) => (
                              <td key={cIdx} className="p-3 border-t border-l border-slate-200 last:border-l-0 text-slate-800" dir="auto">
                                {row[cIdx] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {tbl.notes && <p className="text-xs text-slate-500">{tbl.notes}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Diagrams & Visual Understanding (Feature 9) */}
          {data.diagrams && data.diagrams.length > 0 && (
            <div className="space-y-4">
              {data.diagrams.map((diag, dIdx) => (
                <div key={diag.id || dIdx} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="w-5 h-5 text-emerald-600" />
                      <h4 className="font-bold text-base text-slate-900">تحليل رسم/مخطط: {diag.title}</h4>
                      {diag.pageNumber && (
                        <span className="text-xs font-semibold text-emerald-700">(صفحة {diag.pageNumber})</span>
                      )}
                    </div>
                    {diag.needsManualReview && (
                      <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-xl">
                        يحتاج مراجعة يدوية من الطالب
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-slate-800 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    {diag.description}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
                    {diag.labels?.length > 0 && (
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                        <strong className="text-slate-900 block">التسميات والعناصر الظاهرة:</strong>
                        <div className="flex flex-wrap gap-1.5">
                          {diag.labels.map((lbl, i) => (
                            <span key={i} dir="auto" className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold">
                              {lbl}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {diag.relationships?.length > 0 && (
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                        <strong className="text-slate-900 block">العلاقات بين عناصر الشكل:</strong>
                        <ul className="space-y-1 text-slate-700">
                          {diag.relationships.map((rel, i) => (
                            <li key={i}>• {rel}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-200 text-xs sm:text-sm text-emerald-950">
                    <strong>ارتباط المخطط بنص المحاضرة: </strong>
                    <span>{diag.connectionToLecture}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: EXTRACTED TEXT + OCR UNCERTAINTY REVIEW + EXPLAIN SELECTION */}
      {activeTab === 'extracted' && (
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="space-y-1">
                <h3 className="font-bold text-lg text-slate-900">النص المستخرج ومراجعة دقة القراءة (OCR)</h3>
                <p className="text-xs text-slate-500">
                  ظلّل أي كلمة أو فقرة واضغط «اشرح الجزء المحدد»، أو عدّل النص لمطابقته مع الورقة الأصلية.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {allOriginalPages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowInlineCompare((v) => !v)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold transition cursor-pointer whitespace-nowrap ${
                      showInlineCompare
                        ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                        : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Columns className="w-4 h-4" />
                    <span>{showInlineCompare ? 'إخفاء مقارنة الورقة' : 'مقارنة مع الورقة الأصلية'}</span>
                  </button>
                )}

                {isEditingText ? (
                  <button
                    type="button"
                    onClick={handleSaveTextEdit}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-sm cursor-pointer whitespace-nowrap"
                  >
                    <Save className="w-4 h-4" />
                    <span>حفظ التعديلات</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActivePageView('all');
                      setIsEditingText(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer whitespace-nowrap"
                  >
                    <span>تعديل النص</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleCopy(displayedExtractedText, 'النص المستخرج')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap"
                >
                  {copiedType === 'النص المستخرج' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>نسخ النص</span>
                </button>
              </div>
            </div>

            {/* Page Filter for Multi-Page Lectures */}
            {data.pages && data.pages.length > 1 && !isEditingText && (
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className="text-slate-500 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5" />
                  <span>تصفية الصفحة:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setActivePageView('all')}
                  className={`px-3 py-1.5 rounded-xl cursor-pointer transition ${
                    activePageView === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  جميع الصفحات ({data.pages.length})
                </button>
                {data.pages.map((p) => (
                  <button
                    key={p.pageNumber}
                    type="button"
                    onClick={() => setActivePageView(p.pageNumber)}
                    className={`px-3 py-1.5 rounded-xl cursor-pointer transition tabular-nums ${
                      activePageView === p.pageNumber ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    صفحة {p.pageNumber}
                  </button>
                ))}
              </div>
            )}

            {/* OCR Confidence & Uncertain Text Review (Feature 6) */}
            {data.ocrSegments && data.ocrSegments.length > 0 && (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <strong className="text-slate-900">حالة مراجعة القراءة الآلية (بدون نسب تخمينية):</strong>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      نص موثّق
                    </span>
                    <span className="inline-flex items-center gap-1 text-amber-700 font-bold">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      يحتاج مراجعة
                    </span>
                    <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      نص غير واضح
                    </span>
                  </div>
                </div>

                {data.ocrSegments.some((s) => s.status !== 'verified') && (
                  <div className="space-y-2 pt-1">
                    {data.ocrSegments
                      .filter((s) => s.status !== 'verified')
                      .map((seg, i) => (
                        <div
                          key={seg.id || i}
                          className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                            seg.status === 'unclear'
                              ? 'bg-rose-50 border-rose-200 text-rose-950'
                              : 'bg-amber-50 border-amber-200 text-amber-950'
                          }`}
                        >
                          <div className="space-y-0.5">
                            <span className="font-bold block">
                              {seg.status === 'unclear' ? 'نص غير واضح' : 'يحتاج مراجعة'}
                              {seg.pageNumber ? ` (صفحة ${seg.pageNumber})` : ''}:{' '}
                              <code className="bg-white px-1.5 py-0.5 rounded border" dir="auto">
                                {seg.text}
                              </code>
                            </span>
                            {seg.reason && <span className="text-[11px] opacity-80 block">{seg.reason}</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setActivePageView('all');
                              setIsEditingText(true);
                            }}
                            className="px-3 py-1 rounded-lg bg-white border border-slate-300 text-slate-800 font-bold hover:bg-slate-100 cursor-pointer shrink-0 self-start sm:self-auto"
                          >
                            تصحيح في النص
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Selected Text Quick Action Bar (Feature 3) */}
            <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1 min-w-0 text-xs">
                <strong className="text-emerald-900 flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>اشرح الجزء المحدد:</span>
                </strong>
                <input
                  type="text"
                  dir="auto"
                  value={selectedSnippet}
                  onChange={(e) => setSelectedSnippet(e.target.value)}
                  placeholder="ظلّل كلمة أو جملة من النص بالأسفل أو اكتبها هنا لشرحها فوراً..."
                  className="mt-1.5 w-full px-3 py-2 rounded-xl bg-white border border-emerald-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <button
                type="button"
                disabled={isExplainingSelection || !selectedSnippet.trim()}
                onClick={() => handleExplainSelection()}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap self-end sm:self-center"
              >
                {isExplainingSelection ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>اشرح الجزء المحدد</span>
              </button>
            </div>

            {selectionError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                {selectionError}
              </div>
            )}

            {selectionResult && (
              <div className="p-5 rounded-2xl bg-white border-2 border-emerald-400 shadow-md space-y-3 relative">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                  <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    <span>شرح الجزء المحدد</span>
                  </h4>
                  <button
                    type="button"
                    onClick={() => setSelectionResult(null)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm font-bold text-slate-900" dir="auto">
                  {selectionResult.selectedText}
                </div>
                <div className="text-sm text-emerald-800 font-semibold">
                  <strong>الترجمة: </strong>
                  {selectionResult.translation}
                </div>
                <p className="text-sm text-slate-700 leading-relaxed">{selectionResult.explanation}</p>

                {selectionResult.vocabularyBreakdown?.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {selectionResult.vocabularyBreakdown.map((vb, i) => (
                      <span key={i} className="text-xs bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                        <strong dir="ltr">{vb.word}</strong>: {vb.meaning}
                      </span>
                    ))}
                  </div>
                )}

                {selectionResult.grammarOrTechNote && (
                  <p className="text-xs text-slate-700 bg-blue-50 border border-blue-100 p-3 rounded-xl">
                    <strong>ملاحظة نحوية/علمية: </strong>
                    {selectionResult.grammarOrTechNote}
                  </p>
                )}

                {selectionResult.example && (
                  <p className="text-xs text-slate-700 bg-emerald-50 border border-emerald-100 p-3 rounded-xl" dir="auto">
                    <strong>مثال: </strong>
                    {selectionResult.example}
                  </p>
                )}

                <div className="text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span>
                    <strong>صلته بالمحاضرة: </strong>
                    {selectionResult.connectionToLecture}
                  </span>
                  {selectionResult.sourceRef && (
                    <span className="text-emerald-700 font-semibold">{selectionResult.sourceRef}</span>
                  )}
                </div>
              </div>
            )}

            {/* Split or Full View: Text + Optional Side-by-Side Original Image */}
            <div className={`grid gap-6 ${showInlineCompare && allOriginalPages.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
              <div>
                {isEditingText ? (
                  <div className="space-y-2">
                    <textarea
                      value={editedText}
                      onChange={(e) => setEditedText(e.target.value)}
                      rows={16}
                      dir="auto"
                      className="w-full p-4 rounded-2xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 font-mono text-sm leading-relaxed"
                    />
                    <div className="flex justify-between text-xs text-slate-400 px-1 tabular-nums">
                      <span>عدد الحروف: {editedText.length}</span>
                      <span>اضغط «حفظ التعديلات» بالأعلى لتثبيت التغيير</span>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <div
                      onMouseUp={handleTextMouseUp}
                      dir="auto"
                      className="p-6 rounded-2xl bg-slate-50 border border-slate-200 text-slate-800 font-sans text-sm sm:text-base leading-relaxed whitespace-pre-wrap select-text max-h-[600px] overflow-y-auto"
                    >
                      {displayedExtractedText}
                    </div>
                    <div className="mt-2 text-xs text-slate-400 text-left tabular-nums">
                      عدد الكلمات: {displayedExtractedText.split(/\s+/).filter(Boolean).length} · الحروف: {displayedExtractedText.length}
                    </div>
                  </div>
                )}
              </div>

              {showInlineCompare && allOriginalPages.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-slate-950 p-3 max-h-[600px] overflow-y-auto space-y-3">
                  {allOriginalPages.map((imgUrl, idx) =>
                    imgUrl.startsWith('data:application/pdf') ? (
                      <iframe key={idx} src={imgUrl} title="PDF" className="w-full h-[540px] rounded-xl bg-white" />
                    ) : (
                      <div key={idx} className="space-y-1">
                        {allOriginalPages.length > 1 && (
                          <span className="text-[11px] font-bold text-emerald-400 block">صفحة {idx + 1}</span>
                        )}
                        <img src={imgUrl} alt={`صفحة ${idx + 1}`} className="w-full rounded-xl object-contain" />
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: BILINGUAL SIDE-BY-SIDE VIEW & ARABIC TRANSLATION (Feature 12) */}
      {activeTab === 'translation' && (
        <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div className="space-y-1">
              <h3 className="font-bold text-lg text-slate-900">الترجمة العربية والمقارنة الثنائية</h3>
              <p className="text-xs text-slate-500">
                اختر عرض الترجمة العربية فقط، أو النص الأصلي، أو العرض المتجاور المحاذي للفقرات (RTL/LTR).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setBilingualMode('arabic')}
                  className={`px-3 py-1.5 rounded-lg cursor-pointer transition ${
                    bilingualMode === 'arabic' ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  الترجمة العربية
                </button>
                <button
                  type="button"
                  onClick={() => setBilingualMode('original')}
                  className={`px-3 py-1.5 rounded-lg cursor-pointer transition ${
                    bilingualMode === 'original' ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  النص الأصلي
                </button>
                <button
                  type="button"
                  onClick={() => setBilingualMode('side_by_side')}
                  className={`px-3 py-1.5 rounded-lg cursor-pointer transition ${
                    bilingualMode === 'side_by_side' ? 'bg-emerald-600 text-white' : 'text-slate-600'
                  }`}
                >
                  جنباً إلى جنب
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleCopy(data.arabicTranslation, 'الترجمة العربية')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>نسخ العربية</span>
              </button>
              <button
                type="button"
                onClick={() => handleCopy(editedText, 'النص الأصلي')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>نسخ الأصلي</span>
              </button>
            </div>
          </div>

          {bilingualMode === 'arabic' && (
            <div
              dir="rtl"
              className="p-6 sm:p-8 rounded-2xl bg-emerald-50/40 border border-emerald-100 text-slate-900 text-base sm:text-lg leading-relaxed whitespace-pre-wrap select-text"
            >
              {data.arabicTranslation}
            </div>
          )}

          {bilingualMode === 'original' && (
            <div
              dir={isTurkishSource ? 'ltr' : 'auto'}
              className="p-6 sm:p-8 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 text-base sm:text-lg leading-relaxed whitespace-pre-wrap select-text"
            >
              {editedText}
            </div>
          )}

          {bilingualMode === 'side_by_side' && (
            <div className="space-y-4">
              {data.bilingualSections && data.bilingualSections.length > 0 ? (
                data.bilingualSections.map((sec, idx) => (
                  <div
                    key={sec.id || idx}
                    className="rounded-2xl border border-slate-200 overflow-hidden bg-slate-50/60"
                  >
                    {(sec.sectionTitle || sec.pageNumber) && (
                      <div className="px-4 py-2 bg-slate-900 text-white text-xs font-bold flex items-center justify-between">
                        <span>{sec.sectionTitle || `فقرة ${idx + 1}`}</span>
                        {sec.pageNumber && <span className="text-emerald-400">صفحة {sec.pageNumber}</span>}
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-200">
                      <div dir="rtl" className="p-5 bg-emerald-50/30 text-slate-900 text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
                        <span className="text-[10px] font-bold text-emerald-700 block mb-1.5">الترجمة العربية</span>
                        {sec.arabicTranslation}
                      </div>
                      <div
                        dir={isTurkishSource ? 'ltr' : 'auto'}
                        className="p-5 bg-white text-slate-800 text-sm sm:text-base leading-relaxed whitespace-pre-wrap"
                      >
                        <span dir="rtl" className="text-[10px] font-bold text-slate-500 block mb-1.5 text-right">
                          النص الأصلي ({data.detectedLanguage})
                        </span>
                        {sec.originalText}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div dir="rtl" className="p-5 rounded-2xl bg-emerald-50/40 border border-emerald-100 text-sm sm:text-base leading-relaxed whitespace-pre-wrap">
                    {data.arabicTranslation}
                  </div>
                  <div
                    dir={isTurkishSource ? 'ltr' : 'auto'}
                    className="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-sm sm:text-base leading-relaxed whitespace-pre-wrap"
                  >
                    {editedText}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: DETAILED EXPLANATION */}
      {activeTab === 'explanation' && (
        <DetailedExplanationTab
          lectureText={editedText}
          arabicTranslation={data.arabicTranslation}
          lectureTitle={data.summary.title}
          cachedExplanations={data.detailedExplanations}
          onSaveExplanation={(mode: ExplanationMode, exp: DetailedExplanationData) =>
            updateData((prev) => ({
              ...prev,
              detailedExplanations: { ...(prev.detailedExplanations || {}), [mode]: exp },
            }))
          }
        />
      )}

      {/* TAB 5: ENHANCED VOCABULARY DICTIONARY */}
      {activeTab === 'vocabulary' && (
        <VocabularyTab
          vocabulary={data.vocabulary || []}
          lectureText={editedText}
          detectedLanguage={data.detectedLanguage}
          onCopy={handleCopy}
        />
      )}

      {/* TAB 6: ASK YOUR LECTURE */}
      {activeTab === 'ask' && (
        <AskLectureTab
          lectureText={editedText}
          arabicTranslation={data.arabicTranslation}
          lectureTitle={data.summary.title}
        />
      )}

      {/* TAB 7: SMART COMPARISONS & INTERACTIVE MIND MAP */}
      {activeTab === 'comparisons' && (
        <ComparisonAndMindMapTab
          lectureText={editedText}
          arabicTranslation={data.arabicTranslation}
          lectureTitle={data.summary.title}
          comparisonTables={data.comparisonTables}
          mindMap={data.mindMap}
          onSaveComparisons={(tables: ComparisonTable[]) =>
            updateData((prev) => ({ ...prev, comparisonTables: tables }))
          }
          onSaveMindMap={(map: MindMapData) => updateData((prev) => ({ ...prev, mindMap: map }))}
          onCopy={handleCopy}
        />
      )}

      {/* TAB 8: REVISION SHEET */}
      {activeTab === 'revision' && (
        <RevisionSheetTab
          lectureText={editedText}
          arabicTranslation={data.arabicTranslation}
          lectureTitle={data.summary.title}
          summary={data.summary}
          vocabulary={data.vocabulary || []}
          revisionSheet={data.revisionSheet}
          onSaveRevisionSheet={(sheet: RevisionSheetData) =>
            updateData((prev) => ({ ...prev, revisionSheet: sheet }))
          }
        />
      )}

      {/* TAB 9: ADVANCED QUIZ MODES + EXPECTED EXAM QUESTIONS */}
      {activeTab === 'quiz' && (
        <div className="space-y-10">
          <QuizCard
            questions={data.quiz}
            lectureText={editedText}
            lectureTitle={data.summary.title}
            summary={data.summary}
            vocabulary={data.vocabulary}
            onQuestionsUpdated={onUpdateQuiz}
          />
          <ExpectedExamSection
            lectureText={editedText}
            arabicTranslation={data.arabicTranslation}
            lectureTitle={data.summary.title}
            expectedQuestions={data.expectedExamQuestions}
            onSaveExpectedQuestions={(qs: ExpectedExamQuestion[]) =>
              updateData((prev) => ({ ...prev, expectedExamQuestions: qs }))
            }
          />
        </div>
      )}

      {/* TAB 10: AUDIO LESSON */}
      {activeTab === 'audio' && <AudioLessonTab data={{ ...data, extractedText: editedText }} />}

      {/* Original Image / Multi-page Modal */}
      <OriginalImageModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        imageUrl={originalImage}
        imageUrls={allOriginalPages}
        title={data.summary.title || 'ورقة المحاضرة الأصلية'}
      />
    </div>
  );
};
