import { SampleNote, UploadedPageInput } from '../types';

/**
 * Generates canvas-rendered lecture note images (including multi-page, tables, and visual diagrams)
 * to serve as authentic test inputs.
 */
function createLectureNoteCanvas(
  title: string,
  subTitle: string,
  date: string,
  lines: string[],
  highlightIndexes: number[] = [],
  marginNote: string = '',
  extras?: {
    timelineDiagram?: boolean;
    tensesTable?: boolean;
  }
): string {
  if (typeof document === 'undefined') return '';

  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Paper background
  ctx.fillStyle = '#faf8f5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Classic red notebook margin
  ctx.strokeStyle = '#fca5a5';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(110, 0);
  ctx.lineTo(110, canvas.height);
  ctx.stroke();

  // Horizontal notebook lines
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  const lineSpacing = 36;
  const startY = 160;
  for (let y = startY; y < canvas.height - 40; y += lineSpacing) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Navy header banner
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(40, 45, 820, 85);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 25px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 65, 85);

  ctx.fillStyle = '#34d399';
  ctx.font = '16px sans-serif';
  ctx.fillText(subTitle, 65, 112);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(date, 830, 85);

  if (marginNote) {
    ctx.save();
    ctx.translate(55, 420);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'italic bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`★ ${marginNote}`, 0, 0);
    ctx.restore();
  }

  ctx.textAlign = 'left';
  let curY = startY + 28;

  lines.forEach((line, index) => {
    if (highlightIndexes.includes(index)) {
      ctx.fillStyle = 'rgba(52, 211, 153, 0.25)';
      ctx.fillRect(130, curY - 22, 700, 30);
    }

    if (line.startsWith('## ')) {
      ctx.fillStyle = '#1e3a8a';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText(line.replace('## ', ''), 135, curY);
    } else if (line.startsWith('# ')) {
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(line.replace('# ', ''), 135, curY);
    } else if (line.startsWith('• ') || line.startsWith('- ')) {
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(145, curY - 6, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#1e293b';
      ctx.font = '17px sans-serif';
      ctx.fillText(line.substring(2), 165, curY);
    } else if (line.startsWith('> ')) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(135, curY - 24, 690, 32);
      ctx.strokeStyle = '#059669';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(135, curY - 24);
      ctx.lineTo(135, curY + 8);
      ctx.stroke();

      ctx.fillStyle = '#065f46';
      ctx.font = 'italic bold 16px sans-serif';
      ctx.fillText(line.replace('> ', ''), 155, curY);
    } else {
      ctx.fillStyle = '#334155';
      ctx.font = '17px sans-serif';
      ctx.fillText(line, 135, curY);
    }

    curY += lineSpacing;
  });

  // Optional visual timeline diagram for Turkish Tenses Page 1
  if (extras?.timelineDiagram) {
    const diagY = 890;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.fillRect(135, diagY, 700, 230);
    ctx.strokeRect(135, diagY, 700, 230);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('ZAMAN ÇİZELGESİ DİYAGRAMI (Timeline of Turkish Tenses)', 155, diagY + 32);

    // Horizontal axis arrow
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(175, diagY + 115);
    ctx.lineTo(795, diagY + 115);
    ctx.stroke();

    // Nodes: Geçmiş -> Şimdiki -> Geniş -> Gelecek
    const nodes = [
      { x: 225, title: 'Geçmiş Zaman', sub: '-DI / -mIş (Dün)', color: '#1e3a8a' },
      { x: 405, title: 'Şimdiki Zaman', sub: '-(I)yor (Şimdi)', color: '#059669' },
      { x: 585, title: 'Geniş Zaman', sub: '-(A/I)r (Her gün)', color: '#0f172a' },
      { x: 745, title: 'Gelecek Zaman', sub: '-AcAk (Yarın)', color: '#0d9488' },
    ];

    nodes.forEach((n) => {
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(n.x, diagY + 115, 11, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = n.color;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(n.title, n.x, diagY + 86);

      ctx.fillStyle = '#475569';
      ctx.font = '13px sans-serif';
      ctx.fillText(n.sub, n.x, diagY + 148);
    });

    ctx.textAlign = 'left';
    ctx.fillStyle = '#334155';
    ctx.font = 'italic 14px sans-serif';
    ctx.fillText('Not: Geniş zaman tüm zamanları (geçmiş, şimdi, gelecek) kapsayan alışkanlıkları gösterir.', 155, diagY + 200);
  }

  // Optional structured comparison table for Turkish Tenses Page 2
  if (extras?.tensesTable) {
    const tblY = 760;
    const cols = [135, 300, 465, 650, 835];
    const rowH = 58;
    const tableRows = [
      ['Zaman Kipı', 'Ek (Suffix)', 'Olumsuz (Neg.)', 'Örnek (Gel-mek)'],
      ['Geniş Zaman', '-r / -ar / -er / -ır', '-maz / -mez', 'Gelir / Gelmez'],
      ['Geçmiş (-DI)', '-dı / -di / -du / -dü', '-madı / -medi', 'Geldi / Gelmedi'],
      ['Şimdiki Zaman', '-ıyor / -iyor / -uyor', '-mıyor / -miyor', 'Geliyor / Gelmiyor'],
      ['Gelecek Zaman', '-acak / -ecek', '-mayacak / -meyecek', 'Gelecek / Gelmeyecek'],
    ];

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('TABLO: Türkçede Temel Zamanların Karşılaştırması', 135, tblY - 14);

    tableRows.forEach((row, rIdx) => {
      const y = tblY + rIdx * rowH;
      ctx.fillStyle = rIdx === 0 ? '#0f172a' : rIdx % 2 === 1 ? '#ffffff' : '#f1f5f9';
      ctx.fillRect(cols[0], y, cols[4] - cols[0], rowH);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cols[0], y, cols[4] - cols[0], rowH);

      row.forEach((cell, cIdx) => {
        if (cIdx > 0) {
          ctx.beginPath();
          ctx.moveTo(cols[cIdx], y);
          ctx.lineTo(cols[cIdx], y + rowH);
          ctx.stroke();
        }
        ctx.fillStyle = rIdx === 0 ? '#ffffff' : '#0f172a';
        ctx.font = rIdx === 0 ? 'bold 14px sans-serif' : '14px sans-serif';
        ctx.fillText(cell, cols[cIdx] + 10, y + 35);
      });
    });
  }

  return canvas.toDataURL('image/jpeg', 0.92);
}

