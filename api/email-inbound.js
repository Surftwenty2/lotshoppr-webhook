// api/email-inbound.js

console.log("⚡ LotShoppr: EMAIL INBOUND HANDLER LOADED");


// Ensure fetch is available in Node.js (for Vercel and local)
let fetchFn;
try {
  fetchFn = fetch;
} catch (e) {
  fetchFn = require("node-fetch");
}

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

    // Try to extract the email body from all possible fields
    let text = "";
    if (typeof data.text === "string" && data.text.trim()) {
      text = data.text;
    } else if (typeof data.html === "string" && data.html.trim()) {
      text = data.html;
    } else if (typeof data.body === "string" && data.body.trim()) {
      text = data.body;
    } else if (typeof data.content === "string" && data.content.trim()) {
      text = data.content;
    } else {
      // If body is missing, try to fetch the full email from Resend using email_id
      const emailId = data.email_id;
      if (emailId) {
        let emailResult = null;
        let fetchErr = null;
        // Try up to 3 times with 500ms delay between attempts
        const fetchInboundEmail = async (id) => {
          // Try SDK method if available
          if (resend.emails && resend.emails.receiving && typeof resend.emails.receiving.get === 'function') {
            return await resend.emails.receiving.get(id);
          }
          // Fallback: direct HTTP request
          const apiKey = process.env.RESEND_API_KEY;
          const resp = await fetchFn(`https://api.resend.com/emails/receiving/${id}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Accept': 'application/json',
            },
          });
          if (!resp.ok) throw new Error(`Resend API error: ${resp.status}`);
          return await resp.json();
        };

        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            emailResult = await fetchInboundEmail(emailId);
            if (emailResult && (emailResult.text || emailResult.html)) {
              break;
            }
          } catch (err) {
            fetchErr = err;
          }
          await sleep(500);
        }
        if (emailResult && emailResult.text) {
          text = emailResult.text;
          console.log("[INFO] Fetched email body from Resend API (text)");
        } else if (emailResult && emailResult.html) {
          text = emailResult.html;
          console.log("[INFO] Fetched email body from Resend API (html)");
        } else {
          console.error("[ERROR] No body found in fetched email from Resend API", emailResult || fetchErr);
        }
      } else {
        // Log all keys for debugging if body is missing
        console.error("[ERROR] No email body found in inbound.data. Keys:", Object.keys(data));
      }
    }

    // Debug: log the full inbound payload and extracted fields
    console.log("[DEBUG] Full inbound payload:", JSON.stringify(inbound, null, 2));
    console.log("[DEBUG] Extracted toRaw:", toRaw);


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
      const dealerResponse = await fetchFn(`${BACKEND_URL}/api/leads/${leadId}/dealer-reply`, {
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
    const originalMessageId = backendResponse.messageId; // Retrieve original messageId from backend response

    console.log("🎯 Evaluation decision:", evaluation.decision);


    // ==== Send follow-up email back to dealer ====
    // Only send if backend provided a follow-up message
    if (followupEmail && followupEmail.body) {
      console.log("📨 Sending follow-up email to dealer...");

      const dealsAddress = `deals+${leadId}@deals.lotshoppr.com`;

      try {
        await resend.emails.send({
          from: `LotShoppr <${dealsAddress}>`,
          to: from,
          subject: followupEmail.subject,
          text: followupEmail.body,
          reply_to: dealsAddress,
          headers: {
            ...(originalMessageId && {
              "In-Reply-To": originalMessageId,
              "References": originalMessageId,
            }),
          },
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
