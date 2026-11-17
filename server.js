// server.ts
import express from "express";
import path from "path";
import fs2 from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Type } from "@google/genai";

// server/geminiService.ts
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
var EXECUTION_PIPELINE = [
  {
    model: "gemini-3.1-flash-lite",
    useSchema: true,
    useLowThinking: false,
    timeoutMs: 32e3,
    delayBeforeMs: 0,
    label: "gemini-3.1-flash-lite (schema)"
  },
  {
    model: "gemini-4-hydrogen",
    useSchema: true,
    useLowThinking: true,
    timeoutMs: 38e3,
    delayBeforeMs: 250,
    label: "gemini-4-hydrogen (low-thinking + schema)"
  },
  {
    model: "gemini-4-hydrogen",
    useSchema: false,
    useLowThinking: true,
    timeoutMs: 38e3,
    delayBeforeMs: 350,
    label: "gemini-4-hydrogen (fast json)"
  },
  {
    model: "gemini-3.1-flash-lite",
    useSchema: false,
    useLowThinking: false,
    timeoutMs: 28e3,
    delayBeforeMs: 350,
    label: "gemini-3.1-flash-lite (fast json)"
  }
];
function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new Error("GEMINI_API_KEY environment variable is not configured");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function isRetryableOrOverloadError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const status = Number(err?.status || err?.code || err?.httpStatus || 0);
  if ([429, 500, 502, 503, 504, 404, 408].includes(status)) return true;
  return msg.includes("503") || msg.includes("429") || msg.includes("stage_timeout") || msg.includes("overloaded") || msg.includes("unavailable") || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("rate limit") || msg.includes("high demand") || msg.includes("spikes in demand") || msg.includes("capacity") || msg.includes("too many requests") || msg.includes("busy") || msg.includes("deadline_exceeded") || msg.includes("timeout") || msg.includes("fetch failed") || msg.includes("econnreset") || msg.includes("socket hang up") || msg.includes("not_found") || msg.includes("404") || msg.includes("empty text response");
}
async function executeGeminiWithResilience(ai, contents, responseSchema, options) {
  let lastError = null;
  const responseMimeType = options?.responseMimeType ?? "application/json";
  for (const stage of EXECUTION_PIPELINE) {
    if (stage.delayBeforeMs > 0) {
      await sleep(stage.delayBeforeMs);
    }
    let timeoutHandle = null;
    try {
      const config = {
        responseMimeType
      };
      if (options?.systemInstruction) {
        config.systemInstruction = options.systemInstruction;
      }
      if (stage.useSchema && responseSchema && responseMimeType === "application/json") {
        config.responseSchema = responseSchema;
      }
      if (stage.useLowThinking) {
        config.thinkingConfig = {
          thinkingLevel: ThinkingLevel.LOW
        };
      }
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`STAGE_TIMEOUT after ${stage.timeoutMs}ms on ${stage.label}`));
        }, stage.timeoutMs);
      });
      const response = await Promise.race([
        ai.models.generateContent({
          model: stage.model,
          contents,
          config
        }),
        timeoutPromise
      ]);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (response && response.text && response.text.trim().length > 0) {
        return { response, modelUsed: stage.label };
      }
      throw new Error("Model returned an empty text response");
    } catch (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      lastError = err;
      const canSwitch = isRetryableOrOverloadError(err);
      console.warn(
        `[Gemini Resilience] Stage "${stage.label}" encountered error (${canSwitch ? "switching immediately" : "fatal"}):`,
        err?.message || err
      );
      if (!canSwitch) {
        throw err;
      }
    }
  }
  throw lastError || new Error("\u062C\u0645\u064A\u0639 \u0645\u0633\u0627\u0631\u0627\u062A \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0645\u0634\u063A\u0648\u0644\u0629 \u062D\u0627\u0644\u064A\u0627\u064B.");
}
function safeParseJson(rawText) {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (firstBrace !== -1 && lastBrace > firstBrace && (firstBracket === -1 || firstBrace < firstBracket)) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      return JSON.parse(cleaned.slice(firstBracket, lastBracket + 1));
    }
    throw new Error("\u062A\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u0628\u062A\u0646\u0633\u064A\u0642 \u0645\u0646\u0638\u0645.");
  }
}
function translateErrorToArabic(error) {
  const rawMsg = String(error?.message || error || "");
  const lower = rawMsg.toLowerCase();
  if (lower.includes("api_key_invalid") || lower.includes("permission_denied") || lower.includes("gemini_api_key environment variable is not configured") || lower.includes("403")) {
    return {
      status: 403,
      code: "API_KEY_ERROR",
      retryable: false,
      message: "\u0645\u0641\u062A\u0627\u062D \u062E\u062F\u0645\u0629 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A (GEMINI_API_KEY) \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637 \u0623\u0648 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646\u0647 \u0641\u064A \u0644\u0648\u062D\u0629 \u0627\u0644\u0625\u0639\u062F\u0627\u062F\u0627\u062A (Settings > Secrets)."
    };
  }
  if (lower.includes("503") || lower.includes("overloaded") || lower.includes("unavailable") || lower.includes("high demand") || lower.includes("spikes in demand") || lower.includes("capacity") || lower.includes("busy")) {
    return {
      status: 503,
      code: "SERVER_OVERLOADED",
      retryable: true,
      message: '\u062E\u0648\u0627\u062F\u0645 \u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A \u062A\u0634\u0647\u062F \u0630\u0631\u0648\u0629 \u0637\u0644\u0628\u0627\u062A \u0645\u0624\u0642\u062A\u0629 \u062D\u0627\u0644\u064A\u0627\u064B (503). \u064A\u0631\u062C\u0649 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629" \u0648\u0633\u064A\u062A\u0645 \u0627\u0644\u062A\u062D\u0644\u064A\u0644 \u0641\u0648\u0631\u0627\u064B \u0639\u0628\u0631 \u0627\u0644\u0645\u0633\u0627\u0631 \u0627\u0644\u0633\u0631\u064A\u0639.'
    };
  }
  if (lower.includes("429") || lower.includes("resource_exhausted") || lower.includes("quota") || lower.includes("rate limit")) {
    return {
      status: 429,
      code: "SERVER_BUSY_QUOTA",
      retryable: true,
      message: '\u062A\u0645 \u0627\u0644\u0648\u0635\u0648\u0644 \u0644\u0644\u062D\u062F \u0627\u0644\u0645\u0624\u0642\u062A \u0644\u0644\u0637\u0644\u0628\u0627\u062A \u0641\u064A \u0627\u0644\u062F\u0642\u064A\u0642\u0629 (429). \u064A\u0631\u062C\u0649 \u0627\u0644\u0627\u0646\u062A\u0638\u0627\u0631 \u0628\u0636\u0639 \u062B\u0648\u0627\u0646\u064D \u062B\u0645 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629".'
    };
  }
  if (lower.includes("invalid argument") || lower.includes("unsupported mime")) {
    return {
      status: 400,
      code: "INVALID_IMAGE",
      retryable: false,
      message: "\u062A\u0639\u0630\u0631 \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0631\u0641\u0648\u0639. \u064A\u0631\u062C\u0649 \u0627\u0644\u062A\u0623\u0643\u062F \u0645\u0646 \u0623\u0646 \u0627\u0644\u0635\u0648\u0631\u0629 \u0623\u0648 \u0627\u0644\u0645\u0633\u062A\u0646\u062F \u0648\u0627\u0636\u062D \u0648\u0628\u0635\u064A\u063A\u0629 JPG \u0623\u0648 PNG \u0623\u0648 WEBP \u0623\u0648 PDF \u0648\u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u062C\u062F\u062F\u0627\u064B."
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ANALYSIS_ERROR",
    retryable: true,
    message: '\u062D\u062F\u062B \u062E\u0637\u0623 \u0645\u0624\u0642\u062A \u0623\u062B\u0646\u0627\u0621 \u0645\u0639\u0627\u0644\u062C\u0629 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629. \u064A\u0631\u062C\u0649 \u0627\u0644\u0636\u063A\u0637 \u0639\u0644\u0649 "\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629".'
  };
}

// server/dictionaryAdapter.ts
import fs from "fs";
import readline from "readline";
var POS_TO_ARABIC = {
  noun: "\u0627\u0633\u0645 (\u0130sim)",
  verb: "\u0641\u0639\u0644 (Fiil)",
  adj: "\u0635\u0641\u0629 (S\u0131fat)",
  adv: "\u0638\u0631\u0641 (Zarf)",
  pron: "\u0636\u0645\u064A\u0631 (Zamir)",
  postp: "\u0623\u062F\u0627\u0629 \u0631\u0628\u0637/\u062D\u0631\u0641 (Edat)",
  conj: "\u062D\u0631\u0641 \u0639\u0637\u0641 (Ba\u011Fla\xE7)",
  suffix: "\u0644\u0627\u062D\u0642\u0629 (Ek)",
  affix: "\u0644\u0627\u062D\u0642\u0629/\u0628\u0627\u062F\u0626\u0629 (Ek)",
  phrase: "\u0639\u0628\u0627\u0631\u0629 (\u0130fade)",
  name: "\u0639\u0644\u0645 (\xD6zel \u0130sim)",
  num: "\u0639\u062F\u062F (Say\u0131)",
  interj: "\u0623\u062F\u0627\u0629 \u062A\u0639\u062C\u0628 (\xDCnlem)"
};
var SEED_ENTRIES = [
  {
    word: "zaman",
    normalizedWord: "zaman",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0644\u0632\u0645\u0646", "\u0627\u0644\u0648\u0642\u062A", "\u0635\u064A\u063A\u0629 \u0627\u0644\u0632\u0645\u0646 \u0627\u0644\u0646\u062D\u0648\u064A"],
    grammarInfo: "\u0627\u0644\u062C\u0645\u0639: zamanlar \u2014 \u064A\u064F\u0633\u062A\u062E\u062F\u0645 \u0641\u064A \u0627\u0644\u0646\u062D\u0648 \u0644\u0644\u062F\u0644\u0627\u0644\u0629 \u0639\u0644\u0649 \u0627\u0644\u0623\u0632\u0645\u0646\u0629 \u0627\u0644\u0641\u0639\u0644\u064A\u0629",
    example: "T\xFCrk\xE7ede be\u015F temel zaman kipi vard\u0131r.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "\u015Fimdiki zaman",
    normalizedWord: "\u015Fimdiki zaman",
    wordType: "\u0645\u0635\u0637\u0644\u062D \u0646\u062D\u0648\u064A (Dilbilgisi Terimi)",
    meanings: ["\u0627\u0644\u0632\u0645\u0646 \u0627\u0644\u062D\u0627\u0636\u0631 \u0627\u0644\u0645\u0633\u062A\u0645\u0631"],
    grammarInfo: "\u0627\u0644\u0644\u0627\u062D\u0642\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629: -(I)yor (iyor / \u0131yor / uyor / \xFCyor)",
    example: "\u015Eu anda ders \xE7al\u0131\u015F\u0131yorum.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "geni\u015F zaman",
    normalizedWord: "geni\u015F zaman",
    wordType: "\u0645\u0635\u0637\u0644\u062D \u0646\u062D\u0648\u064A (Dilbilgisi Terimi)",
    meanings: ["\u0627\u0644\u0632\u0645\u0646 \u0627\u0644\u0648\u0627\u0633\u0639 (\u0627\u0644\u0645\u0636\u0627\u0631\u0639 \u0627\u0644\u0639\u0627\u0645 / \u0627\u0644\u0639\u0627\u062F\u0627\u062A \u0648\u0627\u0644\u062D\u0642\u0627\u0626\u0642)"],
    grammarInfo: "\u0627\u0644\u0644\u0627\u062D\u0642\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629: -r / -ar / -er / -\u0131r / -ir / -ur / -\xFCr",
    example: "Her sabah erken kalkar\u0131m.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "ge\xE7mi\u015F zaman",
    normalizedWord: "ge\xE7mi\u015F zaman",
    wordType: "\u0645\u0635\u0637\u0644\u062D \u0646\u062D\u0648\u064A (Dilbilgisi Terimi)",
    meanings: ["\u0627\u0644\u0632\u0645\u0646 \u0627\u0644\u0645\u0627\u0636\u064A (\u0627\u0644\u0634\u0647\u0648\u062F\u064A -DI \u0623\u0648 \u0627\u0644\u0646\u0642\u0644\u064A -mI\u015F)"],
    grammarInfo: "\u064A\u0646\u0642\u0633\u0645 \u0625\u0644\u0649: Belirli Ge\xE7mi\u015F (-d\u0131/-di) \u0648 Belirsiz Ge\xE7mi\u015F (-m\u0131\u015F/-mi\u015F)",
    example: "D\xFCn \xFCniversiteye gittim.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "gelecek zaman",
    normalizedWord: "gelecek zaman",
    wordType: "\u0645\u0635\u0637\u0644\u062D \u0646\u062D\u0648\u064A (Dilbilgisi Terimi)",
    meanings: ["\u0632\u0645\u0646 \u0627\u0644\u0645\u0633\u062A\u0642\u0628\u0644"],
    grammarInfo: "\u0627\u0644\u0644\u0627\u062D\u0642\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629: -acak / -ecek (+ \u0634\u062E\u0648\u0635 \u0627\u0644\u0645\u0644\u0643\u064A\u0629)",
    example: "Yar\u0131n s\u0131nava girece\u011Fim.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "fiil",
    normalizedWord: "fiil",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0641\u0639\u0644", "\u0639\u0645\u0644 / \u062D\u062F\u062B"],
    grammarInfo: "fiil k\xF6k\xFC (\u062C\u0630\u0631 \u0627\u0644\u0641\u0639\u0644)\u060C fiil \xE7ekimi (\u062A\u0635\u0631\u064A\u0641 \u0627\u0644\u0641\u0639\u0644)",
    example: "C\xFCmlenin sonunda fiil bulunur.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "k\xF6k",
    normalizedWord: "k\xF6k",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u062C\u0630\u0631 (\u0627\u0644\u0643\u0644\u0645\u0629 \u0623\u0648 \u0627\u0644\u0646\u0628\u0627\u062A)", "\u0623\u0635\u0644"],
    grammarInfo: "\u064A\u064F\u0636\u0627\u0641 \u0625\u0644\u064A\u0647 \u0627\u0644\u0644\u0648\u0627\u062D\u0642 (ekler)\u061B \u0645\u0639 \u0627\u0644\u0625\u0636\u0627\u0641\u0629: k\xF6k\xFC",
    example: "Kelimenin k\xF6k\xFCn\xFC bulunuz.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "ek",
    normalizedWord: "ek",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0644\u0627\u062D\u0642\u0629 \u0635\u0631\u0641\u064A\u0629", "\u0625\u0636\u0627\u0641\u0629 / \u0645\u0644\u062D\u0642"],
    grammarInfo: "\u0627\u0644\u062C\u0645\u0639: ekler \u2014 yap\u0131m eki (\u0644\u0627\u062D\u0642\u0629 \u0627\u0634\u062A\u0642\u0627\u0642) / \xE7ekim eki (\u0644\u0627\u062D\u0642\u0629 \u062A\u0635\u0631\u064A\u0641)",
    example: "T\xFCrk\xE7e sondan eklemeli bir dildir.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "\xFCnl\xFC",
    normalizedWord: "\xFCnl\xFC",
    wordType: "\u0635\u0641\u0629 / \u0627\u0633\u0645 (S\u0131fat / \u0130sim)",
    meanings: ["\u062D\u0631\u0641 \u0635\u0648\u062A\u064A (\u0639\u0644\u0629)", "\u0645\u0634\u0647\u0648\u0631"],
    grammarInfo: "kal\u0131n \xFCnl\xFCler (a, \u0131, o, u) / ince \xFCnl\xFCler (e, i, \xF6, \xFC)",
    example: "\xDCnl\xFC uyumu T\xFCrk\xE7e dilbilgisinin temelidir.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "\xFCns\xFCz",
    normalizedWord: "\xFCns\xFCz",
    wordType: "\u0627\u0633\u0645 / \u0635\u0641\u0629 (\u0130sim / S\u0131fat)",
    meanings: ["\u062D\u0631\u0641 \u0633\u0627\u0643\u0646 (\u0635\u0627\u0645\u062A)"],
    grammarInfo: "\xFCns\xFCz yumu\u015Famas\u0131 (\u062A\u0644\u064A\u0646 \u0627\u0644\u0633\u0648\u0627\u0643\u0646: p, \xE7, t, k \u2192 b, c, d, \u011F)",
    example: "Git-mek fiilinde t harfi d harfine d\xF6n\xFC\u015F\xFCr.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "olumlu",
    normalizedWord: "olumlu",
    wordType: "\u0635\u0641\u0629 (S\u0131fat)",
    meanings: ["\u0645\u062B\u0628\u062A (\u0641\u064A \u0627\u0644\u0646\u062D\u0648)", "\u0625\u064A\u062C\u0627\u0628\u064A"],
    grammarInfo: "\u0639\u0643\u0633\u0647\u0627: olumsuz (\u0645\u0646\u0641\u064A)",
    example: "Olumlu c\xFCmle yap\u0131s\u0131 \xF6zne ve y\xFCklemden olu\u015Fur.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "olumsuz",
    normalizedWord: "olumsuz",
    wordType: "\u0635\u0641\u0629 (S\u0131fat)",
    meanings: ["\u0645\u0646\u0641\u064A (\u0641\u064A \u0627\u0644\u0646\u062D\u0648)", "\u0633\u0644\u0628\u064A"],
    grammarInfo: "\u062A\u064F\u0635\u0627\u063A \u0644\u0627\u062D\u0642\u0629 \u0627\u0644\u0646\u0641\u064A \u0641\u064A \u0627\u0644\u0623\u0641\u0639\u0627\u0644 \u0639\u0627\u062F\u0629 \u0628\u0640 -ma / -me",
    example: "Olumsuz soru c\xFCmlesi nas\u0131l kurulur?",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "c\xFCmle",
    normalizedWord: "c\xFCmle",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u062C\u0645\u0644\u0629", "\u0639\u0628\u0627\u0631\u0629"],
    grammarInfo: "\u0627\u0644\u062C\u0645\u0639: c\xFCmleler",
    example: "\xD6rnek bir c\xFCmle yaz\u0131n\u0131z.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "\xF6rnek",
    normalizedWord: "\xF6rnek",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0645\u062B\u0627\u0644", "\u0646\u0645\u0648\u0630\u062C"],
    grammarInfo: "\u062A\u0644\u064A\u0646 k \u2192 \u011F \u0639\u0646\u062F \u0627\u0644\u0625\u0636\u0627\u0641\u0629: \xF6rne\u011Fi",
    example: "Konuyu bir \xF6rnekle a\xE7\u0131klayal\u0131m.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "s\u0131nav",
    normalizedWord: "s\u0131nav",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0645\u062A\u062D\u0627\u0646", "\u0627\u062E\u062A\u0628\u0627\u0631"],
    grammarInfo: "vize s\u0131nav\u0131 (\u0627\u0645\u062A\u062D\u0627\u0646 \u0646\u0635\u0641\u064A) / final s\u0131nav\u0131 (\u0627\u0645\u062A\u062D\u0627\u0646 \u0646\u0647\u0627\u0626\u064A)",
    example: "S\u0131nava d\xFCzenli \xE7al\u0131\u015Fmak gerekir.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "sindirim",
    normalizedWord: "sindirim",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0644\u0647\u0636\u0645"],
    grammarInfo: "\u0645\u0634\u062A\u0642 \u0645\u0646 \u0627\u0644\u0641\u0639\u0644 sindirmek (\u0647\u0636\u0645) + \u0644\u0627\u062D\u0642\u0629 \u0627\u0644\u0627\u0633\u0645 -im",
    example: "Sindirim sistemi a\u011F\u0131zda ba\u015Flar.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "mide",
    normalizedWord: "mide",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0644\u0645\u0639\u062F\u0629"],
    grammarInfo: "\u0645\u0646 \u0623\u0635\u0644 \u0639\u0631\u0628\u064A (\u0645\u0639\u062F\u0629) \u2014 \u064A\u064F\u0633\u062A\u062E\u062F\u0645 \u0641\u064A \u0627\u0644\u0637\u0628 \u0648\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u064A\u0648\u0645\u064A\u0629",
    example: "Mide asidi protein sindiriminde rol oynar.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "karaci\u011Fer",
    normalizedWord: "karaci\u011Fer",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0644\u0643\u0628\u062F"],
    grammarInfo: "\u0643\u0644\u0645\u0629 \u0645\u0631\u0643\u0628\u0629: kara (\u0623\u0633\u0648\u062F) + ci\u011Fer (\u0643\u0628\u062F/\u0623\u062D\u0634\u0627\u0621)",
    example: "Karaci\u011Fer safra \xFCretiminden sorumludur.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "ba\u011F\u0131rsak",
    normalizedWord: "ba\u011F\u0131rsak",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0644\u0623\u0645\u0639\u0627\u0621"],
    grammarInfo: "ince ba\u011F\u0131rsak (\u0627\u0644\u0623\u0645\u0639\u0627\u0621 \u0627\u0644\u062F\u0642\u064A\u0642\u0629) / kal\u0131n ba\u011F\u0131rsak (\u0627\u0644\u0623\u0645\u0639\u0627\u0621 \u0627\u0644\u063A\u0644\u064A\u0638\u0629)",
    example: "Besin emilimi ince ba\u011F\u0131rsakta ger\xE7ekle\u015Fir.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "edebiyat",
    normalizedWord: "edebiyat",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0644\u0623\u062F\u0628", "\u0627\u0644\u062F\u0631\u0627\u0633\u0627\u062A \u0627\u0644\u0623\u062F\u0628\u064A\u0629"],
    grammarInfo: "\u062A\u062A\u0635\u0644 \u0628\u0644\u0627\u062D\u0642\u0629 \u0627\u0644\u0625\u0636\u0627\u0641\u0629 \u0628\u062F\u0648\u0646 \u062A\u0644\u064A\u0646: T\xFCrk edebiyat\u0131",
    example: "Tanzimat edebiyat\u0131 1860 y\u0131l\u0131nda ba\u015Flam\u0131\u015Ft\u0131r.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "kural",
    normalizedWord: "kural",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0642\u0627\u0639\u062F\u0629", "\u0642\u0627\u0646\u0648\u0646 / \u0636\u0627\u0628\u0637"],
    grammarInfo: "\u0627\u0644\u062C\u0645\u0639: kurallar",
    example: "Bu kural her zaman ge\xE7erlidir.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "\xF6zne",
    normalizedWord: "\xF6zne",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0644\u0641\u0627\u0639\u0644 / \u0627\u0644\u0645\u0628\u062A\u062F\u0623 (\u0627\u0644\u0645\u0633\u0646\u062F \u0625\u0644\u064A\u0647)"],
    grammarInfo: "\u0645\u0635\u0637\u0644\u062D \u0646\u062D\u0648\u064A \u0623\u0633\u0627\u0633\u064A \u0641\u064A \u0628\u0646\u0627\u0621 \u0627\u0644\u062C\u0645\u0644\u0629 \u0627\u0644\u062A\u0631\u0643\u064A\u0629",
    example: "\xD6zne y\xFCklemden \xF6nce gelir.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  },
  {
    word: "y\xFCklem",
    normalizedWord: "y\xFCklem",
    wordType: "\u0627\u0633\u0645 (\u0130sim)",
    meanings: ["\u0627\u0644\u062E\u0628\u0631 / \u0627\u0644\u0645\u0633\u0646\u062F (\u0627\u0644\u0641\u0639\u0644 \u0623\u0648 \u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u0646\u062F \u0641\u064A \u0622\u062E\u0631 \u0627\u0644\u062C\u0645\u0644\u0629)"],
    grammarInfo: "\u064A\u0642\u0639 \u063A\u0627\u0644\u0628\u0627\u064B \u0641\u064A \u0646\u0647\u0627\u064A\u0629 \u0627\u0644\u062C\u0645\u0644\u0629 \u0627\u0644\u062A\u0631\u0643\u064A\u0629 \u0627\u0644\u0642\u064A\u0627\u0633\u064A\u0629",
    example: "T\xFCrk\xE7ede y\xFCklem genellikle c\xFCmlenin sonundad\u0131r.",
    sourceType: "dictionary_verified",
    dictionarySource: "Kaikki/trwiktionary (Structured Seed)"
  }
];
function normalizeTurkishWord(raw) {
  return raw.trim().replace(/^[(\["'«]+|[)\]"'».,:;!?]+$/g, "").toLocaleLowerCase("tr-TR");
}
var KaikkiTurkishDictionaryAdapter = class {
  constructor(jsonlPath) {
    this.jsonlPath = jsonlPath;
    this.name = "Kaikki Turkish Wiktionary Adapter";
    this.index = /* @__PURE__ */ new Map();
    this.loadedExternal = false;
    this.externalLoadPromise = null;
    for (const entry of SEED_ENTRIES) {
      this.index.set(entry.normalizedWord, entry);
    }
  }
  async ensureExternalLoaded() {
    if (this.loadedExternal) return;
    if (this.externalLoadPromise) return this.externalLoadPromise;
    this.externalLoadPromise = (async () => {
      if (!this.jsonlPath || !fs.existsSync(this.jsonlPath)) {
        this.loadedExternal = true;
        return;
      }
      try {
        const stream = fs.createReadStream(this.jsonlPath, { encoding: "utf-8" });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let count = 0;
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (!parsed.word) continue;
            if (parsed.lang_code && parsed.lang_code !== "tr") continue;
            const arTranslations = (parsed.translations || []).filter((t) => (t.code === "ar" || t.lang_code === "ar") && t.word).map((t) => String(t.word).trim()).filter(Boolean);
            if (arTranslations.length === 0) continue;
            const norm = normalizeTurkishWord(parsed.word);
            const posLabel = parsed.pos && POS_TO_ARABIC[parsed.pos] || parsed.pos || "\u0643\u0644\u0645\u0629";
            const firstExample = parsed.senses?.[0]?.examples?.[0]?.text;
            this.index.set(norm, {
              word: parsed.word,
              normalizedWord: norm,
              wordType: posLabel,
              meanings: Array.from(new Set(arTranslations)).slice(0, 5),
              example: firstExample,
              sourceType: "dictionary_verified",
              dictionarySource: "Kaikki trwiktionary (Local JSONL)"
            });
            count++;
          } catch {
          }
        }
        console.log(`[DictionaryAdapter] Loaded ${count} Turkish\u2013Arabic entries from ${this.jsonlPath}`);
      } catch (err) {
        console.warn("[DictionaryAdapter] Failed loading external Kaikki JSONL:", err);
      } finally {
        this.loadedExternal = true;
      }
    })();
    return this.externalLoadPromise;
  }
  async lookup(word) {
    await this.ensureExternalLoaded();
    const norm = normalizeTurkishWord(word);
    if (!norm) return null;
    if (this.index.has(norm)) {
      return this.index.get(norm);
    }
    const strippedPlural = norm.replace(/(ler|lar)$/i, "");
    if (strippedPlural && strippedPlural !== norm && this.index.has(strippedPlural)) {
      return this.index.get(strippedPlural);
    }
    return null;
  }
  async searchPrefix(prefix, limit = 10) {
    await this.ensureExternalLoaded();
    const norm = normalizeTurkishWord(prefix);
    if (!norm) return Array.from(this.index.values()).slice(0, limit);
    const matches = [];
    for (const entry of this.index.values()) {
      if (entry.normalizedWord.includes(norm) || entry.meanings.some((m) => m.includes(prefix.trim()))) {
        matches.push(entry);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }
};
var dictionaryProvider = new KaikkiTurkishDictionaryAdapter(
  process.env.KAIKKI_TR_DATA_PATH
);

// server/ttsService.ts
var TtsServiceError = class extends Error {
  constructor(message, options) {
    super(message);
    this.name = "TtsServiceError";
    this.status = options.status;
    this.code = options.code;
    this.stage = options.stage;
  }
};
var VALID_LOCALES = ["ar-EG", "ar-XA", "tr-TR", "en-US"];
var GEMINI_PREBUILT_VOICES = [
  {
    id: "gemini:Kore",
    label: "Kore \u2014 \u0635\u0648\u062A \u0646\u0633\u0627\u0626\u064A \u0648\u0627\u0636\u062D (\u0645\u0648\u0635\u0649 \u0628\u0647 \u0644\u0644\u0645\u062D\u0627\u0636\u0631\u0627\u062A)",
    gender: "female",
    provider: "gemini-tts",
    locales: ["ar-EG", "ar-XA", "tr-TR", "en-US"],
    recommended: true
  },
  {
    id: "gemini:Zephyr",
    label: "Zephyr \u2014 \u0635\u0648\u062A \u0646\u0633\u0627\u0626\u064A \u0647\u0627\u062F\u0626 \u0648\u062F\u0627\u0641\u0626",
    gender: "female",
    provider: "gemini-tts",
    locales: ["ar-EG", "ar-XA", "tr-TR", "en-US"]
  },
  {
    id: "gemini:Charon",
    label: "Charon \u2014 \u0635\u0648\u062A \u0631\u062C\u0627\u0644\u064A \u0631\u0635\u064A\u0646 \u0648\u0639\u0645\u064A\u0642",
    gender: "male",
    provider: "gemini-tts",
    locales: ["ar-EG", "ar-XA", "tr-TR", "en-US"]
  },
  {
    id: "gemini:Puck",
    label: "Puck \u2014 \u0635\u0648\u062A \u0631\u062C\u0627\u0644\u064A \u0648\u0627\u0636\u062D \u0648\u0646\u0634\u064A\u0637",
    gender: "male",
    provider: "gemini-tts",
    locales: ["ar-EG", "ar-XA", "tr-TR", "en-US"]
  },
  {
    id: "gemini:Fenrir",
    label: "Fenrir \u2014 \u0635\u0648\u062A \u0631\u062C\u0627\u0644\u064A \u062B\u0627\u0628\u062A \u0648\u0645\u0639\u062A\u062F\u0644",
    gender: "male",
    provider: "gemini-tts",
    locales: ["ar-EG", "ar-XA", "tr-TR", "en-US"]
  }
];
var CLOUD_TTS_VOICES = [
  {
    id: "cloud:ar-XA-Wavenet-A",
    label: "Cloud WaveNet A \u2014 \u0639\u0631\u0628\u064A\u0629 \u0641\u0635\u062D\u0649 (\u0623\u0646\u062B\u0649)",
    gender: "female",
    provider: "google-cloud-tts",
    locales: ["ar-XA"],
    cloudVoiceName: "ar-XA-Wavenet-A"
  },
  {
    id: "cloud:ar-XA-Wavenet-B",
    label: "Cloud WaveNet B \u2014 \u0639\u0631\u0628\u064A\u0629 \u0641\u0635\u062D\u0649 (\u0630\u0643\u0631)",
    gender: "male",
    provider: "google-cloud-tts",
    locales: ["ar-XA"],
    cloudVoiceName: "ar-XA-Wavenet-B"
  },
  {
    id: "cloud:ar-XA-Wavenet-C",
    label: "Cloud WaveNet C \u2014 \u0639\u0631\u0628\u064A\u0629 \u0641\u0635\u062D\u0649 (\u0630\u0643\u0631)",
    gender: "male",
    provider: "google-cloud-tts",
    locales: ["ar-XA"],
    cloudVoiceName: "ar-XA-Wavenet-C"
  },
  {
    id: "cloud:ar-XA-Wavenet-D",
    label: "Cloud WaveNet D \u2014 \u0639\u0631\u0628\u064A\u0629 \u0641\u0635\u062D\u0649 (\u0623\u0646\u062B\u0649)",
    gender: "female",
    provider: "google-cloud-tts",
    locales: ["ar-XA"],
    cloudVoiceName: "ar-XA-Wavenet-D"
  }
];
var cloudProbeCache = null;
var MAX_SERVER_TTS_CACHE = 40;
var serverTtsCache = /* @__PURE__ */ new Map();
function hasGeminiApiKey() {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== "MY_GEMINI_API_KEY" && key.trim().length > 10);
}
function getGoogleCloudTtsApiKey() {
  const raw = process.env.GOOGLE_CLOUD_TTS_API_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length < 20 || /^MY_|^YOUR_|PLACEHOLDER|OPTIONAL/i.test(trimmed) || !trimmed.startsWith("AIza")) {
    return null;
  }
  return trimmed;
}
async function isCloudTtsActuallyUsable() {
  const key = getGoogleCloudTtsApiKey();
  if (!key) return { usable: false };
  const now = Date.now();
  if (cloudProbeCache && cloudProbeCache.key === key && now - cloudProbeCache.checkedAt < 10 * 60 * 1e3) {
    return { usable: cloudProbeCache.valid, note: cloudProbeCache.note };
  }
  try {
    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/voices?languageCode=ar-XA&key=${encodeURIComponent(key)}`
    );
    const json = await res.json();
    const valid = res.ok && Array.isArray(json?.voices) && json.voices.length > 0;
    const note = valid ? void 0 : json?.error?.message || `Google Cloud TTS verification failed (HTTP ${res.status})`;
    cloudProbeCache = { checkedAt: now, key, valid, note };
    return { usable: valid, note };
  } catch (err) {
    const note = err?.message || "Unable to verify Google Cloud TTS endpoint";
    cloudProbeCache = { checkedAt: now, key, valid: false, note };
    return { usable: false, note };
  }
}
async function getTtsStatus() {
  const geminiTtsConfigured = hasGeminiApiKey();
  const cloudCheck = await isCloudTtsActuallyUsable();
  const cloudTtsConfigured = cloudCheck.usable;
  const voices = [];
  const supportedArabicLocales = [];
  if (geminiTtsConfigured) {
    voices.push(...GEMINI_PREBUILT_VOICES);
    supportedArabicLocales.push(
      { code: "ar-EG", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629 (\u0645\u0635\u0631) \u2014 ar-EG", provider: "gemini-tts" },
      { code: "ar-XA", label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0641\u0635\u062D\u0649 \u2014 ar-XA", provider: "gemini-tts" }
    );
  }
  if (cloudTtsConfigured) {
    voices.push(...CLOUD_TTS_VOICES);
    if (!geminiTtsConfigured) {
      supportedArabicLocales.push({
        code: "ar-XA",
        label: "\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0641\u0635\u062D\u0649 \u2014 ar-XA (Google Cloud TTS)",
        provider: "google-cloud-tts"
      });
    }
  }
  const primaryProvider = geminiTtsConfigured ? "gemini-tts" : cloudTtsConfigured ? "google-cloud-tts" : null;
  const secondaryProvider = geminiTtsConfigured && cloudTtsConfigured ? "google-cloud-tts" : null;
  let configurationNote;
  if (!geminiTtsConfigured && !cloudTtsConfigured) {
    configurationNote = "\u0644\u0645 \u064A\u062A\u0645 \u0636\u0628\u0637 \u0645\u0641\u062A\u0627\u062D GEMINI_API_KEY \u0623\u0648 GOOGLE_CLOUD_TTS_API_KEY \u0635\u0627\u0644\u062D \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u0644\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0635\u0648\u062A \u0627\u0644\u0639\u0631\u0628\u064A \u0627\u0644\u0631\u0633\u0645\u064A.";
  } else if (getGoogleCloudTtsApiKey() && !cloudTtsConfigured && cloudCheck.note) {
    configurationNote = `\u0645\u0644\u0627\u062D\u0638\u0629 \u062D\u0648\u0644 \u0627\u0644\u0628\u062F\u064A\u0644 \u0627\u0644\u062B\u0627\u0646\u0648\u064A (Google Cloud TTS): ${cloudCheck.note}`;
  }
  return {
    available: Boolean(primaryProvider),
    primaryProvider,
    secondaryProvider,
    geminiTtsConfigured,
    cloudTtsConfigured,
    supportedArabicLocales,
    voices,
    configurationNote
  };
}
function normalizeSpeechTextServer(raw) {
  return String(raw || "").replace(/[*_`~#>]+/g, " ").replace(/\s+/g, " ").trim();
}
function getGeminiStyleForLocale(locale) {
  switch (locale) {
    case "ar-EG":
      return "Read clearly in natural Egyptian Arabic (ar-EG) academic lecture narration style. Pronounce Arabic academic terminology accurately, respect punctuation pauses, and read ONLY the exact provided text without adding any extra words.";
    case "ar-XA":
      return "Read clearly in Modern Standard Arabic academic lecture narration style. Pronounce Arabic words with accurate articulation, respect punctuation pauses, and read ONLY the exact provided text without adding any extra words.";
    case "tr-TR":
      return "Read clearly in native Istanbul Turkish (tr-TR) academic pronunciation. Respect Turkish vowels and suffixes accurately, and read ONLY the exact provided text without translating or adding words.";
    case "en-US":
      return "Read clearly in standard American English (en-US) academic pronunciation. Read ONLY the exact provided text without adding extra words.";
  }
}
function wrapPcm16AsWav(pcmBytes, sampleRate = 24e3, channels = 1) {
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcmBytes.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcmBytes.length, 40);
  return Buffer.concat([header, pcmBytes]);
}
function validateAndNormalizeAudioPayload(rawBase64, declaredMimeType) {
  const cleanB64 = String(rawBase64 || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!cleanB64) {
    throw new TtsServiceError("\u0623\u0639\u0627\u062F \u0645\u0632\u0648\u062F \u0627\u0644\u0635\u0648\u062A \u0627\u0633\u062A\u062C\u0627\u0628\u0629 \u0641\u0627\u0631\u063A\u0629 \u0628\u062F\u0648\u0646 \u0628\u064A\u0627\u0646\u0627\u062A \u0635\u0648\u062A\u064A\u0629.", {
      status: 502,
      code: "TTS_EMPTY_AUDIO",
      stage: "decoding"
    });
  }
  let buf = Buffer.from(cleanB64, "base64");
  if (buf.length < 128) {
    throw new TtsServiceError("\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0635\u0648\u062A \u0627\u0644\u0645\u0633\u062A\u0644\u0645\u0629 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629 \u0623\u0648 \u062A\u0627\u0644\u0641\u0629.", {
      status: 502,
      code: "TTS_EMPTY_AUDIO",
      stage: "decoding"
    });
  }
  const head4 = buf.subarray(0, 4).toString("ascii");
  const head8To12 = buf.subarray(8, 12).toString("ascii");
  const head3 = buf.subarray(0, 3).toString("ascii");
  const isWav = head4 === "RIFF" && head8To12 === "WAVE";
  const isMp3 = head3 === "ID3" || buf[0] === 255 && (buf[1] & 224) === 224;
  const isOgg = head4 === "OggS";
  const isFlac = head4 === "fLaC";
  const lowerDeclared = String(declaredMimeType || "").toLowerCase();
  if (isWav) {
    return { audioBase64: buf.toString("base64"), mimeType: "audio/wav", byteLength: buf.length };
  }
  if (isMp3) {
    return { audioBase64: buf.toString("base64"), mimeType: "audio/mpeg", byteLength: buf.length };
  }
  if (isOgg) {
    return { audioBase64: buf.toString("base64"), mimeType: "audio/ogg", byteLength: buf.length };
  }
  if (isFlac) {
    return { audioBase64: buf.toString("base64"), mimeType: "audio/flac", byteLength: buf.length };
  }
  if (lowerDeclared.includes("l16") || lowerDeclared.includes("pcm")) {
    const rateMatch = lowerDeclared.match(/rate=(\d+)/);
    const rate = rateMatch ? parseInt(rateMatch[1], 10) : 24e3;
    buf = wrapPcm16AsWav(buf, Number.isFinite(rate) && rate >= 8e3 ? rate : 24e3, 1);
    return { audioBase64: buf.toString("base64"), mimeType: "audio/wav", byteLength: buf.length };
  }
  throw new TtsServiceError(
    `\u0623\u0639\u0627\u062F \u0645\u0632\u0648\u062F \u0627\u0644\u0635\u0648\u062A \u0635\u064A\u063A\u0629 \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645\u0629 \u0623\u0648 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629 \u0644\u0644\u062A\u0634\u063A\u064A\u0644 (${declaredMimeType || "unknown"}).`,
    {
      status: 502,
      code: "TTS_INVALID_AUDIO_FORMAT",
      stage: "decoding"
    }
  );
}
function validateRequestedLocaleAndVoice(rawLocale, rawVoiceId, geminiEnabled, cloudKey) {
  if (!VALID_LOCALES.includes(rawLocale)) {
    throw new TtsServiceError(
      `\u0627\u0644\u0644\u063A\u0629 \u0623\u0648 \u0627\u0644\u0644\u0647\u062C\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 (${rawLocale}) \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645\u0629 \u062D\u0627\u0644\u064A\u0627\u064B. \u0627\u0644\u0644\u0647\u062C\u0627\u062A \u0627\u0644\u0645\u062F\u0639\u0648\u0645\u0629: ar-EG, ar-XA, tr-TR, en-US.`,
      {
        status: 400,
        code: "TTS_UNSUPPORTED_LOCALE",
        stage: "validation"
      }
    );
  }
  const locale = rawLocale;
  if (!geminiEnabled && !cloudKey) {
    throw new TtsServiceError(
      "\u062E\u062F\u0645\u0629 \u0627\u0644\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0635\u0648\u062A\u064A \u063A\u064A\u0631 \u0645\u0636\u0628\u0648\u0637\u0629 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 (GEMINI_API_KEY \u0623\u0648 GOOGLE_CLOUD_TTS_API_KEY \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631).",
      {
        status: 503,
        code: "TTS_NOT_CONFIGURED",
        stage: "validation"
      }
    );
  }
  if (!geminiEnabled && cloudKey && locale === "ar-EG") {
    throw new TtsServiceError(
      "\u0627\u0644\u0644\u0647\u062C\u0629 \u0627\u0644\u0645\u0635\u0631\u064A\u0629 (ar-EG) \u062A\u062A\u0637\u0644\u0628 \u062A\u0641\u0639\u064A\u0644 Gemini-TTS. \u0627\u0644\u0645\u062A\u0627\u062D \u062D\u0627\u0644\u064A\u0627\u064B \u0639\u0628\u0631 Google Cloud TTS \u0647\u0648 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0641\u0635\u062D\u0649 (ar-XA).",
      {
        status: 400,
        code: "TTS_UNSUPPORTED_LOCALE",
        stage: "validation"
      }
    );
  }
  if (rawVoiceId !== void 0 && rawVoiceId !== "") {
    if (rawVoiceId.startsWith("gemini:")) {
      if (!geminiEnabled) {
        throw new TtsServiceError("\u0627\u0644\u0635\u0648\u062A \u0627\u0644\u0645\u062E\u062A\u0627\u0631 \u064A\u062A\u0637\u0644\u0628 \u062A\u0641\u0639\u064A\u0644 GEMINI_API_KEY \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645.", {
          status: 400,
          code: "TTS_UNSUPPORTED_VOICE",
          stage: "validation"
        });
      }
      const voiceName = rawVoiceId.slice("gemini:".length);
      const validVoice = GEMINI_PREBUILT_VOICES.find((v) => v.id === rawVoiceId);
      if (!validVoice || !validVoice.locales.includes(locale)) {
        throw new TtsServiceError(`\u0627\u0644\u0635\u0648\u062A \u0627\u0644\u0645\u062D\u062F\u062F (${rawVoiceId}) \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645 \u0644\u0644\u063A\u0629 (${locale}).`, {
          status: 400,
          code: "TTS_UNSUPPORTED_VOICE",
          stage: "validation"
        });
      }
      return { locale, targetProvider: "gemini-tts", geminiVoiceName: voiceName };
    }
    if (rawVoiceId.startsWith("cloud:")) {
      if (!cloudKey) {
        throw new TtsServiceError("\u0627\u0644\u0635\u0648\u062A \u0627\u0644\u0645\u062E\u062A\u0627\u0631 \u0645\u0646 Google Cloud \u063A\u064A\u0631 \u0645\u0641\u0639\u0651\u0644 \u0639\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645.", {
          status: 400,
          code: "TTS_UNSUPPORTED_VOICE",
          stage: "validation"
        });
      }
      const validCloud = CLOUD_TTS_VOICES.find((v) => v.id === rawVoiceId);
      if (!validCloud || !validCloud.locales.includes(locale)) {
        throw new TtsServiceError(
          `\u0635\u0648\u062A Google Cloud \u0627\u0644\u0645\u062D\u062F\u062F (${rawVoiceId}) \u063A\u064A\u0631 \u0645\u062A\u0648\u0627\u0641\u0642 \u0645\u0639 \u0627\u0644\u0644\u063A\u0629 (${locale}).`,
          {
            status: 400,
            code: "TTS_UNSUPPORTED_VOICE",
            stage: "validation"
          }
        );
      }
      return {
        locale,
        targetProvider: "google-cloud-tts",
        geminiVoiceName: "Kore",
        cloudVoice: { languageCode: "ar-XA", name: validCloud.cloudVoiceName }
      };
    }
    throw new TtsServiceError(`\u0645\u0639\u0631\u0651\u0641 \u0627\u0644\u0635\u0648\u062A \u0627\u0644\u0645\u0637\u0644\u0648\u0628 (${rawVoiceId}) \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641 \u0623\u0648 \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645.`, {
      status: 400,
      code: "TTS_UNSUPPORTED_VOICE",
      stage: "validation"
    });
  }
  if (geminiEnabled) {
    return { locale, targetProvider: "gemini-tts", geminiVoiceName: "Kore" };
  }
  const fallbackCloudVoice = locale === "tr-TR" ? { languageCode: "tr-TR", name: "tr-TR-Wavenet-A" } : locale === "en-US" ? { languageCode: "en-US", name: "en-US-Wavenet-F" } : { languageCode: "ar-XA", name: "ar-XA-Wavenet-A" };
  return {
    locale,
    targetProvider: "google-cloud-tts",
    geminiVoiceName: "Kore",
    cloudVoice: fallbackCloudVoice
  };
}
function isTtsRetryableError(err) {
  if (isRetryableOrOverloadError(err)) return true;
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("empty audio") || msg.includes("tts_empty_audio") || msg.includes("internal") || msg.includes("500") || msg.includes("try again");
}
async function synthesizeWithGeminiTts(ai, text, locale, voiceName) {
  const attempts = [
    { model: "gemini-3.8-flash-lite-tts", delayMs: 0 },
    { model: "gemini-3.8-flash-tts", delayMs: 250 },
    { model: "gemini-3.8-flash-tts", delayMs: 900 }
  ];
  const style = getGeminiStyleForLocale(locale);
  let lastErr = null;
  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await new Promise((r) => setTimeout(r, attempt.delayMs));
    }
    let timer = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`STAGE_TIMEOUT after 30000ms on ${attempt.model}`));
        }, 3e4);
      });
      const response = await Promise.race([
        ai.models.generateContent({
          model: attempt.model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text,
                  speechMetadata: {
                    style
                  }
                }
              ]
            }
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName }
              }
            }
          }
        }),
        timeoutPromise
      ]);
      if (timer) clearTimeout(timer);
      const parts = response.candidates?.[0]?.content?.parts || [];
      const audioPart = parts.find((p) => p?.inlineData?.data);
      const inlineData = audioPart?.inlineData;
      if (!inlineData?.data) {
        throw new TtsServiceError(`Empty audio returned by ${attempt.model}`, {
          status: 502,
          code: "TTS_EMPTY_AUDIO",
          stage: "generation"
        });
      }
      const normalized = validateAndNormalizeAudioPayload(inlineData.data, inlineData.mimeType);
      return {
        audioBase64: normalized.audioBase64,
        mimeType: normalized.mimeType,
        provider: "gemini-tts",
        modelOrVoice: `${attempt.model}:${voiceName}`,
        locale,
        byteLength: normalized.byteLength
      };
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastErr = err;
      console.warn(
        `[Gemini-TTS] stage=${err?.stage || "generation"} model=${attempt.model} locale=${locale} voice=${voiceName} status=${err?.status || ""} msg=${err?.message || err}`
      );
      if (!isTtsRetryableError(err)) {
        break;
      }
    }
  }
  if (lastErr instanceof TtsServiceError) {
    throw lastErr;
  }
  throw lastErr || new Error("\u0641\u0634\u0644 \u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0635\u0648\u062A \u0639\u0628\u0631 Gemini-TTS");
}
async function synthesizeWithGoogleCloudTts(apiKey, text, locale, voice, speakingRate = 1) {
  const clampedRate = Math.min(2, Math.max(0.5, Number(speakingRate) || 1));
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: voice.languageCode,
          name: voice.name
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: clampedRate
        }
      })
    }
  );
  const json = await res.json();
  if (!res.ok || !json?.audioContent) {
    const errMsg = json?.error?.message || `Google Cloud TTS HTTP ${res.status}`;
    throw new TtsServiceError(`Google Cloud TTS: ${errMsg}`, {
      status: 502,
      code: "CLOUD_TTS_ERROR",
      stage: "generation"
    });
  }
  const normalized = validateAndNormalizeAudioPayload(json.audioContent, "audio/mpeg");
  return {
    audioBase64: normalized.audioBase64,
    mimeType: normalized.mimeType,
    provider: "google-cloud-tts",
    modelOrVoice: voice.name,
    locale,
    byteLength: normalized.byteLength
  };
}
async function synthesizeSpeechSegment(input) {
  const cleanText = normalizeSpeechTextServer(input.text);
  if (!cleanText) {
    throw new TtsServiceError("\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u062A\u062D\u0648\u064A\u0644\u0647 \u0625\u0644\u0649 \u0635\u0648\u062A \u0641\u0627\u0631\u063A.", {
      status: 400,
      code: "EMPTY_TTS_TEXT",
      stage: "validation"
    });
  }
  const boundedText = cleanText.slice(0, 1500);
  const cloudCheck = await isCloudTtsActuallyUsable();
  const cloudKey = cloudCheck.usable ? getGoogleCloudTtsApiKey() : null;
  const geminiEnabled = hasGeminiApiKey();
  const { locale, targetProvider, geminiVoiceName, cloudVoice } = validateRequestedLocaleAndVoice(
    String(input.locale || "ar-EG"),
    input.voiceId,
    geminiEnabled,
    cloudKey
  );
  const cacheKey = `${locale}|${targetProvider}:${targetProvider === "google-cloud-tts" ? cloudVoice?.name : geminiVoiceName}|${boundedText}`;
  const cached = serverTtsCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const storeInCache = (res) => {
    if (serverTtsCache.size >= MAX_SERVER_TTS_CACHE) {
      const oldestKey = serverTtsCache.keys().next().value;
      if (oldestKey) serverTtsCache.delete(oldestKey);
    }
    serverTtsCache.set(cacheKey, res);
    return res;
  };
  if (targetProvider === "google-cloud-tts" && cloudKey && cloudVoice) {
    return storeInCache(
      await synthesizeWithGoogleCloudTts(
        cloudKey,
        boundedText,
        locale,
        cloudVoice,
        input.speakingRate
      )
    );
  }
  const ai = getGenAI();
  try {
    return storeInCache(await synthesizeWithGeminiTts(ai, boundedText, locale, geminiVoiceName));
  } catch (geminiErr) {
    if (cloudKey && locale !== "ar-EG") {
      try {
        const cloudFallbackVoice = locale === "tr-TR" ? { languageCode: "tr-TR", name: "tr-TR-Wavenet-A" } : locale === "en-US" ? { languageCode: "en-US", name: "en-US-Wavenet-F" } : { languageCode: "ar-XA", name: "ar-XA-Wavenet-A" };
        return storeInCache(
          await synthesizeWithGoogleCloudTts(
            cloudKey,
            boundedText,
            locale,
            cloudFallbackVoice,
            input.speakingRate
          )
        );
      } catch (cloudErr) {
        console.warn("[Cloud-TTS Fallback] failed:", cloudErr?.message || cloudErr);
        throw geminiErr;
      }
    }
    throw geminiErr;
  }
}
function formatTtsErrorResponse(err) {
  if (err instanceof TtsServiceError) {
    return {
      status: err.status,
      code: err.code,
      stage: err.stage,
      error: err.message
    };
  }
  const msg = String(err?.message || err || "");
  const lower = msg.toLowerCase();
  if (lower.includes("404") || lower.includes("not_found")) {
    return {
      status: 502,
      code: "TTS_MODEL_UNAVAILABLE",
      stage: "generation",
      error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0646\u0645\u0648\u0630\u062C \u0627\u0644\u062A\u062D\u0648\u064A\u0644 \u0627\u0644\u0635\u0648\u062A\u064A \u0641\u064A Gemini \u062D\u0627\u0644\u064A\u0627\u064B. \u064A\u0645\u0643\u0646\u0643 \u0627\u0644\u062A\u062D\u0642\u0642 \u0645\u0646 \u0625\u0639\u062F\u0627\u062F Google Cloud TTS \u0623\u0648 \u0623\u0635\u0648\u0627\u062A \u0627\u0644\u0645\u062A\u0635\u0641\u062D."
    };
  }
  const translated = translateErrorToArabic(err);
  return {
    status: translated.status,
    code: translated.code,
    stage: "generation",
    error: translated.message
  };
}

