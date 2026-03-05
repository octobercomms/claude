// Campaign definitions derived from CAMPAIGN-ARCHITECTURE.md and BUDGET-PLAN.md
// Starter Tier: $500/month Meta budget
// 50% Prospecting ($250/mo → $833/day in cents)
// 30% Retargeting ($150/mo → $500/day in cents)

const DATE = new Date().toISOString().slice(0, 7).replace('-', ''); // e.g. 202603

export const CAMPAIGNS = [
  {
    key: 'prospecting',
    name: `META_CONV_Prospecting_UK_Platform_${DATE}`,
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    // Advantage Campaign Budget — Meta allocates across ad sets automatically
    daily_budget: 833, // cents = ~$8.33/day
    special_ad_categories: [],
    adsets: [
      {
        key: 'broad_homeowners',
        name: `META_CONV_Prospecting_UK_Broad_Homeowners_${DATE}`,
        status: 'PAUSED',
        optimization_goal: 'LEAD_GENERATION',
        billing_event: 'IMPRESSIONS',
        // No daily_budget — uses Advantage Campaign Budget from parent campaign
        targeting: {
          geo_locations: { countries: ['GB'] },
          age_min: 28,
          age_max: 60,
          // No interest targeting — Advantage+ finds the right audience automatically
          publisher_platforms: ['facebook', 'instagram'],
          facebook_positions: ['feed', 'story', 'facebook_reels', 'right_hand_column'],
          instagram_positions: ['stream', 'story', 'reels'],
        },
        // Creative brief (to attach ads manually or via create-ads.js)
        creative_notes: 'Static image or video. Primary text: "Your home project deserves the right architect." Headline: "Find Your Perfect Architect". CTA: Learn More → nvelope.co',
      },
      {
        key: 'interest_renovation',
        name: `META_CONV_Prospecting_UK_HomeRenovation_Interest_${DATE}`,
        status: 'PAUSED',
        optimization_goal: 'LEAD_GENERATION',
        billing_event: 'IMPRESSIONS',
        targeting: {
          geo_locations: { countries: ['GB'] },
          age_min: 30,
          age_max: 65,
          // Interests resolved via src/find-interests.js — IDs populated at creation time
          flexible_spec: [
            {
              interests: [
                { id: '6003543124424', name: 'Home improvement' },
                { id: '6003465471591', name: 'Interior design' },
                { id: '6003490028082', name: 'Architecture' },
                { id: '6003339397855', name: 'Grand Designs' },
                { id: '6003269495735', name: 'Home Renovation' },
              ],
            },
          ],
          publisher_platforms: ['facebook', 'instagram'],
          facebook_positions: ['feed', 'story', 'facebook_reels'],
          instagram_positions: ['stream', 'story', 'reels'],
        },
        creative_notes: 'Carousel format. Cards: portfolio projects → studio CTA. Headline per card: project name. Final card CTA: "Start Your Project Brief →"',
      },
    ],
  },

  {
    key: 'retargeting',
    name: `META_CONV_Retarget_UK_Platform_${DATE}`,
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    daily_budget: 500, // cents = ~$5/day
    special_ad_categories: [],
    adsets: [
      {
        key: 'studio_visitors_7d',
        name: `META_CONV_Retarget_UK_StudioVisitors_7d_${DATE}`,
        status: 'PAUSED',
        optimization_goal: 'LEAD_GENERATION',
        billing_event: 'IMPRESSIONS',
        // Custom audience must be created first via Pixel — see TRACKING-SETUP.md
        // targeting.custom_audiences populated at creation time with the audience ID
        targeting: {
          geo_locations: { countries: ['GB'] },
          age_min: 25,
          age_max: 65,
          publisher_platforms: ['facebook', 'instagram'],
          facebook_positions: ['feed', 'story'],
          instagram_positions: ['stream', 'story'],
          // custom_audiences: [{ id: 'AUDIENCE_ID' }]  ← add after Pixel has 7d data
        },
        creative_notes: 'Static image. Primary text: "Still looking for an architect? You\'ve already seen the studios — take 5 minutes to start your brief." CTA: Get Quote',
      },
      {
        key: 'quiz_starters_14d',
        name: `META_CONV_Retarget_UK_QuizStarters_14d_${DATE}`,
        status: 'PAUSED',
        optimization_goal: 'LEAD_GENERATION',
        billing_event: 'IMPRESSIONS',
        targeting: {
          geo_locations: { countries: ['GB'] },
          age_min: 25,
          age_max: 65,
          publisher_platforms: ['facebook', 'instagram'],
          facebook_positions: ['feed', 'story'],
          instagram_positions: ['stream', 'story'],
          // custom_audiences: [{ id: 'QUIZ_STARTER_AUDIENCE_ID' }]  ← add after Pixel has data
        },
        creative_notes: 'Static image. Primary text: "You were close — finish your project brief and get matched with the right architect." CTA: Complete Now',
      },
      {
        key: 'all_visitors_30d',
        name: `META_CONV_Retarget_UK_AllVisitors_30d_${DATE}`,
        status: 'PAUSED',
        optimization_goal: 'LEAD_GENERATION',
        billing_event: 'IMPRESSIONS',
        targeting: {
          geo_locations: { countries: ['GB'] },
          age_min: 25,
          age_max: 65,
          publisher_platforms: ['facebook', 'instagram'],
          facebook_positions: ['feed', 'story', 'facebook_reels'],
          instagram_positions: ['stream', 'story', 'reels'],
          // custom_audiences: [{ id: 'ALL_VISITORS_AUDIENCE_ID' }]  ← add after Pixel has data
        },
        creative_notes: 'Social proof / testimonial format. Copy angle: client success stories and studio credibility. CTA: Learn More',
      },
    ],
  },
];
