import React, { useState, useMemo } from 'react';
import {
  X,
  Search,
  FolderOpen,
  Trash2,
  Edit3,
  Check,
  GitCompare,
  Sparkles,
  BookOpen,
  Info,
  AlertCircle,
} from 'lucide-react';
import { CombinedLecturesReview, SavedLectureRecord } from '../types';
import {
  deleteLectureFromLibrary,
  updateLectureMetadata,
} from '../utils/storage';

interface SavedLecturesModalProps {
  isOpen: boolean;
  onClose: () => void;
  lectures: SavedLectureRecord[];
  onRefreshLectures: (updated: SavedLectureRecord[]) => void;
  onOpenLecture: (record: SavedLectureRecord) => void;
}

export const SavedLecturesModal: React.FC<SavedLecturesModalProps> = ({
  isOpen,
  onClose,
  lectures,
  onRefreshLectures,
  onOpenLecture,
}) => {
  const [search, setSearch] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editSubject, setEditSubject] = useState<string>('');
  const [editTags, setEditTags] = useState<string>('');

  // Multi-select for combined review / comparison
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState<boolean>(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [combinedReview, setCombinedReview] = useState<CombinedLecturesReview | null>(null);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    lectures.forEach((l) => {
      if (l.subject) set.add(l.subject);
    });
    return Array.from(set);
  }, [lectures]);

  const filtered = useMemo(() => {
    return lectures.filter((l) => {
      if (selectedSubject !== 'all' && l.subject !== selectedSubject) return false;
      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        l.subject.toLowerCase().includes(q) ||
        l.tags.some((t) => t.toLowerCase().includes(q)) ||
        l.data.extractedText.toLowerCase().includes(q)
      );
    });
  }, [lectures, search, selectedSubject]);

  if (!isOpen) return null;

  const startEdit = (item: SavedLectureRecord) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditSubject(item.subject);
    setEditTags(item.tags.join('، '));
  };

  const saveEdit = (id: string) => {
    const next = updateLectureMetadata(id, {
      title: editTitle.trim() || 'محاضرة بدون عنوان',
      subject: editSubject.trim() || 'مادة دراسية',
      tags: editTags
        .split(/[،,]/)
        .map((t) => t.trim())
        .filter(Boolean),
    });
    onRefreshLectures(next);
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    const next = deleteLectureFromLibrary(id);
    onRefreshLectures(next);
    setCompareIds((prev) => prev.filter((x) => x !== id));
  };

  const toggleCompareId = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  };

  const runCombinedReview = async () => {
    if (compareIds.length < 2) return;
    setIsComparing(true);
    setCompareError(null);
    setCombinedReview(null);

    try {
      const chosen = lectures.filter((l) => compareIds.includes(l.id));
      const response = await fetch('/api/compare-lectures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lectures: chosen.map((c) => ({
            title: c.title,
            summary: c.data.summary,
            extractedText: c.data.extractedText,
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success || !json.review) {
        throw new Error(json.error || 'تعذر إجراء المقارنة بين المحاضرات.');
      }
      setCombinedReview(json.review);
    } catch (err: any) {
      setCompareError(err?.message || 'حدث خطأ أثناء مقارنة المحاضرات.');
    } finally {
      setIsComparing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
      <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">مكتبة محاضراتي المحفوظة ({lectures.length})</h3>
              <p className="text-[11px] text-slate-300">
                ابحث في محاضراتك السابقة، نظّمها بالمواد والوسوم، أو قارن بين أكثر من محاضرة.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Honest Persistence Notice */}
        <div className="px-6 py-2.5 bg-blue-50 border-b border-blue-200 text-blue-950 text-xs flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <span>
            تُحفظ هذه المحاضرات محلياً في متصفحك الحالي فقط (LocalStorage) ولا تتم مزامنتها عبر حسابات سحابية أو أجهزة أخرى.
          </span>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="p-4 sm:px-6 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالعنوان، الوسوم، أو محتوى المحاضرة..."
              className="w-full pr-9 pl-3 py-2 rounded-xl bg-white border border-slate-200 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <select
            value={selectedSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">جميع المواد ({lectures.length})</option>
            {subjects.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>

          {compareIds.length >= 2 && (
            <button
              type="button"
              onClick={runCombinedReview}
              disabled={isComparing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black cursor-pointer whitespace-nowrap"
            >
              <GitCompare className="w-4 h-4" />
              <span>{isComparing ? 'جاري المقارنة...' : `مقارنة ومراجعة (${compareIds.length})`}</span>
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {compareError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{compareError}</span>
            </div>
          )}

          {/* Combined Review Output */}
          {combinedReview && (
            <div className="p-5 rounded-3xl bg-emerald-50/70 border-2 border-emerald-300 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-black text-base text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>{combinedReview.title}</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setCombinedReview(null)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  إغلاق المقارنة
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
                <div className="bg-white p-4 rounded-2xl border border-emerald-200 space-y-2">
                  <strong className="text-emerald-800 block">المفاهيم المشتركة:</strong>
                  <ul className="space-y-1 text-slate-700">
                    {combinedReview.sharedConcepts.map((c, i) => (
                      <li key={i}>• {c}</li>
                    ))}
                  </ul>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-emerald-200 space-y-2">
                  <strong className="text-slate-900 block">أبرز الفروقات والربط:</strong>
                  <ul className="space-y-1.5 text-slate-700">
                    {combinedReview.keyDifferences.map((d, i) => (
                      <li key={i}>
                        <strong>{d.topic}:</strong> {d.details}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="bg-white p-4 rounded-2xl border border-emerald-200 text-xs space-y-1.5">
                <strong className="text-slate-900 block">خطة المراجعة المجمعة:</strong>
                <ul className="space-y-1 text-slate-700">
                  {combinedReview.combinedChecklist.map((item, i) => (
                    <li key={i}>✓ {item}</li>
                  ))}
                </ul>
                <p className="text-emerald-800 font-semibold pt-1">{combinedReview.studyAdvice}</p>
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm space-y-2">
              <BookOpen className="w-10 h-10 mx-auto text-slate-300" />
              <p>لا توجد محاضرات محفوظة مطابقة.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((item) => {
                const isEditing = editingId === item.id;
                const isCheckedCompare = compareIds.includes(item.id);

                return (
                  <div
                    key={item.id}
                    className={`p-5 rounded-2xl border transition space-y-3 ${
                      isCheckedCompare
                        ? 'bg-emerald-50/40 border-emerald-400'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {isEditing ? (
                      <div className="space-y-2.5 text-xs">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          placeholder="عنوان المحاضرة"
                          className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 font-bold"
                        />
                        <input
                          type="text"
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          placeholder="المادة الدراسية"
                          className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300"
                        />
                        <input
                          type="text"
                          value={editTags}
                          onChange={(e) => setEditTags(e.target.value)}
                          placeholder="وسوم مفصولة بفاصلة"
                          className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(item.id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>حفظ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 font-semibold cursor-pointer"
                          >
                            إلغاء
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 flex-1 min-w-0">
                            <span className="text-[11px] font-bold text-emerald-700 block">
                              {item.subject} · {item.detectedLanguage} · {item.pageCount} صفحة
                            </span>
                            <h4 className="font-extrabold text-sm sm:text-base text-slate-900 truncate">
                              {item.title}
                            </h4>
                          </div>

                          <label className="flex items-center gap-1 text-[11px] font-bold text-slate-600 cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={isCheckedCompare}
                              onChange={() => toggleCompareId(item.id)}
                              className="accent-emerald-600 w-4 h-4"
                            />
                            <span>مقارنة</span>
                          </label>
                        </div>

                        {item.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {item.tags.map((t, tIdx) => (
                              <span
                                key={tIdx}
                                className="text-[11px] bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-lg"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/80">
                          <button
                            type="button"
                            onClick={() => {
                              onOpenLecture(item);
                              onClose();
                            }}
                            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer"
                          >
                            فتح المحاضرة
                          </button>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-slate-900 cursor-pointer"
                              title="تعديل العنوان والمادة"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item.id)}
                              className="p-2 rounded-xl bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer"
                              title="حذف المحاضرة"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
