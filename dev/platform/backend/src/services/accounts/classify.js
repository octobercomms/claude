// AI classification for unknown bank lines (the long tail).
//
// When the rules engine has no match, Claude proposes an account code and
// VAT treatment. On human confirmation, promoteToRule() makes it deterministic.

const Anthropic = require('@anthropic-ai/sdk');
const { recordClaudeCost } = require('../costLog');

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY, timeout: 60_000 });
}

const SYSTEM = `You are a UK bookkeeper classifying bank statement lines for a UK limited company (VAT registered, accruals basis). The company is a marketing agency (October Communications) that operates in GBP, USD, EUR and CAD.

Your job: given a bank line (payee, amount, date, reference), propose:
1. The correct Xero account code (4-digit chart-of-accounts code)
2. The correct VAT treatment (tax type)
3. Your confidence (0.0 to 1.0)
4. A brief one-line reasoning

Common patterns for this business:
- SaaS subscriptions (software tools): use the code from the chart, typically INPUT2 (20% VAT reclaimable) if UK supplier, reverse charge if overseas
- Ad spend (Meta, Google): marketing code, usually reverse charge if invoiced from Ireland/US
- Contractor/freelancer payments: subcontractors code
- Bank fees, FX charges: bank charges code, exempt/NONE
- HMRC payments (VAT, PAYE, CT): not P&L, post to the org's VAT/PAYE/CT liability codes
- Stripe/GoCardless/PayPal: likely revenue collection, match to debtor/revenue codes
- Wise transfers between own accounts: inter-account transfer, no P&L impact
- Office supplies, equipment: depends on value and the org's chart
- Travel, subsistence: travel code, check if business entertainment (non-deductible)

Tax types:
- OUTPUT2: 20% output VAT (sales)
- INPUT2: 20% input VAT (purchases from UK VAT-registered suppliers)
- ZERORATEDOUTPUT: Zero-rated output
- ZERORATEDINPUT: Zero-rated input
- EXEMPTOUTPUT: Exempt output
- EXEMPTINPUT: Exempt input
- RRINPUT or REVERSECHARGES: Reverse charge input (services from overseas; use whichever the org's chart has)
- NONE: No VAT (e.g. wages, bank charges, inter-account transfers)

Flag as low confidence (< 0.5) anything that is:
- A new payee you haven't seen before with ambiguous description
- Potentially personal expenditure
- A large or unusual amount
- Related to capital expenditure vs revenue
- An FX settlement or conversion
- Entertainment (non-deductible for VAT)

Respond as JSON only: { "accountCode": "XXXX", "accountName": "string", "taxRate": "string", "confidence": 0.X, "reasoning": "string" }`;

const BATCH_SYSTEM = SYSTEM.replace(
  'Respond as JSON only: { "accountCode"',
  'When given multiple numbered lines, respond with a JSON array containing one object per line, in the same order. Each object: { "accountCode"'
);

async function classifyLine(line, chartOfAccounts) {
  const client = getClient();
  const coaContext = chartOfAccounts
    ? `\n\nAvailable account codes:\n${chartOfAccounts.map(a => `${a.code} - ${a.name} (${a.type})`).join('\n')}`
    : '';

  const userMsg = `Classify this bank line:
Payee: ${line.payee || line.description || 'Unknown'}
Amount: ${line.currency || 'GBP'} ${line.amount}
Date: ${line.date || 'Unknown'}
Reference: ${line.reference || 'None'}
Bank account: ${line.bankAccount || 'Unknown'}
Type: ${line.type || 'Unknown'}${coaContext}`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });

  recordClaudeCost({
    feature: 'accounts_classify',
    model: MODEL,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  }).catch(() => {});

  const text = res.content[0].text.trim();
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      accountCode: null,
      accountName: null,
      taxRate: 'NONE',
      confidence: 0.1,
      reasoning: `Failed to parse AI response: ${text.substring(0, 100)}`,
    };
  }
}

const BATCH_SIZE = 5;

async function classifyBatchLines(lines, chartOfAccounts) {
  const client = getClient();
  const coaContext = chartOfAccounts
    ? `\n\nAvailable account codes:\n${chartOfAccounts.map(a => `${a.code} - ${a.name} (${a.type})`).join('\n')}`
    : '';

  const lineDescriptions = lines.map((line, i) =>
    `${i + 1}. Payee: ${line.payee || line.description || 'Unknown'} | Amount: ${line.currency || 'GBP'} ${line.amount} | Date: ${line.date || 'Unknown'} | Ref: ${line.reference || 'None'} | Bank: ${line.bankAccount || 'Unknown'} | Type: ${line.type || 'Unknown'}`
  ).join('\n');

  const userMsg = `Classify these ${lines.length} bank lines:\n${lineDescriptions}${coaContext}\n\nRespond with a JSON array of ${lines.length} objects, one per line, in the same order.`;

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 300 * lines.length,
    system: BATCH_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });

  recordClaudeCost({
    feature: 'accounts_classify',
    model: MODEL,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  }).catch(() => {});

  const text = res.content[0].text.trim();
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length === lines.length) {
      return parsed;
    }
  } catch { /* fall through to individual classification */ }

  return null;
}

async function classifyBatch(lines, chartOfAccounts) {
  const results = [];

  for (let i = 0; i < lines.length; i += BATCH_SIZE) {
    const chunk = lines.slice(i, i + BATCH_SIZE);

    let batchResults = null;
    try {
      batchResults = await classifyBatchLines(chunk, chartOfAccounts);
    } catch (err) {
      console.warn('[Accounts] Batch classification failed, falling back to individual:', err.message);
    }

    if (batchResults) {
      for (let j = 0; j < chunk.length; j++) {
        results.push({ lineRef: chunk[j].lineRef, ...batchResults[j] });
      }
    } else {
      for (const line of chunk) {
        try {
          const result = await classifyLine(line, chartOfAccounts);
          results.push({ lineRef: line.lineRef, ...result });
        } catch (err) {
          results.push({
            lineRef: line.lineRef,
            accountCode: null,
            taxRate: 'NONE',
            confidence: 0,
            reasoning: `Classification error: ${err.message}`,
          });
        }
      }
    }
  }

  return results;
}

module.exports = { classifyLine, classifyBatch };
