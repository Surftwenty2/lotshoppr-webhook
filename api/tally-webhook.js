// File: api/tally-webhook.js
// URL: https://lotshoppr-webhook.vercel.app/api/tally-webhook

const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// --- helper: random alias identity (just the buyer's name in the email text) ---
function generateAliasIdentity() {
  const firstNames = [
    "Alex", "Jordan", "Taylor", "Casey", "Sam",
    "Chris", "Morgan", "Riley", "Jamie", "Drew",
    "Logan", "Cameron", "Avery", "Quinn"
  ];

  const lastNames = [
    "Parker", "Reed", "Hayes", "Bennett", "Cole",
    "Miller", "Lopez", "Foster", "Turner", "Gray",
    "Collins", "Diaz", "Harper", "Wells"
  ];

  const first =
    firstNames[Math.floor(Math.random() * firstNames.length)];
  const last =
    lastNames[Math.floor(Math.random() * lastNames.length)];

  return { first, last };
}

// --- helper: basic field extractor for Tally ---
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

// --- helper: build a “human-ish” email with a little variation ---
function buildEmailText(normalized, alias) {
  const carLine = [
    normalized.vehicle.year,
    normalized.vehicle.make,
    normalized.vehicle.model,
    normalized.vehicle.trim
  ]
    .filter(Boolean)
    .join(" ");

  const intros = [
    `Hi there,`,
    `Hello,`,
    `Good afternoon,`,
    `Hey there,`
  ];

  const intro = intros[Math.floor(Math.random() * intros.length)];

  const colorLine = normalized.vehicle.color
    ? `Ideally in ${normalized.vehicle.color.toLowerCase()}.`
    : "";

  const interiorLine = normalized.vehicle.interiorShade
    ? `I’d prefer a ${normalized.vehicle.interiorShade.toLowerCase()}.`
    : "";

  const typeLine = normalized.deal.type
    ? `I’m planning to ${normalized.deal.type.toLowerCase()}.`
    : "";

  const milesLine = normalized.deal.milesPerYear
    ? `I drive about ${normalized.deal.milesPerYear.toLocaleString()} miles a year.`
    : "";

  const downLine = normalized.deal.downPayment
    ? `I can put around $${normalized.deal.downPayment.toLocaleString()} down.`
    : "";

  const paymentLine = normalized.deal.maxMonthlyPayment
    ? `Ideally I’d like to stay under $${normalized.deal.maxMonthlyPayment.toLocaleString()} a month if possible.`
    : "";

  const closings = [
    `Thanks,`,
    `Thank you,`,
    `Really appreciate it,`,
    `Best regards,`
  ];
  const closing = closings[Math.floor(Math.random() * closings.length)];

  const nameLine = `${alias.first} ${alias.last}`;

  const lines = [
    `${intro}`,
    "",
    `My name is ${nameLine} and I’m shopping for a ${carLine}.`,
    [colorLine, interiorLine].filter(Boolean).join(" "),
    "",
    [typeLine, milesLine, downLine, paymentLine]
      .filter(Boolean)
      .join(" "),
    "",
    `Do you have anything that fits this in stock, and what kind of out-the-door numbers could you do?`,
    "",
    `${closing}`,
    `${alias.first}`
  ];

  return lines.filter(Boolean).join("\n");
}

module.exports = async function handler(req, res) {
  console.log("🔔 Webhook hit:", { method: req.method, url: req.url });

  // If someone hits this in a browser, just show a friendly message
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

    // --- normalize submission (using your actual Tally keys) ---
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
        type: getValue(fields, "question_4x6xjd"), // Lease / Finance / Cash
        milesPerYear:
          parseInt(
            (getValue(fields, "question_jQRQxY") || "").replace(/\D/g, "")
          ) || null,
        termMonths:
          parseInt(
            (getValue(fields, "question_2NWNrg") || "").replace(/\D/g, "")
          ) || null,
        downPayment:
          parseInt(
            (getValue(fields, "question_xaqaZE") || "").replace(/\D/g, "")
          ) || null,
        maxMonthlyPayment:
          parseInt(
            (getValue(fields, "question_R5N5LQ") || "").replace(/\D/g, "")
          ) || null
      },
      rawSubmissionId: payload.data?.submissionId
    };

    console.log("✅ Normalized submission:", normalized);

    // --- generate “customer” name ---
    const alias = generateAliasIdentity();
    console.log("🧑 Alias identity:", alias);

    const senderEmail =
      process.env.SENDER_EMAIL || "WebLeads@LotShoppr.com";
    const dealerEmail =
      process.env.DEALER_TEST_EMAIL || "WebLeads@LotShoppr.com";

    const textBody = buildEmailText(normalized, alias);
    const htmlBody = textBody
      .replace(/\n/g, "<br>")
      .replace(/  +/g, " ");

    const carLine = [
      normalized.vehicle.year,
      normalized.vehicle.make,
      normalized.vehicle.model,
      normalized.vehicle.trim
    ]
      .filter(Boolean)
      .join(" ");

    const subject = carLine
      ? `Question about a ${carLine}`
      : "Vehicle availability inquiry";

    // --- Send the email via Resend ---
    const sendResult = await resend.emails.send({
      from: `LotShoppr Web Lead <${senderEmail}>`,
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
        from: senderEmail,
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
