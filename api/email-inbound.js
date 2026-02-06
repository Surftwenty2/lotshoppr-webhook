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
//
// Negotiation flow:
// 1. Receives inbound dealer email via Resend webhook POST.
// 2. Extracts leadId from plus-address (deals+<leadId>@...)
// 3. Forwards dealer reply to backend /api/leads/:leadId/dealer-reply
// 4. Backend parses, evaluates, and generates follow-up email (accept/counter/clarify/reject)
// 5. Sends follow-up email to dealer if needed
// 6. Logs and notifies as appropriate
module.exports = async (req, res) => {
  console.log("⚡ LotShoppr: EMAIL INBOUND INVOKED");


  try {
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ ok: false, error: "method_not_allowed" });
    }

    const inbound = req.body || {};
    // For Resend, the actual email data is under inbound.data
    const data = inbound.data || {};
    const toRaw = Array.isArray(data.to) ? data.to[0] : data.to;
    const from = data.from;
    const subject = data.subject || "";
    const text = data.text || data.html || "";

    // Debug: log the full inbound payload and extracted fields
    console.log("[DEBUG] Full inbound payload:", JSON.stringify(inbound, null, 2));
    console.log("[DEBUG] Extracted toRaw:", toRaw);
    // Defensive: Extract leadId from plus-address
    const match = String(toRaw).match(/deals\+([^@]+)@/i);
    const leadId = match ? match[1] : null;
    console.log("[DEBUG] Extracted leadId:", leadId);


    // Defensive: Ensure 'to' address exists
    if (!toRaw) {
      console.error("No 'to' address on inbound email");
      return res.json({ ok: true });
    }


    // Defensive: Extract leadId from plus-address
    const match = String(toRaw).match(/deals\+([^@]+)@/i);
    if (!match) {
      console.error("Could not extract leadId from:", toRaw);
      return res.json({ ok: true });
    }

    const leadId = match[1];
    console.log("Extracted leadId:", leadId);


    // ==== Call backend to evaluate offer ====
    // This POST triggers the negotiation logic in the backend
    console.log(`📌 Sending dealer reply to backend for evaluation...`);


    let backendResponse;
    try {
      const dealerResponse = await fetch(`${BACKEND_URL}/api/leads/${leadId}/dealer-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerId: from, // Use dealer's email as ID
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
      // If backend fails, log and exit gracefully
      console.error("❌ Error calling backend for evaluation:", e);
      return res.json({ ok: true, error: "backend_evaluation_failed" });
    }

    const evaluation = backendResponse.evaluation;
    const followupEmail = backendResponse.followupEmail;

    console.log("🎯 Evaluation decision:", evaluation.decision);


    // ==== Send follow-up email back to dealer ====
    // Only send if backend provided a follow-up message
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
        // Log any email sending errors
        console.error("❌ Error sending follow-up email to dealer:", e);
      }

      await sleep(500); // Prevent rapid-fire emails
    }


    // ==== If accepted, notify customer (future work) ====
    if (evaluation.decision === "accept") {
      console.log("✅ Deal accepted! (Customer notification would go here)");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Inbound handler error:", err);
    return res.status(500).json({ ok: false, error: "inbound_failure" });
  }
};
