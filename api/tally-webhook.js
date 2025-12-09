// File: api/tally-webhook.js
// -------------------------------------------------------
// LotShoppr Webhook Handler (Rate-limit Safe Final Version)
// -------------------------------------------------------

console.log("⚡ LotShoppr: NEW TALLY WEBHOOK HANDLER LOADED");

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// -------------------------------------------------------
// Sleep helper to avoid Resend 429 errors
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
// Helpers
// -------------------------------------------------------
function getField(fields, key) {
  const field = fields.find((f) => f.key === key);
  if (!field) return null;

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
    `Pricing on a ${year} ${make} ${model}?`,
    `Looking for a ${year} ${make} ${model} deal`,
    `Question about a ${year} ${make} ${model}`,
  ];
  return pickRandom(subjects);
}

function buildDealerBody(form) {
  const greetings = ["Hi there,", "Hello,", "Good afternoon,", "Hi,"];
  const intros = [
    `My name is ${form.firstName || ""} ${form.lastName || ""}, and I'm shopping for a new vehicle.`,
    `I'm ${form.firstName || ""} and I'm in the market for a new car.`,
    `I'm currently looking for a specific vehicle and wanted to see what you might have available.`,
  ];
  const vehicleLines = [
    `I'm interested in a ${form.year || ""} ${form.make || ""} ${form.model || ""} ${form.trim || ""} in ${form.color || "any"} with a ${form.interior || "any"} interior.`,
    `The vehicle I'm after is a ${form.year || ""} ${form.make || ""} ${form.model || ""} ${form.trim || ""} (${form.color || "any color"}, ${form.interior || "any interior"}).`,
  ];

  let dealBlock = "";

  if (form.dealType === "Lease") {
    dealBlock = `Ideversion:

- Miles per year: ${form.leaseMiles}
- Term: ${form.leaseMonths} months
- Down payment: ${form.leaseDown}
- Target monthly payment: ${form.leaseMaxPayment}`;
  } else if (form.dealType === "Finance") {
    dealBlock = `I'm planning to finance it roughly on these terms:

- Down payment: ${form.financeDown}
- Target monthly payment: ${form.financeMaxPayment}
- Term: ${form.financeMonths} months`;
  } else if (form.dealType === "Pay Cash") {
    dealBlock = `I'm planning to pay cash, and my budget (including taxes and fees) is around ${form.cashMax}.`;
  }

  const closings = [
    "If you have something close in stock – or inbound – I'd really appreciate your best out-the-door number.",
    "If you have anything that matches this, could you please send your best out-the-door pricing?",
    "Please let me know what you have available and what the numbers would look like out the door.",
  ];

  const contactLine = `You can reach me by email at ${form.email || ""} or by replying directly to this message.`;

  return `
${pickRandom(greetings)}

${pickRandom(intros)}

${pickRandom(vehicleLines)}

${dealBlock}

${pickRandom(closings)}

${contactLine}

Thanks,
${form.firstName || ""} ${form.lastName || ""}
Zip code: ${form.zip || ""}
`.trim();
}

// -------------------------------------------------------
// Main handler
// -------------------------------------------------------
module.exports = async (req, res) => {
  console.log("⚡ LotShoppr: NEW HANDLER INVOKED");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
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
    // 1) ADMIN EMAIL (single request)
    // ---------------------------------------------------
    console.log("📨 Sending ADMIN email...");

    try {
      const adminResult = await resend.emails.send({
        from: "LotShoppr <sean@lotshoppr.com>",
        to: ADMIN_RECIPIENTS, // 1 request, sent to 2 inboxes
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

          console.log(`✔ Dealer email result for ${dealerEmail}:`, dealerResult);
        } catch (e) {
          console.error(`❌ Error sending dealer email to ${dealerEmail}:`, e);
        }

        await sleep(700);
      }
    } else {
      console.log("⚠ No dealer recipients configured (DEALER_EMAILS env is empty).");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ ok: false, error: "webhook_failure" });
  }
};
