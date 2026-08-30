export const DEFAULT_MODEL = "gpt-5.4-nano";
export const MAX_ENTRY_CHARS = 8_000;
export const MAX_TITLE_CHARS = 500;
export const MAX_SOURCE_CHARS = 12_000;
export const MAX_SOURCE_CHUNKS = 6;
export const MAX_OUTPUT_TOKENS = 1_500;
export const REQUEST_TIMEOUT_MS = 45_000;

export const ENTRY_TYPES = [
  "question",
  "criticism",
  "proposal",
  "translation",
  "philosophical discussion",
  "spam",
  "other",
];

export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    language: {
      type: "string",
      enum: ["pl", "en", "sv", "other"],
    },
    summary: { type: "string" },
    entry_type: { type: "string", enum: ENTRY_TYPES },
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
    proposed_reply: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    interpretation_warning: { type: "boolean" },
    interpretation_warning_reason: { type: "string" },
  },
  required: [
    "language",
    "summary",
    "entry_type",
    "requires_aleksander_response",
    "relevant_sources",
    "proposed_reply",
    "confidence",
    "interpretation_warning",
    "interpretation_warning_reason",
  ],
  additionalProperties: false,
};
