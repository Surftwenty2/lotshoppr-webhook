// File: api/tally-webhook.js
// Node.js Serverless Function for Vercel
// URL: https://lotshoppr-webhook.vercel.app/api/tally-webhook

module.exports = (req, res) => {
  // If you just open the URL in a browser (GET), show a friendly message
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "LotShoppr webhook is live. Send a POST from Tally."
    });
  }

  try {
    const payload = req.body;
    const fields = payload?.data?.fields || [];

    function getValue(key) {
      const f = fields.find((x) => x.key === key);
      if (!f) return null;

      if (f.type === "INPUT_TEXT" || f.type === "INPUT_EMAIL") {
        return f.value || null;
      }

      if (f.type === "DROPDOWN") {
        const id = f.value?.[0];
        const opt = f.options?.find((o) => o.id === id);
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
    };

    console.log("🔔 Normalized submission:", normalized);

    return res.status(200).json({ ok: true, normalized });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
