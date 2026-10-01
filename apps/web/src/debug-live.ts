/** Reconcile transcript cards without remounting the inspector or unchanged cards. */
export function updateTranscriptPanel(panel: HTMLElement, html: string): void {
  const template = document.createElement("template");
  template.innerHTML = html;
  const key = (node: Element, index: number) => node.getAttribute("data-transcript-key") || `${node.tagName}:${index}`;
  const children = [...panel.children];
  const existing = new Map(children.map((node, index) => [key(node, index), node]));
  const top = panel.getBoundingClientRect().top;
  const anchor = children.find(node => node.hasAttribute("data-transcript-key") && node.getBoundingClientRect().bottom > top);
  const anchorKey = anchor?.getAttribute("data-transcript-key");
  const anchorOffset = anchor ? anchor.getBoundingClientRect().top - top : 0;
  const scrollTop = panel.scrollTop;
  const normalized = (node: Element) => {
    const clone = node.cloneNode(true) as Element;
    clone.querySelectorAll("details[open]").forEach(detail => detail.removeAttribute("open"));
    return clone.outerHTML;
  };
  let cursor = panel.firstElementChild;
  for (const [index, next] of [...template.content.children].entries()) {
    const id = key(next, index);
    const previous = existing.get(id);
    let node = next;
    if (previous) {
      existing.delete(id);
      if (normalized(previous) === normalized(next)) node = previous;
      else {
        const details = [...previous.querySelectorAll("details")];
        const focused = details.findIndex(detail => detail.querySelector("summary") === document.activeElement);
        const replacements = [...next.querySelectorAll("details")];
        details.forEach((detail, i) => { if (detail.open && replacements[i]) replacements[i]!.open = true; });
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
    const retained = [...panel.children].find(node => node.getAttribute("data-transcript-key") === anchorKey);
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
