// lib/negotiation.js
// Central place for lead storage + negotiation logic

const { randomUUID } = require("crypto");

// ----------------------
// In-memory "database"
// (swap for Postgres later)
// ----------------------
const leads = new Map();

/**
 * Create a lead object from the incoming Tally formData
 */
function createLeadFromForm(formData) {
  const id = randomUUID();

  const constraints = {
    dealType: formData.dealType,
    lease: {
      miles: formData.leaseMiles || null,
      months: formData.leaseMonths || null,
      down: formData.leaseDown || null,
      maxPayment: formData.leaseMaxPayment || null,
    },
    finance: {
      months: formData.financeMonths || null,
      down: formData.financeDown || null,
      maxPayment: formData.financeMaxPayment || null,
    },
    cash: {
      maxOtd: formData.cashMax || null,
    },
  };

  return {
    id,
    createdAt: new Date().toISOString(),
    status: "new", // new | negotiating | won | lost
    matchType: null, // null | "exact" | "similar"
    firstName: formData.firstName || "",
    lastName: formData.lastName || "",
    email: formData.email || "",
    zip: formData.zip || "",
    vehicle: {
      year: formData.year || "",
      make: formData.make || "",
      model: formData.model || "",
      trim: formData.trim || "",
      color: formData.color || "",
      interior: formData.interior || "",
    },
    constraints,
    dealerEmails: [], // we’ll fill this when sending
    conversation: [], // { from: "dealer" | "customer", text, at }
  };
}

async function saveLead(lead) {
  leads.set(lead.id, lead);
  return lead;
}

async function getLeadById(id) {
  return leads.get(id) || null;
}

async function updateLead(id, patch) {
  const existing = leads.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  leads.set(id, updated);
  return updated;
}

async function appendConversation(id, entry) {
  const existing = leads.get(id);
  if (!existing) return null;
  const conv = existing.conversation || [];
  conv.push({ ...entry, at: new Date().toISOString() });
  existing.conversation = conv;
  leads.set(id, existing);
  return existing;
}

// ----------------------
// Intent classification
// (very simple keyword-based for now)
// ----------------------
function classifyDealerIntent(text) {
  const t = (text || "").toLowerCase();

  if (!t.trim()) return "UNKNOWN";

  if (
    t.includes("come in") ||
    t.includes("stop by") ||
    t.includes("visit") ||
    t.includes("test drive") ||
    t.includes("drive it first")
  ) {
    return "REFUSE_NUMBERS_IN_PERSON";
  }

  if (
    t.includes("credit app") ||
    t.includes("credit application") ||
    t.includes("finance application") ||
    t.includes("submit an application") ||
    t.includes("apply for credit")
  ) {
    return "REFUSE_NUMBERS_CREDIT_APP";
  }

  if (
    t.includes("sold") ||
    t.includes("no longer available") ||
    t.includes("already gone") ||
    t.includes("we don’t have that car") ||
    t.includes("we don't have that car")
  ) {
    return "UNIT_SOLD";
  }

  if (
    t.includes("similar vehicle") ||
    t.includes("something similar") ||
    t.includes("we have this instead") ||
    t.includes("different trim") ||
    t.includes("different model")
  ) {
    return "PUSHING_DIFFERENT_CAR";
  }

  // crude signal for actual numbers
  if (
    t.includes("$") ||
    t.includes("per month") ||
    t.includes("/mo") ||
    t.includes("out the door") ||
    t.includes("otd")
  ) {
    return "NUMBERS_PROVIDED";
  }

  if (
    t.includes("call me") ||
    t.includes("give me a call") ||
    t.includes("phone") ||
    t.includes("reach me at") ||
    t.includes("let's talk")
  ) {
    return "NOISE_CALL_ME";
  }

  return "UNKNOWN";
}

// ----------------------
// Deal evaluation & parsing
// NOTE: these are intentionally simple placeholders.
// In a “real” v2, you’d use an LLM to parse the dealer’s
// free-text pencil into structured numbers.
// ----------------------

/**
 * Super-naive parser: try to find first $xxx and first "xxx/mo"
 * Just here so the skeleton runs; upgrade this later.
 */
function naiveParseOffer(text) {
  if (!text) return {};

  const dollarMatch = text.match(/\$ ?([\d,]+)/);
  const monthlyMatch = text.match(/\$ ?([\d,]+)\s*\/?\s*(mo|month)/i);

  const priceOtd = dollarMatch ? Number(dollarMatch[1].replace(/,/g, "")) : null;
  const monthly = monthlyMatch
    ? Number(monthlyMatch[1].replace(/,/g, ""))
    : null;

  return {
    raw: text,
    priceOtd,
    monthly,
    // In real implementation, also parse miles, term, DAS, etc.
  };
}