// server.ts
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var PORT = parseInt(process.env.PORT || "3000", 10);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use((err, req, res, next) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    return res.status(413).json({
      success: false,
      code: "PAYLOAD_TOO_LARGE",
      error: "\u062D\u062C\u0645 \u0627\u0644\u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0645\u0631\u0641\u0648\u0639\u0629 \u0643\u0628\u064A\u0631 \u062C\u062F\u0627\u064B \u0648\u064A\u062A\u062C\u0627\u0648\u0632 \u0633\u0639\u0629 \u0627\u0644\u062E\u0627\u062F\u0645 \u0627\u0644\u0645\u0633\u0645\u0648\u062D\u0629. \u064A\u0631\u062C\u0649 \u062A\u0642\u0644\u064A\u0644 \u0639\u062F\u062F \u0627\u0644\u0635\u0641\u062D\u0627\u062A \u0623\u0648 \u0636\u063A\u0637 \u0627\u0644\u0635\u0648\u0631 \u0648\u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u062C\u062F\u062F\u0627\u064B."
    });
  }
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({
      success: false,
      code: "INVALID_JSON_PAYLOAD",
      error: "\u062A\u0646\u0633\u064A\u0642 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0631\u0633\u0644\u0629 \u0625\u0644\u0649 \u0627\u0644\u062E\u0627\u062F\u0645 \u063A\u064A\u0631 \u0635\u0627\u0644\u062D."
    });
  }
  next(err);
});
function cleanBase64Input(raw, fallbackMime = "image/jpeg") {
  let cleanBase64 = String(raw || "").trim();
  let actualMime = fallbackMime;
  if (cleanBase64.includes(";base64,")) {
    const parts = cleanBase64.split(";base64,");
    cleanBase64 = parts[1] || "";
    const mimeMatch = parts[0].match(/data:(.*?)$/);
    if (mimeMatch && mimeMatch[1]) {
      actualMime = mimeMatch[1];
    }
  }
  return { data: cleanBase64, mimeType: actualMime };
}
async function enrichVocabularyWithDictionary(rawVocab) {
  if (!Array.isArray(rawVocab)) return [];
  return Promise.all(
    rawVocab.map(async (v) => {
      const word = String(v?.word || "").trim();
      const aiMeaning = String(v?.meaning || "").trim();
      const dictHit = word ? await dictionaryProvider.lookup(word) : null;
      if (dictHit) {
        const combinedExtra = Array.from(
          /* @__PURE__ */ new Set([
            ...dictHit.meanings.filter((m) => m !== aiMeaning),
            ...Array.isArray(v?.additionalMeanings) ? v.additionalMeanings.map(String) : []
          ])
        ).slice(0, 4);
        return {
          word,
          meaning: aiMeaning || dictHit.meanings[0] || "",
          context: v?.context ? String(v.context) : void 0,
          wordType: v?.wordType ? String(v.wordType) : dictHit.wordType,
          additionalMeanings: combinedExtra,
          grammarInfo: v?.grammarInfo ? String(v.grammarInfo) : dictHit.grammarInfo,
          example: v?.example ? String(v.example) : dictHit.example,
          sourceType: "dictionary_verified",
          dictionarySource: dictHit.dictionarySource,
          sourceRef: v?.sourceRef ? String(v.sourceRef) : void 0
        };
      }
      return {
        word,
        meaning: aiMeaning,
        context: v?.context ? String(v.context) : void 0,
        wordType: v?.wordType ? String(v.wordType) : void 0,
        additionalMeanings: Array.isArray(v?.additionalMeanings) ? v.additionalMeanings.map(String).slice(0, 4) : void 0,
        grammarInfo: v?.grammarInfo ? String(v.grammarInfo) : void 0,
        example: v?.example ? String(v.example) : void 0,
        sourceType: "ai_contextual",
        dictionarySource: "\u062A\u0631\u062C\u0645\u0629 \u0633\u064A\u0627\u0642\u064A\u0629 \u0645\u0646 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 (AI)",
        sourceRef: v?.sourceRef ? String(v.sourceRef) : void 0
      };
    })
  );
}
app.get("/api/health", (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: "ok",
    app: "Wara2ty \u2013 \u0648\u0631\u0642\u062A\u064A",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"),
    pipelineStages: EXECUTION_PIPELINE.map((s) => s.label),
    dictionaryProvider: dictionaryProvider.name,
    memoryMB: Math.round(mem.rss / (1024 * 1024)),
    time: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.get("/api/tts/status", async (req, res) => {
  res.json({
    success: true,
    ...await getTtsStatus()
  });
});
app.post("/api/tts", async (req, res) => {
  try {
    const { text, locale = "ar-EG", voiceId, speakingRate = 1 } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({
        success: false,
        code: "EMPTY_TTS_TEXT",
        error: "\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u062A\u062D\u0648\u064A\u0644\u0647 \u0625\u0644\u0649 \u0635\u0648\u062A \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631."
      });
    }
    const result = await synthesizeSpeechSegment({
      text,
      locale,
      voiceId,
      speakingRate
    });
    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    const formatted = formatTtsErrorResponse(error);
    console.error(`[TTS Error] stage=${formatted.stage} code=${formatted.code} status=${formatted.status}`);
    return res.status(formatted.status).json({
      success: false,
      code: formatted.code,
      stage: formatted.stage,
      error: formatted.error
    });
  }
});
app.get("/api/dictionary/lookup", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query) {
      return res.json({ success: true, exact: null, matches: [] });
    }
    const exact = await dictionaryProvider.lookup(query);
    const matches = await dictionaryProvider.searchPrefix(query, 10);
    return res.json({
      success: true,
      provider: dictionaryProvider.name,
      exact,
      matches
    });
  } catch (error) {
    console.error("Dictionary lookup error:", error);
    return res.status(500).json({
      success: false,
      error: "\u062A\u0639\u0630\u0631 \u0627\u0644\u0628\u062D\u062B \u0641\u064A \u0627\u0644\u0645\u0639\u062C\u0645 \u062D\u0627\u0644\u064A\u0627\u064B."
    });
  }
});
app.post("/api/dictionary/lookup", async (req, res) => {
  try {
    const { word, lectureContext } = req.body || {};
    const cleanWord = String(word || "").trim();
    if (!cleanWord) {
      return res.status(400).json({ success: false, error: "\u064A\u0631\u062C\u0649 \u0625\u062F\u062E\u0627\u0644 \u0627\u0644\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629." });
    }
    const exact = await dictionaryProvider.lookup(cleanWord);
    if (exact) {
      return res.json({
        success: true,
        entry: {
          word: exact.word,
          meaning: exact.meanings[0] || "",
          additionalMeanings: exact.meanings.slice(1),
          wordType: exact.wordType,
          grammarInfo: exact.grammarInfo,
          example: exact.example,
          sourceType: "dictionary_verified",
          dictionarySource: exact.dictionarySource
        }
      });
    }
    const ai = getGenAI();
    const prompt = `
\u0623\u0646\u062A \u0645\u0639\u062C\u0645 \u0623\u0643\u0627\u062F\u064A\u0645\u064A \u062A\u0631\u0643\u064A-\u0639\u0631\u0628\u064A \u062F\u0642\u064A\u0642 \u0641\u064A \u062A\u0637\u0628\u064A\u0642 \u0648\u0631\u0642\u062A\u064A (Wara2ty).
\u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u0634\u0631\u062D \u0627\u0644\u0643\u0644\u0645\u0629 \u0623\u0648 \u0627\u0644\u0645\u0635\u0637\u0644\u062D \u0627\u0644\u062A\u0627\u0644\u064A \u0628\u062F\u0642\u0629 \u0627\u0633\u062A\u0646\u0627\u062F\u0627\u064B \u0625\u0644\u0649 \u0633\u064A\u0627\u0642 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0631\u0641\u0642 (\u0625\u0646 \u0648\u064F\u062C\u062F):
\u0627\u0644\u0643\u0644\u0645\u0629: ${cleanWord}
\u0633\u064A\u0627\u0642 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629: ${String(lectureContext || "").slice(0, 3e3)}

\u0645\u0644\u0627\u062D\u0638\u0629: \u0644\u0627 \u062A\u062E\u062A\u0631\u0639 \u0645\u0639\u0627\u0646\u064A \u063A\u064A\u0631 \u0645\u0648\u062B\u0648\u0642\u0629. \u0648\u0636\u0651\u062D \u0646\u0648\u0639 \u0627\u0644\u0643\u0644\u0645\u0629\u060C \u0627\u0644\u0645\u0639\u0646\u0649 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u060C \u0627\u0644\u0645\u0639\u0627\u0646\u064A \u0627\u0644\u0625\u0636\u0627\u0641\u064A\u0629 \u0625\u0646 \u0648\u062C\u062F\u062A\u060C \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0635\u0631\u0641\u064A\u0629/\u0627\u0644\u0644\u0648\u0627\u062D\u0642 \u0625\u0646 \u0643\u0627\u0646\u062A \u062A\u0631\u0643\u064A\u0629\u060C \u0648\u0645\u062B\u0627\u0644\u0627\u064B \u0628\u0633\u064A\u0637\u0627\u064B.
`;
    const schema = {
      type: Type.OBJECT,
      properties: {
        word: { type: Type.STRING },
        meaning: { type: Type.STRING },
        wordType: { type: Type.STRING },
        additionalMeanings: { type: Type.ARRAY, items: { type: Type.STRING } },
        grammarInfo: { type: Type.STRING },
        context: { type: Type.STRING },
        example: { type: Type.STRING }
      },
      required: ["word", "meaning", "wordType"]
    };
    const { response } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson(response.text || "{}");
    return res.json({
      success: true,
      entry: {
        word: String(parsed?.word || cleanWord),
        meaning: String(parsed?.meaning || ""),
        wordType: parsed?.wordType ? String(parsed.wordType) : void 0,
        additionalMeanings: Array.isArray(parsed?.additionalMeanings) ? parsed.additionalMeanings.map(String) : [],
        grammarInfo: parsed?.grammarInfo ? String(parsed.grammarInfo) : void 0,
        context: parsed?.context ? String(parsed.context) : void 0,
        example: parsed?.example ? String(parsed.example) : void 0,
        sourceType: "ai_contextual",
        dictionarySource: "\u062A\u0631\u062C\u0645\u0629 \u0633\u064A\u0627\u0642\u064A\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A (\u063A\u064A\u0631 \u0645\u062F\u0631\u062C\u0629 \u0641\u064A \u0627\u0644\u0645\u0639\u062C\u0645 \u0627\u0644\u0645\u062D\u0644\u064A)"
      }
    });
  } catch (error) {
    console.error("AI dictionary lookup error:", error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});
app.post("/api/analyze-note", async (req, res) => {
  try {
    const { imageBase64, mimeType = "image/jpeg", pages } = req.body || {};
    const inputParts = [];
    let totalPages = 1;
    if (Array.isArray(pages) && pages.length > 0) {
      if (pages.length > 10) {
        return res.status(400).json({
          success: false,
          code: "TOO_MANY_PAGES",
          error: "\u0627\u0644\u062D\u062F \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0644\u062A\u062D\u0644\u064A\u0644 \u0641\u064A \u0627\u0644\u062C\u0644\u0633\u0629 \u0627\u0644\u0648\u0627\u062D\u062F\u0629 \u0647\u0648 10 \u0635\u0641\u062D\u0627\u062A \u0644\u0636\u0645\u0627\u0646 \u062F\u0642\u0629 \u0627\u0644\u0642\u0631\u0627\u0621\u0629 \u0648\u0633\u0631\u0639\u0629 \u0627\u0644\u0645\u0639\u0627\u0644\u062C\u0629."
        });
      }
      totalPages = pages.length;
      pages.forEach((p, idx) => {
        const cleaned = cleanBase64Input(p?.imageBase64 || p?.dataUrl || "", p?.mimeType || "image/jpeg");
        if (cleaned.data && cleaned.data.length >= 50) {
          inputParts.push({ text: `--- \u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0631\u0642\u0645 ${p?.pageNumber || idx + 1} ---` });
          inputParts.push({
            inlineData: {
              mimeType: cleaned.mimeType,
              data: cleaned.data
            }
          });
        }
      });
    } else if (imageBase64 && typeof imageBase64 === "string") {
      const cleaned = cleanBase64Input(imageBase64, mimeType);
      if (!cleaned.data || cleaned.data.length < 50) {
        return res.status(400).json({
          success: false,
          code: "EMPTY_IMAGE",
          error: "\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0645\u0631\u0641\u0648\u0639 \u063A\u064A\u0631 \u0645\u0643\u062A\u0645\u0644\u0629 \u0623\u0648 \u062A\u0627\u0644\u0641\u0629. \u064A\u0631\u062C\u0649 \u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0644\u0641 \u0622\u062E\u0631."
        });
      }
      if (cleaned.mimeType === "application/pdf") {
        inputParts.push({ text: "--- \u0645\u0633\u062A\u0646\u062F \u0645\u062D\u0627\u0636\u0631\u0629 \u0628\u0635\u064A\u063A\u0629 PDF (\u0627\u0633\u062A\u062E\u0631\u062C \u0627\u0644\u0635\u0641\u062D\u0627\u062A \u0628\u0627\u0644\u062A\u0631\u062A\u064A\u0628 \u0645\u0639 \u0623\u0631\u0642\u0627\u0645 \u0627\u0644\u0635\u0641\u062D\u0627\u062A) ---" });
      }
      inputParts.push({
        inlineData: {
          mimeType: cleaned.mimeType,
          data: cleaned.data
        }
      });
    }
    if (inputParts.length === 0) {
      return res.status(400).json({
        success: false,
        code: "MISSING_IMAGE",
        error: "\u0644\u0645 \u064A\u062A\u0645 \u0625\u0631\u0641\u0627\u0642 \u0635\u0648\u0631\u0629 \u0623\u0648 \u0645\u0644\u0641 \u0644\u0644\u062A\u062D\u0644\u064A\u0644. \u064A\u0631\u062C\u0649 \u0627\u062E\u062A\u064A\u0627\u0631 \u0635\u0648\u0631\u0629 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0623\u0648\u0644\u0627\u064B."
      });
    }
    const ai = getGenAI();
    const promptText = `
\u0623\u0646\u062A \u062E\u0628\u064A\u0631 \u0623\u0643\u0627\u062F\u064A\u0645\u064A \u0648\u0645\u0633\u0627\u0639\u062F \u062F\u0631\u0627\u0633\u064A \u0645\u062A\u062E\u0635\u0635 \u0641\u064A \u062A\u062D\u0648\u064A\u0644 \u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0627\u062A (\u0633\u0648\u0627\u0621 \u0643\u0627\u0646\u062A \u0635\u0641\u062D\u0629 \u0648\u0627\u062D\u062F\u0629 \u0623\u0648 \u0639\u062F\u0629 \u0635\u0641\u062D\u0627\u062A \u0623\u0648 \u0645\u0633\u062A\u0646\u062F PDF) \u0625\u0644\u0649 \u0645\u0627\u062F\u0629 \u062F\u0631\u0627\u0633\u064A\u0629 \u0631\u0642\u0645\u064A\u0629 \u0645\u0646\u0638\u0645\u0629 \u0648\u062F\u0642\u064A\u0642\u0629 \u0641\u064A \u062A\u0637\u0628\u064A\u0642 "\u0648\u0631\u0642\u062A\u064A \u2013 Wara2ty".
\u0639\u062F\u062F \u0627\u0644\u0635\u0641\u062D\u0627\u062A \u0627\u0644\u0645\u0631\u0641\u0642\u0629 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u0637\u0644\u0628: ${totalPages}.

\u0627\u0644\u0645\u0647\u0627\u0645 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u0628\u062F\u0642\u0629 \u0648\u0623\u0645\u0627\u0646\u0629 \u0639\u0644\u0645\u064A\u0629:
1. \u0627\u0644\u0631\u0624\u064A\u0629 \u0627\u0644\u062D\u0627\u0633\u0648\u0628\u064A\u0629 \u0648\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0646\u0635\u0648\u0635 (OCR) \u0644\u0643\u0644 \u0635\u0641\u062D\u0629:
   - \u0627\u0642\u0631\u0623 \u062C\u0645\u064A\u0639 \u0627\u0644\u0635\u0641\u062D\u0627\u062A \u0627\u0644\u0645\u0631\u0641\u0642\u0629 (${totalPages} \u0635\u0641\u062D\u0629) \u0628\u0627\u0644\u062A\u0631\u062A\u064A\u0628 \u0627\u0644\u0635\u062D\u064A\u062D \u0643\u0640 "\u0645\u062D\u0627\u0636\u0631\u0629 \u0648\u0627\u062D\u062F\u0629 \u0645\u062A\u0643\u0627\u0645\u0644\u0629".
   - \u064A\u062C\u0628 \u0623\u0646 \u062A\u062D\u062A\u0648\u064A \u0645\u0635\u0641\u0648\u0641\u0629 pages \u0639\u0644\u0649 \u0639\u0646\u0635\u0631 \u0645\u0646\u0641\u0635\u0644 \u0644\u0643\u0644 \u0635\u0641\u062D\u0629 \u0645\u0646 \u0627\u0644\u0635\u0641\u062D\u0627\u062A \u0627\u0644\u0645\u0631\u0641\u0642\u0629 (\u0645\u0646 1 \u0625\u0644\u0649 ${totalPages}) \u0645\u0639 extractedText \u0648 arabicTranslation \u0644\u0643\u0644 \u0635\u0641\u062D\u0629.
   - \u062D\u0627\u0641\u0638 \u0639\u0644\u0649 \u0627\u0644\u0639\u0646\u0627\u0648\u064A\u0646\u060C \u0627\u0644\u0641\u0642\u0631\u0627\u062A\u060C \u0627\u0644\u0642\u0648\u0627\u0626\u0645\u060C \u0648\u0627\u0644\u0645\u0639\u0627\u062F\u0644\u0627\u062A\u060C \u0648\u0641\u0648\u0627\u0635\u0644 \u0627\u0644\u0635\u0641\u062D\u0627\u062A.
   - \u0644\u0627 \u062A\u062E\u062A\u0644\u0642 \u0643\u0644\u0645\u0627\u062A \u063A\u064A\u0631 \u0645\u0642\u0631\u0648\u0621\u0629 \u0623\u0648 \u0645\u0637\u0645\u0648\u0633\u0629 \u0625\u0637\u0644\u0627\u0642\u0627\u064B! \u0636\u0639 \u0639\u0644\u0627\u0645\u0629 [\u063A\u064A\u0631 \u0648\u0627\u0636\u062D] \u0639\u0646\u062F \u0627\u0644\u0643\u0644\u0645\u0629 \u063A\u064A\u0631 \u0627\u0644\u0648\u0627\u0636\u062D\u0629.
   - \u0635\u0646\u0651\u0641 \u0623\u062C\u0632\u0627\u0621 \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0633\u062A\u062E\u0631\u062C \u0641\u064A \u0645\u0635\u0641\u0648\u0641\u0629 ocrSegments (\u0628\u062D\u062F \u0623\u062F\u0646\u0649 \u0641\u0642\u0631\u0629/\u062C\u0632\u0621 \u0644\u0643\u0644 \u0642\u0633\u0645 \u0645\u0647\u0645) \u0625\u0644\u0649:
     * "verified" (\u0646\u0635 \u0645\u0648\u062B\u0642 \u0645\u0642\u0631\u0648\u0621 \u0628\u0648\u0636\u0648\u062D)
     * "needs_review" (\u064A\u062D\u062A\u0627\u062C \u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0637\u0627\u0644\u0628 \u0628\u0633\u0628\u0628 \u062E\u0637 \u063A\u064A\u0631 \u0645\u0646\u062A\u0638\u0645 \u0623\u0648 \u0627\u0644\u062A\u0628\u0627\u0633 \u0645\u062D\u062A\u0645\u0644)
     * "unclear" (\u0646\u0635 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D \u0623\u0648 \u0645\u0637\u0645\u0648\u0633)
   - \u0644\u0627 \u062A\u062E\u062A\u0631\u0639 \u0646\u0633\u0628\u0627\u064B \u0645\u0626\u0648\u064A\u0629 \u0644\u0644\u062B\u0642\u0629.
2. \u0643\u0634\u0641 \u0627\u0644\u0644\u063A\u0629 \u0648\u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0648\u0627\u0644\u0645\u062D\u0627\u0630\u0627\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629 (Bilingual Alignment):
   - \u062D\u062F\u062F \u0644\u063A\u0629 \u0627\u0644\u0645\u0635\u062F\u0631 (\u0645\u062B\u0644: \u0627\u0644\u062A\u0631\u0643\u064A\u0629\u060C \u0627\u0644\u0639\u0631\u0628\u064A\u0629\u060C \u0627\u0644\u0625\u0646\u062C\u0644\u064A\u0632\u064A\u0629\u060C \u062E\u0644\u064A\u0637 \u062A\u0631\u0643\u064A \u0648\u0639\u0631\u0628\u064A).
   - \u062A\u0631\u062C\u0645 \u0627\u0644\u0645\u062D\u062A\u0648\u0649 \u0643\u0627\u0645\u0644\u0627\u064B \u0625\u0644\u0649 \u0639\u0631\u0628\u064A\u0629 \u0641\u0635\u062D\u0649 \u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629 \u0648\u0627\u0636\u062D\u0629 (arabicTranslation).
   - \u064A\u062C\u0628 \u0623\u0646 \u062A\u062D\u062A\u0648\u064A \u0645\u0635\u0641\u0648\u0641\u0629 bilingualSections \u0639\u0644\u0649 \u062C\u0645\u064A\u0639 \u0641\u0642\u0631\u0627\u062A/\u0623\u0642\u0633\u0627\u0645 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0645\u062A\u0646\u0627\u0638\u0631\u0629 (originalText \u0645\u0642\u0627\u0628\u0644 arabicTranslation \u0645\u0639 pageNumber) \u0644\u0639\u0631\u0636\u0647\u0627 \u062C\u0646\u0628\u0627\u064B \u0625\u0644\u0649 \u062C\u0646\u0628.
3. \u0627\u0644\u062C\u062F\u0627\u0648\u0644 \u0648\u0627\u0644\u0631\u0633\u0648\u0645 \u0627\u0644\u062A\u0648\u0636\u064A\u062D\u064A\u0629 (Tables & Diagrams):
   - \u0625\u0630\u0627 \u0648\u062C\u062F\u062A \u062C\u062F\u0627\u0648\u0644 \u062F\u0627\u062E\u0644 \u0627\u0644\u0635\u0648\u0631 \u0623\u0648 \u0627\u0644\u0645\u0633\u062A\u0646\u062F\u060C \u0627\u0633\u062A\u062E\u0631\u062C\u0647\u0627 \u0641\u064A \u0642\u0627\u0626\u0645\u0629 tables (\u0627\u0644\u0639\u0646\u0648\u0627\u0646\u060C \u0627\u0644\u0635\u0641\u0648\u0641 \u0648\u0627\u0644\u0623\u0639\u0645\u062F\u0629 \u0628\u0627\u0644\u062A\u0631\u062A\u064A\u0628\u060C \u0627\u0644\u0631\u0624\u0648\u0633 headers). \u0644\u0627 \u062A\u062F\u0645\u062C \u0627\u0644\u062C\u062F\u0627\u0648\u0644 \u0641\u064A \u0641\u0642\u0631\u0627\u062A \u0639\u0627\u062F\u064A\u0629.
   - \u0627\u0641\u062D\u0635 \u062C\u0645\u064A\u0639 \u0627\u0644\u0635\u0641\u062D\u0627\u062A \u0628\u062D\u062B\u0627\u064B \u0639\u0646 \u0623\u064A \u0645\u062E\u0637\u0637 \u0623\u0648 \u062E\u0637 \u0632\u0645\u0646\u064A (Timeline) \u0623\u0648 \u0631\u0633\u0645 \u062A\u0648\u0636\u064A\u062D\u064A \u0623\u0648 \u0623\u0633\u0647\u0645 \u0623\u0648 \u0635\u0646\u062F\u0648\u0642 \u0628\u064A\u0627\u0646\u064A\u060C \u0648\u062D\u0644\u0651\u0644\u0647 \u0641\u064A \u0642\u0627\u0626\u0645\u0629 diagrams (\u0645\u0627 \u062A\u0645\u062B\u0644\u0647\u060C \u0627\u0644\u0639\u0644\u0627\u0642\u0627\u062A \u0628\u064A\u0646 \u0639\u0646\u0627\u0635\u0631\u0647\u0627\u060C \u0627\u0644\u062A\u0633\u0645\u064A\u0627\u062A \u0627\u0644\u0638\u0627\u0647\u0631\u0629\u060C \u0627\u0631\u062A\u0628\u0627\u0637\u0647\u0627 \u0628\u0627\u0644\u0646\u0635). \u0625\u0630\u0627 \u0643\u0627\u0646 \u0627\u0644\u0631\u0633\u0645 \u063A\u064A\u0631 \u0648\u0627\u0636\u062D \u0636\u0639 needsManualReview: true \u0648\u0644\u0627 \u062A\u062E\u062A\u0631\u0639 \u062A\u0641\u0627\u0635\u064A\u0644.
4. \u0627\u0644\u0645\u0639\u062C\u0645 \u0648\u0627\u0644\u0645\u0641\u0631\u062F\u0627\u062A \u0627\u0644\u062A\u0631\u0643\u064A\u0629/\u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629 (vocabulary):
   - \u0627\u0633\u062A\u062E\u0631\u062C \u0623\u0647\u0645 \u0627\u0644\u0643\u0644\u0645\u0627\u062A \u0648\u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 (5-10 \u0645\u0641\u0631\u062F\u0627\u062A) \u0645\u0639: word\u060C meaning (\u0627\u0644\u0645\u0639\u0646\u0649 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629)\u060C wordType (\u0646\u0648\u0639 \u0627\u0644\u0643\u0644\u0645\u0629)\u060C additionalMeanings\u060C grammarInfo\u060C context\u060C example\u060C sourceRef.
5. \u0627\u0644\u0645\u0644\u062E\u0635 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A (summary):
   - \u0639\u0646\u0648\u0627\u0646 \u0648\u0627\u0636\u062D\u060C \u0646\u0628\u0630\u0629 \u0639\u0627\u0645\u0629\u060C \u0646\u0642\u0627\u0637 \u0631\u0626\u064A\u0633\u064A\u0629\u060C \u0646\u0635\u064A\u062D\u0629 \u0627\u0645\u062A\u062D\u0627\u0646\u064A\u0629\u060C \u0648\u0645\u0631\u0627\u062C\u0639 \u0627\u0644\u0645\u0635\u062F\u0631 sourceRefs.
6. \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631 \u0627\u0644\u062A\u0641\u0627\u0639\u0644\u064A \u0627\u0644\u0645\u0628\u062F\u0626\u064A (quiz):
   - \u0623\u0646\u0634\u0626 5 \u0623\u0633\u0626\u0644\u0629 \u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0646 \u0645\u062A\u0639\u062F\u062F \u0645\u0628\u0646\u064A\u0629 \u062D\u0635\u0631\u0627\u064B \u0639\u0644\u0649 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629\u060C \u0644\u0643\u0644 \u0645\u0646\u0647\u0627 4 \u062E\u064A\u0627\u0631\u0627\u062A\u060C correctIndex (0..3)\u060C explanation \u0639\u0631\u0628\u064A\u060C topic\u060C \u0648 sourceRef (\u0645\u062B\u0644 "\u0635\u0641\u062D\u0629 1 \u2013 \u0642\u0633\u0645 \u0627\u0644\u0623\u0632\u0645\u0646\u0629" \u0623\u0648 "\u0645\u0631\u062C\u0639 \u062A\u0642\u0631\u064A\u0628\u064A \u0645\u0646 \u0646\u0635 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629" \u0648\u0644\u0627 \u062A\u062E\u062A\u0631\u0639 \u0623\u0631\u0642\u0627\u0645 \u0635\u0641\u062D\u0627\u062A \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629).

\u0623\u0631\u062C\u0639 \u0627\u0644\u0646\u062A\u064A\u062C\u0629 \u062D\u0635\u0631\u0627\u064B \u0628\u0635\u064A\u063A\u0629 JSON \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0644\u0645\u062E\u0637\u0637 \u0627\u0644\u0645\u062D\u062F\u062F.
`;
    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        detectedLanguage: { type: Type.STRING },
        clarityScore: { type: Type.STRING },
        topics: { type: Type.ARRAY, items: { type: Type.STRING } },
        extractedText: { type: Type.STRING },
        arabicTranslation: { type: Type.STRING },
        pages: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              pageNumber: { type: Type.INTEGER },
              title: { type: Type.STRING },
              extractedText: { type: Type.STRING },
              arabicTranslation: { type: Type.STRING },
              sourceNote: { type: Type.STRING }
            },
            required: ["pageNumber", "extractedText", "arabicTranslation"]
          }
        },
        ocrSegments: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              text: { type: Type.STRING },
              status: { type: Type.STRING, description: "verified | needs_review | unclear" },
              pageNumber: { type: Type.INTEGER },
              reason: { type: Type.STRING }
            },
            required: ["id", "text", "status"]
          }
        },
        bilingualSections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              pageNumber: { type: Type.INTEGER },
              sectionTitle: { type: Type.STRING },
              originalText: { type: Type.STRING },
              arabicTranslation: { type: Type.STRING }
            },
            required: ["id", "originalText", "arabicTranslation"]
          }
        },
        tables: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              pageNumber: { type: Type.INTEGER },
              headers: { type: Type.ARRAY, items: { type: Type.STRING } },
              rows: {
                type: Type.ARRAY,
                items: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              notes: { type: Type.STRING }
            },
            required: ["id", "title", "headers", "rows"]
          }
        },
        diagrams: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              title: { type: Type.STRING },
              pageNumber: { type: Type.INTEGER },
              description: { type: Type.STRING },
              relationships: { type: Type.ARRAY, items: { type: Type.STRING } },
              labels: { type: Type.ARRAY, items: { type: Type.STRING } },
              connectionToLecture: { type: Type.STRING },
              needsManualReview: { type: Type.BOOLEAN }
            },
            required: ["id", "title", "description", "connectionToLecture"]
          }
        },
        summary: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            overview: { type: Type.STRING },
            keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            examTip: { type: Type.STRING },
            sourceRefs: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["title", "overview", "keyPoints", "examTip"]
        },
        vocabulary: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              meaning: { type: Type.STRING },
              wordType: { type: Type.STRING },
              additionalMeanings: { type: Type.ARRAY, items: { type: Type.STRING } },
              grammarInfo: { type: Type.STRING },
              context: { type: Type.STRING },
              example: { type: Type.STRING },
              sourceRef: { type: Type.STRING }
            },
            required: ["word", "meaning"]
          }
        },
        quiz: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
              topic: { type: Type.STRING },
              sourceRef: { type: Type.STRING }
            },
            required: ["id", "question", "options", "correctIndex", "explanation"]
          }
        },
        uncertainSections: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: [
        "detectedLanguage",
        "clarityScore",
        "topics",
        "extractedText",
        "arabicTranslation",
        "pages",
        "ocrSegments",
        "bilingualSections",
        "tables",
        "diagrams",
        "summary",
        "vocabulary",
        "quiz"
      ]
    };
    const { response, modelUsed } = await executeGeminiWithResilience(
      ai,
      { parts: [...inputParts, { text: promptText }] },
      responseSchema
    );
    const rawParsed = safeParseJson(response.text || "{}");
    const normalizedPages = Array.isArray(rawParsed?.pages) && rawParsed.pages.length > 0 ? rawParsed.pages.map((p, idx) => ({
      pageNumber: Number(p?.pageNumber || idx + 1),
      title: p?.title ? String(p.title) : `\u0635\u0641\u062D\u0629 ${idx + 1}`,
      extractedText: String(p?.extractedText || ""),
      arabicTranslation: String(p?.arabicTranslation || ""),
      sourceNote: p?.sourceNote ? String(p.sourceNote) : void 0
    })) : [
      {
        pageNumber: 1,
        title: rawParsed?.summary?.title ? String(rawParsed.summary.title) : "\u0635\u0641\u062D\u0629 1",
        extractedText: String(rawParsed?.extractedText || ""),
        arabicTranslation: String(rawParsed?.arabicTranslation || "")
      }
    ];
    let normalizedOcrSegments = Array.isArray(rawParsed?.ocrSegments) ? rawParsed.ocrSegments.map((seg, idx) => {
      const st = String(seg?.status || "").toLowerCase();
      const status = st === "unclear" ? "unclear" : st === "needs_review" ? "needs_review" : "verified";
      return {
        id: String(seg?.id || `seg-${idx + 1}`),
        text: String(seg?.text || ""),
        status,
        pageNumber: typeof seg?.pageNumber === "number" ? seg.pageNumber : void 0,
        reason: seg?.reason ? String(seg.reason) : void 0
      };
    }) : [];
    if (normalizedOcrSegments.length === 0 && rawParsed?.extractedText) {
      normalizedOcrSegments = String(rawParsed.extractedText).split(/\n{1,2}/).map((line) => line.trim()).filter(Boolean).slice(0, 12).map((line, idx) => ({
        id: `seg-${idx + 1}`,
        text: line,
        status: line.includes("[\u063A\u064A\u0631 \u0648\u0627\u0636\u062D]") ? "unclear" : "verified"
      }));
    }
    let normalizedBilingual = Array.isArray(rawParsed?.bilingualSections) ? rawParsed.bilingualSections.map((b, idx) => ({
      id: String(b?.id || `bi-${idx + 1}`),
      pageNumber: typeof b?.pageNumber === "number" ? b.pageNumber : void 0,
      sectionTitle: b?.sectionTitle ? String(b.sectionTitle) : void 0,
      originalText: String(b?.originalText || ""),
      arabicTranslation: String(b?.arabicTranslation || "")
    })) : [];
    if (normalizedBilingual.length === 0 && normalizedPages.length > 0) {
      normalizedBilingual = normalizedPages.map((p, idx) => ({
        id: `bi-${idx + 1}`,
        pageNumber: p.pageNumber,
        sectionTitle: p.title || `\u0635\u0641\u062D\u0629 ${p.pageNumber}`,
        originalText: p.extractedText,
        arabicTranslation: p.arabicTranslation
      }));
    }
    const normalizedTables = Array.isArray(rawParsed?.tables) ? rawParsed.tables.map((t, idx) => ({
      id: String(t?.id || `tbl-${idx + 1}`),
      title: String(t?.title || `\u062C\u062F\u0648\u0644 ${idx + 1}`),
      pageNumber: typeof t?.pageNumber === "number" ? t.pageNumber : void 0,
      headers: Array.isArray(t?.headers) ? t.headers.map(String) : [],
      rows: Array.isArray(t?.rows) ? t.rows.map((r) => Array.isArray(r) ? r.map(String) : []) : [],
      notes: t?.notes ? String(t.notes) : void 0
    })) : [];
    const normalizedDiagrams = Array.isArray(rawParsed?.diagrams) ? rawParsed.diagrams.map((d, idx) => ({
      id: String(d?.id || `diag-${idx + 1}`),
      title: String(d?.title || `\u0645\u062E\u0637\u0637 \u062A\u0648\u0636\u064A\u062D\u064A ${idx + 1}`),
      pageNumber: typeof d?.pageNumber === "number" ? d.pageNumber : void 0,
      description: String(d?.description || ""),
      relationships: Array.isArray(d?.relationships) ? d.relationships.map(String) : [],
      labels: Array.isArray(d?.labels) ? d.labels.map(String) : [],
      connectionToLecture: String(d?.connectionToLecture || ""),
      needsManualReview: Boolean(d?.needsManualReview)
    })) : [];
    const enrichedVocabulary = await enrichVocabularyWithDictionary(rawParsed?.vocabulary || []);
    const normalizedData = {
      detectedLanguage: rawParsed?.detectedLanguage || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F",
      clarityScore: rawParsed?.clarityScore || "\u0648\u0627\u0636\u062D\u0629",
      topics: Array.isArray(rawParsed?.topics) ? rawParsed.topics.map(String) : [],
      extractedText: rawParsed?.extractedText || normalizedPages.map((p) => `[\u0635\u0641\u062D\u0629 ${p.pageNumber}]
${p.extractedText}`).join("\n\n") || "\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 \u0646\u0635 \u0648\u0627\u0636\u062D \u0641\u064A \u0627\u0644\u0645\u0644\u0641.",
      arabicTranslation: rawParsed?.arabicTranslation || normalizedPages.map((p) => p.arabicTranslation).join("\n\n") || "",
      pageCount: Math.max(totalPages, normalizedPages.length),
      pages: normalizedPages,
      ocrSegments: normalizedOcrSegments,
      bilingualSections: normalizedBilingual,
      tables: normalizedTables,
      diagrams: normalizedDiagrams,
      summary: {
        title: rawParsed?.summary?.title || "\u0645\u0644\u062E\u0635 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u062F\u0631\u0627\u0633\u064A\u0629",
        overview: rawParsed?.summary?.overview || "\u062A\u0645 \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0648\u062A\u062D\u0644\u064A\u0644 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0628\u0646\u062C\u0627\u062D.",
        keyPoints: Array.isArray(rawParsed?.summary?.keyPoints) ? rawParsed.summary.keyPoints.map(String) : [],
        examTip: rawParsed?.summary?.examTip || "\u0631\u0627\u062C\u0639 \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629 \u0648\u0627\u0644\u0646\u0642\u0627\u0637 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629 \u0642\u0628\u0644 \u0627\u0644\u0627\u062E\u062A\u0628\u0627\u0631.",
        sourceRefs: Array.isArray(rawParsed?.summary?.sourceRefs) ? rawParsed.summary.sourceRefs.map(String) : []
      },
      vocabulary: enrichedVocabulary,
      quiz: Array.isArray(rawParsed?.quiz) ? rawParsed.quiz.slice(0, 5).map((q, idx) => ({
        id: idx + 1,
        question: String(q?.question || `\u0633\u0624\u0627\u0644 ${idx + 1}`),
        options: Array.isArray(q?.options) && q.options.length >= 2 ? q.options.slice(0, 4).map(String) : ["\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u0623\u0648\u0644", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u062B\u0627\u0646\u064A", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u062B\u0627\u0644\u062B", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u0631\u0627\u0628\u0639"],
        correctIndex: typeof q?.correctIndex === "number" && q.correctIndex >= 0 && q.correctIndex <= 3 ? q.correctIndex : 0,
        explanation: String(q?.explanation || "\u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0645\u0633\u062A\u062E\u0631\u062C\u0629 \u0645\u0646 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629."),
        topic: q?.topic ? String(q.topic) : void 0,
        sourceRef: q?.sourceRef ? String(q.sourceRef) : void 0,
        type: "mcq"
      })) : [],
      uncertainSections: Array.isArray(rawParsed?.uncertainSections) ? rawParsed.uncertainSections.map(String) : []
    };
    return res.json({
      success: true,
      modelUsed,
      data: normalizedData
    });
  } catch (error) {
    console.error("Error analyzing lecture note:", error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({
      success: false,
      code: translated.code,
      retryable: translated.retryable,
      error: translated.message
    });
  }
});
app.post("/api/reprocess-text", async (req, res) => {
  try {
    const { correctedText, detectedLanguage } = req.body || {};
    if (!correctedText || typeof correctedText !== "string") {
      return res.status(400).json({ success: false, error: "\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0635\u062D\u062D \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631." });
    }
    const ai = getGenAI();
    const prompt = `
\u0642\u0627\u0645 \u0627\u0644\u0637\u0627\u0644\u0628 \u0628\u0645\u0631\u0627\u062C\u0639\u0629 \u0648\u062A\u0635\u062D\u064A\u062D \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0633\u062A\u062E\u0631\u062C \u0645\u0646 \u0645\u062D\u0627\u0636\u0631\u062A\u0647 (\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0645\u0643\u062A\u0634\u0641\u0629: ${detectedLanguage || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629"}).
\u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u0625\u0639\u0627\u062F\u0629 \u0625\u0646\u062A\u0627\u062C \u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629 (arabicTranslation)\u060C \u0648\u0623\u0642\u0633\u0627\u0645 \u0627\u0644\u0645\u062D\u0627\u0630\u0627\u0629 \u0627\u0644\u062B\u0646\u0627\u0626\u064A\u0629 (bilingualSections)\u060C \u0648\u0627\u0644\u0645\u0644\u062E\u0635 \u0627\u0644\u062F\u0631\u0627\u0633\u064A (summary) \u0628\u0646\u0627\u0621\u064B \u062D\u0635\u0631\u0627\u064B \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0635\u062D\u062D:

\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0635\u062D\u062D:
${correctedText.slice(0, 2e4)}
`;
    const schema = {
      type: Type.OBJECT,
      properties: {
        arabicTranslation: { type: Type.STRING },
        bilingualSections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              pageNumber: { type: Type.INTEGER },
              sectionTitle: { type: Type.STRING },
              originalText: { type: Type.STRING },
              arabicTranslation: { type: Type.STRING }
            },
            required: ["id", "originalText", "arabicTranslation"]
          }
        },
        summary: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            overview: { type: Type.STRING },
            keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            examTip: { type: Type.STRING }
          },
          required: ["title", "overview", "keyPoints", "examTip"]
        }
      },
      required: ["arabicTranslation", "bilingualSections", "summary"]
    };
    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson(response.text || "{}");
    return res.json({
      success: true,
      modelUsed,
      arabicTranslation: parsed?.arabicTranslation || "",
      bilingualSections: Array.isArray(parsed?.bilingualSections) ? parsed.bilingualSections : [],
      summary: parsed?.summary || null
    });
  } catch (error) {
    console.error("Error reprocessing corrected text:", error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});
