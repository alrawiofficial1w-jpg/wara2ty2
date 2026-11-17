import React, { useState, useEffect } from 'react';
import {
  Search,
  Copy,
  Volume2,
  Bookmark,
  CheckCircle2,
  Sparkles,
  BookOpen,
  MapPin,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { VocabItem } from '../types';
import { loadSavedVocabulary, toggleSaveVocabWord } from '../utils/storage';
import { speakWordWithOfficialTts, stopSpeech } from '../utils/speech';

interface VocabularyTabProps {
  vocabulary: VocabItem[];
  lectureText: string;
  detectedLanguage?: string;
  onCopy: (text: string, label: string) => void;
}

export const VocabularyTab: React.FC<VocabularyTabProps> = ({
  vocabulary = [],
  lectureText,
  detectedLanguage,
  onCopy,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'saved' | 'verified'>('all');
  const [savedWords, setSavedWords] = useState<VocabItem[]>([]);
  const [audioWarning, setAudioWarning] = useState<string | null>(null);
  const [speakingWord, setSpeakingWord] = useState<string | null>(null);

  // Live Turkish–Arabic dictionary lookup state
  const [dictQuery, setDictQuery] = useState<string>('');
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);
  const [lookupResult, setLookupResult] = useState<VocabItem | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    setSavedWords(loadSavedVocabulary());
    return () => {
      stopSpeech();
    };
  }, []);

  const isSaved = (word: string) =>
    savedWords.some((s) => s.word.toLowerCase() === word.toLowerCase());

  const handleToggleSave = (item: VocabItem) => {
    const { saved } = toggleSaveVocabWord(item);
    setSavedWords(saved);
  };

  const handleSpeak = async (word: string) => {
    if (speakingWord === word) return;
    setAudioWarning(null);
    setSpeakingWord(word);
    const res = await speakWordWithOfficialTts(word, 'auto', undefined, detectedLanguage, () => {
      setSpeakingWord((curr) => (curr === word ? null : curr));
    });
    if (!res.started) {
      setSpeakingWord((curr) => (curr === word ? null : curr));
      if (res.warning) {
        setAudioWarning(res.warning);
      }
    }
  };

  const handleDictionaryLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = dictQuery.trim();
    if (!trimmed) return;

    setIsLookingUp(true);
    setLookupError(null);
    setLookupResult(null);

    try {
      const response = await fetch('/api/dictionary/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: trimmed, lectureContext: lectureText }),
      });
      const json = await response.json();
      if (!response.ok || !json.success || !json.entry) {
        throw new Error(json.error || 'تعذر البحث عن الكلمة.');
      }
      setLookupResult(json.entry);
    } catch (err: any) {
      setLookupError(err?.message || 'حدث خطأ أثناء البحث في المعجم.');
    } finally {
      setIsLookingUp(false);
    }
  };

  const sourceList = filterMode === 'saved' ? savedWords : vocabulary;
  const filteredVocab = sourceList.filter((item) => {
    if (filterMode === 'verified' && item.sourceType !== 'dictionary_verified') return false;
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      item.word.toLowerCase().includes(q) ||
      item.meaning.toLowerCase().includes(q) ||
      (item.context && item.context.toLowerCase().includes(q))
    );
  });

  const renderVocabCard = (item: VocabItem, idx: number) => {
    const saved = isSaved(item.word);
    const isVerified = item.sourceType === 'dictionary_verified';

    return (
      <div
        key={`${item.word}-${idx}`}
        className="p-5 rounded-2xl bg-slate-50 border border-slate-200 hover:border-emerald-300 transition-all space-y-3 group"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                dir="ltr"
                className="text-lg font-black text-slate-900 tracking-wide group-hover:text-emerald-700 transition"
              >
                {item.word}
              </span>
              {item.wordType && (
                <span className="text-[11px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-lg">
                  {item.wordType}
                </span>
              )}
            </div>

            <span className="text-sm sm:text-base font-bold text-emerald-700 block">
              {item.meaning}
            </span>

            {item.additionalMeanings && item.additionalMeanings.length > 0 && (
              <p className="text-xs text-slate-600">
                <strong className="text-slate-700">معانٍ أخرى: </strong>
                {item.additionalMeanings.join(' · ')}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleSpeak(item.word)}
              disabled={speakingWord === item.word}
              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-emerald-600 hover:border-emerald-300 transition shadow-sm cursor-pointer disabled:opacity-70"
              title="استمع للنطق الصوتي"
            >
              {speakingWord === item.word ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleToggleSave(item)}
              className={`p-2 rounded-xl border transition shadow-sm cursor-pointer ${
                saved
                  ? 'bg-amber-50 border-amber-300 text-amber-600'
                  : 'bg-white border-slate-200 text-slate-500 hover:text-amber-600'
              }`}
              title={saved ? 'إزالة من المحفوظات' : 'حفظ الكلمة للمراجعة'}
            >
              <Bookmark className={`w-4 h-4 ${saved ? 'fill-amber-500' : ''}`} />
            </button>
          </div>
        </div>

        {item.grammarInfo && (
          <div className="text-xs text-slate-700 bg-white px-3 py-2 rounded-xl border border-slate-200/80">
            <strong className="text-slate-900">معلومات صرفية ولواحق: </strong>
            <span>{item.grammarInfo}</span>
          </div>
        )}

        {item.context && (
          <div className="text-xs text-slate-600 pt-1 border-t border-slate-200/60 leading-relaxed">
            <strong className="text-slate-700">السياق في المحاضرة: </strong>
            <span>{item.context}</span>
          </div>
        )}

        {item.example && (
          <div dir="auto" className="text-xs text-slate-700 bg-emerald-50/50 border border-emerald-100 px-3 py-2 rounded-xl">
            <strong className="text-emerald-800">مثال: </strong>
            <span>{item.example}</span>
          </div>
        )}

        {/* Source verification & lecture traceability */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
          <span
            className={`inline-flex items-center gap-1 font-semibold ${
              isVerified ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            {isVerified ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>موثّق من بيانات المعجم ({item.dictionarySource || 'Kaikki'})</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                <span>ترجمة سياقية من المحاضرة (AI)</span>
              </>
            )}
          </span>

          {item.sourceRef && (
            <span className="inline-flex items-center gap-1 text-slate-500">
              <MapPin className="w-3 h-3 text-emerald-600" />
              <span>{item.sourceRef}</span>
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Direct Turkish-Arabic Dictionary Search Card */}
      <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-base sm:text-lg flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-400" />
              <span>البحث الفوري في المعجم التركي–العربي</span>
            </h3>
            <p className="text-xs text-slate-300 mt-0.5">
              ابحث عن أي كلمة تركية من المحاضرة عبر محول بيانات المعجم (Kaikki/Wiktionary) مع توضيح السياق.
            </p>
          </div>
        </div>

        <form onSubmit={handleDictionaryLookup} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            dir="auto"
            value={dictQuery}
            onChange={(e) => setDictQuery(e.target.value)}
            placeholder="أدخل كلمة تركية للبحث (مثلاً: gelecek zaman, ek, sindirim)..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <button
            type="submit"
            disabled={isLookingUp || !dictQuery.trim()}
            className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 disabled:text-slate-400 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap"
          >
            {isLookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>بحث في المعجم</span>
          </button>
        </form>

        {lookupError && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-400/30 text-rose-200 text-xs">
            {lookupError}
          </div>
        )}

        {lookupResult && (
          <div className="bg-white text-slate-900 rounded-2xl p-1">
            {renderVocabCard(lookupResult, 999)}
          </div>
        )}
      </div>

      {/* Audio Warning */}
      {audioWarning && (
        <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{audioWarning}</span>
        </div>
      )}

      {/* Main Extracted Vocabulary List */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="space-y-1">
            <h3 className="font-bold text-lg text-slate-900">معجم المفردات والمصطلحات الأكاديمية</h3>
            <p className="text-xs text-slate-500">
              يُفرّق المعجم بشفافية بين المداخل الموثقة من قاعدة بيانات المعجم والترجمة السياقية بالذكاء الاصطناعي.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="تصفية مفردات الدرس..."
                className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                const vocabText = vocabulary.map((v) => `${v.word} : ${v.meaning}`).join('\n');
                onCopy(vocabText, 'المفردات');
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold whitespace-nowrap transition cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>نسخ القائمة</span>
            </button>
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold tabular-nums">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-3.5 py-1.5 rounded-xl transition cursor-pointer ${
              filterMode === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            مفردات المحاضرة ({vocabulary.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('verified')}
            className={`px-3.5 py-1.5 rounded-xl transition cursor-pointer ${
              filterMode === 'verified'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            موثّق من المعجم ({vocabulary.filter((v) => v.sourceType === 'dictionary_verified').length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('saved')}
            className={`px-3.5 py-1.5 rounded-xl transition cursor-pointer ${
              filterMode === 'saved'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
            }`}
          >
            المفردات المحفوظة ({savedWords.length})
          </button>
        </div>

        {filteredVocab.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">
            {filterMode === 'saved'
              ? 'لم تحفظ أي مفردات بعد. اضغط على أيقونة الحفظ بجانب أي كلمة لإضافتها هنا.'
              : 'لا توجد مصطلحات مطابقة لبحثك.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredVocab.map((item, idx) => renderVocabCard(item, idx))}
          </div>
        )}
      </div>
    </div>
  );
};
