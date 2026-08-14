// Shared (social) pillar snapshot — the missing sibling of paid/earned/owned
// OverviewReport modules, to the same contract: reportData(clientId,{days}) →
// { ...shape, has_data }. Reads STORED social data (published posts + their
// latest engagement snapshots) via the social service's aggregations; it does
// not do a live account fetch (follower counts aren't stored). Used by the
// cross-PESO Strategist briefing. See services/strategist/briefing.js.

const pool = require('../db');
const social = require('./social');

async function reportData(clientId, { days = 30 } = {}) {
  let winners = [], spark = [], frameworks = [];
  try { winners = await social.getRecentWinners(clientId, { days, limit: 8 }); } catch { /* degrade */ }
  try { spark = await social.getReachSparkline(clientId, { days }); } catch { /* degrade */ }
  try { frameworks = await social.getFrameworkBreakdown(clientId, { days }); } catch { /* degrade */ }

  // Posting cadence + by-network counts from stored published posts.
  let byPlatform = [];
  try {
    const { rows } = await pool.query(
      `SELECT platform, COUNT(*)::int AS posts
         FROM social_posts
        WHERE client_id = $1 AND published_at IS NOT NULL
          AND published_at >= NOW() - make_interval(days => $2)
        GROUP BY platform ORDER BY posts DESC`,
      [clientId, days]
    );
    byPlatform = rows;
  } catch { /* degrade */ }

  const totalReach = spark.reduce((s, d) => s + Number(d.reach || 0), 0);
  const totalInteractions = spark.reduce((s, d) => s + Number(d.interactions || 0), 0);
  const totalPosts = byPlatform.reduce((s, r) => s + Number(r.posts || 0), 0);
  const engRates = winners.map(w => Number(w.engagement_rate || 0)).filter(Boolean);
  const avgEng = engRates.length ? engRates.reduce((s, r) => s + r, 0) / engRates.length : 0;

  return {
    days,
    totals: {
      posts: totalPosts,
      reach: totalReach,
      interactions: totalInteractions,
      avg_engagement_rate: Number(avgEng.toFixed(4)),
    },
    by_platform: byPlatform,
    top_posts: winners.slice(0, 8).map(w => ({
      platform: w.platform, kind: w.kind, hook: w.hook,
      reach: w.reach, likes: w.likes, comments: w.comments, shares: w.shares, saves: w.saves,
      engagement_rate: w.engagement_rate, is_heater: w.is_heater, published_at: w.published_at,
    })),
    frameworks,
    reach_trend: spark,
    has_data: totalPosts > 0 || winners.length > 0 || spark.length > 0,
  };
}

function buildSummaryPrompt({ client, data }) {
  const t = data.totals || {};
  return {
    system: 'You are a senior organic social strategist at October Communications writing the opening summary of a Shared/social overview for a client. British English. 2–3 short sentences, plain and confident. Say how social is performing (reach, engagement, cadence) and the ONE thing to focus on next. Do not invent numbers beyond those given.',
    user: `Client: ${client.name || ''}
Posts published (last ${data.days}d): ${t.posts}. Total reach: ${t.reach}. Interactions: ${t.interactions}. Avg engagement rate on top posts: ${(Number(t.avg_engagement_rate || 0) * 100).toFixed(1)}%.
By network: ${(data.by_platform || []).map(p => `${p.platform}: ${p.posts}`).join(', ') || 'none'}.`,
  };
}

module.exports = { reportData, buildSummaryPrompt };
