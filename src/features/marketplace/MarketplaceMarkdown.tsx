import { useEffect, useMemo, useRef } from "react";
import { fetchMarketplaceImage } from "./marketplaceApi";

interface MarketplaceMarkdownProps {
  source: string;
}

const allowedHtmlTags = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DETAILS",
  "DIV",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "IMG",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "SPAN",
  "STRONG",
  "SUMMARY",
  "UL",
]);

const droppedHtmlTags = new Set([
  "EMBED",
  "FORM",
  "IFRAME",
  "INPUT",
  "MATH",
  "OBJECT",
  "SCRIPT",
  "STYLE",
  "SVG",
]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(
  value: string,
  allowedProtocols = ["http:", "https:", "mailto:"],
) {
  try {
    const parsed = new URL(value, window.location.origin);
    return allowedProtocols.includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function isProxiedMarketplaceImage(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "cdn.bbsmc.net" &&
      url.pathname.startsWith("/bbsmc/data/")
    );
  } catch {
    return false;
  }
}

function unwrapElement(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function sanitizeHtml(html: string) {
  if (typeof window === "undefined" || !html.trim()) return "";

  const document = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  const root = document.body.firstElementChild;
  if (!root) return "";

  const clean = (node: Node) => {
    if (!(node instanceof Element)) return;

    if (droppedHtmlTags.has(node.tagName)) {
      node.remove();
      return;
    }

    const href = node.tagName === "A" ? (node.getAttribute("href") ?? "") : "";
    const src =
      node.tagName === "IMG"
        ? (node.getAttribute("src") ??
          node.getAttribute("data-marketplace-image-src") ??
          "")
        : "";
    const alt = node.tagName === "IMG" ? (node.getAttribute("alt") ?? "") : "";

    for (const attribute of Array.from(node.attributes)) {
      node.removeAttribute(attribute.name);
    }

    for (const child of Array.from(node.childNodes)) {
      clean(child);
    }

    if (!allowedHtmlTags.has(node.tagName)) {
      unwrapElement(node);
      return;
    }

    if (node.tagName === "A" && href) {
      const safeHref = safeUrl(href);
      if (safeHref) {
        node.setAttribute("href", safeHref);
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noreferrer noopener");
      }
    }

    if (node.tagName === "IMG" && src) {
      const safeSrc = safeUrl(src, ["http:", "https:"]);
      if (safeSrc) {
        if (isProxiedMarketplaceImage(safeSrc)) {
          node.setAttribute("data-marketplace-image-src", safeSrc);
        } else {
          node.setAttribute("src", safeSrc);
        }
        node.setAttribute("alt", alt);
        node.setAttribute("loading", "lazy");
        node.setAttribute("referrerpolicy", "no-referrer");
      } else {
        node.remove();
      }
    }
  };

  for (const child of Array.from(root.childNodes)) {
    clean(child);
  }

  return root.innerHTML;
}

function renderInlineMarkdown(value: string) {
  let html = escapeHtml(value);
  const codeValues: string[] = [];

  html = html.replace(/`([^`]+)`/g, (_match: string, code: string) => {
    codeValues.push(`<code>${code}</code>`);
    return `\u0000CODE${codeValues.length - 1}\u0000`;
  });

  html = html.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match: string, alt: string, url: string) => {
      const src = safeUrl(url, ["http:", "https:"]);
      const sourceAttribute =
        src && isProxiedMarketplaceImage(src)
          ? `data-marketplace-image-src="${escapeHtml(src)}"`
          : `src="${escapeHtml(src || "")}"`;
      return src
        ? `<img ${sourceAttribute} alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer">`
        : "";
    },
  );

  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match: string, text: string, url: string) => {
      const href = safeUrl(url);
      return href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${text}</a>`
        : text;
    },
  );

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>");

  return html.replace(
    /\u0000CODE(\d+)\u0000/g,
    (_match: string, index: string) => {
      return codeValues[Number(index)] || "";
    },
  );
}

function renderList(lines: string[], ordered: boolean) {
  const tag = ordered ? "ol" : "ul";
  const items = lines
    .map((line) =>
      ordered
        ? line.replace(/^\s*\d+[.)]\s+/, "")
        : line.replace(/^\s*[-*+]\s+/, ""),
    )
    .map((line) => `<li>${renderInlineMarkdown(line)}</li>`)
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

function convertMarkdownInHtml(source: string) {
  let result = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${heading[2]}</h${level}>`;
      }
      return line;
    })
    .join("\n");

  result = result.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match: string, alt: string, url: string) => {
      const src = safeUrl(url, ["http:", "https:"]);
      if (!src) return "";
      const sourceAttribute = isProxiedMarketplaceImage(src)
        ? `data-marketplace-image-src="${escapeHtml(src)}"`
        : `src="${escapeHtml(src)}"`;
      return `<img ${sourceAttribute} alt="${escapeHtml(alt)}" loading="lazy" referrerpolicy="no-referrer">`;
    },
  );

  result = result.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match: string, text: string, url: string) => {
      const href = safeUrl(url);
      return href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${text}</a>`
        : text;
    },
  );

  return result;
}

function renderMarkdown(source: string) {
  const safeSource = source.replace(
    /<(script|style|iframe|object|embed|form|svg|math)\b[\s\S]*?<\/\1>/gi,
    "",
  );
  const lines = safeSource.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(listLines, false));
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderList(listLines, true));
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(
        `<blockquote>${quoteLines.map(renderInlineMarkdown).join("<br>")}</blockquote>`,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !/^```/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(
      `<p>${paragraphLines.map(renderInlineMarkdown).join("<br>")}</p>`,
    );
  }

  return sanitizeHtml(blocks.join(""));
}

