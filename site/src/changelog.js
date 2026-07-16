// Shared changelog rendering used by the landing page (latest release) and
// the dedicated changelog page (full release list). Renders a small, safe
// Markdown subset from GitHub release notes.

/**
 * Escapes HTML-significant characters so untrusted release notes can be
 * injected as text before the Markdown subset is applied.
 * @param {string} str Raw text.
 * @returns {string} HTML-escaped text.
 */
export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a small, safe Markdown subset (headings, bold, links, lists,
 * paragraphs). Input must already be HTML-escaped; only well-formed
 * http(s) links are turned into anchors, everything else stays text.
 * @param {string} escaped HTML-escaped Markdown source.
 * @returns {string} Rendered HTML.
 */
export function renderChangelogMarkdown(escaped) {
  const withInlines = escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" class="underline hover:text-text-primary" rel="noopener">$1</a>',
    );

  const lines = withInlines.split("\n");
  let html = "";
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      html += "</ul>";
      listOpen = false;
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^(#{2,3})\s+(.*)/);
    const item = line.match(/^[-*]\s+(.*)/);
    if (heading) {
      closeList();
      const tag = heading[1].length === 2 ? "h3" : "h4";
      html += `<${tag} class="mt-4 font-semibold text-accent-blue">${heading[2]}</${tag}>`;
    } else if (item) {
      if (!listOpen) {
        html += '<ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-text-secondary">';
        listOpen = true;
      }
      html += `<li>${item[1]}</li>`;
    } else if (line === "") {
      closeList();
    } else {
      closeList();
      html += `<p class="mt-2 text-sm text-text-secondary">${line}</p>`;
    }
  }
  closeList();
  return html;
}

/**
 * Formats an ISO date string into a human-readable date, falling back to the
 * raw value when parsing fails.
 * @param {string} iso ISO 8601 date string.
 * @returns {string} Localized date, e.g. "16 July 2026".
 */
function formatReleaseDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Renders an array of GitHub release objects into HTML, newest first as
 * provided. Each release becomes a version heading, a formatted date and the
 * release notes rendered via the shared Markdown subset.
 * @param {Array<{tag_name: string, published_at: string, body: string}>} releases
 * @returns {string} Rendered HTML for the full release list.
 */
export function renderReleaseList(releases) {
  if (!Array.isArray(releases) || releases.length === 0) {
    return '<p class="text-sm text-text-muted">No releases found.</p>';
  }
  return releases
    .map((release) => {
      const tag = escapeHtml(release.tag_name || "");
      const date = formatReleaseDate(release.published_at);
      const body = (release.body || "").trim();
      const notes = body
        ? renderChangelogMarkdown(escapeHtml(body))
        : '<p class="mt-2 text-sm text-text-muted">No release notes provided.</p>';
      return `<article class="border-b border-border-subtle pb-8 last:border-b-0 last:pb-0">
        <div class="flex flex-wrap items-baseline gap-3">
          <h2 class="t-heading text-lg text-text-primary">${tag}</h2>
          ${date ? `<span class="text-sm text-text-muted">${escapeHtml(date)}</span>` : ""}
        </div>
        <div class="mt-2">${notes}</div>
      </article>`;
    })
    .join("");
}
