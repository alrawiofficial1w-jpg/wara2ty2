import React, { useState, useEffect } from 'react';
import {
  Table2,
  GitBranch,
  RefreshCw,
  AlertCircle,
  Copy,
  MapPin,
  Printer,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import { ComparisonTable, MindMapData } from '../types';

interface ComparisonAndMindMapTabProps {
  lectureText: string;
  arabicTranslation: string;
  lectureTitle: string;
  comparisonTables?: ComparisonTable[];
  mindMap?: MindMapData;
  onSaveComparisons: (tables: ComparisonTable[]) => void;
  onSaveMindMap: (map: MindMapData) => void;
  onCopy: (text: string, label: string) => void;
}

export const ComparisonAndMindMapTab: React.FC<ComparisonAndMindMapTabProps> = ({
  lectureText,
  arabicTranslation,
  lectureTitle,
  comparisonTables,
  mindMap,
  onSaveComparisons,
  onSaveMindMap,
  onCopy,
}) => {
  const [subView, setSubView] = useState<'comparisons' | 'mindmap'>('comparisons');
  const [isLoadingComp, setIsLoadingComp] = useState<boolean>(false);
  const [isLoadingMap, setIsLoadingMap] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedBranches, setCollapsedBranches] = useState<Record<string, boolean>>({});

  const fetchComparisons = async () => {
    setIsLoadingComp(true);
    setError(null);
    try {
      const response = await fetch('/api/study-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'comparisons',
          lectureText,
          arabicTranslation,
          lectureTitle,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'تعذر توليد جداول المقارنة.');
      }
      onSaveComparisons(json.comparisonTables || []);
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء توليد جداول المقارنة.');
    } finally {
      setIsLoadingComp(false);
    }
  };

  const fetchMindMap = async () => {
    setIsLoadingMap(true);
    setError(null);
    try {
      const response = await fetch('/api/study-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'mind_map',
          lectureText,
          arabicTranslation,
          lectureTitle,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success || !json.mindMap) {
        throw new Error(json.error || 'تعذر إنشاء الخريطة الذهنية.');
      }
      onSaveMindMap(json.mindMap);
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء إنشاء الخريطة الذهنية.');
    } finally {
      setIsLoadingMap(false);
    }
  };

  useEffect(() => {
    if (subView === 'comparisons' && comparisonTables === undefined && !isLoadingComp) {
      fetchComparisons();
    }
    if (subView === 'mindmap' && mindMap === undefined && !isLoadingMap) {
      fetchMindMap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subView]);

  const toggleBranch = (id: string) => {
    setCollapsedBranches((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyTableAsText = (tbl: ComparisonTable) => {
    const header = tbl.columns.join(' | ');
    const sep = tbl.columns.map(() => '---').join(' | ');
    const rows = tbl.rows.map((r) => r.join(' | ')).join('\n');
    onCopy(`${tbl.title}\n${header}\n${sep}\n${rows}`, 'جدول المقارنة');
  };

  const copyMindMapText = (map: MindMapData) => {
    const lines = [map.centralTopic];
    map.branches.forEach((b) => {
      lines.push(`- ${b.title}`);
      b.children.forEach((c) => {
        lines.push(`  • ${c.title}${c.details ? `: ${c.details}` : ''}`);
      });
    });
    onCopy(lines.join('\n'), 'مخطط الخريطة الذهنية');
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation switcher */}
      <div className="bg-white rounded-3xl border border-slate-200 p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubView('comparisons')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition cursor-pointer ${
              subView === 'comparisons'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Table2 className="w-4 h-4 text-emerald-400" />
            <span>جداول المقارنة الذكية</span>
          </button>

          <button
            type="button"
            onClick={() => setSubView('mindmap')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition cursor-pointer ${
              subView === 'mindmap'
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <GitBranch className="w-4 h-4 text-emerald-400" />
            <span>الخريطة الذهنية التفاعلية</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {subView === 'comparisons' ? (
            <button
              type="button"
              onClick={fetchComparisons}
              disabled={isLoadingComp}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingComp ? 'animate-spin' : ''}`} />
              <span>توليد/تحديث المقارنات</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={fetchMindMap}
                disabled={isLoadingMap}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMap ? 'animate-spin' : ''}`} />
                <span>تحديث الخريطة</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black cursor-pointer whitespace-nowrap no-print"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة الخريطة</span>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* VIEW 1: SMART COMPARISON TABLES */}
      {subView === 'comparisons' && (
        <div className="space-y-6">
          {isLoadingComp ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
              <p className="font-bold text-slate-900">جاري استخراج جداول المقارنة من المحاضرة...</p>
            </div>
          ) : !comparisonTables || comparisonTables.length === 0 ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2 text-slate-500 text-sm">
              <Table2 className="w-8 h-8 mx-auto text-slate-400" />
              <p className="font-bold text-slate-800">لا توجد عناصر متقابلة واضحة للمقارنة في هذه المحاضرة</p>
              <p className="text-xs">
                حرصاً على الدقة، لا يختلق النظام مقارنات إذا لم تتضمن المحاضرة مفهومين أو قاعدتين للمقارنة.
              </p>
            </div>
          ) : (
            comparisonTables.map((tbl, idx) => (
              <div
                key={tbl.id || idx}
                className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-black text-base sm:text-lg text-slate-900">{tbl.title}</h4>
                    {tbl.sourceRef && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 mt-0.5">
                        <MapPin className="w-3 h-3" />
                        <span>المصدر: {tbl.sourceRef}</span>
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyTableAsText(tbl)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold cursor-pointer self-start sm:self-auto"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ الجدول</span>
                  </button>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-right text-xs sm:text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        {tbl.columns.map((col, cIdx) => (
                          <th key={cIdx} className="p-3.5 font-bold border-l border-slate-700 last:border-l-0 whitespace-nowrap">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tbl.rows.map((row, rIdx) => (
                        <tr
                          key={rIdx}
                          className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'}
                        >
                          {tbl.columns.map((_, cIdx) => (
                            <td
                              key={cIdx}
                              dir="auto"
                              className="p-3.5 border-t border-l border-slate-200 last:border-l-0 text-slate-800 align-top leading-relaxed"
                            >
                              {row[cIdx] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {tbl.missingDetailsNote && (
                  <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                    <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>ملاحظة الدقة:</strong> {tbl.missingDetailsNote}
                    </span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* VIEW 2: INTERACTIVE RTL MIND MAP */}
      {subView === 'mindmap' && (
        <div className="space-y-6">
          {isLoadingMap ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin mx-auto" />
              <p className="font-bold text-slate-900">جاري رسم الخريطة الذهنية للمحاضرة...</p>
            </div>
          ) : !mindMap ? (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
              اضغط على «تحديث الخريطة» لتوليد الخريطة الذهنية.
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <h4 className="font-black text-lg text-slate-900">الخريطة الذهنية التفاعلية</h4>
                  <p className="text-xs text-slate-500">
                    تمثيل هرمي للأفكار والأقسام الفعلية داخل المحاضرة من اليمين إلى اليسار.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyMindMapText(mindMap)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold cursor-pointer self-start sm:self-auto"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>نسخ المخطط النصي</span>
                </button>
              </div>

              {/* Central Node */}
              <div className="flex flex-col items-center space-y-6">
                <div className="px-7 py-4 rounded-3xl bg-slate-900 text-white shadow-lg border-2 border-emerald-500 text-center max-w-md">
                  <span className="text-[11px] font-bold text-emerald-400 block mb-0.5">
                    الموضوع الرئيسي للمحاضرة
                  </span>
                  <h5 className="text-base sm:text-xl font-black">{mindMap.centralTopic}</h5>
                </div>

                {/* Vertical trunk line */}
                <div className="w-0.5 h-6 bg-emerald-400" />

                {/* Branches Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
                  {mindMap.branches.map((branch, bIdx) => {
                    const bId = branch.id || String(bIdx);
                    const isCollapsed = Boolean(collapsedBranches[bId]);

                    return (
                      <div
                        key={bId}
                        className="rounded-3xl border-2 border-slate-200 bg-slate-50/70 p-5 space-y-3 relative hover:border-emerald-400 transition"
                      >
                        <button
                          type="button"
                          onClick={() => toggleBranch(bId)}
                          className="w-full flex items-center justify-between gap-2 text-right cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-7 h-7 rounded-xl bg-emerald-600 text-white text-xs font-black flex items-center justify-center shrink-0 tabular-nums">
                              {bIdx + 1}
                            </span>
                            <div>
                              <h6 className="font-extrabold text-sm sm:text-base text-slate-900">
                                {branch.title}
                              </h6>
                              {branch.sourceRef && (
                                <span className="text-[10px] text-emerald-700 font-semibold block">
                                  {branch.sourceRef}
                                </span>
                              )}
                            </div>
                          </div>
                          {isCollapsed ? (
                            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                          ) : (
                            <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
                          )}
                        </button>

                        {!isCollapsed && (
                          <div className="space-y-2.5 pt-2 border-t border-slate-200/80 pr-3 border-r-2 border-r-emerald-400">
                            {branch.children.map((child, cIdx) => (
                              <div
                                key={cIdx}
                                className="bg-white p-3 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1"
                              >
                                <div className="font-bold text-xs sm:text-sm text-slate-900" dir="auto">
                                  {child.title}
                                </div>
                                {child.details && (
                                  <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed" dir="auto">
                                    {child.details}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