function looksLikeHtml(source: string) {
  return /<\/?(a|b|blockquote|br|code|details|div|em|h[1-6]|img|li|ol|p|pre|span|strong|summary|ul)\b/i.test(
    source,
  );
}

function detailsKey(details: HTMLDetailsElement, index: number) {
  const summary = Array.from(details.children).find(
    (child) => child.tagName === "SUMMARY",
  );
  return `${index}:${summary?.textContent?.trim() ?? ""}`;
}

export function MarketplaceMarkdown({ source }: MarketplaceMarkdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const openDetailsRef = useRef(new Set<string>());
  const html = useMemo(
    () =>
      looksLikeHtml(source)
        ? sanitizeHtml(convertMarkdownInHtml(source))
        : renderMarkdown(source),
    [source],
  );

  useEffect(() => {
    const details = Array.from(
      rootRef.current?.querySelectorAll("details") ?? [],
    );

    const handleToggle = (event: Event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLDetailsElement)) return;

      const index = details.indexOf(target);
      if (index < 0) return;

      const key = detailsKey(target, index);
      if (target.open) {
        openDetailsRef.current.add(key);
      } else {
        openDetailsRef.current.delete(key);
      }
    };

    details.forEach((item, index) => {
      if (openDetailsRef.current.has(detailsKey(item, index))) {
        item.open = true;
      }
      item.addEventListener("toggle", handleToggle);
    });

    return () => {
      details.forEach((item) => {
        item.removeEventListener("toggle", handleToggle);
      });
    };
  }, [html]);

  useEffect(() => {
    let cancelled = false;
    const images = Array.from(
      rootRef.current?.querySelectorAll<HTMLImageElement>(
        "img[data-marketplace-image-src]",
      ) ?? [],
    );

    for (const image of images) {
      const remoteSrc = image.dataset.marketplaceImageSrc;
      if (!remoteSrc) continue;

      void fetchMarketplaceImage(remoteSrc)
        .then(({ dataUrl }) => {
          if (cancelled || !image.isConnected) return;
          image.src = dataUrl;
          image.removeAttribute("data-marketplace-image-src");
        })
        .catch((error) => {
          console.error("Failed to load BBSMC marketplace image", error);
          if (cancelled || !image.isConnected) return;
          image.dataset.marketplaceImageError = "true";
          image.removeAttribute("data-marketplace-image-src");
          image.title =
            error instanceof Error ? error.message : "BBSMC image load failed";
        });
    }

    return () => {
      cancelled = true;
    };
  }, [html]);

  // Modpack descriptions embed arbitrary remote images (Modrinth CDN, raw
  // GitHub, dead hotlinks in years-old bodies). A broken one otherwise renders
  // as the browser's broken-image glyph with the alt text leaking beside it.
  // Mark failures so CSS can hide them, matching the gallery's null fallback,
  // and log the URL so the failure stays diagnosable instead of silent.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const markFailed = (image: HTMLImageElement) => {
      if (image.dataset.marketplaceImageError === "true") return;
      image.dataset.marketplaceImageError = "true";
      console.error(
        "Marketplace body image failed to load",
        image.currentSrc || image.getAttribute("src") || "(no src)",
      );
    };

    const handleError = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement) markFailed(target);
    };

    // `error` does not bubble, so capture it at the root instead of per-image.
    root.addEventListener("error", handleError, true);

    // Images that already resolved to a broken state before this effect ran
    // never fire a fresh `error` event, so reconcile them directly.
    for (const image of Array.from(root.querySelectorAll("img"))) {
      if (
        !image.hasAttribute("data-marketplace-image-src") &&
        image.complete &&
        image.naturalWidth === 0
      ) {
        markFailed(image);
      }
    }

    return () => {
      root.removeEventListener("error", handleError, true);
    };
  }, [html]);

  return (
    <div
      ref={rootRef}
      className="marketplace-pack-body marketplace-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
