// api/tally-webhook.js

console.log("⚡ LotShoppr: TALLY WEBHOOK HANDLER LOADED");

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

// Backend URL (from env, default to local dev)
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

// Sleep helper to avoid Resend rate limits
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ADMIN_RECIPIENTS = ["Srboyan@gmail.com", "sean@lotshoppr.com"];

function getDealerRecipients() {
  const raw = process.env.DEALER_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

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

// short, assertive opening email
function buildDealerInitialBody(form) {
  const fullName = [form.firstName, form.lastName].filter(Boolean).join(" ");
  const year = form.year || "";
  const make = form.make || "";
  const model = form.model || "";
  const trim = form.trim || "";
  const color = form.color || "any color";
  const interior = form.interior || "any interior";

  const lines = [];
  lines.push(
    `I’m interested in a ${year} ${make} ${model} ${trim} in ${color} with ${interior}.`
  );

  if (form.dealType === "Pay Cash") {
    lines.push(
      `I’m a cash buyer and need the out-the-door price (tax, title, all fees) to be at or under ${form.cashMax || ""}.`
    );
  } else if (form.dealType === "Lease") {
    lines.push("Here’s the lease structure I’m looking for:");
    if (form.leaseMonths || form.leaseMiles) {
      let line = "- Lease:";
      if (form.leaseMonths) line += ` ${form.leaseMonths} months`;
      if (form.leaseMiles)
        line += `${form.leaseMonths ? ", " : " "}${form.leaseMiles}`;
      lines.push(line);
    }
    if (form.leaseDown) {
      lines.push(`- Total due at signing: ${form.leaseDown}`);
    }
    if (form.leaseMaxPayment) {
      lines.push(`- Monthly payment: ${form.leaseMaxPayment} or less`);
    }
  } else if (form.dealType === "Finance") {
    lines.push("Here’s the finance structure I’m targeting:");
    if (form.financeMonths) {
      lines.push(`- Term: ${form.financeMonths} months`);
    }
    if (form.financeDown) {
      lines.push(`- Down payment: ${form.financeDown}`);
    }
    if (form.financeMaxPayment) {
      lines.push(`- Monthly payment: ${form.financeMaxPayment} or less`);
    }
  }

  lines.push(
    "If you can meet those numbers on something in stock or inbound, I’m ready to come in and sign."
  );

  return `
Hi,

${lines.join("\n")}

You can reply directly to this email.

Thanks,
${fullName || "Thanks"}
${form.zip ? `Zip: ${form.zip}` : ""}
`.trim();
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
  return subjects[Math.floor(Math.random() * subjects.length)];
}

module.exports = async (req, res) => {
  console.log("⚡ LotShoppr: TALLY HANDLER INVOKED");

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

    // ==== 1. Create lead in backend ====
    console.log(`📌 Creating lead in backend (${BACKEND_URL}/api/leads)...`);
              const dealerResult = await resend.emails.send({
                from: `LotShoppr for ${formData.firstName || "Customer"} <deals@deals.lotshoppr.com>`,
                to: dealerEmail,
                subject,
                text,
                reply_to: "deals@deals.lotshoppr.com",
              });
    } else if (constraints.dealType === "lease") {
      constraints.lease = {
        miles: parseMiles(formData.leaseMiles),
        months: parseInt(formData.leaseMonths) || null,
        down: parseMoney(formData.leaseDown),
        maxPayment: parseMoney(formData.leaseMaxPayment),
      };
    } else if (constraints.dealType === "finance") {
      constraints.finance = {
        months: parseInt(formData.financeMonths) || null,
        down: parseMoney(formData.financeDown),
        maxPayment: parseMoney(formData.financeMaxPayment),
      };
    }

    let leadResponse;
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          zip: formData.zip,
          vehicle: {
            year: parseInt(formData.year) || 0,
            make: formData.make,
            model: formData.model,
            trim: formData.trim,
            color: formData.color,
            interior: formData.interior === "Light Interior" ? "light" : formData.interior === "Dark Interior" ? "dark" : "any",
          },
          constraints,
        }),
      });

      leadResponse = await response.json();
      if (!response.ok) {
        throw new Error(`Backend error: ${JSON.stringify(leadResponse)}`);
      }
    } catch (e) {
      console.error("❌ Error creating lead in backend:", e);
      return res.status(500).json({ ok: false, error: "backend_lead_creation_failed" });
    }

    const leadId = leadResponse.lead.id;
    const dealsAddress = `deals+${leadId}@lotshoppr.com`;

    console.log(`✔ Lead created with ID: ${leadId}`);

    // ==== 2. Send admin email ====
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

    await sleep(700);

    // ==== 3. Send dealer initial emails ====
    const dealerRecipients = getDealerRecipients();
    if (dealerRecipients.length > 0) {
      const subject = buildDealerSubject(formData);
      const text = buildDealerInitialBody(formData);

      for (const dealerEmail of dealerRecipients) {
        console.log(`📨 Sending dealer email to ${dealerEmail}...`);
          const dealerResult = await resend.emails.send({
            from: `LotShoppr for ${formData.firstName || "Customer"} <${dealsAddress}>`,
            to: dealerEmail,
            subject,
            text,
            reply_to: dealsAddress,
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
      console.log("⚠ No dealer recipients configured (DEALER_EMAILS env is empty).");
    }

    return res.json({ ok: true, leadId });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({ ok: false, error: "webhook_failure" });
  }
};

// ====== Helpers ======
function parseMoney(input) {
  if (!input) return null;
  const cleaned = input.toString().replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}

function parseMiles(input) {
  if (!input) return null;
  const cleaned = input.toString().replace(/[^0-9]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : n;
}
