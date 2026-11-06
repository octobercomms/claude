const db = require('../../db');

async function matchRule(payee) {
  if (!payee) return null;
  const normalised = payee.trim().toLowerCase();

  const { rows } = await db.query(`
    SELECT * FROM acct_rules
    ORDER BY
      CASE match_type WHEN 'exact' THEN 0 WHEN 'starts_with' THEN 1 WHEN 'contains' THEN 2 WHEN 'regex' THEN 3 END,
      times_confirmed DESC
  `);

  for (const rule of rows) {
    const pattern = rule.payee_pattern.toLowerCase();
    let matched = false;

    switch (rule.match_type) {
      case 'exact':
        matched = normalised === pattern;
        break;
      case 'starts_with':
        matched = normalised.startsWith(pattern);
        break;
      case 'contains':
        matched = normalised.includes(pattern);
        break;
      case 'regex':
        try { matched = new RegExp(rule.payee_pattern, 'i').test(payee); } catch { /* skip bad regex */ }
        break;
    }

    if (matched) {
      await db.query(
        'UPDATE acct_rules SET last_seen = now(), updated_at = now() WHERE id = $1',
        [rule.id]
      );
      return rule;
    }
  }
  return null;
}

async function classifyWithAI(transaction, chartOfAccounts, taxRates) {
  let callClaude;
  try { callClaude = require('../claude').callClaude; } catch { return null; }

  const accountsList = chartOfAccounts
    .filter(a => a.Status === 'ACTIVE' && a.Class !== 'ASSET' && a.Class !== 'EQUITY')
    .map(a => `${a.Code} - ${a.Name} (${a.Type})`)
    .join('\n');

  const ratesList = taxRates
    .filter(r => r.Status === 'ACTIVE')
    .map(r => `${r.Name} (${r.TaxType}, ${r.EffectiveRate}%)`)
    .join('\n');

  const prompt = `You are a UK bookkeeper for a limited company (VAT registered, accruals basis).
Classify this bank transaction into the correct account code and VAT treatment.

Transaction:
- Date: ${transaction.line_date || transaction.Date}
- Payee: ${transaction.payee || transaction.Contact?.Name || 'Unknown'}
- Amount: ${transaction.amount || transaction.Total} ${transaction.currency || 'GBP'}
- Reference: ${transaction.reference || transaction.Reference || ''}
- Description: ${transaction.description || ''}

Chart of Accounts:
${accountsList}

Tax Rates:
${ratesList}

Respond in JSON only:
{
  "account_code": "the 4-digit code",
  "account_name": "the account name",
  "tax_rate": "the tax rate name",
  "confidence": 0.0 to 1.0,
  "reasoning": "one sentence explaining why"
}

Rules:
- HMRC payments (VAT, PAYE, CT) go to their control accounts, not P&L.
- Entertaining is non-deductible (no VAT recovery).
- Foreign transactions: use the rate from the transaction date.
- If unsure, set confidence below 0.5 and say so in reasoning.`;

  try {
    const result = await callClaude(prompt, { maxTokens: 500 });
    const text = result?.content?.[0]?.text || result;
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('[accounts] AI classification failed:', err.message);
    return null;
  }
}

async function classify(transaction, chartOfAccounts, taxRates) {
  const payee = transaction.payee || transaction.Contact?.Name || '';

  const rule = await matchRule(payee);
  if (rule && rule.confidence >= 0.8 && rule.times_confirmed >= 2) {
    return {
      accountCode: rule.account_code,
      accountName: rule.account_name,
      taxRate: rule.tax_rate,
      confidence: Number(rule.confidence),
      matchSource: 'rule',
      matchedRuleId: rule.id,
      aiReasoning: null,
    };
  }

  const aiResult = await classifyWithAI(transaction, chartOfAccounts, taxRates);
  if (aiResult) {
    return {
      accountCode: aiResult.account_code,
      accountName: aiResult.account_name,
      taxRate: aiResult.tax_rate,
      confidence: Number(aiResult.confidence) || 0.5,
      matchSource: 'ai',
      matchedRuleId: null,
      aiReasoning: aiResult.reasoning,
    };
  }

  if (rule) {
    return {
      accountCode: rule.account_code,
      accountName: rule.account_name,
      taxRate: rule.tax_rate,
      confidence: Number(rule.confidence),
      matchSource: 'rule',
      matchedRuleId: rule.id,
      aiReasoning: null,
    };
  }

  return {
    accountCode: null,
    accountName: null,
    taxRate: null,
    confidence: 0,
    matchSource: null,
    matchedRuleId: null,
    aiReasoning: null,
  };
}

async function promoteToRule(confirmation) {
  const existing = await db.query(
    'SELECT * FROM acct_rules WHERE lower(payee_pattern) = lower($1) AND match_type = $2 LIMIT 1',
    [confirmation.payee, 'contains']
  );

  if (existing.rows.length) {
    await db.query(`
      UPDATE acct_rules SET
        account_code = $1, account_name = $2, tax_rate = $3,
        times_confirmed = times_confirmed + 1,
        confidence = LEAST(1.0, confidence + 0.1),
        last_seen = now(), updated_at = now()
      WHERE id = $4
    `, [confirmation.confirmed_code, confirmation.confirmed_name, confirmation.confirmed_rate, existing.rows[0].id]);
    return existing.rows[0].id;
  }

  const { rows } = await db.query(`
    INSERT INTO acct_rules (payee_pattern, match_type, account_code, account_name, tax_rate, currency, confidence, times_confirmed, last_seen)
    VALUES ($1, 'contains', $2, $3, $4, $5, 0.8, 1, now())
    RETURNING id
  `, [confirmation.payee, confirmation.confirmed_code, confirmation.confirmed_name, confirmation.confirmed_rate, confirmation.currency || 'GBP']);

  return rows[0].id;
}

module.exports = { matchRule, classify, classifyWithAI, promoteToRule };
