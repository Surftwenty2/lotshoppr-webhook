// File: api/tally-webhook.js
// -------------------------------------------------------
// LotShoppr Webhook Handler (clean, tested structure)
// -------------------------------------------------------

console.log("⚡ LotShoppr: NEW TALLY WEBHOOK HANDLER LOADED");

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

  // For dropdowns / multiple choice
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
// Dealer-facing email helpers
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
    `Pricing on a ${year} ${make} ${model}?`,
    `Looking for a ${year} ${make} ${model} deal`,
    `Question about a ${year} ${make} ${model}`,
  ];
  return pickRandom(subjects);
}

function buildDealerBody(form) {
