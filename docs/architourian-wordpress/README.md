# Architourian WordPress Integration

A WordPress plugin + MCP server that lets the Architourian team manage their
site through Claude. Instead of logging into wp-admin, they talk to Claude
naturally: "Show me upcoming tours", "Change the date on the Rome tour to
March 15", "Create a new London walking tour for April".

- **Code:** `dev/architourian-wordpress/`
- **Plugin slug / text domain:** `architourian-wordpress`
- **Releases:** GitHub Releases tagged `atwp-v<version>` (built by Action;
  installed via the plugin's built-in self-updater)

## How it works

Two components:

1. **WordPress plugin** (installed on architourian.com): exposes a secure REST
   API at `/wp-json/architourian/v1/` with API key authentication, tour CRUD
   endpoints, content management, and JetEngine/Crocoblock field auto-discovery.

2. **MCP server** (runs locally or hosted): connects Claude Desktop (or Claude
   Code) to the WordPress API. Registers tools like `list_tours`, `update_tour`,
   `create_tour` that Claude calls when the user asks to manage their site.

```
User talks to Claude
  → Claude calls MCP tool (e.g. list_tours)
    → MCP server hits WP REST API
      → Plugin validates API key, queries WordPress, returns data
        → Claude formats response naturally
```

## Setup

### 1. Install the WordPress plugin

Upload `architourian-wordpress.zip` to the site via Plugins > Add New > Upload,
or install from the GitHub Release. Activate it.

### 2. Generate an API key

Go to **Settings > Architourian API** in wp-admin.

1. Enter a name for the key (e.g. "Claude Desktop")
2. Select permission level:
   - **Read**: can list and view tours/content (safe for testing)
   - **Write**: can also create and update tours/content
   - **Admin**: can also delete and change settings
3. Click **Generate Key**
4. **Copy the key immediately** — it's shown once and stored as a hash

### 3. Configure tour settings

On the same settings page:

1. Select which Custom Post Type represents tours (the plugin auto-detects
   registered CPTs including JetEngine types)
2. Optionally map specific fields to semantic roles (tour date, end date,
   availability, capacity, price, location) — this helps Claude understand
   what each field means

### 4. Set up the MCP server

#### Claude Desktop

Install Node.js 18+, then:

```bash
cd /path/to/architourian-wordpress/mcp-server
npm install
```

Add to `claude_desktop_config.json` (on Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "architourian": {
      "command": "node",
      "args": ["/path/to/mcp-server/index.js"],
      "env": {
        "ARCHITOURIAN_URL": "https://architourian.com",
        "ARCHITOURIAN_API_KEY": "atwp_your_key_here"
      }
    }
  }
}
```

Restart Claude Desktop. The Architourian tools appear in the tool picker.

#### Claude Code

```bash
claude mcp add architourian -- node /path/to/mcp-server/index.js
```

Then set the environment variables in your shell before starting Claude Code:

```bash
export ARCHITOURIAN_URL="https://architourian.com"
export ARCHITOURIAN_API_KEY="atwp_your_key_here"
```

## Available tools

Once connected, Claude has these tools:

| Tool | Permission | What it does |
|------|-----------|--------------|
| `list_tours` | Read | List tours with filtering (status, date range, search) |
| `get_tour` | Read | Get full details of a specific tour |
| `create_tour` | Write | Create a new tour (defaults to draft) |
| `update_tour` | Write | Update any tour field (dates, availability, content) |
| `delete_tour` | Admin | Move a tour to trash |
| `get_tour_fields` | Read | Discover available fields and their types |
| `list_content` | Read | List pages and posts |
| `update_content` | Write | Update page or post content |
| `get_site_info` | Read | Site configuration and registered post types |

## Example conversations

**Checking tours:**
> "What tours do I have coming up?"

Claude calls `list_tours` with `status: publish` and `date_from: today`.

**Changing a date:**
> "Move the Rome tour to March 20"

Claude calls `list_tours` with `search: Rome`, finds the tour, then calls
`update_tour` with the new date in the appropriate meta field.

**Updating availability:**
> "The Barcelona tour is now fully booked"

Claude calls `update_tour` with the availability meta field set to "fully-booked"
(or whatever value the JetEngine field expects).

**Creating a tour:**
> "Create a new walking tour of London for April 12, max 15 people, £95 per person"

Claude calls `get_tour_fields` to understand the schema, then `create_tour`
with all the details mapped to the correct fields.

## Security

- **API keys** are hashed (SHA-256) before storage. The raw key is shown once
  on generation and never again.
- **Permission levels** (read/write/admin) control what each key can do.
- **Rate limiting**: 60 requests per minute per key (configurable).
- **Audit log**: every API call is logged with key ID, endpoint, method, IP,
  timestamp and response code. Viewable in wp-admin.
- **HTTPS enforced** by default (configurable for local dev).
- **IP allowlist** (optional): restrict API access to specific IPs.

## JetEngine / Crocoblock integration

The plugin auto-detects JetEngine meta boxes and fields. When JetEngine is
active, the `/tours/schema` endpoint returns full field definitions including:

- Field name and human-readable label
- Field type (text, number, date, select, checkbox, repeater, gallery, media)
- Available options for select/checkbox fields
- Required flag

This means Claude understands the tour's data model automatically. No hardcoding
of field names required.

If JetEngine isn't active, the plugin falls back to standard WordPress meta.
ACF fields are also detected if ACF is installed.

## Files

```
dev/architourian-wordpress/
  architourian-wordpress.php        Plugin bootstrap, constants, route registration
  readme.txt                        WP plugin metadata
  includes/
    class-atwp-auth.php             API key auth, rate limiting, audit logging
    class-atwp-settings.php         Admin settings page
    class-atwp-rest-tours.php       Tours REST controller
    class-atwp-rest-content.php     Content + site-info REST controller
    class-atwp-jetengine.php        JetEngine/Crocoblock field discovery
    class-atwp-updater.php          Self-update from monorepo GitHub Releases
  assets/
    css/admin.css                   Admin page styling
    js/admin.js                     Admin JS (key copy, generate, CPT switcher)
  mcp-server/
    package.json                    Node.js dependencies
    index.js                        MCP server (Claude Desktop / Claude Code)
```

## Releasing a new version

1. Bump the version in the plugin header and `ATWP_VERSION` constant in
   `architourian-wordpress.php`, and add a `readme.txt` changelog entry.
2. Merge to `main`. The release Action builds the zip and publishes an
   `atwp-v<version>` Release.
3. The live site's self-updater offers it as a one-click update.

## Troubleshooting

**"Unauthorized" errors:** Check the API key is correct and hasn't been deleted.
The key must include the `atwp_` prefix.

**"Rate limited" (429):** Wait a minute, or increase the limit in Settings >
Architourian API.

**Tours not showing:** Check the Tour Post Type setting matches the CPT used on
the site. The plugin auto-detects CPTs but the correct one must be selected.

**JetEngine fields missing:** Make sure JetEngine is active and has meta boxes
assigned to the tours CPT.

**MCP server won't start:** Check Node.js 18+ is installed. Run
`node --version` to verify. Check the environment variables are set.