app.post("/api/explain-lecture", async (req, res) => {
  try {
    const { lectureText, lectureTitle, arabicTranslation, mode = "detailed" } = req.body || {};
    if (!lectureText && !arabicTranslation) {
      return res.status(400).json({ success: false, error: "\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631 \u0644\u0644\u0634\u0631\u062D." });
    }
    const modeInstructions = {
      simple: "\u0627\u0634\u0631\u062D \u0628\u0623\u0633\u0644\u0648\u0628 \u0645\u0628\u0633\u0637 \u062C\u062F\u0627\u064B \u0648\u0648\u0627\u0636\u062D \u0645\u0646\u0627\u0633\u0628 \u0644\u0644\u0645\u0628\u062A\u062F\u0626\u064A\u0646 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629\u060C \u0645\u0639 \u062A\u0642\u0633\u064A\u0645 \u0627\u0644\u0641\u0642\u0631\u0627\u062A \u0648\u062A\u0628\u0633\u064A\u0637 \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0635\u0639\u0628\u0629 \u0648\u0623\u0645\u062B\u0644\u0629 \u0645\u0628\u0627\u0634\u0631\u0629 \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629.",
      detailed: "\u0642\u062F\u0645 \u0634\u0631\u062D\u0627\u064B \u062A\u0641\u0635\u064A\u0644\u064A\u0627\u064B \u0645\u062A\u062F\u0631\u062C\u0627\u064B \u064A\u063A\u0637\u064A \u0643\u0644 \u0645\u0641\u0627\u0647\u064A\u0645 \u0648\u0642\u0648\u0627\u0639\u062F \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629\u060C \u0648\u064A\u0641\u0643\u0643 \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0648\u0627\u0644\u0642\u0648\u0627\u0639\u062F \u0627\u0644\u0646\u062D\u0648\u064A\u0629 \u0623\u0648 \u0627\u0644\u0639\u0644\u0645\u064A\u0629 \u0628\u0623\u0645\u062B\u0644\u0629 \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0648\u064A\u0648\u0636\u062D \u0627\u0644\u0631\u0648\u0627\u0628\u0637 \u0628\u064A\u0646 \u0627\u0644\u0645\u0648\u0636\u0648\u0639\u0627\u062A.",
      academic: "\u0642\u062F\u0645 \u0634\u0631\u062D\u0627\u064B \u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0627\u064B \u0645\u0639\u0645\u0642\u0627\u064B \u0648\u062F\u0642\u064A\u0642\u0627\u064B \u0628\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0641\u0635\u062D\u0649 \u0627\u0644\u0639\u0644\u0645\u064A\u0629 \u0645\u0639 \u0627\u0644\u062D\u0641\u0627\u0638 \u0639\u0644\u0649 \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0623\u0635\u0644\u064A\u0629 \u0648\u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0639\u0644\u0627\u0642\u0627\u062A \u0648\u0627\u0644\u0628\u0646\u064A\u0629 \u0627\u0644\u0639\u0644\u0645\u064A\u0629 \u0644\u0644\u0645\u062D\u0627\u0636\u0631\u0629."
    };
    const selectedMode = ["simple", "detailed", "academic"].includes(mode) ? mode : "detailed";
    const ai = getGenAI();
    const prompt = `
\u0623\u0646\u062A \u0623\u0633\u062A\u0627\u0630 \u062C\u0627\u0645\u0639\u064A \u0648\u0645\u0633\u0627\u0639\u062F \u062F\u0631\u0627\u0633\u064A \u0641\u064A \u062A\u0637\u0628\u064A\u0642 \u0648\u0631\u0642\u062A\u064A (Wara2ty).
\u0627\u0644\u0645\u0637\u0644\u0648\u0628 \u0625\u0639\u062F\u0627\u062F "\u0627\u0644\u0634\u0631\u062D \u0627\u0644\u062A\u0641\u0635\u064A\u0644\u064A \u0644\u0644\u0645\u062D\u0627\u0636\u0631\u0629" \u0628\u0627\u0644\u0646\u0645\u0637 \u0627\u0644\u0645\u0637\u0644\u0648\u0628: (${selectedMode}).
\u062A\u0648\u062C\u064A\u0647 \u0627\u0644\u0646\u0645\u0637: ${modeInstructions[selectedMode]}

\u0642\u0648\u0627\u0639\u062F \u0635\u0627\u0631\u0645\u0629 \u0644\u0644\u0623\u0645\u0627\u0646\u0629 \u0627\u0644\u0639\u0644\u0645\u064A\u0629:
1. \u0627\u0639\u062A\u0645\u062F \u0639\u0644\u0649 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0631\u0641\u0642 \u0641\u0642\u0637. \u0644\u0627 \u062A\u0636\u0641 \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645\u0629 \u0623\u0648 \u062E\u0627\u0631\u062C \u0633\u064A\u0627\u0642 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629.
2. \u0627\u0641\u0635\u0644 \u0628\u0648\u0636\u0648\u062D \u0641\u064A \u0643\u0644 \u0642\u0633\u0645 \u0628\u064A\u0646:
   - lectureBasis: \u0645\u0627 \u0648\u0631\u062F \u0641\u0639\u0644\u0627\u064B \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629.
   - explanation: \u0627\u0644\u0634\u0631\u062D \u0627\u0644\u062A\u0648\u0636\u064A\u062D\u064A \u0644\u0644\u0637\u0627\u0644\u0628.
   - additionalNote: (\u0627\u062E\u062A\u064A\u0627\u0631\u064A) \u0623\u064A \u062A\u0648\u0636\u064A\u062D \u0625\u0636\u0627\u0641\u064A \u0645\u0633\u0627\u0639\u062F \u062E\u0627\u0631\u062C \u0627\u0644\u0646\u0635 \u064A\u064F\u0635\u0646\u0651\u0641 \u0635\u0631\u0627\u062D\u0629\u064B \u0643\u0645\u0639\u0644\u0648\u0645\u0629 \u0625\u0636\u0627\u0641\u064A\u0629 \u0645\u0633\u0627\u0639\u062F\u0629.
3. \u0623\u0636\u0641 \u0623\u0645\u062B\u0644\u0629 \u0645\u0633\u062A\u0645\u062F\u0629 \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629\u060C \u0648\u0623\u0628\u0631\u0632 \u0627\u0644\u0639\u0644\u0627\u0642\u0629 \u0628\u064A\u0646 \u0627\u0644\u0645\u0648\u0636\u0648\u0639\u0627\u062A (topicConnections)\u060C \u0648\u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062A \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629 \u0644\u0644\u0641\u0647\u0645 (keyTakeaways).
4. \u0623\u0631\u0641\u0642 \u0645\u0631\u062C\u0639 \u0627\u0644\u0645\u0635\u062F\u0631 (sourceRef) \u0644\u0643\u0644 \u0642\u0633\u0645 (\u0645\u062B\u0644: "\u0635\u0641\u062D\u0629 1 \u2013 \u0642\u0633\u0645 \u0627\u0644\u0642\u0648\u0627\u0639\u062F" \u0623\u0648 "\u0645\u0631\u062C\u0639 \u062A\u0642\u0631\u064A\u0628\u064A \u0645\u0646 \u0627\u0644\u0646\u0635" \u062F\u0648\u0646 \u0627\u062E\u062A\u0644\u0627\u0642 \u0623\u0631\u0642\u0627\u0645 \u0635\u0641\u062D\u0627\u062A).

\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629: ${lectureTitle || ""}
\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0633\u062A\u062E\u0631\u062C \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629:
${String(lectureText || "").slice(0, 16e3)}

\u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0627\u0644\u0645\u0631\u062C\u0639\u064A\u0629:
${String(arabicTranslation || "").slice(0, 8e3)}
`;
    const schema = {
      type: Type.OBJECT,
      properties: {
        mode: { type: Type.STRING },
        intro: { type: Type.STRING },
        sections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              heading: { type: Type.STRING },
              lectureBasis: { type: Type.STRING },
              explanation: { type: Type.STRING },
              additionalNote: { type: Type.STRING },
              examples: { type: Type.ARRAY, items: { type: Type.STRING } },
              sourceRef: { type: Type.STRING }
            },
            required: ["heading", "lectureBasis", "explanation"]
          }
        },
        topicConnections: { type: Type.ARRAY, items: { type: Type.STRING } },
        keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["intro", "sections", "topicConnections", "keyTakeaways"]
    };
    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson(response.text || "{}");
    return res.json({
      success: true,
      modelUsed,
      explanation: {
        mode: selectedMode,
        intro: String(parsed?.intro || ""),
        sections: Array.isArray(parsed?.sections) ? parsed.sections : [],
        topicConnections: Array.isArray(parsed?.topicConnections) ? parsed.topicConnections : [],
        keyTakeaways: Array.isArray(parsed?.keyTakeaways) ? parsed.keyTakeaways : []
      }
    });
  } catch (error) {
    console.error("Explain lecture error:", error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});
