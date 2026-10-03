let position;
let size;
let observedFeed;
const resize = new ResizeObserver(() => {
  if (!observedFeed?.isConnected) return;
  if (observedFeed.style.width) size = { width: observedFeed.style.width, height: observedFeed.style.height };
  if (position) place(observedFeed, position.x, position.y);
});
const mounted = new WeakSet();

function place(feed, x, y) {
  const parent = feed.parentElement.getBoundingClientRect();
  const bounds = feed.getBoundingClientRect();
  position = {
    x: Math.max(0, Math.min(x, parent.width - bounds.width)),
    y: Math.max(0, Math.min(y, parent.height - bounds.height)),
  };
  Object.assign(feed.style, { left: `${position.x}px`, top: `${position.y}px`, bottom: "auto" });
}

export function mountPlayerFeedDrag(feed) {
  if (size) Object.assign(feed.style, size);
  if (position) place(feed, position.x, position.y);
  if (observedFeed !== feed) {
    resize.disconnect();
    observedFeed = feed;
    resize.observe(feed);
  }
  if (mounted.has(feed)) return;
  mounted.add(feed);
  let drag;
  feed.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    const bounds = feed.getBoundingClientRect();
    if (!event.target.closest("[data-feed-drag]")) {
      // Anchor the top-left while the native bottom-right grip resizes the window.
      if (event.clientX >= bounds.right - 20 && event.clientY >= bounds.bottom - 20) {
        const parent = feed.parentElement.getBoundingClientRect();
        place(feed, bounds.left - parent.left, bounds.top - parent.top);
      }
      return;
    }
    drag = { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    feed.setPointerCapture(event.pointerId);
    feed.classList.add("dragging");
    event.preventDefault();
  });
  feed.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const parent = feed.parentElement.getBoundingClientRect();
    place(feed, event.clientX - parent.left - drag.x, event.clientY - parent.top - drag.y);
  });
  const stop = () => { drag = undefined; feed.classList.remove("dragging"); };
  feed.addEventListener("pointerup", event => {
    if (feed.hasPointerCapture(event.pointerId)) feed.releasePointerCapture(event.pointerId);
    stop();
  });
  feed.addEventListener("pointercancel", stop);
  feed.addEventListener("lostpointercapture", stop);
  feed.addEventListener("keydown", event => {
    if (!event.target.closest("[data-feed-drag]")) return;
    if (event.key === "Home") {
      position = undefined;
      for (const property of ["left", "top", "bottom"]) feed.style.removeProperty(property);
    } else {
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      const bounds = feed.getBoundingClientRect(), parent = feed.parentElement.getBoundingClientRect();
      const step = event.shiftKey ? 40 : 10;
      place(feed, bounds.left - parent.left + direction[0] * step, bounds.top - parent.top + direction[1] * step);
    }
    event.preventDefault();
    event.stopPropagation();
  });
}

window.addEventListener("resize", () => {
  const feed = document.querySelector("[data-player-feed]");
  if (feed && position) place(feed, position.x, position.y);
});
