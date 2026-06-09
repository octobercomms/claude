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

    /**
     * Fetch a press release URL and return clean article HTML.
     * Tries article > main > .entry-content > .post-content selectors.
     * Converts relative image/link URLs to absolute so they render in emails.
     */
    public function extract_press_release_html( $url ) {
        if ( ! $url || ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
            return '';
        }

        $response = wp_remote_get( $url, array( 'timeout' => 15, 'redirection' => 5 ) );
        if ( is_wp_error( $response ) ) return '';
        $html = wp_remote_retrieve_body( $response );
        if ( ! $html ) return '';

        $parsed   = wp_parse_url( $url );
        $base_url = $parsed['scheme'] . '://' . $parsed['host'];

        libxml_use_internal_errors( true );
        $dom = new DOMDocument( '1.0', 'UTF-8' );
        $dom->loadHTML( mb_convert_encoding( $html, 'HTML-ENTITIES', 'UTF-8' ), LIBXML_NOWARNING | LIBXML_NOERROR );
        libxml_clear_errors();

        // Strip chrome elements
        foreach ( array( 'script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'iframe', 'noscript' ) as $tag ) {
            $nodes = $dom->getElementsByTagName( $tag );
            while ( $nodes->length > 0 ) {
                $nodes->item(0)->parentNode->removeChild( $nodes->item(0) );
            }
        }

        $xpath = new DOMXPath( $dom );
        $content_node = null;
        foreach ( array(
            '//article',
            '//main',
            '//*[contains(@class,"entry-content")]',
            '//*[contains(@class,"post-content")]',
            '//*[contains(@class,"wp-block-post-content")]',
            '//*[contains(@class,"press-release")]',
            '//*[contains(@class,"page-content")]',
            '//body',
        ) as $selector ) {
            $nodes = $xpath->query( $selector );
            if ( $nodes && $nodes->length > 0 ) {
                $content_node = $nodes->item(0);
                break;
            }
        }
        if ( ! $content_node ) return '';

        $inner_html = '';
        foreach ( $content_node->childNodes as $child ) {
            $inner_html .= $dom->saveHTML( $child );
        }

        // Make relative src/href absolute
        $inner_html = preg_replace_callback(
            '/\b(src|href)=(["\'])(?!https?:\/\/|\/\/|data:|mailto:)([^"\']+)\2/i',
            function ( $m ) use ( $base_url ) {
                $path = $m[3][0] === '/' ? $base_url . $m[3] : $base_url . '/' . $m[3];
                return $m[1] . '=' . $m[2] . esc_attr( $path ) . $m[2];
            },
            $inner_html
        );

        // Sanitise — allow full post HTML including images
        $allowed = wp_kses_allowed_html( 'post' );
        $allowed['img']        = array_merge( $allowed['img'] ?? array(), array( 'src' => true, 'alt' => true, 'width' => true, 'height' => true, 'style' => true, 'class' => true ) );
        $allowed['figure']     = array( 'class' => true, 'style' => true );
        $allowed['figcaption'] = array( 'class' => true, 'style' => true );
        $allowed['picture']    = array();
        $allowed['source']     = array( 'srcset' => true, 'media' => true, 'type' => true );

        return wp_kses( $inner_html, $allowed );
    }

    /**
     * Fetch plain text from a press release URL (used as Claude context summary).
     */
    public function fetch_press_release_content( $url ) {
        if ( ! $url || ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
            return '';
        }
        $response = wp_remote_get( $url, array( 'timeout' => 15, 'redirection' => 5 ) );
        if ( is_wp_error( $response ) ) return '';
        $body = wp_remote_retrieve_body( $response );
        $body = preg_replace( '/<(script|style|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/i', ' ', $body );
        $text = wp_strip_all_tags( $body );
        $text = preg_replace( '/\s+/', ' ', $text );
        return mb_substr( trim( $text ), 0, 3000 );
    }

    /**
     * Extract editorial-log fields from a story page. Given the URL and the
     * page's text, returns { publication, author, title, published_date
     * (YYYY-MM-DD|''), sentiment (positive|neutral|negative) } for one-tap
     * log entry. Returns WP_Error on failure.
     */
    public function extract_story_meta( $url, $text ) {
        $host = '';
        if ( $url && ( $p = wp_parse_url( $url ) ) && ! empty( $p['host'] ) ) {
            $host = preg_replace( '/^www\./', '', $p['host'] );
        }

        $system = 'You extract structured metadata from a press/news article page. Respond with JSON only — no prose. Never invent values; use an empty string when unsure.';

        $prompt  = "Article URL: {$url}\n";
        if ( $host ) $prompt .= "Domain: {$host}\n";
        $prompt .= "\nPage text (truncated):\n" . mb_substr( (string) $text, 0, 2500 ) . "\n\n";
        $prompt .= "Return JSON: {\"publication\":\"the outlet/masthead name (not the domain if a real name is clear)\",";
        $prompt .= "\"author\":\"the journalist's full name, or ''\",";
        $prompt .= "\"title\":\"the article headline\",";
        $prompt .= "\"published_date\":\"YYYY-MM-DD or ''\",";
        $prompt .= "\"sentiment\":\"positive|neutral|negative\"}";

        return $this->request_json( array( array( 'role' => 'user', 'content' => $prompt ) ), 400, $system );
    }

    /**
     * Write the intro paragraph + subject for a press release email 1,
     * plus follow-up emails 2 and 3.
     * Email 1 body = returned intro + <hr> + extracted press release HTML (assembled by caller).
     */
    public function write_press_sequence( $campaign, $press_text_summary = '', $extra_instructions = '' ) {
        $brands      = OO_Database::get_brands();
        $brand_label = $brands[ $campaign->brand ] ?? $campaign->brand;

        $system = "You are an expert PR writer crafting journalist pitch emails. Lead with the news angle — not pleasantries. Keep intros under 80 words. Never use 'I hope this finds you well' or similar filler.";

        $prompt  = "Write a 3-step press release pitch sequence for journalist outreach.\n\n";
        $prompt .= "Campaign: {$campaign->name}\n";
        $prompt .= "Brand: {$brand_label}\n";
        $prompt .= "From: {$campaign->from_name}\n";
        if ( $extra_instructions ) {
            $prompt .= "Instructions: {$extra_instructions}\n";
        }
        if ( $press_text_summary ) {
            $prompt .= "\nPress release summary (for context — the full release is embedded in email 1 below the intro):\n{$press_text_summary}\n";
        }
        $prompt .= "\nI need:\n";
        $prompt .= "1. subject line for email 1\n";
        $prompt .= "2. short intro paragraph for email 1 (2-3 sentences, under 80 words) — greet the journalist, state the key news angle, say the full release is below. Use {{first_name}}.\n";
        $prompt .= "3. subject + body for email 2: brief follow-up (day 3) referencing the release — one short paragraph\n";
        $prompt .= "4. subject + body for email 3: final nudge (day 7) — very short, low-pressure\n\n";
        $prompt .= "Use {{first_name}} as the journalist name placeholder.\n";
        $prompt .= 'Respond as valid JSON only: {"step1_subject":"...","step1_intro":"...","step2":{"subject":"...","body":"..."},"step3":{"subject":"...","body":"..."}}';

        $messages = array( array( 'role' => 'user', 'content' => $prompt ) );
        return $this->request_json( $messages, 1024, $system );
    }

    public function write_sequence( $campaign, $audience_description, $sample_contacts = array(), $extra_instructions = '', $press_release_content = '' ) {
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
        if ( $press_release_content ) {
            $prompt .= "\nPress release content (use this to make the emails specific and relevant):\n---\n" . $press_release_content . "\n---\n";
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

    /**
     * Write a short, genuine thank-you to a journalist for a published piece.
     * Pass prior thank-you excerpts sent to THIS journalist so the new one is
     * demonstrably different (never the same note twice).
     *
     * @return array|WP_Error { tone, subject, body }
     */
    public function write_thank_you( $journalist_name, $outlet, $story_title, $client, $prior_excerpts = array() ) {
        $first = trim( explode( ' ', trim( $journalist_name ) )[0] );

        $system = 'You write short, warm, genuine thank-you emails from a PR professional to a journalist who has just featured their client. British English. 2–4 sentences. Specific, not gushing. No marketing speak, no "I hope this finds you well", no hard ask. Vary tone and opening each time. Respond as JSON only.';

        $prompt  = "Write a thank-you email.\n";
        $prompt .= "Journalist: {$journalist_name}" . ( $first ? " (use first name \"{$first}\")" : '' ) . "\n";
        if ( $outlet )      $prompt .= "Publication: {$outlet}\n";
        if ( $story_title ) $prompt .= "Article: {$story_title}\n";
        if ( $client )      $prompt .= "Client featured: {$client}\n";
        if ( $prior_excerpts ) {
            $prompt .= "\nYou have thanked this journalist before. DO NOT reuse these openings/phrasings — write something clearly different:\n";
            foreach ( array_slice( $prior_excerpts, 0, 5 ) as $ex ) {
                $prompt .= '- "' . mb_substr( $ex, 0, 140 ) . "\"\n";
            }
        }
        $prompt .= "\nReturn JSON: {\"tone\":\"one or two words for the tone you chose\",\"subject\":\"short subject line\",\"body\":\"the email body, plain text, with the first-name greeting\"}";

        return $this->request_json( array( array( 'role' => 'user', 'content' => $prompt ) ), 700, $system );
    }

    /**
     * Write a short, warm client-facing summary of a period's press coverage.
     * $items: [ {outlet, journalist, title, date} … ] (published pieces only).
     * Returns plain prose (2–4 sentences) or a WP_Error.
     */
    public function write_coverage_report( $client_name, array $items, $period_label = 'this period' ) {
        $lines = array();
        foreach ( $items as $it ) {
            $lines[] = trim(
                ( $it['outlet'] ?? '' )
                . ( ! empty( $it['journalist'] ) ? ' (' . $it['journalist'] . ')' : '' )
                . ( ! empty( $it['title'] ) ? ' — ' . $it['title'] : '' )
                . ( ! empty( $it['date'] ) ? ', ' . $it['date'] : '' )
            );
        }
        $list = implode( "\n", array_filter( $lines ) );

        $system = 'You write concise, warm PR coverage summaries for clients. Plain prose, British English. No greeting, no sign-off, no markdown, no invented facts — only summarise what is listed.';

        $prompt  = "Summarise the press coverage for the client \"{$client_name}\" for {$period_label}, in 2–4 sentences. ";
        $prompt .= "Mention the volume, any standout publications, and notable journalists if relevant. Keep it upbeat but factual.\n\n";
        $prompt .= ( $list !== '' ? "Coverage:\n{$list}" : "There was no new published coverage in this period." );

        return $this->request( array( array( 'role' => 'user', 'content' => $prompt ) ), 600, $system );
    }

    /**
     * Adjudicate candidate duplicate publication groups. Each input cluster is
     * a list of names that MIGHT be the same outlet; Claude confirms true
     * duplicates, splits false matches, and picks a canonical name.
     *
     * @param array $clusters array of arrays of names
     * @return array|WP_Error  [ { canonical, members:[names], confidence } ]
     */
    public function adjudicate_duplicates( array $clusters ) {
        $lines = array();
        foreach ( $clusters as $i => $names ) {
            $lines[] = 'Group ' . ( $i + 1 ) . ': ' . implode( ' | ', $names );
        }
        $blocks = implode( "\n", $lines );

        $system = 'You are a data-quality assistant cleaning a publications/media database for a PR tool. You decide which publication names refer to the SAME outlet. Respond ONLY with a JSON array — no prose outside it.';

        $prompt  = "Below are candidate groups of publication names that may be duplicates. ";
        $prompt .= "For each, decide which names are truly the SAME publication.\n\n";
        $prompt .= "RULES:\n";
        $prompt .= "- TREAT AS SAME: case/punctuation/spacing differences, a website/URL form (e.g. 'Dezeen' and 'Dezeen.com'), a trailing 'DO NOT USE' marker, obvious typos ('Dezeen' / 'Dazeen').\n";
        $prompt .= "- KEEP SEPARATE: different regional editions (e.g. 'Elle Decor Spain' vs 'Elle Decor Italia' vs 'Elle Decor India' are DIFFERENT). \n";
        $prompt .= "- KEEP SEPARATE: distinct titles that merely sound alike ('Interior Design' vs 'Interior Designer', 'Architect' vs 'Archinect', 'Kent Live' vs 'Kent Life').\n";
        $prompt .= "- Pick the cleanest real name as the canonical (no URL, no 'DO NOT USE').\n\n";
        $prompt .= "Candidate groups:\n" . $blocks . "\n\n";
        $prompt .= "Respond with a JSON array of confirmed duplicate sets only (omit anything you'd keep separate). ";
        $prompt .= 'Each item: {"canonical":"Clean Name","members":["name a","name b"],"confidence":0.0-1.0}. ';
        $prompt .= 'Only include sets with 2+ members that are genuinely the same. JSON array only.';

        $raw = $this->request( array( array( 'role' => 'user', 'content' => $prompt ) ), 4096, $system );
        if ( is_wp_error( $raw ) ) return $raw;

        $groups = json_decode( $raw, true );
        if ( is_array( $groups ) ) return $groups;

        // Salvage balanced {...} objects if the model wrapped the array.
        $groups = array(); $depth = 0; $buf = ''; $in = false;
        for ( $i = 0, $n = strlen( $raw ); $i < $n; $i++ ) {
            $ch = $raw[ $i ];
            if ( $ch === '{' ) { $in = true; $depth++; }
            if ( $in ) $buf .= $ch;
            if ( $ch === '}' && $in ) {
                $depth--;
                if ( $depth === 0 ) {
                    $obj = json_decode( $buf, true );
                    if ( $obj && isset( $obj['members'] ) ) $groups[] = $obj;
                    $buf = ''; $in = false;
                }
            }
        }
        return $groups;
    }

    public function analyze_tags( array $tags_map ) {
        $tag_lines = array();
        foreach ( $tags_map as $tag => $count ) {
            $tag_lines[] = $tag . ' (' . $count . ')';
        }
        $tags_text = implode( "\n", $tag_lines );

        $system = 'You are a data-quality assistant helping to clean up a contact tag library for a PR and media outreach tool. Analyse the tags and suggest operations to tidy them. Respond ONLY with a JSON array of operation objects — no explanation text outside the JSON.';

        $prompt = "Here are all the tags in this workspace with their contact counts:\n\n" . $tags_text . "\n\n"
            . "Suggest operations to tidy these tags. Each operation must be one of:\n"
            . "- {\"type\":\"rename\",\"from\":\"old-tag\",\"to\":\"new-tag\",\"why\":\"reason\"}\n"
            . "- {\"type\":\"merge\",\"from\":\"duplicate-tag\",\"to\":\"canonical-tag\",\"why\":\"reason\"}\n"
            . "- {\"type\":\"delete\",\"tag\":\"tag-to-remove\",\"why\":\"reason\"}\n"
            . "- {\"type\":\"add_parent\",\"child\":\"specific-tag\",\"parent\":\"broad-tag\",\"why\":\"reason\"}\n\n"
            . "Rules:\n"
            . "- Merge tags that mean the same thing (e.g. 'tv' and 'television')\n"
            . "- Rename tags to lowercase-hyphenated canonical form\n"
            . "- Delete tags that are clearly noise (single-letter, numbers, gibberish)\n"
            . "- Only suggest changes that are clearly correct — be conservative\n"
            . "- Do not suggest deleting tags with high counts (100+) without strong reason\n"
            . "- Respond with a JSON array only. No markdown, no explanation outside the array.";

        $raw = $this->request( array( array( 'role' => 'user', 'content' => $prompt ) ), 8192, $system );
        if ( is_wp_error( $raw ) ) return $raw;

        // Try clean decode first
        $ops = json_decode( $raw, true );
        if ( is_array( $ops ) ) return $ops;

        // Salvage: extract balanced {...} objects from the text
        $ops = array();
        $depth = 0; $buf = ''; $in = false;
        for ( $i = 0; $i < strlen( $raw ); $i++ ) {
            $ch = $raw[ $i ];
            if ( $ch === '{' ) { $in = true; $depth++; }
            if ( $in ) $buf .= $ch;
            if ( $ch === '}' && $in ) {
                $depth--;
                if ( $depth === 0 ) {
                    $obj = json_decode( $buf, true );
                    if ( $obj && isset( $obj['type'] ) ) $ops[] = $obj;
                    $buf = ''; $in = false;
                }
            }
        }
        return $ops;
    }
}