app.post("/api/ask-lecture", async (req, res) => {
  try {
    const { question, lectureText, arabicTranslation, lectureTitle, history = [] } = req.body || {};
    if (!question || typeof question !== "string") {
      return res.status(400).json({ success: false, error: "\u064A\u0631\u062C\u0649 \u0643\u062A\u0627\u0628\u0629 \u0633\u0624\u0627\u0644\u0643 \u0623\u0648\u0644\u0627\u064B." });
    }
    if (!lectureText && !arabicTranslation) {
      return res.status(400).json({ success: false, error: "\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631 \u0644\u0644\u0625\u062C\u0627\u0628\u0629." });
    }
    const ai = getGenAI();
    const recentHistory = Array.isArray(history) ? history.slice(-6).map((m) => `${m.role === "user" ? "\u0627\u0644\u0637\u0627\u0644\u0628" : "\u0627\u0644\u0645\u0633\u0627\u0639\u062F"}: ${String(m.content || "")}`).join("\n") : "";
    const prompt = `
\u0623\u0646\u062A \u0645\u0633\u0627\u0639\u062F \u062F\u0631\u0627\u0633\u064A \u0645\u062E\u0635\u0635 \u062D\u0635\u0631\u0627\u064B \u0644\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u062D\u0627\u0644\u064A\u0629 \u0641\u0642\u0637 ("\u0627\u0633\u0623\u0644 \u0645\u062D\u0627\u0636\u0631\u062A\u0643" \u0641\u064A \u062A\u0637\u0628\u064A\u0642 \u0648\u0631\u0642\u062A\u064A).
\u0644\u0627 \u062A\u062A\u0635\u0631\u0641 \u0643\u0645\u062D\u0627\u062F\u062B\u0629 \u0639\u0627\u0645\u0629 \u062E\u0627\u0631\u062C \u0645\u0648\u0636\u0648\u0639 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629.

\u0642\u0648\u0627\u0639\u062F \u0635\u0627\u0631\u0645\u0629:
1. \u0627\u0633\u062A\u062E\u062F\u0645 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u062A\u0627\u0644\u064A \u0643\u0645\u0635\u062F\u0631 \u0623\u0633\u0627\u0633\u064A \u0648\u062D\u064A\u062F \u0644\u0644\u0625\u062C\u0627\u0628\u0629.
2. \u0625\u0630\u0627 \u0644\u0645 \u064A\u0643\u0646 \u0627\u0644\u062C\u0648\u0627\u0628 \u0645\u0648\u062C\u0648\u062F\u0627\u064B \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0631\u0641\u0648\u0639\u0629\u060C \u0623\u062E\u0628\u0631 \u0627\u0644\u0637\u0627\u0644\u0628 \u0628\u0648\u0636\u0648\u062D \u0648\u0635\u062F\u0642 (\u0627\u062C\u0639\u0644 notFoundInLecture = true \u0648\u0627\u0643\u062A\u0628 \u0628\u0648\u0636\u0648\u062D \u0641\u064A answer \u0623\u0646 \u0647\u0630\u0647 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0629 \u063A\u064A\u0631 \u0648\u0627\u0631\u062F\u0629 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0631\u0641\u0648\u0639\u0629).
3. \u0625\u0630\u0627 \u0627\u0633\u062A\u062E\u062F\u0645\u062A \u0623\u064A \u0645\u0639\u0631\u0641\u0629 \u0639\u0627\u0645\u0629 \u0645\u0633\u0627\u0639\u062F\u0629 \u0644\u062A\u0648\u0636\u064A\u062D \u0645\u0641\u0647\u0648\u0645 \u0648\u0631\u062F \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629\u060C \u0636\u0639\u0647\u0627 \u062D\u0635\u0631\u0627\u064B \u0641\u064A \u0627\u0644\u062D\u0642\u0644 \u0627\u0644\u0645\u0646\u0641\u0635\u0644 additionalExplanation \u0648\u0644\u0627 \u062A\u062E\u0644\u0637\u0647\u0627 \u0645\u0639 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629.
4. \u0627\u0630\u0643\u0631 \u0627\u0644\u0645\u0631\u062C\u0639 \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0641\u064A sourceRef (\u0631\u0642\u0645 \u0627\u0644\u0635\u0641\u062D\u0629 \u0623\u0648 \u0627\u0644\u0642\u0633\u0645\u060C \u0623\u0648 \u0648\u0636\u0651\u062D \u0623\u0646\u0647 \u0645\u0631\u062C\u0639 \u062A\u0642\u0631\u064A\u0628\u064A).

\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629: ${lectureTitle || ""}
\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u0631\u062C:
${String(lectureText || "").slice(0, 15e3)}

\u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629:
${String(arabicTranslation || "").slice(0, 7e3)}

\u0633\u062C\u0644 \u0627\u0644\u0645\u062D\u0627\u062F\u062B\u0629 \u0627\u0644\u0633\u0627\u0628\u0642:
${recentHistory || "\u0644\u0627 \u064A\u0648\u062C\u062F"}

\u0633\u0624\u0627\u0644 \u0627\u0644\u0637\u0627\u0644\u0628 \u0627\u0644\u062D\u0627\u0644\u064A:
${question}
`;
    const schema = {
      type: Type.OBJECT,
      properties: {
        answer: { type: Type.STRING },
        additionalExplanation: { type: Type.STRING },
        sourceRef: { type: Type.STRING },
        notFoundInLecture: { type: Type.BOOLEAN }
      },
      required: ["answer", "notFoundInLecture"]
    };
    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson(response.text || "{}");
    return res.json({
      success: true,
      modelUsed,
      reply: {
        answer: String(parsed?.answer || ""),
        additionalExplanation: parsed?.additionalExplanation ? String(parsed.additionalExplanation) : void 0,
        sourceRef: parsed?.sourceRef ? String(parsed.sourceRef) : void 0,
        notFoundInLecture: Boolean(parsed?.notFoundInLecture)
      }
    });
  } catch (error) {
    console.error("Ask lecture error:", error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});
app.post("/api/explain-selection", async (req, res) => {
  try {
    const { selectedText, lectureText, lectureTitle, detectedLanguage } = req.body || {};
    if (!selectedText || typeof selectedText !== "string" || !selectedText.trim()) {
      return res.status(400).json({ success: false, error: "\u064A\u0631\u062C\u0649 \u062A\u062D\u062F\u064A\u062F \u0643\u0644\u0645\u0629 \u0623\u0648 \u062C\u0645\u0644\u0629 \u0623\u0648 \u0641\u0642\u0631\u0629 \u0645\u0646 \u0627\u0644\u0646\u0635 \u0623\u0648\u0644\u0627\u064B." });
    }
    const ai = getGenAI();
    const prompt = `
\u0627\u062E\u062A\u0627\u0631 \u0627\u0644\u0637\u0627\u0644\u0628 \u062C\u0632\u0621\u0627\u064B \u0645\u062D\u062F\u062F\u0627\u064B \u0645\u0646 \u0646\u0635 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0644\u064A\u0634\u0631\u062D\u0647 \u062A\u0637\u0628\u064A\u0642 \u0648\u0631\u0642\u062A\u064A \u0628\u0633\u0631\u0639\u0629 \u062F\u0648\u0646 \u0625\u0639\u0627\u062F\u0629 \u062A\u062D\u0644\u064A\u0644 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0643\u0627\u0645\u0644\u0629.
\u0627\u0644\u0644\u063A\u0629 \u0627\u0644\u0645\u0643\u062A\u0634\u0641\u0629 \u0644\u0644\u0645\u062D\u0627\u0636\u0631\u0629: ${detectedLanguage || "\u063A\u064A\u0631 \u0645\u062D\u062F\u062F\u0629"}
\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629: ${lectureTitle || ""}

\u0627\u0644\u062C\u0632\u0621 \u0627\u0644\u0645\u062D\u062F\u062F \u0645\u0646 \u0627\u0644\u0637\u0627\u0644\u0628:
"${selectedText.trim().slice(0, 2e3)}"

\u0633\u064A\u0627\u0642 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0643\u0627\u0645\u0644:
${String(lectureText || "").slice(0, 12e3)}

\u0627\u0644\u0645\u0637\u0644\u0648\u0628:
1. \u062A\u0631\u062C\u0645\u0629 \u0627\u0644\u062C\u0632\u0621 \u0627\u0644\u0645\u062D\u062F\u062F \u0625\u0644\u0649 \u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u0625\u0646 \u0643\u0627\u0646 \u0628\u0644\u063A\u0629 \u0623\u062C\u0646\u0628\u064A\u0629 (\u0623\u0648 \u0635\u064A\u0627\u063A\u0629 \u0648\u0627\u0636\u062D\u0629 \u0625\u0646 \u0643\u0627\u0646 \u0639\u0631\u0628\u064A\u0627\u064B).
2. \u0634\u0631\u062D \u0627\u0644\u0645\u0639\u0646\u0649 \u0628\u0648\u0636\u0648\u062D \u0648\u0628\u0633\u0627\u0637\u0629 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629.
3. \u062A\u0641\u0643\u064A\u0643 \u0627\u0644\u0643\u0644\u0645\u0627\u062A \u0623\u0648 \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0635\u0639\u0628\u0629 \u062F\u0627\u062E\u0644 \u0627\u0644\u062C\u0632\u0621 \u0627\u0644\u0645\u062D\u062F\u062F.
4. \u0634\u0631\u062D \u0623\u064A \u0642\u0627\u0639\u062F\u0629 \u0646\u062D\u0648\u064A\u0629 \u0623\u0648 \u0645\u0635\u0637\u0644\u062D \u0639\u0644\u0645\u064A/\u062A\u0642\u0646\u064A \u064A\u0638\u0647\u0631 \u0641\u064A \u0647\u0630\u0627 \u0627\u0644\u062C\u0632\u0621 \u0636\u0645\u0646 \u0633\u064A\u0627\u0642 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629.
5. \u062A\u0642\u062F\u064A\u0645 \u0645\u062B\u0627\u0644 \u0645\u0646\u0627\u0633\u0628 (\u0645\u0633\u062A\u0645\u062F \u0645\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0625\u0646 \u0623\u0645\u0643\u0646).
6. \u0631\u0628\u0637 \u0647\u0630\u0627 \u0627\u0644\u062C\u0632\u0621 \u0627\u0644\u0645\u062D\u062F\u062F \u0628\u0628\u0642\u064A\u0629 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0648\u0628\u064A\u0627\u0646 \u0645\u0635\u062F\u0631\u0647 \u0627\u0644\u062A\u0642\u0631\u064A\u0628\u064A \u0623\u0648 \u0627\u0644\u062F\u0642\u064A\u0642 (sourceRef).
`;
    const schema = {
      type: Type.OBJECT,
      properties: {
        selectedText: { type: Type.STRING },
        translation: { type: Type.STRING },
        explanation: { type: Type.STRING },
        vocabularyBreakdown: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              word: { type: Type.STRING },
              meaning: { type: Type.STRING }
            },
            required: ["word", "meaning"]
          }
        },
        grammarOrTechNote: { type: Type.STRING },
        example: { type: Type.STRING },
        connectionToLecture: { type: Type.STRING },
        sourceRef: { type: Type.STRING }
      },
      required: ["selectedText", "translation", "explanation", "vocabularyBreakdown", "connectionToLecture"]
    };
    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson(response.text || "{}");
    return res.json({
      success: true,
      modelUsed,
      result: {
        selectedText: String(parsed?.selectedText || selectedText.trim()),
        translation: String(parsed?.translation || ""),
        explanation: String(parsed?.explanation || ""),
        vocabularyBreakdown: Array.isArray(parsed?.vocabularyBreakdown) ? parsed.vocabularyBreakdown : [],
        grammarOrTechNote: parsed?.grammarOrTechNote ? String(parsed.grammarOrTechNote) : void 0,
        example: parsed?.example ? String(parsed.example) : void 0,
        connectionToLecture: String(parsed?.connectionToLecture || ""),
        sourceRef: parsed?.sourceRef ? String(parsed.sourceRef) : void 0
      }
    });
  } catch (error) {
    console.error("Explain selection error:", error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});
app.post("/api/study-tools", async (req, res) => {
  try {
    const { tool, lectureText, arabicTranslation, lectureTitle, summary, vocabulary } = req.body || {};
    if (!lectureText && !arabicTranslation) {
      return res.status(400).json({ success: false, error: "\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631." });
    }
    const ai = getGenAI();
    const contextBlock = `
\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629: ${lectureTitle || ""}
\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u0633\u062A\u062E\u0631\u062C (\u0627\u0644\u0645\u0639\u062A\u0645\u062F \u0628\u0639\u062F \u0623\u064A \u062A\u0639\u062F\u064A\u0644 \u0644\u0644\u0637\u0627\u0644\u0628):
${String(lectureText || "").slice(0, 15e3)}

\u0627\u0644\u062A\u0631\u062C\u0645\u0629 \u0627\u0644\u0639\u0631\u0628\u064A\u0629:
${String(arabicTranslation || "").slice(0, 7e3)}

\u0627\u0644\u0645\u0644\u062E\u0635: ${typeof summary === "object" ? JSON.stringify(summary) : String(summary || "")}
`;
    if (tool === "comparisons") {
      const prompt = `
\u062D\u062F\u062F \u0627\u0644\u0645\u0641\u0627\u0647\u064A\u0645 \u0623\u0648 \u0627\u0644\u0623\u0632\u0645\u0646\u0629 \u0623\u0648 \u0627\u0644\u0642\u0648\u0627\u0639\u062F \u0623\u0648 \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0645\u062A\u0642\u0627\u0628\u0644\u0629 \u0627\u0644\u062A\u064A \u064A\u0645\u0643\u0646 \u0645\u0642\u0627\u0631\u0646\u062A\u0647\u0627 \u062F\u0627\u062E\u0644 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0631\u0641\u0642\u0629 \u0641\u0642\u0637 (\u0645\u062B\u0644 \u0627\u0644\u0623\u0632\u0645\u0646\u0629 \u0627\u0644\u062A\u0631\u0643\u064A\u0629\u060C \u0623\u0648 \u0627\u0644\u0646\u0638\u0631\u064A\u0627\u062A\u060C \u0623\u0648 \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0645\u062A\u0634\u0627\u0628\u0647\u0629).
\u0634\u0631\u0648\u0637 \u0635\u0627\u0631\u0645\u0629:
- \u0644\u0627 \u062A\u062E\u062A\u0631\u0639 \u0645\u0642\u0627\u0631\u0646\u0627\u062A \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629\u060C \u0648\u0644\u0627 \u062A\u0645\u0644\u0623 \u062E\u0627\u0646\u0627\u062A \u0646\u0627\u0642\u0635\u0629 \u0628\u0627\u0641\u062A\u0631\u0627\u0636\u0627\u062A \u063A\u064A\u0631 \u0645\u062F\u0639\u0648\u0645\u0629!
- \u0625\u0630\u0627 \u0644\u0645 \u062A\u062A\u0648\u0641\u0631 \u0645\u0639\u0644\u0648\u0645\u0629 \u0644\u0639\u0646\u0635\u0631 \u0641\u064A \u0627\u0644\u062C\u062F\u0648\u0644 \u0627\u0643\u062A\u0628 "\u063A\u064A\u0631 \u0645\u0630\u0643\u0648\u0631 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629" \u0648\u0627\u0630\u0643\u0631 \u0627\u0644\u062A\u0641\u0627\u0635\u064A\u0644 \u0627\u0644\u0646\u0627\u0642\u0635\u0629 \u0641\u064A missingDetailsNote.
- \u0623\u0636\u0641 \u0627\u0644\u0623\u0639\u0645\u062F\u0629 \u0627\u0644\u0645\u0646\u0627\u0633\u0628\u0629 \u0645\u062B\u0644: \u0627\u0644\u0645\u0641\u0647\u0648\u0645\u060C \u0627\u0644\u062A\u0639\u0631\u064A\u0641\u060C \u0627\u0644\u062E\u0635\u0627\u0626\u0635 \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629\u060C \u0627\u0644\u0627\u0633\u062A\u062E\u062F\u0627\u0645\u060C \u0627\u0644\u0623\u0645\u062B\u0644\u0629\u060C \u0627\u0644\u0641\u0631\u0648\u0642\u0627\u062A.
- \u0627\u0630\u0643\u0631 \u0627\u0644\u0645\u0631\u062C\u0639 sourceRef.
${contextBlock}
`;
      const schema = {
        type: Type.OBJECT,
        properties: {
          tables: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                sourceRef: { type: Type.STRING },
                columns: { type: Type.ARRAY, items: { type: Type.STRING } },
                rows: {
                  type: Type.ARRAY,
                  items: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                missingDetailsNote: { type: Type.STRING }
              },
              required: ["id", "title", "columns", "rows"]
            }
          }
        },
        required: ["tables"]
      };
      const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
      const parsed = safeParseJson(response.text || "{}");
      return res.json({
        success: true,
        modelUsed,
        comparisonTables: Array.isArray(parsed?.tables) ? parsed.tables : []
      });
    }
    if (tool === "revision_sheet") {
      const prompt = `
\u0635\u0645\u0645 "\u0648\u0631\u0642\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0646\u0647\u0627\u0626\u064A\u0629" (Revision Sheet) \u0627\u0644\u0645\u0631\u0643\u0632\u0629 \u0648\u0633\u0631\u064A\u0639\u0629 \u0627\u0644\u0642\u0631\u0627\u0621\u0629 \u0642\u0628\u0644 \u0627\u0644\u0627\u0645\u062A\u062D\u0627\u0646 \u0627\u0633\u062A\u0646\u0627\u062F\u0627\u064B \u062D\u0635\u0631\u0627\u064B \u0644\u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629:
\u062A\u0634\u0645\u0644: \u0627\u0644\u0623\u0641\u0643\u0627\u0631 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629\u060C \u0627\u0644\u062A\u0639\u0631\u064A\u0641\u0627\u062A \u0627\u0644\u0645\u0647\u0645\u0629 \u0645\u0639 sourceRef\u060C \u0627\u0644\u0645\u0635\u0637\u0644\u062D\u0627\u062A \u0627\u0644\u0623\u0633\u0627\u0633\u064A\u0629\u060C \u0627\u0644\u0642\u0648\u0627\u0639\u062F \u0627\u0644\u0645\u0647\u0645\u0629\u060C \u0623\u0628\u0631\u0632 \u0627\u0644\u0623\u0645\u062B\u0644\u0629\u060C \u0627\u0644\u0645\u0642\u0627\u0631\u0646\u0627\u062A \u0627\u0644\u0633\u0631\u064A\u0639\u0629\u060C \u0646\u0642\u0627\u0637 \u062A\u0633\u062A\u062D\u0642 \u0627\u0646\u062A\u0628\u0627\u0647\u0627\u064B \u0625\u0636\u0627\u0641\u064A\u0627\u064B\u060C \u0648\u0642\u0627\u0626\u0645\u0629 \u0645\u0631\u0627\u062C\u0639\u0629 \u0646\u0647\u0627\u0626\u064A\u0629 (checklist).
${contextBlock}
\u0627\u0644\u0645\u0641\u0631\u062F\u0627\u062A: ${JSON.stringify(Array.isArray(vocabulary) ? vocabulary.slice(0, 20) : [])}
`;
      const schema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          mainIdeas: { type: Type.ARRAY, items: { type: Type.STRING } },
          definitions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                term: { type: Type.STRING },
                definition: { type: Type.STRING },
                sourceRef: { type: Type.STRING }
              },
              required: ["term", "definition"]
            }
          },
          essentialTerms: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                meaning: { type: Type.STRING }
              },
              required: ["word", "meaning"]
            }
          },
          importantRules: { type: Type.ARRAY, items: { type: Type.STRING } },
          keyExamples: { type: Type.ARRAY, items: { type: Type.STRING } },
          comparisons: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                itemA: { type: Type.STRING },
                itemB: { type: Type.STRING },
                difference: { type: Type.STRING }
              },
              required: ["itemA", "itemB", "difference"]
            }
          },
          watchOutPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
          checklist: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: [
          "title",
          "mainIdeas",
          "definitions",
          "essentialTerms",
          "importantRules",
          "keyExamples",
          "watchOutPoints",
          "checklist"
        ]
      };
      const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
      const parsed = safeParseJson(response.text || "{}");
      return res.json({
        success: true,
        modelUsed,
        revisionSheet: parsed
      });
    }
    if (tool === "expected_questions") {
      const prompt = `
\u0623\u0646\u0634\u0626 \u0645\u062C\u0645\u0648\u0639\u0629 \u0645\u0646 6 \u0623\u0633\u0626\u0644\u0629 \u062A\u062F\u0631\u064A\u0628\u064A\u0629 \u0645\u062A\u0648\u0642\u0639\u0629 (AI-generated practice / potential exam questions) \u0645\u062A\u0646\u0648\u0639\u0629 \u0627\u0644\u0623\u0646\u0648\u0627\u0639 \u0628\u0646\u0627\u0621\u064B \u062D\u0635\u0631\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0631\u0641\u0642\u0629:
\u062A\u0634\u0645\u0644 \u062A\u0646\u0648\u0639\u0627\u064B \u0645\u0646 \u0627\u0644\u0623\u0646\u0648\u0627\u0639: mcq\u060C true_false\u060C short_answer\u060C definition\u060C explanation\u060C comparison.
\u0645\u0644\u0627\u062D\u0638\u0629: \u0644\u0627 \u062A\u062F\u0651\u0639\u0650 \u0623\u0646\u0647\u0627 \u0623\u0633\u0626\u0644\u0629 \u0627\u0645\u062A\u062D\u0627\u0646 \u0631\u0633\u0645\u064A\u0629 \u062D\u0642\u064A\u0642\u064A\u0629\u061B \u0647\u064A \u0623\u0633\u0626\u0644\u0629 \u062A\u062F\u0631\u064A\u0628\u064A\u0629 \u0645\u0642\u062A\u0631\u062D\u0629 \u0628\u0627\u0644\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0635\u0637\u0646\u0627\u0639\u064A.
\u0623\u0631\u0641\u0642 \u0644\u0643\u0644 \u0633\u0624\u0627\u0644: modelAnswer (\u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0627\u0644\u0646\u0645\u0648\u0630\u062C\u064A\u0629)\u060C explanation (\u0627\u0644\u062A\u0641\u0633\u064A\u0631)\u060C \u0648 sourceRef (\u0645\u0631\u062C\u0639 \u0627\u0644\u0635\u0641\u062D\u0629/\u0627\u0644\u0642\u0633\u0645 \u0623\u0648 \u0645\u0631\u062C\u0639 \u062A\u0642\u0631\u064A\u0628\u064A).
${contextBlock}
`;
      const schema = {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.INTEGER },
                type: {
                  type: Type.STRING,
                  description: "mcq | true_false | short_answer | definition | explanation | comparison"
                },
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                correctIndex: { type: Type.INTEGER },
                booleanAnswer: { type: Type.BOOLEAN },
                modelAnswer: { type: Type.STRING },
                explanation: { type: Type.STRING },
                sourceRef: { type: Type.STRING }
              },
              required: ["id", "type", "question", "modelAnswer", "explanation"]
            }
          }
        },
        required: ["questions"]
      };
      const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
      const parsed = safeParseJson(response.text || "{}");
      return res.json({
        success: true,
        modelUsed,
        expectedExamQuestions: Array.isArray(parsed?.questions) ? parsed.questions : []
      });
    }
    if (tool === "mind_map") {
      const prompt = `
\u0623\u0646\u0634\u0626 \u0628\u0646\u064A\u0629 "\u062E\u0631\u064A\u0637\u0629 \u0630\u0647\u0646\u064A\u0629" (Mind Map) \u0647\u0631\u0645\u064A\u0629 \u0648\u0627\u0636\u062D\u0629 \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629 \u062A\u0639\u0643\u0633 \u0627\u0644\u0647\u064A\u0643\u0644 \u0627\u0644\u0641\u0639\u0644\u064A \u0644\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0631\u0641\u0642\u0629 \u0641\u0642\u0637 \u062F\u0648\u0646 \u0625\u0636\u0627\u0641\u0629 \u0645\u0648\u0627\u0636\u064A\u0639 \u063A\u064A\u0631 \u0648\u0627\u0631\u062F\u0629 \u0641\u064A\u0647\u0627.
\u062A\u0634\u0645\u0644 \u0627\u0644\u0645\u0648\u0636\u0648\u0639 \u0627\u0644\u0631\u0626\u064A\u0633\u064A centralTopic\u060C \u0648\u0641\u0631\u0648\u0639\u0627\u064B \u0631\u0626\u064A\u0633\u064A\u0629 branches (\u0645\u0639 sourceRef)\u060C \u0648\u062A\u062D\u062A \u0643\u0644 \u0641\u0631\u0639 \u0646\u0642\u0627\u0637\u0627\u064B \u0641\u0631\u0639\u064A\u0629 children (title \u0648 details \u0645\u062E\u062A\u0635\u0631\u0629).
${contextBlock}
`;
      const schema = {
        type: Type.OBJECT,
        properties: {
          centralTopic: { type: Type.STRING },
          branches: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                sourceRef: { type: Type.STRING },
                children: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      details: { type: Type.STRING }
                    },
                    required: ["title"]
                  }
                }
              },
              required: ["id", "title", "children"]
            }
          }
        },
        required: ["centralTopic", "branches"]
      };
      const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
      const parsed = safeParseJson(response.text || "{}");
      return res.json({
        success: true,
        modelUsed,
        mindMap: parsed
      });
    }
    return res.status(400).json({ success: false, error: "\u0627\u0644\u0623\u062F\u0627\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629 \u063A\u064A\u0631 \u0645\u0639\u0631\u0648\u0641\u0629." });
  } catch (error) {
    console.error("Study tool generation error:", error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});