export const SAMPLE_NOTES: SampleNote[] = [
  {
    id: 'turkish-tenses-multipage',
    title: 'الأزمنة في اللغة التركية (Türkçede Zamanlar) — محاضرة متعددة الصفحات',
    subject: 'قواعد اللغة التركية',
    language: 'التركية',
    badge: 'صفحتان · جدول + مخطط',
    description:
      'محاضرة شاملة من صفحتين تغطي Geniş و Geçmiş و Şimdiki و Gelecek Zaman مع جدول مقارنة ومخطط زمني توضيحي.',
    imageDataUrl: '',
    isMultiPage: true,
  },
  {
    id: 'turkish-grammar',
    title: 'قواعد اللغة التركية: الزمن الحاضر (Şimdiki Zaman)',
    subject: 'اللغة التركية وآدابها',
    language: 'التركية',
    badge: 'تركي - صفحة واحدة',
    description: 'ملاحظات محاضرة جامعية تشرح صياغة الزمن الحاضر في التركية مع اللواحق (-iyor) والأمثلة وقواعد التوافق الصوتي.',
    imageDataUrl: '',
  },
  {
    id: 'turkish-medical',
    title: 'مصطلحات طبية بالتركية: الجهاز الهضمي (Sindirim Sistemi)',
    subject: 'الطب والعلوم الصحية',
    language: 'التركية واللاتينية',
    badge: 'طبي - مصطلحات وتشريح',
    description: 'ملاحظات طالب طب في جامعة تركية تتضمن أعضاء الجهاز الهضمي ووظائفها ومصطلحات سريرية مترجمة.',
    imageDataUrl: '',
  },
  {
    id: 'turkish-history',
    title: 'التاريخ والأدب العثماني والتركي (Osmanlı ve Türk Edebiyatı)',
    subject: 'التاريخ الإنساني',
    language: 'التركية',
    badge: 'تاريخ وأدب',
    description: 'ملخص مكتوب لأبرز المراحل الأدبية والشعراء والمصطلحات التاريخية في العصر العثماني والحديث.',
    imageDataUrl: '',
  },
];

