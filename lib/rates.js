const { kv } = require("./kv");

const NB_URL = "https://nationalbank.kz/rss/rates_all.xml";
const CACHE_KEY = "currency_rates";
const CACHE_TTL = 3600; // 1 hour

// Currencies we need
const NEEDED = ["USD", "EUR", "GBP", "CAD", "AUD"];

/**
 * Fetch official exchange rates from National Bank of Kazakhstan
 * Returns { USD: 470.46, EUR: 543.10, GBP: 622.42, ... , date: "04.04.2026" }
 */
async function fetchRatesFromNBRK() {
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();
  const fdate = dd + "." + mm + "." + yyyy;

  const res = await fetch(NB_URL + "?fdate=" + fdate);
  if (!res.ok) throw new Error("NBRK API error: " + res.status);

  const xml = await res.text();
  const rates = { date: fdate };

  // Parse XML with regex (simple, no dependencies)
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  for (const item of items) {
    const title = (item.match(/<title>(.*?)<\/title>/) || [])[1];
    const value = (item.match(/<description>(.*?)<\/description>/) || [])[1];
    const quant = (item.match(/<quant>(.*?)<\/quant>/) || [])[1];

    if (title && value && NEEDED.includes(title)) {
      const rate = parseFloat(value);
      const q = parseInt(quant) || 1;
      rates[title] = Math.round((rate / q) * 100) / 100;
    }
  }

  return rates;
}

/**
 * Get rates with caching (1 hour in KV)
 */
async function getRates() {
  // Try cache first
  try {
    const cached = await kv.get(CACHE_KEY);
    if (cached && cached.USD) return cached;
  } catch {}

  // Fetch fresh
  try {
    const rates = await fetchRatesFromNBRK();
    // Cache for 1 hour
    try {
      await kv.set(CACHE_KEY, rates, { ex: CACHE_TTL });
    } catch {}
    return rates;
  } catch (err) {
    console.error("Failed to fetch rates:", err.message);
    // Return fallback rates
    return {
      USD: 470,
      EUR: 543,
      GBP: 622,
      CAD: 338,
      AUD: 325,
      date: "fallback",
    };
  }
}

/**
 * Calculate total cost in tenge for a direction
 */
function calculateTotal(direction, rates) {
  let total = parseInt(String(direction.price).replace(/\D/g, "")) || 0;
  const fees = direction.additionalFees || [];

  const calculations = [];
  calculations.push("Услуги PositiVisa: " + direction.price);

  for (const fee of fees) {
    const feeStr = fee.toLowerCase();

    // Try to extract amount and currency
    let amount = 0;
    let currency = "KZT";
    let tenge = 0;

    // EUR
    const eurMatch = fee.match(/([\d,.]+)\s*(евро|eur|€)/i);
    if (eurMatch) {
      amount = parseFloat(eurMatch[1].replace(",", "."));
      currency = "EUR";
      tenge = Math.round(amount * rates.EUR);
    }

    // USD
    const usdMatch = fee.match(/\$([\d,.]+)\s*(usd)?/i) || fee.match(/([\d,.]+)\s*(долл|usd|\$)/i);
    if (!eurMatch && usdMatch) {
      amount = parseFloat(usdMatch[1].replace(",", "."));
      currency = "USD";
      tenge = Math.round(amount * rates.USD);
    }

    // GBP
    const gbpMatch = fee.match(/([\d,.]+)\s*(фунт|gbp|£)/i) || fee.match(/£([\d,.]+)/i);
    if (gbpMatch) {
      amount = parseFloat(gbpMatch[1].replace(",", "."));
      currency = "GBP";
      tenge = Math.round(amount * rates.GBP);
    }

    // CAD
    const cadMatch = fee.match(/\$([\d,.]+)\s*cad/i) || fee.match(/([\d,.]+)\s*cad/i);
    if (cadMatch) {
      amount = parseFloat(cadMatch[1].replace(",", "."));
      currency = "CAD";
      tenge = Math.round(amount * rates.CAD);
    }

    // AUD
    const audMatch = fee.match(/\$([\d,.]+)\s*aud/i) || fee.match(/([\d,.]+)\s*aud/i);
    if (audMatch) {
      amount = parseFloat(audMatch[1].replace(",", "."));
      currency = "AUD";
      tenge = Math.round(amount * rates.AUD);
    }

    // KZT directly
    const kztMatch = fee.match(/([\d\s]+)\s*тг/i);
    if (kztMatch && !eurMatch && !usdMatch && !gbpMatch && !cadMatch && !audMatch) {
      tenge = parseInt(kztMatch[1].replace(/\s/g, "")) || 0;
    }

    if (tenge > 0) {
      total += tenge;
      if (currency !== "KZT") {
        calculations.push(fee + " (~" + tenge.toLocaleString("ru") + " тг по курсу НБ)");
      } else {
        calculations.push(fee);
      }
    }
  }

  return {
    total,
    totalFormatted: total.toLocaleString("ru") + " тг",
    calculations,
  };
}

module.exports = { getRates, calculateTotal };
