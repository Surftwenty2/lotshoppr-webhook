// File: api/tally-webhook.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const payload = req.body;
  const fields = payload?.data?.fields || [];

  function getValue(key) {
    const f = fields.find(x => x.key === key);
    if (!f) return null;

    if (f.type === "INPUT_TEXT" || f.type === "INPUT_EMAIL") {
      return f.value || null;
    }

    if (f.type === "DROPDOWN") {
      const id = f.value?.[0];
      const opt = f.options?.find(o => o.id === id);
      return opt?.text || null;
    }

    return null;
  }

  const normalized = {
    customer: {
      firstName: getValue("question_oMPMO5"),
      lastName: getValue("question_P5x50x"),
      email: getValue("question_EQRQ02"),
      zip: getValue("question_rA4AEX"),
    },
    vehicle: {
      year: parseInt(getValue("question_O5250k")),
      make: getValue("question_V5e58N"),
      model: getValue("question_P5x50P"),
      trim: getValue("question_EQRQ0A"),
      exteriorColor: getValue("question_GdGd0Q"),
      interiorShade: getValue("question_rA4AEp"),
    },
    deal: {
      type: getValue("question_4x6xjd"),
      milesPerYear: parseInt((getValue("question_jQRQxY") || "").replace(/\D/g, "")),
      termMonths: parseInt((getValue("question_2NWNrg") || "").replace(/\D/g, "")),
      downPayment: parseInt((getValue("question_xaqaZE") || "").replace(/\D/g, "")),
      maxMonthlyPayment: parseInt((getValue("question_R5N5LQ") || "").replace(/\D/g, "")),
    },
    rawSubmissionId: payload?.data?.submissionId,
    raw: payload,
  };

  console.log("Normalized submission:", normalized);

  return res.status(200).json({ success: true, normalized });
}
