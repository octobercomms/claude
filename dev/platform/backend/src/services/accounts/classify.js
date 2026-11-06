// AI classification for unknown bank lines (the long tail).
//
// When the rules engine has no match, Claude proposes an account code and
// VAT treatment. On human confirmation, promoteToRule() makes it deterministic.

const Anthropic = require('@anthropic-ai/sdk');
const { recordClaudeCost } = require('../costLog');

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

const SYSTEM = `You are a UK bookkeeper classifying bank statement lines for a UK limited company (VAT registered, accruals basis). The company is a marketing agency (October Communications) that operates in GBP, USD, EUR and CAD.

Your job: given a bank line (payee, amount, date, reference), propose:
1. The correct Xero account code (4-digit chart-of-accounts code)
2. The correct VAT treatment (tax type)
3. Your confidence (0.0 to 1.0)
4. A brief one-line reasoning

Common patterns for this business:
- SaaS subscriptions (software tools): 6xxx codes, typically INPUT2 (20% VAT reclaimable) if UK supplier, NONE if overseas
- Ad spend (Meta, Google): 6xxx marketing, usually reverse charge if invoiced from Ireland/US
- Contractor/freelancer payments: 6xxx subcontractors
- Bank fees, FX charges: 7xxx bank charges, exempt/NONE
- HMRC payments (VAT, PAYE, CT): not P&L, post to control codes (2200/2201/2202 or similar)
- Stripe/GoCardless/PayPal: likely revenue collection, match to debtor/revenue codes
- Wise transfers between own accounts: inter-account transfer, no P&L impact
- Office supplies, equipment: 6xxx/7xxx depending on value
- Travel, subsistence: 6xxx travel, check if business entertainment (non-deductible)

Tax types:
- OUTPUT2: 20% output VAT (sales)
- INPUT2: 20% input VAT (purchases from UK VAT-registered suppliers)
- ZERORATEDOUTPUT: Zero-rated output
- ZERORATEDINPUT: Zero-rated input
- EXEMPTOUTPUT: Exempt output
- EXEMPTINPUT: Exempt input
- RRINPUT: Reverse charge input (services from overseas)
- NONE: No VAT (e.g. wages, bank charges, inter-account transfers)

Flag as low confidence (< 0.5) anything that is:
- A new payee you haven't seen before with ambiguous description
- Potentially personal expenditure
- A large or unusual amount
- Related to capital expenditure vs revenue
- An FX settlement or conversion
- Entertainment (non-deductible for VAT)

Respond as JSON only: { "accountCode": "XXXX", "accountName": "string", "taxRate": "string", "confidence": 0.X, "reasoning": "string" }`;

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

// Batch classify multiple lines. Calls are sequential to respect rate limits.
async function classifyBatch(lines, chartOfAccounts) {
  const results = [];
  for (const line of lines) {
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
  return results;
}

module.exports = { classifyLine, classifyBatch };
