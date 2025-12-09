// File: api/tally-webhook.js

const { Resend } = require("resend");

// Resend client – make sure RESEND_API_KEY is set in Vercel
const resend = new Resend(process.env.RESEND_API_KEY);

// Admin recipients: always notify you
const ADMIN_RECIPIENTS = [
  "Srboyan@gmail.com",
  "sean@lotshoppr.com",
];

// Dealer recipients: configured via env in Vercel
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

// -------------------------------------------------------
// Randomized dealer-facing email
// (sounds like a real customer, not a broker)
// -------------------------------------------------------
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildDealerSubject(form) {
  const subjects = [
    `${form.year || ""} ${form.make || ""} ${form.model || ""} ${form.trim || ""} – quote request`,
    `Pricing on a ${form.year || ""} ${form.make || ""} ${form.model || ""}?`,
    `Looking for a ${form.year || ""} ${form.make || ""} ${form.model || ""} deal`,
    `Question about a ${form.year || ""} ${form.make || ""} ${form.model || ""}`,
  ];
  return pickRandom(subjects);
}

function buildDealerBody(form, dealerEmail) {
  const greetings = [
    "Hi there,",
    "Hello,",
    "Good afternoon,",
    "Hi,",
  ];

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
    dealBlock = `Ideally, I'd like to lease it around these terms:

- Miles per year: ${form.leaseMiles || ""}
- Term: ${form.leaseMonths || ""} months
- Down payment: ${form.leaseDown || ""}
- Target monthly payment: ${form.leaseMaxPayment || ""}`;
  } else if (form.dealType === "Finance") {
    dealBlock = `I'm planning to finance it roughly on these terms:

- Down payment: ${form.financeDown || ""}
- Target monthly payment: ${form.financeMaxPayment || ""}
- Term: ${form.financeMonths || ""} months`;
  } else if (form.dealType === "Pay Cash") {
    dealBlock = `I'm planning to pay cash, and my budget (including taxes and fees) is around ${form.cashMax || ""}.`;
  }

  const closingLines = [
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

${pickRandom(closingLines)}

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

    // 1) Admin notification (you)
    try {
      const adminResult = await resend.emails.send({
        from: "LotShoppr <sean@lotshoppr.com>",
        to: ADMIN_RECIPIENTS,
        subject: "🚗 New LotShoppr Submission",
        text: buildAdminEmail(formData),
      });
      console.log("Admin email result:", adminResult);
    } catch (e) {
      console.error("Error sending admin email:", e);
    }

    // 2) Dealer-facing emails (randomized copy, customer voice)
    const dealerRecipients = getDealerRecipients();
    if (dealerRecipients.length > 0) {
      const subject = buildDealerSubject(formData);

      for (const dealerEmail of dealerRecipients) {
        try {
          const body = buildDealerBody(formData, dealerEmail);
          const dealerResult = await resend.emails.send({
            // From: looks like the customer, but sends via your domain
            from: `LotShoppr for ${formData.firstName || "Customer"} <sean@lotshoppr.com>`,
            to: dealerEmail,
            subject,
            text: body,
            // Let replies go straight to the customer's real email
            reply_to: formData.email || "sean@lotshoppr.com",
          });
          console.log(`Dealer email result for ${dealerEmail}:`, dealerResult);
        } catch (e) {
          console.error(`Error sending dealer email to ${dealerEmail}:`, e);
        }
      }
    } else {
      console.log("No dealer recipients configured (DEALER_EMAILS env is empty).");
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ ok: false, error: "webhook_failure" });
  }
};