export function getSampleNotePages(id: string): UploadedPageInput[] {
  if (typeof document === 'undefined') return [];

  if (id === 'turkish-tenses-multipage') {
    const page1 = createLectureNoteCanvas(
      'TÜRKÇEDE ZAMANLAR – SAYFA 1 (BÖLÜM I)',
      'İstanbul Üniversitesi - Türkçe Dilbilgisi Dersi',
      'Sayfa 1 / 2 · Tarih: 20.11.2025',
      [
        '# Türkçede Temel Zaman Kipleri',
        'Fiillerin ne zaman gerçekleştiğini gösteren çekim eklerine zaman ekleri denir.',
        '',
        '## 1. Geniş Zaman (-r / -ar / -er / -ır / -ir / -ur / -ür):',
        '• Her zaman yapılan alışkanlıkları, genel doğruları ve doğa kanunlarını anlatır.',
        '> Örnek: Güneş doğudan doğar. / Her gün kitap okurum.',
        '• Olumsuz: -maz / -mez (Örnek: O kahve içmez).',
        '',
        '## 2. Şimdiki Zaman (-(I)yor):',
        '• Konuşma anında devam etmekte olan eylemleri bildirir.',
        '• Formül: Fiil Kökü + (ı/i/u/ü) + yor + Şahıs Eki',
        '> Örnek: Şu anda kütüphanede ders çalışıyorum.',
        '• Ünlü daralması: Bekle + yor -> Bekliyor (e harfi i olur).',
      ],
      [3, 8],
      'Sayfa 1 - Temel Zamanlar',
      { timelineDiagram: true }
    );

    const page2 = createLectureNoteCanvas(
      'TÜRKÇEDE ZAMANLAR – SAYFA 2 (BÖLÜM II)',
      'İstanbul Üniversitesi - Türkçe Dilbilgisi Dersi',
      'Sayfa 2 / 2 · Tarih: 20.11.2025',
      [
        '## 3. Geçmiş Zaman (Bilinen & Duyulan Geçmiş):',
        '• Belirli (Görülen) Geçmiş Zaman (-dı / -di / -du / -dü / -tı / -ti):',
        '  Konuşmacının bizzat şahit olduğu geçmiş olaylar için kullanılır.',
        '> Örnek: Dün sınava girdim ve tüm soruları çözdüm.',
        '• Belirsiz (Duyulan) Geçmiş Zaman (-mış / -miş / -muş / -müş):',
        '  Başkasından duyulan veya sonradan fark edilen olayları anlatır.',
        '',
        '## 4. Gelecek Zaman (-acak / -ecek):',
        '• Henüz gerçekleşmemiş, gelecekte yapılacak plan ve eylemleri anlatır.',
        '• Ünsüz yumuşaması: k harfi ğ olur (Örnek: Yapacağım, Geleceğim).',
        '> Örnek: Yarın yeni bir makale yazacağız.',
      ],
      [1, 7],
      'Sayfa 2 - Tablo ve Örnekler',
      { tensesTable: true }
    );

    return [
      {
        id: 'sample-p1',
        pageNumber: 1,
        name: 'Turkcede_Zamanlar_Sayfa_1.jpg',
        dataUrl: page1,
        mimeType: 'image/jpeg',
        sizeLabel: 'صفحة 1 · 900×1200',
      },
      {
        id: 'sample-p2',
        pageNumber: 2,
        name: 'Turkcede_Zamanlar_Sayfa_2.jpg',
        dataUrl: page2,
        mimeType: 'image/jpeg',
        sizeLabel: 'صفحة 2 · 900×1200',
      },
    ];
  }

  const single = getSampleNoteImageData(id);
  const meta = SAMPLE_NOTES.find((s) => s.id === id);
  return [
    {
      id: `sample-${id}-p1`,
      pageNumber: 1,
      name: `${meta?.title || id}.jpg`,
      dataUrl: single,
      mimeType: 'image/jpeg',
      sizeLabel: 'صفحة 1 · 900×1200',
    },
  ];
}

