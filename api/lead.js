// POST /api/lead: receives an application from the form and forwards it to the
// lead webhook (Autodroids / LeadConnector) in the same shape as our other lead sources.
// Runs as a Vercel function, and is also mounted by server.js on Railway.
// The webhook URL is kept in the LEAD_WEBHOOK_URL environment variable, never in the page.
const crypto = require("crypto");

const PROVINCES = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
// Form income source -> short status, matching the other lead sources ("self-employed" etc.)
const EMPLOYMENT = {
  "Employed (full-time / part-time)": "employed",
  "Self-employed": "self-employed",
  "Student": "student",
  "Not working": "not working",
  "Retired / Disability": "retired/disability",
  "Homemaker / Unemployed": "homemaker/unemployed",
  "Other": "other",
};

const str = (v) => (typeof v === "string" ? v.trim().slice(0, 500) : "");
const xml = (v) => String(v).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
const duration = (y, m) => {
  if (y === "" && m === "") return "";
  const yrs = y === "20" ? "20+ years" : `${y} year${y === "1" ? "" : "s"}`;
  return `${yrs} ${m} month${m === "1" ? "" : "s"}`;
};

function readBody(req) {
  // Vercel parses JSON bodies for us; on Railway we read the stream
  if (req.body !== undefined) return Promise.resolve(typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 50000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

function buildPayload(f, req) {
  const leadId = crypto.randomBytes(6).toString("base64").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8).padEnd(8, "X");
  const [first, ...rest] = f.fullName.split(/\s+/);
  const last = rest.join(" ");
  const phone = f.phone.replace(/\D/g, "");
  const street = f.unit ? `${f.street}, Unit ${f.unit}` : f.street;
  const employment = EMPLOYMENT[f.incomeSource] || f.incomeSource.toLowerCase();
  const budget = f.budget === "800" ? "800+" : f.budget;
  const vehicle = f.vehicle.toLowerCase();
  const residenceTime = duration(f.resYears, f.resMonths);
  const incomeTime = duration(f.incYears, f.incMonths);
  const consent = f.consent === "Yes" ? "true" : "false";
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const userAgent = str(req.headers["user-agent"]);
  const now = new Date().toISOString();

  const notes = [
    `MonthlyBudget=${budget}`,
    `VehicleType=${vehicle}`,
    `DateOfBirth=${f.dob}`,
    `AuthorizedCredit=${consent}`,
    `IncomeTime=${incomeTime}`,
    `EmploymentStatus=${employment}`,
    `IncomeSource=${f.incomeSource}`,
    `JobTitle=${f.position}`,
    `CompanyName=${f.employer}`,
    `MonthlyIncome=${f.monthlyIncome}`,
    `ResidenceTime=${residenceTime}`,
    `RentOrOwn=${f.housing}`,
    `MonthlyHomePayment=${f.housingCost}`,
    `DesiredVehicle=${vehicle}`,
    `Agreed=${consent}`,
    `IPAddress=${ip}`,
    `FBCLID=${f.fbclid}`,
    `UserAgent=${userAgent}`,
  ].join("\n");

  const adf = `<?xml version="1.0"?>
<?ADF version="1.0"?>
<adf>
    <prospect>
        <id>${xml(leadId)}</id>
        <requestdate>${xml(now)}</requestdate>
        <vehicle>
            <year></year>
            <make></make>
            <model></model>
        </vehicle>
        <customer>
            <contact>
                <name part="first" type="individual">${xml(first)}</name>
                <name part="last" type="individual">${xml(last)}</name>
                <email>${xml(f.email)}</email>
                <phone time="nopreference" type="voice">${xml(phone)}</phone>
                <address type="home">
                    <street line="1">${xml(street)}</street>
                    <city>${xml(f.city)}</city>
                    <regioncode>${xml(f.province)}</regioncode>
                    <postalcode>${xml(f.postal)}</postalcode>
                    <country>CA</country>
                </address>
            </contact>
            <comments>
${xml(notes)}
            </comments>
        </customer>
        <vendor>
            <vendorname>EasyAuto</vendorname>
        </vendor>
        <provider>
            <name>EasyAuto Website</name>
            <service>Consumer Car Leads</service>
            <url>${xml(f.pageUrl)}</url>
        </provider>
    </prospect>
</adf>
`;

  return {
    subject: `New Lead - ${f.fullName}`,
    "ADF Lead Summary": adf,
    "Lead ID": leadId,
    "First Name": first,
    "Last Name": last,
    "Phone": phone,
    "Email": f.email,
    "Lead Provider": "EasyAuto Website",
    "Contact Source": "EasyAuto Website",
    "Lead Type": "Auto Lead",
    "Business Name": "EasyAuto",
    "Consent for Credit Check": consent,
    "Date Of Birth": f.dob,
    "Time at Current Address": residenceTime,
    "Residence Type": f.housing,
    "Monthly Housing Payment": f.housingCost,
    "Employer Name": f.employer,
    "Employment Status": employment,
    "Job Title": f.position,
    "Time With Employer": incomeTime,
    "Monthly Income": f.monthlyIncome,
    "Target Budget": budget,
    "Notes": notes,
    "Street Address": street,
    "City": f.city,
    "Country": "CA",
    "Postal Code": f.postal,
    "Province Code": f.province,
    "Province Name": PROVINCES[f.province] || "",
    "VOI Body Style": vehicle,
    "User Agent": userAgent,
    "UTM Source": f.utm_source,
    "UTM Medium": f.utm_medium,
    "UTM Campaign": f.utm_campaign,
    "UTM Term": f.utm_term,
    "UTM Content": f.utm_content,
    "GCLID": f.gclid,
    "Landing Page URL": f.pageUrl,
    "Lead Origin URL": f.pageUrl,
    "Referrer URL": f.referrer,
    "Submitted At": f.submittedAt || now,
  };
}

module.exports = async function handler(req, res) {
  const reply = (status, body) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  };
  // GET is a status check: says whether the webhook is configured, without revealing it
  if (req.method === "GET") return reply(200, { ok: true, configured: Boolean(process.env.LEAD_WEBHOOK_URL) });
  if (req.method !== "POST") return reply(405, { ok: false, error: "Method not allowed" });

  let body;
  try { body = await readBody(req); } catch { return reply(400, { ok: false, error: "Invalid JSON" }); }
  if (!body || typeof body !== "object") return reply(400, { ok: false, error: "Invalid body" });

  // Honeypot: real people never see this field, bots fill it in. Pretend success.
  if (str(body.website)) return reply(200, { ok: true });

  const keys = ["fullName", "email", "phone", "street", "unit", "city", "province", "postal", "dob", "budget", "vehicle",
    "housing", "housingCost", "resYears", "resMonths", "incomeSource", "employer", "position", "incYears", "incMonths",
    "monthlyIncome", "consent", "pageUrl", "referrer", "submittedAt",
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
  const f = Object.fromEntries(keys.map((k) => [k, str(body[k])]));

  const missing = ["fullName", "email", "phone", "street", "city", "province", "postal", "dob"].filter((k) => !f[k]);
  if (missing.length || f.fullName.split(/\s+/).length < 2 || f.phone.replace(/\D/g, "").length !== 10 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) || f.consent !== "Yes") {
    return reply(400, { ok: false, error: "Incomplete application" });
  }

  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) {
    console.error("LEAD_WEBHOOK_URL is not set; lead not forwarded");
    return reply(500, { ok: false, error: "Lead destination not configured" });
  }

  const payload = buildPayload(f, req);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`Webhook responded ${r.status}`);
  } catch (err) {
    console.error("Lead forward failed:", err.message, "lead", payload["Lead ID"]);
    return reply(502, { ok: false, error: "Could not deliver lead" });
  }
  return reply(200, { ok: true, id: payload["Lead ID"] });
};
