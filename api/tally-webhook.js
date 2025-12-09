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
const ADMIN_RECIPIENTS = [
  "Srboyan@gmail.com",
  "sean@lotshoppr.com",
];

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
    `Quick quote on a ${year} ${make} ${model}`,
    `Checking availability on a ${year} ${make} ${model}`,
    `Pricing on a ${year} ${make} ${model}?`,
  ];
  return pickRandom(subjects);
}

// One-line summary of the deal type, tuned to sound like a real buyer
function getDealLine(form) {
  if (form.dealType === "Lease") {
    const miles = form.leaseMiles || "standard miles";
    const term = form.leaseMonths ? `${form.leaseMonths} months` : "a typical term";
    const payment = form.leaseMaxPayment || null;
    const down = form.leaseDown || null;

    let line = `Looking to lease it, ${miles}/yr over about ${term}`;
    if (down) line += ` with roughly ${down} down`;
    if (payment) line += ` and a target payment around ${payment}/mo`;
    line += ".";
    return line;
  }

  if (form.dealType === "Finance") {
    const term = form.financeMonths ? `${form.financeMonths} months` : "a standard term";
    const payment = form.financeMaxPayment || null;
    const down = form.financeDown || null;

    let line = `Planning to finance over about ${term}`;
    if (down) line += ` with around ${down} down`;
    if (payment) line += ` and a target payment near ${payment}/mo`;
    line += ".";
    return line;
  }

  if (form.dealType === "Pay Cash") {
    if (form.cashMax) {
      return `Cash buyer, trying to stay around ${form.cashMax} out-the-door (taxes/fees included).`;
    }
    return "Cash buyer, just need a clean out-the-door number.";
  }

  return "Just looking for a straightforward out-the-door number on something that matches.";
}

// Main dealer body: short, assertive, “knows their stuff” with a couple longer variants
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
  const email = form.email || "";
  const zip = form.zip || "";
  const dealLine = getDealLine(form);

  const carLineShort = `Looking for a ${year} ${make} ${model} ${trim} in ${color} / ${interior}.`;
  const carLineAlt = `Interested in a ${year} ${make} ${model} ${trim} — ${color} exterior, ${interior} interior.`;

  const contactShort = email
    ? `You can reply here or reach me at ${email}.`
    : `You can reply directly to this email.`;

  // --- Short, assertive variants ---

  const templateShort1 = `
Hi there,

${carLineShort}
${dealLine}
If you have one in stock or incoming, please send your best out-the-door number.

${contactShort}

Thanks,
${fullName || "Thanks"}
${zip ? `Zip code: ${zip}` : ""}`.trim();

  const templateShort2 = `
Hello,

Can you check availability on a ${year} ${make} ${model} ${trim} in ${color} with a ${interior} interior?
${dealLine}
If you have anything close, I'd like to see your OTD pricing.

${contactShort}

${fullName || "Thanks"}
${zip ? `Zip: ${zip}` : ""}`.trim();

  const templateShort3 = `
Hey,

Quick quote request on a ${year} ${make} ${model} ${trim} (${color} / ${interior}).
${dealLine}
Please send your best out-the-door price if you have something that matches.

${contactShort}

Thanks,
${fullName || "Thanks"}
${zip ? `Zip: ${zip}` : ""}`.trim();

  // --- Longer “I know my stuff” variants for variance ---

  const templateLong1 = `
Hi there,

I'm reaching out to get numbers on a ${year} ${make} ${model} ${trim} — ${color} outside, ${interior} inside. ${dealLine}

I'm checking a few stores and just need a straightforward out-the-door quote (no add-ons I didn't ask for). If you have one on the ground or inbound that fits, I'd appreciate your best figure.

${contactShort}

Thanks,
${fullName || "Thanks"}
${zip ? `Zip code: ${zip}` : ""}`.trim();

  const templateLong2 = `
Good afternoon,

I'm lining up pricing on a ${year} ${make} ${model} ${trim} in ${color} with a ${interior} interior. ${dealLine}

I'm reaching out to a few dealers and just looking for a clean OTD quote so I can compare. If you have something that fits (or close), please include any adds you can't remove so I can look at everything side by side.

${contactShort}

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
