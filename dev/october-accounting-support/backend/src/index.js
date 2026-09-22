require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const xeroAuth = require('./xero/oauth');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'october-accounting-support',
    writeBack: process.env.WRITE_BACK_ENABLED === 'true',
  });
});

app.use('/auth', xeroAuth);

// TODO Phase 1: GET /queue (unreconciled lines + suggestions), POST /confirm.
// TODO Phase 3/4: GET /packs/vat, GET /packs/year-end.

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

const port = process.env.PORT || 4300;
app.listen(port, () => console.log(`october-accounting-support backend on :${port}`));
