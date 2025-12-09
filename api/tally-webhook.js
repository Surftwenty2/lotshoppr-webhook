// File: api/tally-webhook.js

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// -------------------------------------------------------
// Helper: Extract field value from Tally payload
// -------------------------------------------------------
function getField(fields, key) {
  const field = fields.find(f => f.key === key);
  if (!field) return null;

  // Dropdowns return array of IDs, so also return the text
  if (Array.isArray(field.value) && field.options) {
    const selectedId = field.value[0];
    const match = field.options.find(o => o.id === selectedId);
    return match ? match.text : null;
  }

  return field.value ?? null;
}

// -------------------------------------------------------
// Build the summary email that goes to *you* (the owner)
// -------------------------------------------------------
function buildOwnerEmail(formData) {
  return `
A new LotShoppr submission just came in:

Name: ${formData.firstName} ${formData.lastName}
Email: ${formData.email}
Zip Code: ${formData.zip}

----

Vehicle Requested:
- ${formData.year} ${formData.make} ${formData.model} ${formData.trim}
- Color: ${formData.color}
- Interior: ${formData.interior}

Deal Type: ${formData.dealType}

${
  formData.dealType === "Lease"
    ? `
Lease Terms:
- Miles: ${formData.leaseMiles}
- Months: ${formData.leaseMonths}
- Down: ${formData.leaseDown}
- Max Payment: ${formData.leaseMaxPayment}
`
    : ""
}

${
  formData.dealType === "Finance"
    ? `
Finance Terms:
- Down: ${formData.financeDown}
- Max Payment: ${formData.financeMaxPayment}
- Months: ${formData.financeMonths}
`
    : ""
}

${
  formData.dealType === "Pay Cash"
    ? `
Cash Deal:
- Max Cash Price: ${formData.cashMax}
`
    : ""
}

-----------------------------------

Full JSON (for debugging):
${JSON.stringify(formData, null, 2)}

  `;
}

// -------------------------------------------------------
// API Handler
// -------------------------------------------------------
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const payload = req.body;
    const fields = payload?.data?.fields || [];

    // -------------------------------------------------------
    // Extract all Tally fields using their actual keys
    // -------------------------------------------------------
    const formData = {
      firstName: getField(fields, "question_oMPMO5"),
      color: getField(fields, "question_GdGd0Q"),
      year: getField(fields, "question_O5250k"),
      make: getField(fields, "question_V5e58N"),
      model: getField(fields, "question_P5x50P"),
      trim: getField(fields, "question_EQRQ0A"),
      interior: getField(fields, "question_rA4AEp"),

      dealType: getField(fields, "question_4x6xjd"),

      // Lease fields (may be null)
      leaseMiles: getField(fields, "question_jQRQxY"),
      leaseMonths: getField(fields, "question_2NWNrg"),
      leaseDown: getField(fields, "question_xaqaZE"),
      leaseMaxPayment: getField(fields, "question_R5N5LQ"),

      // Finance fields (may be null)
      financeDown: getField(fields, "question_oMPMON"),
      financeMaxPayment: getField(fields, "question_GdGd0O"),
      financeMonths: getField(fields, "question_O5250M"),

      // Cash
      cashMax: getField(fields, "question_V5e586"),

      // Final contact fields
      lastName: getField(fields, "question_P5x50x"),
      email: getField(fields, "question_EQRQ02"),
      zip: getField(fields, "question_rA4AEX"),
    };

    console.log("Parsed Form Data:", formData);

    // -------------------------------------------------------
    // Send YOU an email with the new submission
    // -------------------------------------------------------
    await resend.emails.send({
      from: "LotShoppr <no-reply@lotshoppr.com>",
      to: "sean@lotshoppr.com",
      subject: "🚗 New LotShoppr Submission",
      text: buildOwnerEmail(formData),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Webhook processing failed:", err);
    return res.status(500).json({ ok: false, error: "webhook_failure" });
  }
};

