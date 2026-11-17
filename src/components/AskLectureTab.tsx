import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquareText,
  Send,
  Sparkles,
  AlertTriangle,
  Info,
  MapPin,
  Trash2,
  Bot,
  User,
} from 'lucide-react';
import { ChatMessage } from '../types';

interface AskLectureTabProps {
  lectureText: string;
  arabicTranslation: string;
  lectureTitle: string;
}

const STARTER_QUESTIONS = [
  'ما الفكرة الرئيسية لهذه المحاضرة؟',
  'اشرح القاعدة أو الفكرة الأساسية بالعربية المبسطة',
  'ما الفرق بين المفاهيم الواردة في الدرس؟',
  'أعطني مثالاً مذكوراً في المحاضرة',
  'ما أهم النقاط التي يجب حفظها للامتحان؟',
];

export const AskLectureTab: React.FC<AskLectureTabProps> = ({
  lectureText,
  arabicTranslation,
  lectureTitle,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isSending]);

  const sendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || isSending) return;

    setError(null);
    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setIsSending(true);

    try {
      const response = await fetch('/api/ask-lecture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          lectureText,
          arabicTranslation,
          lectureTitle,
          history: nextHistory.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const json = await response.json();
      if (!response.ok || !json.success || !json.reply) {
        throw new Error(json.error || 'تعذر الحصول على إجابة من مساعد المحاضرة.');
      }

      const botMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: 'assistant',
        content: json.reply.answer,
        additionalExplanation: json.reply.additionalExplanation,
        sourceRef: json.reply.sourceRef,
        notFoundInLecture: json.reply.notFoundInLecture,
        timestamp: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: any) {
      setError(err?.message || 'حدث خطأ أثناء الاتصال بمساعد المحاضرة.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 text-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
            <MessageSquareText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base sm:text-lg">اسأل محاضرتك</h3>
            <p className="text-xs text-slate-300">
              مساعد ذكي مقيد حصراً بمحتوى محاضرتك الحالية — يخبرك بوضوح إذا لم ترد المعلومة في الورقة.
            </p>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 cursor-pointer self-start sm:self-auto whitespace-nowrap"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>محادثة جديدة</span>
          </button>
        )}
      </div>

      {/* Starter Prompts */}
      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-slate-500 ml-1">أسئلة سريعة:</span>
        {STARTER_QUESTIONS.map((q, i) => (
          <button
            key={i}
            type="button"
            disabled={isSending}
            onClick={() => sendQuestion(q)}
            className="px-3 py-1.5 rounded-xl bg-white hover:bg-emerald-50 border border-slate-200 hover:border-emerald-400 text-xs font-semibold text-slate-700 hover:text-emerald-800 transition cursor-pointer"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Chat Thread */}
      <div className="p-5 sm:p-6 space-y-4 min-h-[320px] max-h-[520px] overflow-y-auto bg-white">
        {messages.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center">
              <Sparkles className="w-7 h-7" />
            </div>
            <h4 className="font-bold text-slate-900">اطرح أي سؤال حول «{lectureTitle || 'المحاضرة'}»</h4>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              سأجيبك اعتماداً على النص المستخرج (بما فيه تعديلاتك) والترجمة. وإذا كانت المعلومة غير موجودة في المحاضرة سأوضح ذلك دون تخمين.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                  msg.role === 'user'
                    ? 'bg-slate-900 text-white'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[85%] rounded-2xl p-4 space-y-2.5 text-sm ${
                  msg.role === 'user'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-800'
                }`}
              >
                {msg.notFoundInLecture && (
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-xl">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>هذه المعلومة غير واردة في نص المحاضرة المرفوعة</span>
                  </div>
                )}

                <p className="leading-relaxed whitespace-pre-wrap" dir="auto">
                  {msg.content}
                </p>

                {msg.additionalExplanation && (
                  <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-950 text-xs space-y-0.5">
                    <span className="font-bold flex items-center gap-1">
                      <Info className="w-3.5 h-3.5 text-blue-600" />
                      <span>توضيح إضافي مساعد:</span>
                    </span>
                    <p className="leading-relaxed">{msg.additionalExplanation}</p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 text-[11px] opacity-75 pt-0.5">
                  {msg.sourceRef ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                      <MapPin className="w-3 h-3" />
                      <span>المصدر: {msg.sourceRef}</span>
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="tabular-nums">{msg.timestamp}</span>
                </div>
              </div>
            </div>
          ))
        )}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold px-2">
            <Sparkles className="w-4 h-4 text-emerald-600 animate-pulse" />
            <span>جاري البحث في محتوى المحاضرة وصياغة الإجابة...</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendQuestion(input);
        }}
        className="p-4 bg-slate-50 border-t border-slate-200 flex items-center gap-2.5"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isSending}
          placeholder="اكتب سؤالك عن هذه المحاضرة..."
          className="flex-1 px-4 py-3 rounded-2xl bg-white border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm text-slate-900"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="px-5 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-300 text-slate-950 font-black text-sm flex items-center gap-2 transition cursor-pointer whitespace-nowrap"
        >
          <Send className="w-4 h-4" />
          <span>إرسال</span>
        </button>
      </form>
    </div>
  );
};