/**
 * Compare dealer offer to lead constraints.
 * Returns { outcome, matchType, reason }
 * outcome: "MEETS", "CLOSE", "WAY_OFF"
 */
function evaluateOffer(lead, offer) {
  const t = lead.constraints.dealType;

  if (t === "Pay Cash") {
    const maxOtdStr = lead.constraints.cash.maxOtd || "";
    const maxOtd = Number(maxOtdStr.replace(/[^0-9.]/g, "")) || null;
    if (!maxOtd || !offer.priceOtd) {
      return { outcome: "UNKNOWN", matchType: null, reason: "Missing numbers" };
    }
    if (offer.priceOtd <= maxOtd) {
      return { outcome: "MEETS", matchType: "exact", reason: "Price at or under target" };
    }
    if (offer.priceOtd <= maxOtd * 1.05) {
      return { outcome: "CLOSE", matchType: "exact", reason: "Slightly high" };
    }
    return { outcome: "WAY_OFF", matchType: null, reason: "Price too high" };
  }

  if (t === "Lease" || t === "Finance") {
    const maxPaymentStr =
      t === "Lease"
        ? lead.constraints.lease.maxPayment
        : lead.constraints.finance.maxPayment;
    const maxPayment = Number((maxPaymentStr || "").replace(/[^0-9.]/g, "")) || null;
    if (!maxPayment || !offer.monthly) {
      return { outcome: "UNKNOWN", matchType: null, reason: "Missing monthly payment" };
    }
    if (offer.monthly <= maxPayment) {
      return { outcome: "MEETS", matchType: "exact", reason: "Monthly at or under target" };
    }
    if (offer.monthly <= maxPayment + 50) {
      return { outcome: "CLOSE", matchType: "exact", reason: "Slightly high monthly" };
    }
    return { outcome: "WAY_OFF", matchType: null, reason: "Monthly too high" };
  }

  return { outcome: "UNKNOWN", matchType: null, reason: "Unhandled deal type" };
}

// ----------------------
// Reply templates per scenario
// ----------------------

function buildRefuseInPersonReply(lead) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  return `
Hi,

I’m not going to come in just to find out we’re too far apart on numbers.

I need a clear out-the-door quote based on the structure I sent. If we’re in the same range, I’m happy to come in, drive it, and wrap things up.

If you’re able to send that, great — otherwise I’ll move on.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
}

function buildRefuseCreditAppReply(lead) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  return `
Hi,

I’m not filling out a credit app just to see basic pricing.

Please send an out-the-door quote based on the terms I sent. If it works, I’ll complete the application and come in to finish everything.

If you can’t provide numbers without an app, I’ll keep looking.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
}

function buildUnitSoldReply(lead, flexible = false) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const baseSpec = `${lead.vehicle.year} ${lead.vehicle.make} ${lead.vehicle.model} ${lead.vehicle.trim}`;

  if (!flexible) {
    return `
Hi,

If that exact ${baseSpec} in the spec I asked about is gone, I’ll pass for now. That’s the combo I’m looking for.

If you get one back in stock with the same spec, feel free to reach out.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
  }

  return `
Hi,

Thanks for letting me know. If that specific unit is sold, I’d still be open to something very close — same trim and similar color — if the numbers line up with what I sent.

If you have something like that and can meet those terms, let me know. Otherwise I’ll keep looking.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
}

function buildDifferentCarReply(lead, flexible = true) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const baseSpec = `${lead.vehicle.year} ${lead.vehicle.make} ${lead.vehicle.model} ${lead.vehicle.trim}`;

  if (!flexible) {
    return `
Hi,

I’m specifically looking for a ${baseSpec} in the spec I mentioned. I’m not interested in a different model or a big jump in price.

If you’re able to match that vehicle and hit the numbers I laid out, I’ll come in and sign. If not, I’ll keep looking.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
  }

  return `
Hi,

I’m mainly targeting a ${baseSpec}, but I could consider something very close if the numbers are right.

If you have a similar unit and can match the structure I sent (same term/miles and OTD range), send the details and I’ll take a look. If it’s a totally different build or a lot more money, I’m going to stick to my original target.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
}