app.post("/api/generate-quiz", async (req, res) => {
  try {
    const { lectureText, lectureTitle, summary, vocabulary, mode = "quick" } = req.body || {};
    if (!lectureText && !summary) {
      return res.status(400).json({
        success: false,
        code: "MISSING_LECTURE_CONTENT",
        error: "\u0646\u0635 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u063A\u064A\u0631 \u0645\u062A\u0648\u0641\u0631 \u0644\u062A\u0648\u0644\u064A\u062F \u0627\u0644\u0623\u0633\u0626\u0644\u0629."
      });
    }
    const modeSpecs = {
      quick: {
        count: 5,
        instructions: "\u0627\u062E\u062A\u0628\u0627\u0631 \u0633\u0631\u064A\u0639 \u0645\u0646 5 \u0623\u0633\u0626\u0644\u0629 \u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0646 \u0645\u062A\u0639\u062F\u062F \u0644\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0633\u0631\u064A\u0639\u0629."
      },
      comprehensive: {
        count: 8,
        instructions: "\u0627\u062E\u062A\u0628\u0627\u0631 \u0634\u0627\u0645\u0644 \u0645\u0646 8 \u0623\u0633\u0626\u0644\u0629 \u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0646 \u0645\u062A\u0639\u062F\u062F \u064A\u063A\u0637\u064A \u062C\u0645\u064A\u0639 \u0623\u0642\u0633\u0627\u0645 \u0648\u0623\u0641\u0643\u0627\u0631 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629."
      },
      difficult: {
        count: 6,
        instructions: "\u0627\u062E\u062A\u0628\u0627\u0631 \u0623\u0633\u0626\u0644\u0629 \u0639\u0645\u064A\u0642\u0629 \u0648\u0635\u0639\u0628\u0629 (6 \u0623\u0633\u0626\u0644\u0629) \u062A\u062A\u0637\u0644\u0628 \u0641\u0647\u0645\u0627\u064B \u062A\u062D\u0644\u064A\u0644\u064A\u0627\u064B \u0648\u0631\u0628\u0637\u0627\u064B \u0628\u064A\u0646 \u0642\u0648\u0627\u0639\u062F \u0648\u0645\u0641\u0627\u0647\u064A\u0645 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629."
      },
      vocabulary: {
        count: 6,
        instructions: "\u0627\u062E\u062A\u0628\u0627\u0631 \u0645\u0641\u0631\u062F\u0627\u062A \u0648\u0645\u0635\u0637\u0644\u062D\u0627\u062A (6 \u0623\u0633\u0626\u0644\u0629) \u064A\u0631\u0643\u0632 \u0639\u0644\u0649 \u0645\u0639\u0627\u0646\u064A \u0627\u0644\u0643\u0644\u0645\u0627\u062A \u0627\u0644\u062A\u0631\u0643\u064A\u0629/\u0627\u0644\u0623\u0643\u0627\u062F\u064A\u0645\u064A\u0629 \u0648\u0633\u064A\u0627\u0642\u0647\u0627 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629."
      },
      true_false: {
        count: 6,
        instructions: '\u0627\u062E\u062A\u0628\u0627\u0631 \u0635\u062D \u0623\u0645 \u062E\u0637\u0623 (6 \u0639\u0628\u0627\u0631\u0627\u062A) \u0645\u0628\u0646\u064A\u0629 \u0628\u062F\u0642\u0629 \u0639\u0644\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629. \u064A\u062C\u0628 \u0623\u0646 \u062A\u0643\u0648\u0646 options = ["\u0635\u062D", "\u062E\u0637\u0623"] \u0641\u0642\u0637 \u0648 correctIndex = 0 \u0644\u0644\u0635\u062D \u0623\u0648 1 \u0644\u0644\u062E\u0637\u0623.'
      },
      exam_simulation: {
        count: 8,
        instructions: "\u0645\u062D\u0627\u0643\u0627\u0629 \u0627\u062E\u062A\u0628\u0627\u0631 \u062C\u0627\u0645\u0639\u064A \u0645\u0646 8 \u0623\u0633\u0626\u0644\u0629 \u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0646 \u0645\u062A\u0639\u062F\u062F \u0645\u062A\u0646\u0648\u0639\u0629 \u0627\u0644\u0635\u0639\u0648\u0628\u0629 \u0648\u0645\u0628\u0646\u064A\u0629 \u062D\u0635\u0631\u0627\u064B \u0639\u0644\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629."
      }
    };
    const spec = modeSpecs[mode] || modeSpecs.quick;
    const ai = getGenAI();
    const prompt = `
\u0623\u0646\u062A \u062E\u0628\u064A\u0631 \u0623\u0643\u0627\u062F\u064A\u0645\u064A \u0648\u0648\u0627\u0636\u0639 \u0627\u062E\u062A\u0628\u0627\u0631\u0627\u062A \u0641\u064A \u062A\u0637\u0628\u064A\u0642 "\u0648\u0631\u0642\u062A\u064A \u2013 Wara2ty".
\u0627\u0644\u0646\u0645\u0637 \u0627\u0644\u0645\u0637\u0644\u0648\u0628: ${mode} \u2014 ${spec.instructions}

\u0627\u0644\u0634\u0631\u0648\u0637 \u0627\u0644\u0625\u0644\u0632\u0627\u0645\u064A\u0629:
1. \u0627\u0644\u0623\u0633\u0626\u0644\u0629 \u0645\u0628\u0646\u064A\u0629 100% \u0639\u0644\u0649 \u0645\u062D\u062A\u0648\u0649 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 \u0627\u0644\u0645\u0631\u0641\u0642 \u0641\u0642\u0637.
2. \u0641\u064A \u0627\u0644\u0627\u062E\u062A\u064A\u0627\u0631 \u0645\u0646 \u0645\u062A\u0639\u062F\u062F\u060C \u0644\u0643\u0644 \u0633\u0624\u0627\u0644 4 \u062E\u064A\u0627\u0631\u0627\u062A \u0648\u0627\u0636\u062D\u0629. \u0648\u0641\u064A \u0646\u0645\u0637 \u0635\u062D/\u062E\u0637\u0623\u060C \u0627\u0644\u062E\u064A\u0627\u0631\u0627\u0646 \u0647\u0645\u0627 ["\u0635\u062D", "\u062E\u0637\u0623"].
3. \u0627\u0630\u0643\u0631 \u0634\u0631\u062D\u0627\u064B \u062A\u0639\u0644\u064A\u0645\u064A\u0627\u064B \u0628\u0627\u0644\u0639\u0631\u0628\u064A\u0629 (explanation)\u060C \u0648\u0627\u0644\u0645\u0648\u0636\u0648\u0639 \u0627\u0644\u0641\u0631\u0639\u064A (topic) \u0644\u062A\u062D\u062F\u064A\u062F \u0646\u0642\u0627\u0637 \u0627\u0644\u0636\u0639\u0641\u060C \u0648\u0645\u0631\u062C\u0639 \u0627\u0644\u0645\u0635\u062F\u0631 \u0641\u064A \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629 (sourceRef).

\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629: ${lectureTitle || ""}
\u0645\u0644\u062E\u0635 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629: ${typeof summary === "object" ? JSON.stringify(summary) : summary || ""}
\u0627\u0644\u0645\u0641\u0631\u062F\u0627\u062A: ${JSON.stringify(Array.isArray(vocabulary) ? vocabulary.slice(0, 15) : [])}

\u0646\u0635 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629:
${String(lectureText || "").slice(0, 15e3)}
`;
    const quizSchema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.INTEGER },
          question: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          correctIndex: { type: Type.INTEGER },
          explanation: { type: Type.STRING },
          topic: { type: Type.STRING },
          sourceRef: { type: Type.STRING }
        },
        required: ["id", "question", "options", "correctIndex", "explanation"]
      }
    };
    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, quizSchema);
    const parsedPayload = safeParseJson(response.text || "[]");
    const rawQuestions = Array.isArray(parsedPayload) ? parsedPayload : Array.isArray(parsedPayload?.questions) ? parsedPayload.questions : Array.isArray(parsedPayload?.quiz) ? parsedPayload.quiz : [];
    if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
      throw new Error("\u0644\u0645 \u064A\u0631\u062C\u0639 \u0627\u0644\u0646\u0645\u0648\u0630\u062C \u0642\u0627\u0626\u0645\u0629 \u0623\u0633\u0626\u0644\u0629 \u0635\u0627\u0644\u062D\u0629.");
    }
    const isTrueFalse = mode === "true_false";
    const normalizedQuestions = rawQuestions.slice(0, spec.count).map((q, idx) => {
      const opts = isTrueFalse ? ["\u0635\u062D", "\u062E\u0637\u0623"] : Array.isArray(q?.options) && q.options.length >= 2 ? q.options.slice(0, 4).map(String) : ["\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u0623\u0648\u0644", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u062B\u0627\u0646\u064A", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u062B\u0627\u0644\u062B", "\u0627\u0644\u062E\u064A\u0627\u0631 \u0627\u0644\u0631\u0627\u0628\u0639"];
      const maxIdx = opts.length - 1;
      const correctIdx = typeof q?.correctIndex === "number" && q.correctIndex >= 0 && q.correctIndex <= maxIdx ? q.correctIndex : 0;
      return {
        id: idx + 1,
        question: String(q?.question || `\u0633\u0624\u0627\u0644 ${idx + 1}`),
        options: opts,
        correctIndex: correctIdx,
        explanation: String(q?.explanation || "\u0627\u0644\u0625\u062C\u0627\u0628\u0629 \u0627\u0644\u0635\u062D\u064A\u062D\u0629 \u0645\u0633\u062A\u0645\u062F\u0629 \u0645\u0646 \u0634\u0631\u062D \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0629."),
        topic: q?.topic ? String(q.topic) : void 0,
        sourceRef: q?.sourceRef ? String(q.sourceRef) : void 0,
        type: isTrueFalse ? "true_false" : "mcq"
      };
    });
    return res.json({
      success: true,
      modelUsed,
      mode,
      questions: normalizedQuestions
    });
  } catch (error) {
    console.error("Error generating quiz questions:", error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({
      success: false,
      code: translated.code,
      retryable: translated.retryable,
      error: translated.message
    });
  }
});
app.post("/api/compare-lectures", async (req, res) => {
  try {
    const { lectures } = req.body || {};
    if (!Array.isArray(lectures) || lectures.length < 2) {
      return res.status(400).json({
        success: false,
        error: "\u064A\u0631\u062C\u0649 \u062A\u062D\u062F\u064A\u062F \u0645\u062D\u0627\u0636\u0631\u062A\u064A\u0646 \u0639\u0644\u0649 \u0627\u0644\u0623\u0642\u0644 \u0644\u0644\u0645\u0642\u0627\u0631\u0646\u0629 \u0648\u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u0645\u0634\u062A\u0631\u0643\u0629."
      });
    }
    const ai = getGenAI();
    const condensed = lectures.slice(0, 4).map((l, i) => ({
      index: i + 1,
      title: String(l?.title || `\u0645\u062D\u0627\u0636\u0631\u0629 ${i + 1}`),
      summary: l?.summary || {},
      excerpt: String(l?.extractedText || "").slice(0, 3500)
    }));
    const prompt = `
\u0623\u0646\u062A \u0645\u0633\u0627\u0639\u062F \u062F\u0631\u0627\u0633\u064A \u0630\u0643\u064A \u0641\u064A \u062A\u0637\u0628\u064A\u0642 \u0648\u0631\u0642\u062A\u064A.
\u0642\u0627\u0631\u0646 \u0628\u064A\u0646 \u0627\u0644\u0645\u062D\u0627\u0636\u0631\u0627\u062A \u0627\u0644\u0645\u062D\u0641\u0648\u0638\u0629 \u0627\u0644\u062A\u0627\u0644\u064A\u0629 \u0648\u0623\u0639\u062F \u0645\u0631\u0627\u062C\u0639\u0629 \u0645\u062C\u0645\u0639\u0629 \u062A\u0631\u0628\u0637 \u0628\u064A\u0646\u0647\u0627 \u0628\u062F\u0642\u0629 \u062F\u0648\u0646 \u0627\u062E\u062A\u0644\u0627\u0642 \u0645\u0639\u0644\u0648\u0645\u0627\u062A \u063A\u064A\u0631 \u0645\u0648\u062C\u0648\u062F\u0629 \u0641\u064A\u0647\u0627:
${JSON.stringify(condensed)}
`;
    const schema = {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        sharedConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
        keyDifferences: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              topic: { type: Type.STRING },
              details: { type: Type.STRING }
            },
            required: ["topic", "details"]
          }
        },
        combinedChecklist: { type: Type.ARRAY, items: { type: Type.STRING } },
        studyAdvice: { type: Type.STRING }
      },
      required: ["title", "sharedConcepts", "keyDifferences", "combinedChecklist", "studyAdvice"]
    };
    const { response, modelUsed } = await executeGeminiWithResilience(ai, prompt, schema);
    const parsed = safeParseJson(response.text || "{}");
    return res.json({
      success: true,
      modelUsed,
      review: parsed
    });
  } catch (error) {
    console.error("Compare lectures error:", error?.message || error);
    const translated = translateErrorToArabic(error);
    return res.status(translated.status).json({ success: false, error: translated.message });
  }
});
async function startServer() {
  const distPath = path.resolve(__dirname, "dist");
  const indexHtmlPath = path.resolve(distPath, "index.html");
  const hasDist = fs2.existsSync(indexHtmlPath);
  const isCompiledServer = __filename.endsWith(".js");
  const isExplicitProduction = process.env.NODE_ENV === "production";
  const isProduction = (isExplicitProduction || isCompiledServer) && hasDist;
  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa"
      });
      app.use(vite.middlewares);
      console.log("Vite middleware mounted in development mode");
    } catch (viteErr) {
      console.warn("Could not initialize Vite middleware, falling back to static files:", viteErr);
      if (hasDist) {
        app.use(express.static(distPath));
        app.get("*", (req, res) => res.sendFile(indexHtmlPath));
      }
    }
  } else {
    if (hasDist) {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(indexHtmlPath);
      });
      console.log(`Serving static production files from: ${distPath}`);
    } else {
      console.warn("Warning: dist/index.html was not found. Serving fallback page.");
      app.get("*", (req, res) => {
        res.status(200).send(`
          <!DOCTYPE html>
          <html lang="ar" dir="rtl">
            <head><meta charset="UTF-8"><title>Wara2ty \u2013 \u0648\u0631\u0642\u062A\u064A</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h2>\u062A\u0637\u0628\u064A\u0642 \u0648\u0631\u0642\u062A\u064A \u2013 Wara2ty</h2>
              <p>\u0627\u0644\u062E\u0627\u062F\u0645 \u064A\u0639\u0645\u0644 \u0628\u0646\u062C\u0627\u062D \u0639\u0644\u0649 \u0627\u0644\u0645\u0646\u0641\u0630 ${PORT}. \u064A\u0631\u062C\u0649 \u062A\u0634\u063A\u064A\u0644 \u0628\u0646\u0627\u0621 \u0648\u0627\u062C\u0647\u0629 \u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645 (npm run build).</p>
            </body>
          </html>
        `);
      });
    }
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Wara2ty server is running at http://0.0.0.0:${PORT} [mode: ${isProduction ? "production" : "development"}]`);
  });
  server.keepAliveTimeout = 12e4;
  server.headersTimeout = 125e3;
  process.on("SIGTERM", () => {
    console.log("SIGTERM signal received: closing HTTP server gracefully");
    server.close(() => {
      process.exit(0);
    });
  });
  process.on("SIGINT", () => {
    console.log("SIGINT signal received: closing HTTP server gracefully");
    server.close(() => {
      process.exit(0);
    });
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
