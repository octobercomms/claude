import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SITE_URL = process.env.ARCHITOURIAN_URL;
const API_KEY = process.env.ARCHITOURIAN_API_KEY;

if (!SITE_URL || !API_KEY) {
  console.error(
    "Missing required environment variables.\n" +
      "Set ARCHITOURIAN_URL (e.g. https://architourian.com) and ARCHITOURIAN_API_KEY."
  );
  process.exit(1);
}

const BASE = `${SITE_URL.replace(/\/+$/, "")}/wp-json/architourian/v1`;

async function wpFetch(endpoint, { method = "GET", body } = {}) {
  const url = `${BASE}${endpoint}`;
  const headers = {
    "X-Architourian-Key": API_KEY,
    Accept: "application/json",
  };
  const init = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`Network error reaching ${SITE_URL}: ${err.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "Authentication failed. Check that ARCHITOURIAN_API_KEY is valid and has the required permissions."
    );
  }
  if (res.status === 429) {
    throw new Error("Rate limit exceeded. Wait a moment and try again.");
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    throw new Error(`Invalid JSON response from WordPress: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    const msg = data?.message || data?.code || JSON.stringify(data);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  return data;
}

function formatTourSummary(tour) {
  const meta = tour.meta || {};
  const parts = [
    `ID: ${tour.id}`,
    `Title: ${tour.title}`,
    `Status: ${tour.status}`,
  ];
  if (tour.date) parts.push(`Date: ${tour.date}`);
  if (tour.permalink) parts.push(`URL: ${tour.permalink}`);
  if (meta.tour_date) parts.push(`Tour date: ${meta.tour_date}`);
  if (meta.tour_end_date) parts.push(`End date: ${meta.tour_end_date}`);
  if (meta.availability_status) parts.push(`Availability: ${meta.availability_status}`);
  if (meta.max_capacity) parts.push(`Capacity: ${meta.max_capacity}`);
  if (meta.price) parts.push(`Price: ${meta.price}`);
  if (meta.location) parts.push(`Location: ${meta.location}`);
  return parts.join("\n");
}

function formatTourDetail(tour) {
  const lines = [
    `# ${tour.title}`,
    "",
    `ID: ${tour.id}`,
    `Status: ${tour.status}`,
    `Slug: ${tour.slug || "—"}`,
    `Author: ${tour.author || "—"}`,
    `Published: ${tour.date || "—"}`,
    `Modified: ${tour.modified || "—"}`,
    `Permalink: ${tour.permalink || "—"}`,
  ];

  if (tour.featured_image) {
    lines.push(`Featured image: ${tour.featured_image.url || "—"}`);
  }

  if (tour.excerpt) {
    lines.push("", "## Excerpt", tour.excerpt);
  }

  if (tour.content) {
    lines.push("", "## Content", tour.content);
  }

  const meta = tour.meta || {};
  const metaKeys = Object.keys(meta);
  if (metaKeys.length > 0) {
    lines.push("", "## Meta fields");
    for (const key of metaKeys) {
      const val =
        typeof meta[key] === "object" ? JSON.stringify(meta[key]) : meta[key];
      lines.push(`${key}: ${val ?? "—"}`);
    }
  }

  return lines.join("\n");
}

function formatContentSummary(item) {
  return [
    `ID: ${item.id}`,
    `Type: ${item.type || "—"}`,
    `Title: ${item.title}`,
    `Status: ${item.status}`,
    `Permalink: ${item.permalink || "—"}`,
    `Modified: ${item.modified || "—"}`,
  ].join("\n");
}

const server = new McpServer({
  name: "architourian",
  version: "1.0.0",
});

server.tool(
  "list_tours",
  "List tours on the Architourian website. Use this to see all upcoming tours, search for specific tours, or filter by status and date range.",
  {
    status: z
      .enum(["publish", "draft", "any"])
      .optional()
      .describe("Filter by publication status. Defaults to published tours."),
    search: z
      .string()
      .optional()
      .describe("Search tours by keyword in title or content."),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Results per page (1-100, default 20)."),
    page: z.number().int().min(1).optional().describe("Page number for pagination."),
    date_from: z
      .string()
      .optional()
      .describe("Only tours on or after this date (ISO 8601, e.g. 2025-06-01)."),
    date_to: z
      .string()
      .optional()
      .describe("Only tours on or before this date (ISO 8601, e.g. 2025-12-31)."),
  },
  async (params) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.search) qs.set("search", params.search);
    if (params.per_page) qs.set("per_page", String(params.per_page));
    if (params.page) qs.set("page", String(params.page));
    if (params.date_from) qs.set("date_from", params.date_from);
    if (params.date_to) qs.set("date_to", params.date_to);

    const query = qs.toString();
    const data = await wpFetch(`/tours${query ? `?${query}` : ""}`);
    const tours = data.tours || data;

    if (!Array.isArray(tours) || tours.length === 0) {
      return { content: [{ type: "text", text: "No tours found matching your criteria." }] };
    }

    const text = tours.map((t, i) => `--- Tour ${i + 1} ---\n${formatTourSummary(t)}`).join("\n\n");
    const pagination = data.total ? `\n\nShowing page ${data.page || 1} of ${data.total_pages || 1} (${data.total} total)` : "";
    return {
      content: [
        {
          type: "text",
          text: `Found ${tours.length} tour(s):${pagination}\n\n${text}`,
        },
      ],
    };
  }
);

