// File: api/tally-webhook.js
// -------------------------------------------------------
// LotShoppr Webhook Handler – production version
// -------------------------------------------------------

console.log("⚡ LotShoppr: NEW TALLY WEBHOOK HANDLER LOADED");

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// -------------------------------------------------------
// Sleep helper to avoid Resend 429 (rate limit) errors
// -------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Admin recipients
const ADMIN_RECIPIENTS = ["Srboyan@gmail.com", "sean@lotshoppr.com"];

// Dealer recipients read from environment variable
function getDealerRecipients() {
  const raw = process.env.DEALER_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// -------------------------------------------------------
// Form helpers
// -------------------------------------------------------
function getField(fields, key) {
  const field = fields.find((f) => f.key === key);
  if (!field) return null;

  // For dropdowns/multiple choice
  if (Array.isArray(field.value) && field.options) {
    const selectedId = field.value[0];
    const match = field.options.find((o) => o.id === selectedId);
    return match ? match.text : null;
  }

  return field.value ?? null;
}

function buildAdminEmail(form) {
  return `
New LotShoppr submission

Customer
--------
Name: ${form.firstName || ""} ${form.lastName || ""}
Email: ${form.email || ""}
Zip: ${form.zip || ""}

Vehicle
-------
Year: ${form.year || ""}
Make: ${form.make || ""}
Model: ${form.model || ""}
Trim: ${form.trim || ""}
Color: ${form.color || ""}
Interior: ${form.interior || ""}

Deal Type
---------
Type: ${form.dealType || ""}

${
  form.dealType === "Lease"
    ? `Lease Terms
-----------
Miles per year: ${form.leaseMiles || ""}
Months: ${form.leaseMonths || ""}
Down payment: ${form.leaseDown || ""}
Max monthly payment: ${form.leaseMaxPayment || ""}

`
    : ""
}${
    form.dealType === "Finance"
      ? `Finance Terms
-------------
Down payment: ${form.financeDown || ""}
Max monthly payment: ${form.financeMaxPayment || ""}
Months: ${form.financeMonths || ""}

`
      : ""
  }${
    form.dealType === "Pay Cash"
      ? `Cash Deal
---------
Max cash price: ${form.cashMax || ""}

`
      : ""
  }Raw JSON
---------
${JSON.stringify(form, null, 2)}
`.trim();
}

// -------------------------------------------------------
// Dealer email helpers
// -------------------------------------------------------
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildDealerSubject(form) {
  const year = form.year || "";
  const make = form.make || "";
  const model = form.model || "";
  const trim = form.trim || "";

  const subjects = [
    `${year} ${make} ${model} ${trim} – quote request`,
    `Quote on a ${year} ${make} ${model}`,
    `Checking numbers on a ${year} ${make} ${model}`,
    `OTD pricing on a ${year} ${make} ${model}?`,
  ];
  return pickRandom(subjects);
}

// Build a clear, non-ambiguous deal block
function getDealBlock(form) {
  const lines = [];

  if (form.dealType === "Lease") {
    const miles = form.leaseMiles || null;
    const term = form.leaseMonths || null;
    const down = form.leaseDown || null;
    const payment = form.leaseMaxPayment || null;

    lines.push("Here’s the lease structure I’m looking for:");
    if (miles || term) {
      let line = "- Lease:";
      if (miles) line += ` ${miles}`; // label already includes units
      if (term) line += `${miles ? ", " : " "}${term} months`;
      lines.push(line);
    }
    if (down) {
      lines.push(`- Total due at signing: ${down}`);
    }
    if (payment) {
      lines.push(`- Monthly payment: ${payment} or less`);
    }
  } else if (form.dealType === "Finance") {
    const term = form.financeMonths || null;
    const down = form.financeDown || null;
    const payment = form.financeMaxPayment || null;

    lines.push("Here’s the finance structure I’m targeting:");
    if (term) {
      lines.push(`- Term: ${term} months`);
    }
    if (down) {
      lines.push(`- Down payment: ${down}`);
    }
    if (payment) {
      lines.push(`- Monthly payment: ${payment} or less`);
    }
  } else if (form.dealType === "Pay Cash") {
    lines.push("Here’s what I’m targeting:");
    if (form.cashMax) {
      lines.push(
        `- Cash buyer: out-the-door price at or under ${form.cashMax} (tax, title, fees included)`
      );
    } else {
      lines.push(
        "- Cash buyer: need a clear out-the-door price (tax, title, fees included)"
      );
    }
  } else {
    lines.push("Here’s what I’m looking for:");
    lines.push(
      "- Straightforward out-the-door number with standard fees only"
    );
  }

  return lines.join("\n");
}

// Main dealer body: short, assertive, with a couple longer variants
function buildDealerBody(form) {
  const first = form.firstName || "";
  const last = form.lastName || "";
  const fullName = [first, last].filter(Boolean).join(" ");
  const year = form.year || "";
  const make = form.make || "";
  const model = form.model || "";
  const trim = form.trim || "";
  const color = form.color || "any color";
  const interior = form.interior || "any interior";
  const zip = form.zip || "";
  const dealBlock = getDealBlock(form);

  // avoid "Light Interior interior" – interior string is already descriptive
  const carLine = `I’m interested in a ${year} ${make} ${model} ${trim} in ${color} with ${interior}.`;
  const carLineAlt = `Looking at a ${year} ${make} ${model} ${trim} — ${color} exterior, ${interior}.`;

  // Dealer should NOT see customer email in body
  const contactLine = "You can reply directly to this email.";

  const commitLine =
    "If you can meet those numbers on something in stock or inbound, I’m ready to come in and sign.";

  // --- Short, assertive variants ---

  const templateShort1 = `
Hi there,

${carLine}
${dealBlock}

${commitLine}

${contactLine}

Thanks,
${fullName || "Thanks"}
${zip ? `Zip code: ${zip}` : ""}`.trim();

  const templateShort2 = `
Hello,

${carLineAlt}
${dealBlock}

${commitLine}

${contactLine}

${fullName || "Thanks"}
${zip ? `Zip: ${zip}` : ""}`.trim();

  const templateShort3 = `
Hey,

I’m pricing a ${year} ${make} ${model} ${trim} (${color} / ${interior}).
${dealBlock}

${commitLine}

${contactLine}

Thanks,
${fullName || "Thanks"}
${zip ? `Zip: ${zip}` : ""}`.trim();

  // --- Longer “I know my numbers” variants ---

  const templateLong1 = `
Hi there,

I’m lining up numbers on a ${year} ${make} ${model} ${trim} in ${color} with ${interior}.

${dealBlock}

I’m talking to a few stores and want a straight OTD quote that matches this structure. If you can hit those numbers on a unit you have or have coming in, I’m good to come down and sign.

${contactLine}

Thanks,
${fullName || "Thanks"}
${zip ? `Zip code: ${zip}` : ""}`.trim();

  const templateLong2 = `
Good afternoon,

I’m working up a deal on a ${year} ${make} ${model} ${trim} (${color} / ${interior}).

${dealBlock}

I’m comparing offers and plan to move forward where the numbers line up. If you can meet those terms, let me know and we can set a time for me to come in and finish paperwork.

${contactLine}

Thanks,
${fullName || "Thanks"}
${zip ? `${zip}` : ""}`.trim();

  const templates = [
    templateShort1,
    templateShort2,
    templateShort3,
    templateLong1,
    templateLong2,
  ];

  return pickRandom(templates);
}

// -------------------------------------------------------
// Main handler
// -------------------------------------------------------
module.exports = async (req, res) => {
  console.log("⚡ LotShoppr: NEW HANDLER INVOKED");

  try {
    if (req.method !== "POST") {
      return res
        .status(405)
        .json({ ok: false, error: "method_not_allowed" });
    }

    const payload = req.body;
    const fields = payload?.data?.fields || [];

    const formData = {
      firstName: getField(fields, "question_oMPMO5"),
      color: getField(fields, "question_GdGd0Q"),
      year: getField(fields, "question_O5250k"),
      make: getField(fields, "question_V5e58N"),
      model: getField(fields, "question_P5x50P"),
      trim: getField(fields, "question_EQRQ0A"),
      interior: getField(fields, "question_rA4AEp"),

      dealType: getField(fields, "question_4x6xjd"),

      leaseMiles: getField(fields, "question_jQRQxY"),
      leaseMonths: getField(fields, "question_2NWNrg"),
      leaseDown: getField(fields, "question_xaqaZE"),
      leaseMaxPayment: getField(fields, "question_R5N5LQ"),

      financeDown: getField(fields, "question_oMPMON"),
      financeMaxPayment: getField(fields, "question_GdGd0O"),
      financeMonths: getField(fields, "question_O5250M"),

      cashMax: getField(fields, "question_V5e586"),

      lastName: getField(fields, "question_P5x50x"),
      email: getField(fields, "question_EQRQ02"),
      zip: getField(fields, "question_rA4AEX"),
    };

    console.log("Parsed Form Data:", formData);

    // ---------------------------------------------------
    // 1) ADMIN EMAIL (single Resend request)
    // ---------------------------------------------------
    console.log("📨 Sending ADMIN email...");

    try {
      const adminResult = await resend.emails.send({
        from: "LotShoppr <sean@lotshoppr.com>",
        to: ADMIN_RECIPIENTS,
        subject: "🚗 New LotShoppr Submission",
        text: buildAdminEmail(formData),
      });

      console.log("✔ Admin email result:", adminResult);
    } catch (e) {
      console.error("❌ Error sending admin email:", e);
    }

    // Sleep to avoid rate limit
    await sleep(700);

    // ---------------------------------------------------
    // 2) DEALER EMAILS
    // ---------------------------------------------------
    const dealerRecipients = getDealerRecipients();
    console.log("👀 Dealer Recipients:", dealerRecipients);

    if (dealerRecipients.length > 0) {
      const subject = buildDealerSubject(formData);

      for (const dealerEmail of dealerRecipients) {
        console.log(`📨 Sending dealer email to ${dealerEmail}...`);

        try {
          const body = buildDealerBody(formData);

          const dealerResult = await resend.emails.send({
            from: `LotShoppr for ${formData.firstName || "Customer"} <sean@lotshoppr.com>`,
            to: dealerEmail,
            subject,
            text: body,
            // Dealer replies still go to the customer, but email
            // is not shown in the body.
            reply_to: formData.email || "sean@lotshoppr.com",
          });

          console.log(
            `✔ Dealer email result for ${dealerEmail}:`,
            dealerResult
          );
        } catch (e) {
          console.error(
            `❌ Error sending dealer email to ${dealerEmail}:`,
            e
          );
        }

        await sleep(700);
      }
    } else {
      console.log(
        "⚠ No dealer recipients configured (DEALER_EMAILS env is empty)."
      );
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ ok: false, error: "webhook_failure" });
  }
};
