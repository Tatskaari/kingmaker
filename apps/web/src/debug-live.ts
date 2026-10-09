/** Reconcile transcript cards without remounting the inspector or unchanged cards. */
export function updateTranscriptPanel(panel: HTMLElement, html: string): void {
  const template = document.createElement("template");
  template.innerHTML = panel.matches("table") ? `<table>${html}</table>` : html;
  const incoming = panel.matches("table") ? template.content.querySelector("table")! : template.content;
  const key = (node: Element, index: number) => node.getAttribute("data-transcript-key") || `${node.tagName}:${index}`;
  const children = [...panel.children];
  const existing = new Map(children.map((node, index) => [key(node, index), node]));
  const top = panel.getBoundingClientRect().top;
  const anchor = [...panel.querySelectorAll("[data-transcript-key]")].find(node => !node.matches("table") && node.hasAttribute("data-transcript-key") && node.getBoundingClientRect().bottom > top);
  const anchorKey = anchor?.getAttribute("data-transcript-key");
  const anchorOffset = anchor ? anchor.getBoundingClientRect().top - top : 0;
  const scrollTop = panel.scrollTop;
  const disclosures = (node: Element) => [
    ...(node.matches("details") ? [node as HTMLDetailsElement] : []),
    ...node.querySelectorAll("details"),
  ];
  const normalized = (node: Element) => {
    const clone = node.cloneNode(true) as Element;
    disclosures(clone).forEach(detail => detail.removeAttribute("open"));
    return clone.outerHTML;
  };
  let cursor = panel.firstElementChild;
  for (const [index, next] of [...incoming.children].entries()) {
    const id = key(next, index);
    const previous = existing.get(id);
    let node = next;
    if (previous) {
      existing.delete(id);
      if ((previous.matches("table") && next.matches("table"))
        || (previous.hasAttribute("data-transcript-container") && next.hasAttribute("data-transcript-container"))) {
        updateTranscriptPanel(previous as HTMLElement, next.innerHTML);
        node = previous;
      } else if (normalized(previous) === normalized(next)) node = previous;
      else {
        const details = disclosures(previous);
        const focused = details.findIndex(detail => detail.querySelector("summary") === document.activeElement);
        const replacements = disclosures(next);
        details.forEach((detail, i) => { if (replacements[i]) replacements[i]!.open = detail.open; });
        previous.replaceWith(next);
        if (cursor === previous) cursor = next;
        if (focused >= 0) replacements[focused]?.querySelector("summary")?.focus({ preventScroll: true });
      }
    }
    if (node !== cursor) panel.insertBefore(node, cursor);
    cursor = node.nextElementSibling;
  }
  existing.forEach(node => node.remove());
  if (scrollTop > 0 && anchorKey) {
    const retained = [...panel.querySelectorAll("[data-transcript-key]")].find(node => node.getAttribute("data-transcript-key") === anchorKey);
    panel.scrollTop = retained ? panel.scrollTop + retained.getBoundingClientRect().top - top - anchorOffset : scrollTop;
  } else panel.scrollTop = scrollTop;
}

/** Collapse event bursts into one read, with one follow-up if data changes mid-read. */
export function coalescedRefresh(refresh: () => Promise<void>, delay = 100): () => void {
  let pending = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    pending = true;
    if (running || timer) return;
    timer = setTimeout(async () => {
      timer = undefined;
      pending = false;
      running = true;
      try { await refresh(); }
      finally {
        running = false;
        if (pending) schedule();
      }
    }, delay);
  };
  return schedule;
}
