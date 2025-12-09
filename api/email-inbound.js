// api/email-inbound.js

console.log("⚡ LotShoppr: EMAIL INBOUND HANDLER LOADED");

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const {
  getLeadById,
  updateLead,
  handleDealerReply,
} = require("../lib/negotiation");

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
    const lead = await getLeadById(leadId);

    if (!lead) {
      console.error("No lead found for id:", leadId);
      return res.json({ ok: true });
    }

    console.log("Found lead:", leadId);

    const decision = await handleDealerReply(lead, text);
    console.log("Negotiation decision:", decision);

    const dealsAddress = `deals+${lead.id}@lotshoppr.com`;

    if (decision.matchType && decision.matchType !== lead.matchType) {
      await updateLead(lead.id, { matchType: decision.matchType });
    }

    if (decision.action === "REPLY" && decision.body) {
      // Reply as the customer, continue the same thread
      console.log("📨 Sending negotiation reply to dealer...");

      await resend.emails.send({
        from: `LotShoppr for ${lead.firstName || "Customer"} <${dealsAddress}>`,
        to: from,
        subject: subject || "Re: your quote",
        text: decision.body,
        reply_to: dealsAddress,
      });

      await sleep(500);
    }

    if (decision.action === "ACCEPT_AND_NOTIFY" && decision.body) {
      // 1) Reply to dealer: "I'm good, let's move forward"
      console.log("📨 Sending ACCEPT email to dealer...");

      await resend.emails.send({
        from: `LotShoppr for ${lead.firstName || "Customer"} <${dealsAddress}>`,
        to: from,
        subject: subject || "Re: your quote",
        text: decision.body,
        reply_to: dealsAddress,
      });

      await updateLead(lead.id, {
        status: "won",
        matchType: decision.matchType || lead.matchType || "exact",
      });

      // 2) Notify the customer (separately)
      if (lead.email) {
        const matchType =
          decision.matchType || lead.matchType || "exact";

        const spec = `${lead.vehicle.year} ${lead.vehicle.make} ${lead.vehicle.model} ${lead.vehicle.trim}`;

        const matchLine =
          matchType === "similar"
            ? `Note: the dealer's proposal is on a SIMILAR spec, not the exact build you originally requested. Please review details before you commit.`
            : `This matches the spec you requested.`;

        const bodyToCustomer = `
Good news,

A dealer has come back with numbers that meet the targets you set for:

${spec}

${matchLine}

Check your email thread with them (from your address) or contact the store directly to confirm details and timing.

– LotShoppr
`.trim();

        console.log("📨 Notifying customer of deal...");

        await resend.emails.send({
          from: "LotShoppr <deals@lotshoppr.com>",
          to: lead.email,
          subject: "LotShoppr: A dealer hit your numbers",
          text: bodyToCustomer,
        });
      }

      await sleep(500);
    }

    // NO_REPLY → do nothing, just return OK
    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Inbound handler error:", err);
    return res.status(500).json({ ok: false, error: "inbound_failure" });
  }
};
