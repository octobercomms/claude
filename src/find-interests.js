// Search Meta's targeting API for interest IDs by keyword
// Usage: node src/find-interests.js "home renovation"
import { MetaClient } from './meta-client.js';

const query = process.argv[2];

if (!query) {
  console.log('Usage: node src/find-interests.js "<search term>"');
  console.log('Example: node src/find-interests.js "interior design"');
  process.exit(1);
}

async function searchInterests(query) {
  const client = new MetaClient();
  const result = await client.get('search', {
    type: 'adinterest',
    q: query,
    limit: 10,
  });

  if (!result.data || result.data.length === 0) {
    console.log(`No interests found for "${query}"`);
    return;
  }

  console.log(`Interests matching "${query}":\n`);
  for (const interest of result.data) {
    console.log(`  Name: ${interest.name}`);
    console.log(`  ID:   ${interest.id}`);
    if (interest.audience_size_lower_bound) {
      console.log(`  Audience: ${interest.audience_size_lower_bound.toLocaleString()}–${interest.audience_size_upper_bound.toLocaleString()}`);
    }
    console.log('');
  }
}

searchInterests(query).catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
