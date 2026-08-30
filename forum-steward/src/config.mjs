export const DEFAULT_MODEL = "gpt-5.4-nano";
export const MAX_ENTRY_CHARS = 8_000;
export const MAX_TITLE_CHARS = 500;
export const MAX_SOURCE_CHARS = 12_000;
export const MAX_SOURCE_CHUNKS = 6;
export const MAX_OUTPUT_TOKENS = 4_000;
export const MAX_APPROVED_REPLY_CHARS = 8_000;
export const MAX_TARGET_CHARS = 250;
export const MIN_TRANSLATION_CONFIDENCE = 0.9;
export const REQUEST_TIMEOUT_MS = 45_000;
export const APPROVAL_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
export const MAX_EMAIL_SOURCE_BYTES = 256_000;
export const IMAP_LOOKBACK_DAYS = 15;

export const ENTRY_TYPES = [
  "question",
  "criticism",
  "proposal",
  "translation",
  "philosophical discussion",
  "spam",
  "other",
];

export const PRIORITY_LEVELS = ["low", "normal", "high", "urgent"];
export const SUPPORT_LEVELS = ["direct", "interpretation", "new_position"];

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    original_language: {
      type: "string",
      enum: ["pl", "en", "sv", "other"],
    },
    polish_translation: { type: "string" },
    summary_pl: { type: "string" },
    entry_type: { type: "string", enum: ENTRY_TYPES },
    priority: { type: "string", enum: PRIORITY_LEVELS },
    requires_aleksander_response: { type: "boolean" },
    relevant_sources: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          section: { type: "string" },
          relevance: { type: "string" },
        },
        required: ["path", "section", "relevance"],
        additionalProperties: false,
      },
    },
    support_level: { type: "string", enum: SUPPORT_LEVELS },
    requires_new_position: { type: "boolean" },
    proposed_reply_pl: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    interpretation_warning: { type: "boolean" },
    interpretation_warning_reason: { type: "string" },
  },
  required: [
    "original_language",
    "polish_translation",
    "summary_pl",
    "entry_type",
    "priority",
    "requires_aleksander_response",
    "relevant_sources",
    "support_level",
    "requires_new_position",
    "proposed_reply_pl",
    "confidence",
    "interpretation_warning",
    "interpretation_warning_reason",
  ],
  additionalProperties: false,
};

export const TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    detected_language: { type: "string", enum: ["pl", "en", "sv", "other"] },
    language_name: { type: "string" },
    detection_confidence: { type: "number", minimum: 0, maximum: 1 },
    translated_reply: { type: "string" },
    faithful: { type: "boolean" },
    added_or_removed_content: { type: "boolean" },
    cannot_translate_reason: { type: "string" },
  },
  required: [
    "detected_language",
    "language_name",
    "detection_confidence",
    "translated_reply",
    "faithful",
    "added_or_removed_content",
    "cannot_translate_reason",
  ],
  additionalProperties: false,
};
