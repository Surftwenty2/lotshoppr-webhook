// File: api/tally-webhook.js
// URL: https://lotshoppr-webhook.vercel.app/api/tally-webhook

module.exports = async function handler(req, res) {
  // Log EVERY hit so we know if Tally reaches us at all
  console.log("🔔 Webhook hit:", {
    method: req.method,
    url: req.url,
  });

  // If you open this URL in a browser (GET), show a friendly message
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "LotShoppr webhook is live — waiting for POST from Tally.",
    });
  }

  try {
    const payload = req.body || {};
    console.log("📥 Raw Tally payload:", JSON.stringify(payload));

    const fields = payload.data?.fields || [];

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
        color: getValue("question_GdGd0Q"),
        year: getValue("question_O5250k"),
        make: getValue("question_V5e58N"),
        model: getValue("question_P5x50P"),
        trim: getValue("question_EQRQ0A"),
        interiorShade: getValue("question_rA4AEp"),
      },
    };

    console.log("✅ Normalized submission:", normalized);

    return res.status(200).json({ ok: true, normalized });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

