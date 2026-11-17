import { jsPDF } from 'jspdf';
import { AnalysisData, RevisionSheetData } from '../types';

/**
 * High-DPI Canvas-to-PDF renderer with native browser Arabic RTL shaping,
 * Turkish LTR segments, structured tables, and zero oklch/font-garbling issues.
 */

const PAGE_W_PX = 1240; // A4 @ ~150 DPI
const PAGE_H_PX = 1754;
const MARGIN = 72;
const CONTENT_W = PAGE_W_PX - MARGIN * 2;

interface PageCanvasBuilder {
  pages: HTMLCanvasElement[];
  ctx: CanvasRenderingContext2D;
  y: number;
  addPage: () => void;
  ensureSpace: (neededPx: number) => void;
}

function createBuilder(headerTitle: string, headerSubtitle: string): PageCanvasBuilder {
  const pages: HTMLCanvasElement[] = [];
  let currentCanvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let y = 0;

  const initPage = (isFirst: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W_PX;
    canvas.height = PAGE_H_PX;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PAGE_W_PX, PAGE_H_PX);

    if (isFirst) {
      // Navy Header Banner
      context.fillStyle = '#0f172a';
      context.fillRect(0, 0, PAGE_W_PX, 150);

      context.direction = 'rtl';
      context.textAlign = 'right';
      context.fillStyle = '#ffffff';
      context.font = '900 34px Cairo, Tajawal, sans-serif';
      context.fillText(headerTitle, PAGE_W_PX - MARGIN, 68);

      context.fillStyle = '#34d399';
      context.font = '700 20px Cairo, Tajawal, sans-serif';
      context.fillText(headerSubtitle, PAGE_W_PX - MARGIN, 110);

      context.direction = 'ltr';
      context.textAlign = 'left';
      context.fillStyle = '#94a3b8';
      context.font = '600 18px "Plus Jakarta Sans", sans-serif';
      const dateStr = new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      context.fillText(`Wara2ty – ورقتي | ${dateStr}`, MARGIN, 86);
      y = 195;
    } else {
      // Compact top bar on subsequent pages
      context.fillStyle = '#f8fafc';
      context.fillRect(0, 0, PAGE_W_PX, 64);
      context.fillStyle = '#e2e8f0';
      context.fillRect(0, 64, PAGE_W_PX, 2);

      context.direction = 'rtl';
      context.textAlign = 'right';
      context.fillStyle = '#475569';
      context.font = '700 18px Cairo, Tajawal, sans-serif';
      context.fillText(headerTitle, PAGE_W_PX - MARGIN, 42);
      y = 105;
    }

    pages.push(canvas);
    currentCanvas = canvas;
    ctx = context;
  };

  initPage(true);

  const builder: PageCanvasBuilder = {
    pages,
    get ctx() {
      return ctx;
    },
    get y() {
      return y;
    },
    set y(val: number) {
      y = val;
    },
    addPage: () => initPage(false),
    ensureSpace: (neededPx: number) => {
      if (y + neededPx > PAGE_H_PX - 80) {
        initPage(false);
      }
    },
  };

  return builder;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string
): string[] {
  ctx.font = font;
  const paragraphs = String(text || '').split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }
    const words = trimmed.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

function drawSectionHeading(b: PageCanvasBuilder, title: string) {
  b.ensureSpace(65);
  const ctx = b.ctx;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(PAGE_W_PX - MARGIN - 8, b.y - 24, 8, 32);

  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 26px Cairo, Tajawal, sans-serif';
  ctx.fillText(title, PAGE_W_PX - MARGIN - 20, b.y);
  b.y += 20;

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(MARGIN, b.y, CONTENT_W, 2);
  b.y += 28;
}

function drawRtlParagraph(
  b: PageCanvasBuilder,
  text: string,
  options?: { font?: string; color?: string; lineHeight?: number; indent?: number }
) {
  const font = options?.font || '500 20px Cairo, Tajawal, sans-serif';
  const color = options?.color || '#1e293b';
  const lineHeight = options?.lineHeight || 32;
  const indent = options?.indent || 0;
  const lines = wrapLines(b.ctx, text, CONTENT_W - indent, font);

  for (const line of lines) {
    b.ensureSpace(lineHeight + 10);
    if (line === '') {
      b.y += Math.round(lineHeight * 0.5);
      continue;
    }
    const ctx = b.ctx;
    const isMostlyLatin =
      (line.match(/[a-zA-Z]/g)?.length || 0) > (line.match(/[\u0600-\u06FF]/g)?.length || 0) * 1.5;

    ctx.font = font;
    ctx.fillStyle = color;
    if (isMostlyLatin) {
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillText(line, MARGIN + indent, b.y);
    } else {
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillText(line, PAGE_W_PX - MARGIN - indent, b.y);
    }
    b.y += lineHeight;
  }
}