server.tool(
  "get_tour",
  "Get the full details of a specific tour, including all custom fields, content, dates, availability, and pricing.",
  {
    tour_id: z.number().int().describe("The WordPress post ID of the tour."),
  },
  async ({ tour_id }) => {
    const data = await wpFetch(`/tours/${tour_id}`);
    return {
      content: [{ type: "text", text: formatTourDetail(data) }],
    };
  }
);

server.tool(
  "create_tour",
  "Create a new tour on the Architourian website. The tour is created as a draft by default so you can review it before publishing.",
  {
    title: z.string().describe("The tour title."),
    content: z
      .string()
      .optional()
      .describe("The full tour description (HTML or plain text)."),
    status: z
      .enum(["draft", "publish", "pending"])
      .optional()
      .describe("Publication status. Defaults to draft."),
    excerpt: z.string().optional().describe("A short summary of the tour."),
    meta: z
      .record(z.unknown())
      .optional()
      .describe(
        "Custom field values as key:value pairs. Use get_tour_fields to discover available fields. Common fields: tour_date, tour_end_date, availability_status, max_capacity, price, location."
      ),
  },
  async (params) => {
    const body = { title: params.title };
    if (params.content !== undefined) body.content = params.content;
    if (params.status !== undefined) body.status = params.status;
    if (params.excerpt !== undefined) body.excerpt = params.excerpt;
    if (params.meta !== undefined) body.meta = params.meta;

    const data = await wpFetch("/tours", { method: "POST", body });
    return {
      content: [
        {
          type: "text",
          text: `Tour created successfully.\n\n${formatTourDetail(data)}`,
        },
      ],
    };
  }
);

server.tool(
  "update_tour",
  "Update an existing tour. Change dates, availability, pricing, content, or any other field. Only the fields you provide will be changed; everything else stays as it is.",
  {
    tour_id: z.number().int().describe("The WordPress post ID of the tour to update."),
    title: z.string().optional().describe("New tour title."),
    content: z
      .string()
      .optional()
      .describe("New tour description (HTML or plain text)."),
    status: z
      .enum(["draft", "publish", "pending", "private"])
      .optional()
      .describe("Change publication status."),
    excerpt: z.string().optional().describe("New short summary."),
    meta: z
      .record(z.unknown())
      .optional()
      .describe(
        "Custom field values to update as key:value pairs. Use get_tour_fields to discover available fields. Common fields: tour_date, tour_end_date, availability_status, max_capacity, price, location."
      ),
  },
  async (params) => {
    const body = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.content !== undefined) body.content = params.content;
    if (params.status !== undefined) body.status = params.status;
    if (params.excerpt !== undefined) body.excerpt = params.excerpt;
    if (params.meta !== undefined) body.meta = params.meta;

    const data = await wpFetch(`/tours/${params.tour_id}`, {
      method: "PATCH",
      body,
    });
    return {
      content: [
        {
          type: "text",
          text: `Tour updated successfully.\n\n${formatTourDetail(data)}`,
        },
      ],
    };
  }
);

server.tool(
  "delete_tour",
  "Move a tour to the trash. This does not permanently delete it; the tour can be restored from the WordPress trash within 30 days.",
  {
    tour_id: z.number().int().describe("The WordPress post ID of the tour to trash."),
  },
  async ({ tour_id }) => {
    const data = await wpFetch(`/tours/${tour_id}`, { method: "DELETE" });
    const title = data?.title || `ID ${tour_id}`;
    return {
      content: [
        {
          type: "text",
          text: `Tour "${title}" has been moved to the trash.`,
        },
      ],
    };
  }
);

