export function slugify(value, fallback = "asset") {
  const ascii = String(value || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
  return ascii || fallback;
}

export function buildRunId(prefix, prompt, extra = "") {
  const parts = [prefix, Date.now(), extra, slugify(prompt, prefix)].filter(Boolean);
  return parts.join("_");
}