export function getSampleNoteImageData(id: string): string {
  if (typeof document === 'undefined') return '';

  if (id === 'turkish-tenses-multipage') {
    return getSampleNotePages('turkish-tenses-multipage')[0]?.dataUrl || '';
  }

  if (id === 'turkish-grammar') {
    return createLectureNoteCanvas(
      'TÜRKÇE DERS NOTLARI: ŞİMDİKİ ZAMAN',
      'İstanbul Üniversitesi - Dilbilim ve Dilbilgisi Dersi',
      'Ders: 04 / Tarih: 18.10.2025',
      [
        '# Konu: Şimdiki Zaman (-iyor Eki)',
        'Bu zaman kipi şu anda yapılmakta olan veya devam eden eylemleri anlatır.',
        '',
        '## 1. Temel Yapı ve Formül:',
        '• Formül: Fiil Kökü + (ı / i / u / ü) + yor + Şahıs Eki',
        '> Örnek 1: Gel-mek -> Gel + i + yor + um = Geliyorum (أنا قادم / آتي الآن)',
        '> Örnek 2: Git-mek -> Gid + i + yor = Gidiyor (هو يذهب - t harfi d olur)',
        '> Örnek 3: Oku-mak -> Oku + yor = Okuyor (هو يقرأ)',
        '',
        '## 2. Ünlü Daralması Kuralı (قاعدة تضييق الحروف الصوتية):',
        '• Fiil kökü geniş sesli (a, e) ile bitiyorsa:',
        '• a -> ı veya u  (Örnek: Başla-mak -> Başlıyor)',
        '• e -> i veya ü  (Örnek: Bekle-mek -> Bekliyor)',
        '',
        '## 3. Olumsuz Şekil (الشرط المنفي -mıyor / -miyor):',
        '• Yapı: Fiil Kökü + -mı / -mi / -mu / -mü + yor + Şahıs eki',
        '• Örnek: Anlamıyorum (لا أفهم) / Bilmiyor (لا يعلم)',
        '',
        '## 4. Önemli Kelimeler ve Cümleler (Ödev):',
        '• Kütüphanede Türkçe sınavına çalışıyorum.',
        '• Öğretmen tahtaya yeni kelimeleri yazıyor.',
      ],
      [4, 9, 10, 16],
      'Önemli Sınav Sorusu!'
    );
  }

  if (id === 'turkish-medical') {
    return createLectureNoteCanvas(
      'TIBBİ BİYOLOJİ: SİNDİRİM SİSTEMİ ANATOMİSİ',
      'Cerrahpaşa Tıp Fakültesi - Dönem 2',
      'Hafta: 03 / Tarih: 22.10.2025',
      [
        '# Sindirim Kanalı Organları ve Temel İşlevleri',
        'Besinlerin mekanik ve kimyasal parçalanmasını sağlayan organlar sistemi.',
        '',
        '## 1. Ağız ve Yutak (Cavitas Oris & Farenks):',
        '• Tükürük bezleri amilaz enzimi içerir, karbonhidrat sindirimi başlar.',
        '• Dil (lingua) besinlerin karıştırılması ve yutulmasını sağlar.',
        '',
        '## 2. Mide (Gaster):',
        '• pH değeri yaklaşık 1.5 - 2.0 (Hidroklorik Asit - HCl salgısı).',
        '• Pepsin ve gastrin enzimleri protein sindirimini başlatır.',
        '> Klinik Not: Gastrit ve ülser mukozal bariyerin hasarında oluşur.',
        '',
        '## 3. Karaciğer ve Safra Kesesi (Hepar & Vesica Biliaris):',
        '• Safra (bile) üretir ve yağların mekanik emülsifikasyonunu sağlar.',
        '• Toksinlerin arındırılması ve glikojen depolanmasında birincil organdır.',
        '',
        '## 4. İnce Bağırsak (Duodenum, Jejunum, İleum):',
        '• Besin emiliminin (absorpsiyon) en yoğun gerçekleştiği kısımdır.',
        '• Villus yapıları yüzey alanını 600 kat genişletir.',
      ],
      [3, 8, 12, 17],
      'Anatomi Pratik Sınavı'
    );
  }

  return createLectureNoteCanvas(
    'TÜRK EDEBİYATI VE KÜLTÜR TARİHİ',
    'Ankara Üniversitesi - Edebiyat Fakültesi',
    'Ders: 07 / Tarih: 15.10.2025',
    [
      '# Tanzimat Dönemi Türk Edebiyatı (1860-1896)',
      'Batılılaşma hareketlerinin edebiyata yansıdığı ilk dönemdir.',
      '',
      '## 1. Temel Özellikler ve Akımlar:',
      '• Sanat toplum içindir anlayışı benimsenmiştir.',
      '• Fransız edebiyatından roman, tiyatro ve makale türleri çevrilmiştir.',
      '• Hak, adalet, vatan ve hürriyet kavramları ilk kez işlenmiştir.',
      '',
      '## 2. Önemli Temsilciler:',
      '• Şinasi: İlk Türkçe özel gazete (Tercüman-ı Ahval) ve ilk tiyatro (Şair Evlenmesi).',
      '> Namık Kemal: Vatan Şairi olarak bilinir (Vatan yahut Silistre eseri).',
      '• Ziya Paşa: Terkib-i Bend ve şiir eleştirileri ile ünlüdür.',
      '',
      '## 3. Dil ve Üslup Tartışmaları:',
      '• Dilde sadeleşme savunulmuş ancak tam başarılamamıştır.',
      '• Divan edebiyatı nazım şekilleri ve aruz ölçüsü kullanılmaya devam etmiştir.',
    ],
    [3, 7, 9, 13],
    'Final Konusu'
  );
}