function drawTable(
  b: PageCanvasBuilder,
  title: string,
  headers: string[],
  rows: string[][]
) {
  if (!headers.length) return;
  drawSectionHeading(b, title);

  const colCount = headers.length;
  const colW = Math.floor(CONTENT_W / colCount);
  const cellPad = 12;
  const fontHeader = '700 17px Cairo, Tajawal, sans-serif';
  const fontCell = '500 16px Cairo, Tajawal, sans-serif';

  // Header row (RTL: first column on right)
  b.ensureSpace(58);
  const ctxH = b.ctx;
  ctxH.fillStyle = '#0f172a';
  ctxH.fillRect(MARGIN, b.y, CONTENT_W, 44);
  ctxH.direction = 'rtl';
  ctxH.textAlign = 'right';
  ctxH.fillStyle = '#ffffff';
  ctxH.font = fontHeader;

  headers.forEach((h, colIdx) => {
    const cellRight = PAGE_W_PX - MARGIN - colIdx * colW;
    const clipped = wrapLines(ctxH, h, colW - cellPad * 2, fontHeader)[0] || '';
    ctxH.fillText(clipped, cellRight - cellPad, b.y + 28);
  });
  b.y += 44;

  // Data rows
  rows.forEach((row, rIdx) => {
    const wrappedPerCol = headers.map((_, cIdx) =>
      wrapLines(b.ctx, String(row[cIdx] ?? '—'), colW - cellPad * 2, fontCell)
    );
    const maxLines = Math.max(1, ...wrappedPerCol.map((w) => w.length));
    const rowH = maxLines * 24 + 20;

    b.ensureSpace(rowH + 8);
    const ctx = b.ctx;
    ctx.fillStyle = rIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
    ctx.fillRect(MARGIN, b.y, CONTENT_W, rowH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(MARGIN, b.y, CONTENT_W, rowH);

    headers.forEach((_, colIdx) => {
      const cellRight = PAGE_W_PX - MARGIN - colIdx * colW;
      if (colIdx > 0) {
        ctx.beginPath();
        ctx.moveTo(cellRight, b.y);
        ctx.lineTo(cellRight, b.y + rowH);
        ctx.stroke();
      }
      ctx.fillStyle = '#1e293b';
      ctx.font = fontCell;
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      wrappedPerCol[colIdx].forEach((ln, lIdx) => {
        ctx.fillText(ln, cellRight - cellPad, b.y + 24 + lIdx * 24);
      });
    });

    b.y += rowH;
  });

  b.y += 24;
}

function finalizePdf(b: PageCanvasBuilder, fileName: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pdfW = doc.internal.pageSize.getWidth();
  const pdfH = doc.internal.pageSize.getHeight();
  const total = b.pages.length;

  b.pages.forEach((canvas, idx) => {
    const ctx = canvas.getContext('2d')!;
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 16px Cairo, Tajawal, sans-serif';
    ctx.fillText(`ورقتي – Wara2ty | صفحة ${idx + 1} من ${total}`, PAGE_W_PX / 2, PAGE_H_PX - 30);

    if (idx > 0) doc.addPage();
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    doc.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);
  });

  doc.save(fileName);
}