server.tool(
  "get_tour_fields",
  "Discover the available custom fields for tours. Returns field names, types, labels, and options. Run this first if you are unsure which meta keys to use when creating or updating a tour.",
  {},
  async () => {
    const data = await wpFetch("/tours/schema");
    const fields = data.fields || data;

    if (!Array.isArray(fields) || fields.length === 0) {
      const info = [];
      if (data.post_type) info.push(`Post type: ${data.post_type} (${data.label || "—"})`);
      info.push(`JetEngine: ${data.jetengine ? "active" : "not detected"}`);
      info.push(`ACF: ${data.acf ? "active" : "not detected"}`);
      if (data.field_mapping && Object.keys(data.field_mapping).length > 0) {
        info.push("", "Field mapping:", ...Object.entries(data.field_mapping).map(([k, v]) => `  ${k}: ${v || "(not set)"}`));
      }
      return {
        content: [
          {
            type: "text",
            text: `No custom fields discovered automatically.\n\n${info.join("\n")}\n\nYou can still set meta values by key name when creating or updating tours.`,
          },
        ],
      };
    }

    const lines = fields.map((f) => {
      const parts = [`Field: ${f.name}`, `  Label: ${f.label || "—"}`, `  Type: ${f.type || "—"}`];
      if (f.required) parts.push("  Required: yes");
      if (f.options && Object.keys(f.options).length > 0) {
        parts.push(`  Options: ${JSON.stringify(f.options)}`);
      }
      return parts.join("\n");
    });

    return {
      content: [
        {
          type: "text",
          text: `Available tour fields (${data.length}):\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "list_content",
  "List pages and posts on the Architourian website. Use this to find content that is not a tour, such as the homepage, about page, or blog posts.",
  {
    type: z
      .enum(["page", "post", "any"])
      .optional()
      .describe("Filter by content type. Defaults to any."),
    status: z
      .enum(["publish", "draft", "any"])
      .optional()
      .describe("Filter by publication status."),
    search: z.string().optional().describe("Search by keyword in title or content."),
    per_page: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Results per page (1-100, default 20)."),
    page: z.number().int().min(1).optional().describe("Page number for pagination."),
  },
  async (params) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set("type", params.type);
    if (params.status) qs.set("status", params.status);
    if (params.search) qs.set("search", params.search);
    if (params.per_page) qs.set("per_page", String(params.per_page));
    if (params.page) qs.set("page", String(params.page));

    const query = qs.toString();
    const data = await wpFetch(`/content${query ? `?${query}` : ""}`);
    const items = data.items || data;

    if (!Array.isArray(items) || items.length === 0) {
      return { content: [{ type: "text", text: "No content found matching your criteria." }] };
    }

    const text = items
      .map((item, i) => `--- Item ${i + 1} ---\n${formatContentSummary(item)}`)
      .join("\n\n");
    const pagination = data.total ? `\n\nShowing page ${data.page || 1} of ${data.total_pages || 1} (${data.total} total)` : "";

    return {
      content: [{ type: "text", text: `Found ${items.length} item(s):${pagination}\n\n${text}` }],
    };
  }
);

server.tool(
  "update_content",
  "Update a page or post on the Architourian website. Change the title, body, excerpt, or status. Only the fields you provide will be changed.",
  {
    content_id: z
      .number()
      .int()
      .describe("The WordPress post ID of the page or post to update."),
    title: z.string().optional().describe("New title."),
    content: z
      .string()
      .optional()
      .describe("New body content (HTML or plain text)."),
    excerpt: z.string().optional().describe("New excerpt."),
    status: z
      .enum(["draft", "publish", "pending", "private"])
      .optional()
      .describe("Change publication status."),
    meta: z
      .record(z.unknown())
      .optional()
      .describe("Custom field values to update as key:value pairs."),
  },
  async (params) => {
    const body = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.content !== undefined) body.content = params.content;
    if (params.excerpt !== undefined) body.excerpt = params.excerpt;
    if (params.status !== undefined) body.status = params.status;
    if (params.meta !== undefined) body.meta = params.meta;

    const data = await wpFetch(`/content/${params.content_id}`, {
      method: "PATCH",
      body,
    });

    return {
      content: [
        {
          type: "text",
          text: `Content updated successfully.\n\nID: ${data.id}\nTitle: ${data.title}\nStatus: ${data.status}\nPermalink: ${data.permalink || "—"}`,
        },
      ],
    };
  }
);

server.tool(
  "get_site_info",
  "Get information about the Architourian WordPress site: name, URL, timezone, theme, registered content types, and active plugins. Useful for understanding the site setup.",
  {},
  async () => {
    const data = await wpFetch("/site-info");
    const lines = [
      `Site: ${data.name || "—"}`,
      `URL: ${data.url || "—"}`,
      `Timezone: ${data.timezone || "—"}`,
      `Theme: ${data.theme || "—"}`,
    ];

    if (Array.isArray(data.post_types) && data.post_types.length > 0) {
      lines.push(
        "",
        "Registered content types:",
        ...data.post_types.map(
          (pt) => `  ${pt.name}: ${pt.label} (${pt.count ?? "?"} items)`
        )
      );
    }

    if (Array.isArray(data.plugins) && data.plugins.length > 0) {
      lines.push("", "Active plugins:", ...data.plugins.map((p) => `  ${p}`));
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
