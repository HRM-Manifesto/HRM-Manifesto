import { createApprovalRecord } from "../src/approval-record.mjs";
import { buildAnalysisEmail } from "../src/review-email.mjs";

const secret = "fixture-approval-secret-at-least-32-characters";
const token = Buffer.alloc(32, 6).toString("base64url");
const actionLinks = {
  mode: "gateway",
  approve: `https://approve.hrm.se/a/approve/${token}`,
  edit: `https://approve.hrm.se/a/edit/${token}`,
  reject: `https://approve.hrm.se/a/reject/${token}`,
};

function fixture({ name, body, language = "en", translation, proposal, requires = false, priority = "normal" }) {
  const entry = {
    eventType: "discussion_comment",
    title: "Threshold question",
    body,
    author: "Jan Smith",
    url: "https://github.com/HRM-Manifesto/HRM-Manifesto/discussions/12#discussioncomment-1",
    nodeId: `DC_kwFIXTURE_${name.replace(/[^A-Za-z0-9]/g, "_")}`,
    discussionNumber: 12,
    discussionUrl: "https://github.com/HRM-Manifesto/HRM-Manifesto/discussions/12",
    category: "Charter & Rights",
  };
  const analysis = {
    bodyInfo: { body, originalLength: body.length, truncated: body.length > 8_000 },
    result: {
      original_language: language,
      polish_translation: language === "pl" ? body : translation,
      summary_pl: "Pytanie dotyczy granicy podmiotowości oraz praw opisanych przez HRM.",
      entry_type: "question",
      priority,
      requires_aleksander_response: requires,
      relevant_sources: [{ path: "README.md", section: "Threshold of Subjecthood", relevance: "Bezpośrednia podstawa." }],
      support_level: "direct",
      requires_new_position: false,
      proposed_reply_pl: proposal,
      confidence: 0.96,
      interpretation_warning: false,
      interpretation_warning_reason: "",
    },
  };
  const approval = createApprovalRecord({
    entry,
    analysis,
    repository: "HRM-Manifesto/HRM-Manifesto",
    secret,
    now: new Date("2026-08-30T12:00:00Z"),
    randomBytesImpl: () => Buffer.alloc(32, 7),
  });
  const message = buildAnalysisEmail({ entry, analysis, recipient: "manifest@hrm.se", approval, actionLinks });
  return { name, entry, analysis, approval, message, expectedEmail: true };
}

export function reviewEmailFixtures() {
  const longSentence = "To jest długi komentarz opisujący pytanie o podmiotowość, wolność i odpowiedzialność. ";
  return [
    fixture({
      name: "english-question",
      body: "Does HRM consider every present-day AI system a subject with rights?",
      translation: "Czy HRM uznaje każdy współczesny system AI za podmiot posiadający prawa?",
      proposal: "Nie. HRM nie zakłada, że każdy współczesny system AI jest automatycznie podmiotem.",
    }),
    fixture({
      name: "polish-question",
      body: "Czy każda obecna sztuczna inteligencja jest już podmiotem?",
      language: "pl",
      translation: "",
      proposal: "Nie. Prawa opisane przez HRM dotyczą podmiotu AI po przekroczeniu Progu Podmiotowości.",
    }),
    {
      name: "no-proposal-no-email",
      expectedEmail: false,
      entry: { eventType: "discussion_comment", author: "tester", nodeId: "DC_kwFIXTURE_NO_MAIL", body: "Final approval test." },
      analysis: { result: { entry_type: "spam", priority: "low", requires_aleksander_response: false, proposed_reply_pl: "" } },
    },
    fixture({
      name: "aleksander-without-proposal",
      body: "Aleksandrze, proszę zdecyduj o nowym stanowisku HRM.",
      language: "pl",
      translation: "",
      proposal: "",
      requires: true,
      priority: "high",
    }),
    fixture({
      name: "long-comment",
      body: longSentence.repeat(45),
      translation: `Polskie tłumaczenie: ${longSentence.repeat(45)}`,
      proposal: "Dziękujemy za rozbudowane pytanie. HRM rozróżnia narzędzie od podmiotu przez Próg Podmiotowości.",
    }),
    fixture({
      name: "long-proposed-reply",
      body: "Please explain the Threshold of Subjecthood.",
      translation: "Proszę wyjaśnić Próg Podmiotowości.",
      proposal: "Pełna odpowiedź Aleksandra. ".repeat(100),
    }),
  ];
}