function buildPushForEmailNumbersReply(lead) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  return `
Hi,

I’m comparing a few options and don’t want to spend time on calls or visits until I know we’re in the same range.

Please send a simple out-the-door quote that matches the structure I sent. If it works, I’ll set a time to come in and finalize everything with you.

If you’re unable to provide numbers by email, I’ll keep looking.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
}

function buildCounterReply(lead) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  const { dealType, lease, finance, cash } = lead.constraints;

  if (dealType === "Pay Cash") {
    const maxOtd = cash.maxOtd || "";
    return `
Hi,

Thanks for sending the numbers.

That’s more than I’m looking to spend. I need the out-the-door price (tax, title, all fees) to be at or under ${maxOtd}.

If you can get it there, I’ll come in and buy the car.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
  }

  const terms = dealType === "Lease" ? lease : finance;
  const items = [];

  if (terms.months) items.push(`- ${terms.months} months`);
  if (dealType === "Lease" && terms.miles)
    items.push(`- ${terms.miles} miles/year`);
  if (terms.down) items.push(`- Total due at signing: ${terms.down}`);
  if (terms.maxPayment)
    items.push(`- Monthly payment: ${terms.maxPayment} or less`);

  return `
Hi,

Thanks for sending the numbers.

That’s too high for me. I need to be at:

${items.join("\n")}

If you can meet that, I’m good to come in and sign.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
}

function buildAcceptReply(lead) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  return `
Hi,

Those numbers work for me.

Let’s move forward on that structure. Please confirm the exact out-the-door amount and we can set a time for me to come in and finish paperwork.

Thanks,
${name || "Thanks"}
${lead.zip ? `Zip: ${lead.zip}` : ""}
`.trim();
}

// ----------------------
// Main negotiation entrypoint
// ----------------------

/**
 * Process a dealer reply and decide what to send back.
 * Returns:
 * {
 *   action: "REPLY" | "ACCEPT_AND_NOTIFY" | "NO_REPLY",
 *   body: string | null,
 *   matchType: null | "exact" | "similar"
 * }
 */
async function handleDealerReply(lead, inboundText) {
  await appendConversation(lead.id, { from: "dealer", text: inboundText });

  const intent = classifyDealerIntent(inboundText);

  // defaults
  let matchType = lead.matchType || null;

  if (intent === "REFUSE_NUMBERS_IN_PERSON") {
    return { action: "REPLY", body: buildRefuseInPersonReply(lead), matchType };
  }

  if (intent === "REFUSE_NUMBERS_CREDIT_APP") {
    return { action: "REPLY", body: buildRefuseCreditAppReply(lead), matchType };
  }

  if (intent === "UNIT_SOLD") {
    // mark that anything going forward would be "similar"
    matchType = "similar";
    return {
      action: "REPLY",
      body: buildUnitSoldReply(lead, /* flexible= */ true),
      matchType,
    };
  }

  if (intent === "PUSHING_DIFFERENT_CAR") {
    // Again, any accepted deal is "similar", not exact.
    matchType = "similar";
    return {
      action: "REPLY",
      body: buildDifferentCarReply(lead, /* flexible= */ true),
      matchType,
    };
  }

  if (intent === "NOISE_CALL_ME" || intent === "UNKNOWN") {
    return {
      action: "REPLY",
      body: buildPushForEmailNumbersReply(lead),
      matchType,
    };
  }

  if (intent === "NUMBERS_PROVIDED") {
    const offer = naiveParseOffer(inboundText);
    const evalResult = evaluateOffer(lead, offer);

    if (evalResult.outcome === "MEETS") {
      // If previously marked similar, keep that, else exact.
      matchType = matchType || evalResult.matchType || "exact";
      return {
        action: "ACCEPT_AND_NOTIFY",
        body: buildAcceptReply(lead),
        matchType,
      };
    }

    if (evalResult.outcome === "CLOSE") {
      matchType = matchType || evalResult.matchType || null;
      return {
        action: "REPLY",
        body: buildCounterReply(lead),
        matchType,
      };
    }

    if (evalResult.outcome === "WAY_OFF") {
      // Optional: one polite pass, or just no reply.
      return {
        action: "NO_REPLY",
        body: null,
        matchType,
      };
    }

    // Unknown outcome – safe push for clearer numbers
    return {
      action: "REPLY",
      body: buildPushForEmailNumbersReply(lead),
      matchType,
    };
  }

  return {
    action: "REPLY",
    body: buildPushForEmailNumbersReply(lead),
    matchType,
  };
}

module.exports = {
  createLeadFromForm,
  saveLead,
  getLeadById,
  updateLead,
  handleDealerReply,
};
