<?php

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class OO_Claude {

    private $api_key;
    private $model = 'claude-sonnet-4-6';
    private $api_url = 'https://api.anthropic.com/v1/messages';

    public function __construct() {
        $settings = get_option( 'oo_settings', array() );
        $this->api_key = $settings['claude_api_key'] ?? '';
    }

    public function is_configured() {
        return ! empty( $this->api_key );
    }

    private function request( $messages, $max_tokens = 1024, $system = '' ) {
        if ( ! $this->is_configured() ) {
            return new WP_Error( 'no_api_key', 'Claude API key not configured.' );
        }

        $body = array(
            'model'      => $this->model,
            'max_tokens' => $max_tokens,
            'messages'   => $messages,
        );

        if ( $system ) {
            $body['system'] = $system;
        }

        $response = wp_remote_post( $this->api_url, array(
            'timeout' => 60,
            'headers' => array(
                'Content-Type'      => 'application/json',
                'x-api-key'         => $this->api_key,
                'anthropic-version' => '2023-06-01',
            ),
            'body' => wp_json_encode( $body ),
        ) );

        if ( is_wp_error( $response ) ) {
            return $response;
        }

        $code = wp_remote_retrieve_response_code( $response );
        $data = json_decode( wp_remote_retrieve_body( $response ), true );

        if ( $code !== 200 ) {
            $msg = $data['error']['message'] ?? 'Unknown API error';
            return new WP_Error( 'claude_api_error', $msg );
        }

        return $data['content'][0]['text'] ?? '';
    }

    private function request_json( $messages, $max_tokens = 1024, $system = '' ) {
        $text = $this->request( $messages, $max_tokens, $system );
        if ( is_wp_error( $text ) ) {
            return $text;
        }

        // Extract JSON from the response (Claude sometimes wraps in markdown)
        if ( preg_match( '/```(?:json)?\s*([\s\S]*?)\s*```/', $text, $matches ) ) {
            $text = $matches[1];
        }

        $decoded = json_decode( trim( $text ), true );
        if ( json_last_error() !== JSON_ERROR_NONE ) {
            return new WP_Error( 'json_parse_error', 'Could not parse Claude response as JSON.' );
        }

        return $decoded;
    }

    /**
     * Refine an audience description and suggest search targets.
     */
    public function refine_audience( $campaign_name, $brand, $campaign_type, $audience_description, $extra_instructions = '', $exclude_domains = array(), $structured = array() ) {
        $brands = OO_Database::get_brands();
        $brand_label = $brands[ $brand ] ?? $brand;

        $system = "You are a B2B research specialist who knows how to find real, active companies in niche professional sectors. You only suggest domains that genuinely exist and match the audience criteria. You never fabricate company names. When given a location, you suggest companies actually based in or serving that region. Quality over quantity — a list of 20 real, perfectly-matched domains is far better than 40 guesses.";

        $prompt = "I'm creating an email outreach campaign and need help defining my target audience and finding real companies to contact.\n\n";
        $prompt .= "Campaign: {$campaign_name}\n";
        $prompt .= "Brand: {$brand_label}\n";
        $prompt .= "Campaign type: {$campaign_type}\n";
        $prompt .= "Audience description: {$audience_description}\n";

        // Structured fields
        $loc   = $structured['location']       ?? '';
        $itype = $structured['industry_type']  ?? '';
        $spec  = $structured['specialisation'] ?? '';
        $size  = $structured['business_size']  ?? '';
        $excl  = $structured['exclude_types']  ?? '';

        if ( $loc )   $prompt .= "Location / geography: {$loc}\n";
        if ( $itype ) $prompt .= "Industry sub-type: {$itype}\n";
        if ( $spec )  $prompt .= "Specialisation / focus: {$spec}\n";
        if ( $size )  $prompt .= "Business size: {$size}\n";
        if ( $excl )  $prompt .= "Exclude these types: {$excl}\n";

        if ( $extra_instructions ) {
            $prompt .= "Extra instructions: {$extra_instructions}\n";
        }

        if ( ! empty( $exclude_domains ) ) {
            $exclude_list = implode( ', ', array_slice( $exclude_domains, 0, 100 ) );
            $prompt .= "\nIMPORTANT — do NOT suggest any of these already-searched domains:\n{$exclude_list}\n";
        }

        $prompt .= "\nYour task:\n";
        $prompt .= "1. Write a refined audience description (2-3 sentences, specific and actionable)\n";
        $prompt .= "2. Suggest 20-30 REAL company domains to search — firms, studios, practices, offices that genuinely match ALL criteria above (location, type, size). Only include domains you are confident actually exist and are active businesses.\n";
        $prompt .= "3. Suggest 5-8 target job titles appropriate for this audience\n";
        $prompt .= "4. Write a brief rationale (1-2 sentences)\n\n";
        $prompt .= "Respond as valid JSON only, no markdown:\n";
        $prompt .= '{"refined_description":"...","domains":["domain1.com","domain2.com"],"job_titles":["Title 1","Title 2"],"rationale":"..."}';

        $messages = array(
            array( 'role' => 'user', 'content' => $prompt ),
        );

        return $this->request_json( $messages, 1500, $system );
    }

    /**
     * Suggest relevant industry directories for a given audience.
     * Returns array of {name, domain, search_path} objects.
     */
    public function suggest_directories( $industry_type, $location, $specialisation ) {
        $subject = trim( $specialisation ?: $industry_type );

        $prompt  = "I need to find real professional firms in this niche:\n";
        $prompt .= "Industry: {$subject}\n";
        if ( $location ) $prompt .= "Location: {$location}\n";
        $prompt .= "\nList up to 6 publicly-accessible online directories, databases, or association member listings where such firms would be listed — ideally with individual firm profile pages and links to their websites.\n";
        $prompt .= "Prefer directories that are specific to this industry and region if possible.\n\n";
        $prompt .= "Return as valid JSON array only:\n";
        $prompt .= '[{"name":"Directory Name","domain":"directory.com","search_path":"/search?q=melbourne"}]';
        $prompt .= "\nsearch_path should be a path on that domain that lists relevant firms (include any useful query params). Use empty string if none.";

        $messages = array( array( 'role' => 'user', 'content' => $prompt ) );
        return $this->request_json( $messages, 512 );
    }

    /**
     * Generate a fresh batch of domains from a different angle than the first run.
     */
    public function more_domains( $campaign_name, $brand, $audience_description, $structured, $exclude_domains ) {
        $brands      = OO_Database::get_brands();
        $brand_label = $brands[ $brand ] ?? $brand;

        $system = "You are a B2B research specialist. Only suggest company domains that genuinely exist and are active businesses. Never fabricate domains. Focus on finding companies the user has NOT already found — use different sub-sectors, adjacent disciplines, neighbouring cities, or related associations.";

        $loc   = $structured['location']       ?? '';
        $itype = $structured['industry_type']  ?? '';
        $spec  = $structured['specialisation'] ?? '';
        $size  = $structured['business_size']  ?? '';

        $prompt  = "I'm expanding the contact list for a campaign called \"{$campaign_name}\" by {$brand_label}.\n";
        $prompt .= "Target audience: {$audience_description}\n";
        if ( $loc )   $prompt .= "Location: {$loc}\n";
        if ( $itype ) $prompt .= "Industry: {$itype}\n";
        if ( $spec )  $prompt .= "Specialisation: {$spec}\n";
        if ( $size )  $prompt .= "Size: {$size}\n";

        if ( ! empty( $exclude_domains ) ) {
            $list    = implode( ', ', array_slice( $exclude_domains, 0, 150 ) );
            $prompt .= "\nThese domains have already been found — DO NOT repeat any of them:\n{$list}\n";
        }

        $prompt .= "\nFind 30–50 more real company domains I haven't found yet. Try:\n";
        $prompt .= "- Different sub-specialisations or project types\n";
        $prompt .= "- Neighbouring cities or regions\n";
        $prompt .= "- Related but adjacent disciplines\n";
        $prompt .= "- Smaller or larger firms if appropriate\n\n";
        $prompt .= "Return as valid JSON only:\n";
        $prompt .= '{"domains":["domain1.com","domain2.com"],"angle":"brief note on the approach taken"}';

        $messages = array( array( 'role' => 'user', 'content' => $prompt ) );
        return $this->request_json( $messages, 1024, $system );
    }

     */
    public function write_sequence( $campaign, $audience_description, $sample_contacts = array(), $extra_instructions = '' ) {
        $brands = OO_Database::get_brands();
        $brand_label = $brands[ $campaign->brand ] ?? $campaign->brand;

        $sample = '';
        if ( $sample_contacts ) {
            $names = array_map( function( $c ) {
                return trim( $c['first_name'] . ' ' . $c['last_name'] ) . ' at ' . $c['company'];
            }, array_slice( $sample_contacts, 0, 3 ) );
            $sample = implode( ', ', $names );
        }

        $system = "You are an expert B2B email copywriter specialising in outreach to architects, designers, and built environment professionals. You write concise, warm, non-salesy emails that feel personal and human. Never use generic phrases like 'I hope this email finds you well' or 'I am reaching out because'. Keep emails under 150 words each.";

        $prompt = "Write a 3-email outreach sequence for this campaign:\n\n";
        $prompt .= "Campaign: {$campaign->name}\n";
        $prompt .= "Brand: {$brand_label}\n";
        $prompt .= "From: {$campaign->from_name}\n";
        $prompt .= "Audience: {$audience_description}\n";
        if ( $sample ) {
            $prompt .= "Example contacts: {$sample}\n";
        }
        if ( $extra_instructions ) {
            $prompt .= "Instructions: {$extra_instructions}\n";
        }
        $prompt .= "\nEmail 1: Initial outreach (day 0)\n";
        $prompt .= "Email 2: Follow-up if no reply (day 4) — different angle, shorter\n";
        $prompt .= "Email 3: Final nudge (day 9) — brief, low-pressure close\n\n";
        $prompt .= "Use {{first_name}} as a placeholder for the recipient's first name.\n\n";
        $prompt .= "Respond as valid JSON only:\n";
        $prompt .= '[{"step":1,"subject":"...","body":"...","delay_days":0},{"step":2,"subject":"...","body":"...","delay_days":4},{"step":3,"subject":"...","body":"...","delay_days":9}]';

        $messages = array(
            array( 'role' => 'user', 'content' => $prompt ),
        );

        return $this->request_json( $messages, 2048, $system );
    }

    /**
     * Classify an inbound reply.
     */
    public function classify_reply( $reply_text, $campaign_name ) {
        $prompt = "Classify this email reply to an outreach campaign ({$campaign_name}).\n\n";
        $prompt .= "Reply:\n{$reply_text}\n\n";
        $prompt .= "Classify as one of: interested, not_now, not_relevant, unsubscribe, auto_reply, question\n";
        $prompt .= "Also write a one-sentence summary.\n\n";
        $prompt .= 'Respond as JSON: {"classification":"...","summary":"..."}';

        $messages = array( array( 'role' => 'user', 'content' => $prompt ) );
        return $this->request_json( $messages, 256 );
    }

    /**
     * Define journalist audience from a press release URL/content.
     */
    public function define_press_audience( $title, $content_summary ) {
        $prompt = "I have a press release and need to identify the right journalists to pitch it to.\n\n";
        $prompt .= "Title: {$title}\n";
        $prompt .= "Summary: {$content_summary}\n\n";
        $prompt .= "Provide:\n";
        $prompt .= "1. The type of journalists who would cover this (beats, publication types)\n";
        $prompt .= "2. 8-10 specific publications or media outlet domains to search\n";
        $prompt .= "3. Target job titles at those outlets\n";
        $prompt .= "4. A short pitch angle (one sentence)\n\n";
        $prompt .= 'Respond as JSON: {"journalist_type":"...","publication_domains":["..."],"job_titles":["..."],"pitch_angle":"..."}';

        $messages = array( array( 'role' => 'user', 'content' => $prompt ) );
        return $this->request_json( $messages, 1024 );
    }

    /**
     * Write a press release pitch email.
     */
    public function write_press_pitch( $press_release_title, $pitch_angle, $from_name, $extra_instructions = '' ) {
        $system = "You are an expert PR writer. Write concise, compelling journalist pitches that get opened. Lead with the news angle, not pleasantries. Under 120 words.";

        $prompt = "Write a press release pitch email and one follow-up.\n\n";
        $prompt .= "Press release: {$press_release_title}\n";
        $prompt .= "Angle: {$pitch_angle}\n";
        $prompt .= "From: {$from_name}\n";
        if ( $extra_instructions ) {
            $prompt .= "Instructions: {$extra_instructions}\n";
        }
        $prompt .= "\nUse {{first_name}} for recipient name.\n\n";
        $prompt .= 'Respond as JSON: [{"step":1,"subject":"...","body":"...","delay_days":0},{"step":2,"subject":"...","body":"...","delay_days":3}]';

        $messages = array( array( 'role' => 'user', 'content' => $prompt ) );
        return $this->request_json( $messages, 1024, $system );
    }
}
