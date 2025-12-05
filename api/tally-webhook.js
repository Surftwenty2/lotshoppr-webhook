// File: api/tally-webhook.js

module.exports = async function handler(req, res) {
  // If someone opens the URL in a browser
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "LotShoppr webhook is live — send a POST from Tally."
    });
  }

  try {
    console.log("📥 Incoming Tally Webhook Payload:", req.body);

    const payload = req.body || {};
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
      firstName: getValue("question_oMPMO5"),
      lastName: getValue("question_P5x50x"),
      email: getValue("question_EQRQ02"),
      zip: getValue("question_rA4AEX"),

      vehicle: {
        color: getValue("question_GdGd0Q"),
        year: getValue("question_O5250k"),
        make: getValue("question_V5e58N"),
        model: getValue("question_P5x50P"),
        trim: getValue("question_EQRQ0A"),
        interior: getValue("question_rA4AEp"),
      },

      finance: {
        method: getValue("question_4x6xjd"),
        miles: getValue("question_jQRQxY"),
        months: getValue("question_2NWNrg"),
        down: getValue("question_xaqaZE"),
        paymentCap: getValue("question_R5N5LQ")
      }
    };

    console.log("✅ Normalized Lead:", normalized);

    return res.status(200).json({ received: true, normalized });
  } catch (err) {
    console.error("❌ Webhook Error:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
};
