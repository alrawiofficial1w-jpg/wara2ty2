export type OcrSegmentStatus = 'verified' | 'needs_review' | 'unclear';

export interface OcrSegment {
  id: string;
  text: string;
  status: OcrSegmentStatus;
  pageNumber?: number;
  reason?: string;
}

export interface BilingualSection {
  id: string;
  pageNumber?: number;
  sectionTitle?: string;
  originalText: string;
  arabicTranslation: string;
}

export interface ExtractedTable {
  id: string;
  title: string;
  pageNumber?: number;
  headers: string[];
  rows: string[][];
  notes?: string;
}

export interface DiagramAnalysis {
  id: string;
  title: string;
  pageNumber?: number;
  description: string;
  relationships: string[];
  labels: string[];
  connectionToLecture: string;
  needsManualReview?: boolean;
}

export interface LecturePageData {
  pageNumber: number;
  title?: string;
  extractedText: string;
  arabicTranslation: string;
  sourceNote?: string;
}

export interface VocabItem {
  word: string;
  meaning: string;
  context?: string;
  wordType?: string;
  additionalMeanings?: string[];
  grammarInfo?: string;
  example?: string;
  sourceType?: 'dictionary_verified' | 'ai_contextual';
  dictionarySource?: string;
  sourceRef?: string;
}

export type QuizMode =
  | 'quick'
  | 'comprehensive'
  | 'difficult'
  | 'vocabulary'
  | 'true_false'
  | 'exam_simulation';

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  sourceRef?: string;
  topic?: string;
  difficulty?: string;
  type?: 'mcq' | 'true_false';
}

export interface StudySummary {
  title: string;
  overview: string;
  keyPoints: string[];
  examTip: string;
  sourceRefs?: string[];
}

export type ExplanationMode = 'simple' | 'detailed' | 'academic';

export interface ExplanationSection {
  heading: string;
  lectureBasis: string;
  explanation: string;
  additionalNote?: string;
  examples?: string[];
  sourceRef?: string;
}

export interface DetailedExplanationData {
  mode: ExplanationMode;
  intro: string;
  sections: ExplanationSection[];
  topicConnections: string[];
  keyTakeaways: string[];
}

export interface ComparisonTable {
  id: string;
  title: string;
  sourceRef?: string;
  columns: string[];
  rows: string[][];
  missingDetailsNote?: string;
}

export interface ExpectedExamQuestion {
  id: number;
  type: 'mcq' | 'true_false' | 'short_answer' | 'definition' | 'explanation' | 'comparison';
  question: string;
  options?: string[];
  correctIndex?: number;
  booleanAnswer?: boolean;
  modelAnswer: string;
  explanation: string;
  sourceRef?: string;
}

export interface RevisionSheetData {
  title: string;
  mainIdeas: string[];
  definitions: { term: string; definition: string; sourceRef?: string }[];
  essentialTerms: { word: string; meaning: string }[];
  importantRules: string[];
  keyExamples: string[];
  comparisons: { itemA: string; itemB: string; difference: string }[];
  watchOutPoints: string[];
  checklist: string[];
}

export interface MindMapChild {
  title: string;
  details?: string;
}

export interface MindMapBranch {
  id: string;
  title: string;
  sourceRef?: string;
  children: MindMapChild[];
}

export interface MindMapData {
  centralTopic: string;
  branches: MindMapBranch[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  additionalExplanation?: string;
  sourceRef?: string;
  notFoundInLecture?: boolean;
  timestamp: string;
}

export interface SelectionExplanation {
  selectedText: string;
  translation: string;
  explanation: string;
  vocabularyBreakdown: { word: string; meaning: string }[];
  grammarOrTechNote?: string;
  example?: string;
  connectionToLecture: string;
  sourceRef?: string;
}

export interface AnalysisData {
  detectedLanguage: string;
  clarityScore: string;
  topics: string[];
  extractedText: string;
  arabicTranslation: string;
  summary: StudySummary;
  vocabulary: VocabItem[];
  quiz: QuizQuestion[];
  uncertainSections?: string[];
  // Enhanced features
  pageCount?: number;
  pages?: LecturePageData[];
  ocrSegments?: OcrSegment[];
  bilingualSections?: BilingualSection[];
  tables?: ExtractedTable[];
  diagrams?: DiagramAnalysis[];
  detailedExplanations?: Partial<Record<ExplanationMode, DetailedExplanationData>>;
  comparisonTables?: ComparisonTable[];
  expectedExamQuestions?: ExpectedExamQuestion[];
  revisionSheet?: RevisionSheetData;
  mindMap?: MindMapData;
  textEditedSinceAnalysis?: boolean;
}

export interface AnalysisResponse {
  success: boolean;
  modelUsed?: string;
  data?: AnalysisData;
  error?: string;
}

export type ActivePage = 'home' | 'upload' | 'results';

export interface SampleNote {
  id: string;
  title: string;
  subject: string;
  language: string;
  badge: string;
  description: string;
  imageDataUrl: string;
  isMultiPage?: boolean;
}

export interface UploadedPageInput {
  id: string;
  pageNumber: number;
  name: string;
  dataUrl: string;
  mimeType: string;
  sizeLabel: string;
}

export interface SavedLectureRecord {
  id: string;
  title: string;
  subject: string;
  tags: string[];
  detectedLanguage: string;
  savedAt: string;
  updatedAt: string;
  pageCount: number;
  data: AnalysisData;
  previewImage?: string | null;
}

export interface CombinedLecturesReview {
  title: string;
  sharedConcepts: string[];
  keyDifferences: { topic: string; details: string }[];
  combinedChecklist: string[];
  studyAdvice: string;
}
