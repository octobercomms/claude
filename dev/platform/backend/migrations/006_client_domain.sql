-- Add domain field to clients for SEO data lookups
ALTER TABLE clients ADD COLUMN IF NOT EXISTS domain VARCHAR(255);
