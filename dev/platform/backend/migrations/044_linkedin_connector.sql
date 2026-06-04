-- LinkedIn connector for the social autopilot (Phase 4). We post on
-- behalf of a member (not a company page) for now — w_member_social only
-- requires standard developer access, while w_organization_social
-- requires LinkedIn Marketing Developer Platform approval which can take
-- weeks. Company-Page support is a follow-up once a client needs it.
ALTER TYPE connector_type_enum ADD VALUE IF NOT EXISTS 'linkedin_organic';
