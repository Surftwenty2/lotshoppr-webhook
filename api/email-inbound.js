// api/email-inbound.js

console.log("⚡ LotShoppr: EMAIL INBOUND HANDLER LOADED");

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// Backend URL (from env, default to local dev)
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

// naive sleep again if needed
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// NOTE: This handler assumes your email provider POSTs a JSON body
// with at least { to, from, subject, text }.
// Adjust mapping based on your provider’s actual payload.
module.exports = async (req, res) => {
  console.log("⚡ LotShoppr: EMAIL INBOUND INVOKED");

  try {
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ ok: false, error: "method_not_allowed" });
    }

    const inbound = req.body || {};
    // You will need to confirm these property names from your provider:
    // e.g., inbound.to = "deals+<leadId>@lotshoppr.com"
    const toRaw = Array.isArray(inbound.to) ? inbound.to[0] : inbound.to;
    const from = inbound.from;
    const subject = inbound.subject || "";
    const text = inbound.text || inbound.html || "";

    console.log("Inbound email:", { toRaw, from, subject });

    if (!toRaw) {
      console.error("No 'to' address on inbound email");
      return res.json({ ok: true });
    }

    const match = String(toRaw).match(/deals\+([^@]+)@/i);
    if (!match) {
      console.error("Could not extract leadId from:", toRaw);
      return res.json({ ok: true });
    }

    const leadId = match[1];
    console.log("Extracted leadId:", leadId);

    // ==== Call backend to evaluate offer ====
    console.log(`📌 Sending dealer reply to backend for evaluation...`);

    let backendResponse;
    try {
      const dealerResponse = await fetch(`${BACKEND_URL}/api/leads/${leadId}/dealer-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerId: from,
          from,
          subject,
          text,
        }),
      });

      backendResponse = await dealerResponse.json();
      if (!dealerResponse.ok) {
        throw new Error(`Backend error: ${JSON.stringify(backendResponse)}`);
      }
    } catch (e) {
      console.error("❌ Error calling backend for evaluation:", e);
      return res.json({ ok: true, error: "backend_evaluation_failed" });
    }

    const evaluation = backendResponse.evaluation;
    const followupEmail = backendResponse.followupEmail;

    console.log("🎯 Evaluation decision:", evaluation.decision);

    // ==== Send follow-up email back to dealer ====
    if (followupEmail && followupEmail.body) {
      console.log("📨 Sending follow-up email to dealer...");

      const dealsAddress = `deals+${leadId}@lotshoppr.com`;

      try {
        await resend.emails.send({
          from: `LotShoppr <${dealsAddress}>`,
          to: from,
          subject: followupEmail.subject,
          text: followupEmail.body,
          reply_to: dealsAddress,
        });
        console.log("✔ Follow-up email sent");
      } catch (e) {
        console.error("❌ Error sending follow-up email to dealer:", e);
      }

      await sleep(500);
    }

    // ==== If accepted, notify customer ====
    if (evaluation.decision === "accept") {
      console.log("✅ Deal accepted! (Customer notification would go here)");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Inbound handler error:", err);
    return res.status(500).json({ ok: false, error: "inbound_failure" });
  }
};