export function exportStudyMaterialToPDF(data: AnalysisData, _titleName: string = 'ملخص_ورقتي_الدراسي') {
  try {
    const b = createBuilder(
      data.summary?.title || 'ملخص المحاضرة الدراسية',
      `اللغة: ${data.detectedLanguage} · الوضوح: ${data.clarityScore} · عدد الصفحات: ${data.pageCount || 1}`
    );

    // 1. Overview & Key Points
    drawSectionHeading(b, '1. ملخص المحاضرة والنقاط الأساسية');
    drawRtlParagraph(b, data.summary.overview, { font: '600 21px Cairo, Tajawal, sans-serif' });
    b.y += 12;

    data.summary.keyPoints.forEach((pt, i) => {
      drawRtlParagraph(b, `${i + 1}. ${pt}`, { indent: 16 });
      b.y += 4;
    });

    if (data.summary.examTip) {
      b.y += 8;
      drawRtlParagraph(b, `★ نصيحة للامتحان: ${data.summary.examTip}`, {
        font: '700 20px Cairo, Tajawal, sans-serif',
        color: '#047857',
      });
    }
    b.y += 22;

    // 2. Extracted Tables (Feature 10)
    if (data.tables && data.tables.length > 0) {
      data.tables.forEach((tbl) => {
        drawTable(b, `جدول مستخرج: ${tbl.title}`, tbl.headers, tbl.rows);
      });
    }

    // 3. Smart Comparisons (Feature 4)
    if (data.comparisonTables && data.comparisonTables.length > 0) {
      data.comparisonTables.forEach((tbl) => {
        drawTable(b, `جدول مقارنة ذكي: ${tbl.title}`, tbl.columns, tbl.rows);
      });
    }

    // 4. Arabic Translation
    if (data.arabicTranslation) {
      drawSectionHeading(b, '2. الترجمة العربية الأكاديمية');
      drawRtlParagraph(b, data.arabicTranslation.slice(0, 5000));
      b.y += 20;
    }

    // 5. Vocabulary
    if (data.vocabulary && data.vocabulary.length > 0) {
      const vocabRows = data.vocabulary.slice(0, 20).map((v) => [
        v.word,
        v.meaning,
        v.wordType || '—',
        v.context || '—',
      ]);
      drawTable(b, '3. معجم المفردات والمصطلحات', ['الكلمة', 'المعنى بالعربية', 'النوع', 'السياق'], vocabRows);
    }

    // 6. Quiz
    if (data.quiz && data.quiz.length > 0) {
      drawSectionHeading(b, '4. الأسئلة التدريبية');
      data.quiz.forEach((q, idx) => {
        drawRtlParagraph(b, `س${idx + 1}: ${q.question}`, {
          font: '700 20px Cairo, Tajawal, sans-serif',
          color: '#0f172a',
        });
        q.options.forEach((opt, optIdx) => {
          const mark = optIdx === q.correctIndex ? '✓ [صحيح]' : '○';
          drawRtlParagraph(b, `${mark} ${opt}`, {
            indent: 24,
            color: optIdx === q.correctIndex ? '#047857' : '#475569',
            font: optIdx === q.correctIndex ? '700 18px Cairo, sans-serif' : '500 18px Cairo, sans-serif',
          });
        });
        drawRtlParagraph(b, `التفسير: ${q.explanation}`, {
          indent: 24,
          font: '500 17px Cairo, sans-serif',
          color: '#64748b',
        });
        b.y += 12;
      });
    }

    const sanitizedTitle = (data.summary.title || 'Wara2ty_Study_Notes')
      .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')
      .substring(0, 32);
    finalizePdf(b, `${sanitizedTitle}_Wara2ty.pdf`);
    return true;
  } catch (err) {
    console.error('Error generating RTL PDF, falling back to print:', err);
    window.print();
    return false;
  }
}

export function exportRevisionSheetToPDF(sheet: RevisionSheetData, lectureTitle: string) {
  try {
    const b = createBuilder(
      `ورقة المراجعة النهائية: ${sheet.title || lectureTitle}`,
      'ملخص مكثف قبل الامتحان — Wara2ty'
    );

    drawSectionHeading(b, 'الأفكار الرئيسية');
    sheet.mainIdeas.forEach((idea, i) => drawRtlParagraph(b, `${i + 1}. ${idea}`, { indent: 14 }));
    b.y += 16;

    if (sheet.definitions?.length) {
      drawTable(
        b,
        'التعريفات الأساسية',
        ['المصطلح', 'التعريف', 'المرجع'],
        sheet.definitions.map((d) => [d.term, d.definition, d.sourceRef || 'من المحاضرة'])
      );
    }

    if (sheet.importantRules?.length) {
      drawSectionHeading(b, 'القواعد المهمة');
      sheet.importantRules.forEach((r) => drawRtlParagraph(b, `• ${r}`, { indent: 14 }));
      b.y += 16;
    }

    if (sheet.keyExamples?.length) {
      drawSectionHeading(b, 'أبرز الأمثلة');
      sheet.keyExamples.forEach((ex) => drawRtlParagraph(b, `• ${ex}`, { indent: 14 }));
      b.y += 16;
    }

    if (sheet.comparisons?.length) {
      drawTable(
        b,
        'مقارنات سريعة',
        ['العنصر الأول', 'العنصر الثاني', 'الفرق الأساسي'],
        sheet.comparisons.map((c) => [c.itemA, c.itemB, c.difference])
      );
    }

    if (sheet.watchOutPoints?.length) {
      drawSectionHeading(b, 'نقاط تستحق انتباهاً إضافياً');
      sheet.watchOutPoints.forEach((w) =>
        drawRtlParagraph(b, `⚠ ${w}`, { indent: 14, color: '#b45309' })
      );
      b.y += 16;
    }

    if (sheet.checklist?.length) {
      drawSectionHeading(b, 'قائمة المراجعة السريعة');
      sheet.checklist.forEach((c) => drawRtlParagraph(b, `☐ ${c}`, { indent: 14 }));
    }

    const sanitizedTitle = (sheet.title || lectureTitle || 'Revision_Sheet')
      .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')
      .substring(0, 32);
    finalizePdf(b, `${sanitizedTitle}_Revision_Wara2ty.pdf`);
    return true;
  } catch (err) {
    console.error('Error generating Revision Sheet PDF:', err);
    window.print();
    return false;
  }
}
