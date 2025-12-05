// File: api/tally-webhook.js
// URL: https://lotshoppr-webhook.vercel.app/api/tally-webhook

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// --- helper: random alias identity (name only, email stays the same) ---
function generateAliasIdentity() {
  const firstNames = [
    "Alex", "Jordan", "Taylor", "Casey", "Sam",
    "Chris", "Morgan", "Riley", "Jamie", "Drew",
    "Logan", "Cameron", "Avery", "Quinn", "Ryan",
    "Jess", "Sydney", "Elliot", "Blake"
  ];

  const lastNames = [
    "Parker", "Reed", "Hayes", "Bennett", "Cole",
    "Miller", "Lopez", "Foster", "Turner", "Gray",
    "Collins", "Diaz", "Harper", "Wells", "Brooks",
    "Ramirez", "Howard", "Russell", "Ward"
  ];

  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];

  return { first, last };
}

// --- helper: basic field extractor for Tally payload ---
function getValue(fields, key) {
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

// --- build email body: professional + firm negotiator (A/C mix) ---
function buildEmailText(normalized, alias) {
  const carLine = [
    normalized.vehicle.year,
    normalized.vehicle.make,
    normalized.vehicle.model,
    normalized.vehicle.trim
  ]
    .filter(Boolean)
    .join(" ");

  const intro = "Hi there,";

  const colorLine = normalized.vehicle.color
    ? `Ideally in ${normalized.vehicle.color.toLowerCase()}.`
    : "";

  const interiorLine = normalized.vehicle.interiorShade
    ? `I’d prefer a ${normalized.vehicle.interiorShade.toLowerCase()}.`
    : "";

  const typeLine = normalized.deal.type
    ? `I’m looking to ${normalized.deal.type.toLowerCase()}.`
    : "";

  const milesLine = normalized.deal.milesPerYear
    ? `I drive about ${normalized.deal.milesPerYear.toLocaleString()} miles per year.`
    : "";

  const downLine = normalized.deal.downPayment
    ? `I’m planning around $${normalized.deal.downPayment.toLocaleString()} down.`
    : "";

  const paymentLine = normalized.deal.maxMonthlyPayment
    ? `To make this work, I need to be under $${normalized.deal.maxMonthlyPayment.toLocaleString()} per month.`
    : "";

  const lines = [
    `${intro}`,
    "",
    `My name is ${alias.first} ${alias.last} and I’m currently shopping for a ${carLine}.`,
    [colorLine, interiorLine].filter(Boolean).join(" "),
    "",
    [typeLine, milesLine, downLine, paymentLine].filter(Boolean).join(" "),
    "",
    "I’m reaching out to a few local dealers and can move quickly if the numbers make sense.",
    "Can you please send me your best out-the-door price on this vehicle (including all taxes, fees, and any dealer-installed add-ons)?",
    "",
    "Email is my preferred way to communicate for now.",
    "",
    "Thanks in advance for your help,",
    `${alias.first} ${alias.last}`
  ];

  return lines.filter(Boolean).join("\n");
}

module.exports = async function handler(req, res) {
  console.log("🔔 Webhook hit:", { method: req.method, url: req.url });

  // If someone just opens the URL in a browser, be friendly
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: true,
      message: "LotShoppr webhook is live — send a POST from Tally."
    });
  }

  try {
    const payload = req.body || {};
    console.log("📥 Raw Tally payload:", JSON.stringify(payload));

    const fields = payload.data?.fields || [];

    // --- normalize your exact Tally question keys ---
    const normalized = {
      customer: {
        firstName: getValue(fields, "question_oMPMO5"),
        lastName: getValue(fields, "question_P5x50x"),
        email: getValue(fields, "question_EQRQ02"),
        zip: getValue(fields, "question_rA4AEX")
      },
      vehicle: {
        color: getValue(fields, "question_GdGd0Q"),
        year: getValue(fields, "question_O5250k"),
        make: getValue(fields, "question_V5e58N"),
        model: getValue(fields, "question_P5x50P"),
        trim: getValue(fields, "question_EQRQ0A"),
        interiorShade: getValue(fields, "question_rA4AEp")
      },
      deal: {
        type: getValue(fields, "question_4x6xjd"), // Lease / Finance / Pay Cash
        milesPerYear:
          parseInt((getValue(fields, "question_jQRQxY") || "").replace(/\D/g, "")) || null,
        termMonths:
          parseInt((getValue(fields, "question_2NWNrg") || "").replace(/\D/g, "")) || null,
        downPayment:
          parseInt((getValue(fields, "question_xaqaZE") || "").replace(/\D/g, "")) || null,
        maxMonthlyPayment:
          parseInt((getValue(fields, "question_R5N5LQ") || "").replace(/\D/g, "")) || null
      },
      rawSubmissionId: payload.data?.submissionId
    };

    console.log("✅ Normalized submission:", normalized);

    // --- alias name for this email ---
    const alias = generateAliasIdentity();
    console.log("🧑 Alias identity:", alias);

    const senderEmail = process.env.SENDER_EMAIL || "WebLeads@LotShoppr.com";
    const dealerEmail = process.env.DEALER_TEST_EMAIL || "WebLeads@LotShoppr.com";

    const textBody = buildEmailText(normalized, alias);
    const htmlBody = textBody.replace(/\n/g, "<br>");

    const carLine = [
      normalized.vehicle.year,
      normalized.vehicle.make,
      normalized.vehicle.model,
      normalized.vehicle.trim
    ]
      .filter(Boolean)
      .join(" ");

    const subject = carLine
      ? `Quote request for ${carLine}`
      : "Vehicle quote request";

    // --- IMPORTANT: to avoid domain-verification issues while testing,
    // use Resend's default sender, but keep Reply-To as WebLeads@LotShoppr.com.
    // Once lotshoppr.com is verified in Resend, change `from` to use senderEmail.
    const sendResult = await resend.emails.send({
      from: `${alias.first} ${alias.last} <onboarding@resend.dev>`,
      to: [dealerEmail],
      subject,
      html: htmlBody,
      reply_to: senderEmail
    });

    console.log("✉️ Resend sendResult:", sendResult);

    return res.status(200).json({
      ok: true,
      alias,
      normalized,
      email: {
        from: "onboarding@resend.dev",
        replyTo: senderEmail,
        to: dealerEmail,
        subject,
        preview: textBody.slice(0, 200),
        resendId: sendResult?.id || null
      }
    });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};

