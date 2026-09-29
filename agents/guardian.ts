export const DISCLAIMER =
  "Advisory signal only. Not KYC, not sanctions screening, and not proof the invoice is genuine.";

export type Fields = {
  merchantCategory: string;
  issuerName: string;
  lineItems: { description: string; category: string }[];
};

export type Notice = {
  id: string;
  title: string;
  usedOnSend: boolean;
  rawText: string;
  fixture: Fields;
};

export type Decision = {
  decision: "approve" | "hold";
  reasons: string[];
  disclaimer: string;
  source: "rule" | "rule+model";
};

export function ruleFloor(purposeTag: string, fields: Fields): { hold: boolean; reason?: string } {
  if (purposeTag !== "TUITION") return { hold: false };
  const items = fields.lineItems ?? [];
  if (items.length === 0 || items.some((item) => item.category !== "EDUCATION_FEE")) {
    return { hold: true, reason: "line_item_category_mismatch" };
  }
  return { hold: false };
}

export function finalizeDecision(input: {
  purposeTag: string;
  fields: Fields | null;
  extractionFailed: boolean;
  modelEscalateHold: boolean;
  modelReasons: string[];
  usedModel: boolean;
}): Decision {
  if (input.extractionFailed || !input.fields) {
    return {
      decision: "hold",
      reasons: ["extraction_failed"],
      disclaimer: DISCLAIMER,
      source: input.usedModel ? "rule+model" : "rule",
    };
  }
  const rule = ruleFloor(input.purposeTag, input.fields);
  if (rule.hold) {
    const reasons = [rule.reason ?? "line_item_category_mismatch"];
    for (const reason of input.modelReasons) {
      if (reason && !reasons.includes(reason)) reasons.push(reason);
    }
    return { decision: "hold", reasons, disclaimer: DISCLAIMER, source: input.usedModel ? "rule+model" : "rule" };
  }
  if (input.modelEscalateHold) {
    return {
      decision: "hold",
      reasons: input.modelReasons.length > 0 ? input.modelReasons : ["model_escalation"],
      disclaimer: DISCLAIMER,
      source: "rule+model",
    };
  }
  return {
    decision: "approve",
    reasons: ["education_fee_lines"],
    disclaimer: DISCLAIMER,
    source: input.usedModel ? "rule+model" : "rule",
  };
}

type Extraction = {
  merchantCategory?: string;
  issuerName?: string;
  lineItems?: { description?: string; category?: string }[];
  escalateHold?: boolean;
  reasons?: string[];
};

async function extractWithModel(rawText: string): Promise<Extraction> {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content:
            "Extract a fee notice into JSON only. Do not decide the payment. " +
            'Schema: {"merchantCategory":"","issuerName":"","lineItems":[{"description":"","category":""}],"escalateHold":false,"reasons":[]}. ' +
            "line item category must be one of EDUCATION_FEE, ELECTRONICS, BOOKS, HEALTH_FEE, OTHER. " +
            "Set escalateHold true only if you want an extra hold. You cannot approve a notice the rule will hold. Text:\n" +
            rawText,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`model HTTP ${response.status}`);
  const body = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = body.content?.find((block) => block.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("model returned no JSON");
  return JSON.parse(match[0]) as Extraction;
}

export async function reviewNotice(notice: Notice, purposeTag: string): Promise<Decision> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return finalizeDecision({
      purposeTag,
      fields: notice.fixture,
      extractionFailed: false,
      modelEscalateHold: false,
      modelReasons: [],
      usedModel: false,
    });
  }
  try {
    const extracted = await extractWithModel(notice.rawText);
    const fields: Fields = {
      merchantCategory: extracted.merchantCategory ?? "",
      issuerName: extracted.issuerName ?? "",
      lineItems: (extracted.lineItems ?? []).map((item) => ({
        description: item.description ?? "",
        category: item.category ?? "",
      })),
    };
    return finalizeDecision({
      purposeTag,
      fields,
      extractionFailed: false,
      modelEscalateHold: extracted.escalateHold === true,
      modelReasons: (extracted.reasons ?? []).filter((reason): reason is string => typeof reason === "string"),
      usedModel: true,
    });
  } catch {
    return finalizeDecision({
      purposeTag,
      fields: null,
      extractionFailed: true,
      modelEscalateHold: false,
      modelReasons: [],
      usedModel: true,
    });
  }
}

export function offlineResults(notices: Notice[], purposeTag = "TUITION") {
  return notices.map((notice) => {
    const decision = finalizeDecision({
      purposeTag,
      fields: notice.fixture,
      extractionFailed: false,
      modelEscalateHold: false,
      modelReasons: [],
      usedModel: false,
    });
    return {
      id: notice.id,
      title: notice.title,
      decision: decision.decision,
      reasons: decision.reasons,
    };
  });
}
