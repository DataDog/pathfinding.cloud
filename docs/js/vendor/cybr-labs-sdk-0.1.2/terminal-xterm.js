// src/terminal-xterm.ts
function xtermCallbacks(term) {
  return {
    onOutput: (data) => term.write(data),
    onReset: () => term.reset()
  };
}
function attachXterm(term, client, options = {}) {
  const { fit, copyOnCtrlC = true, resizeDelayMs = 100 } = options;
  if (!Number.isFinite(resizeDelayMs) || resizeDelayMs < 0) {
    throw new TypeError("resizeDelayMs must be a nonnegative finite number");
  }
  const cleanups = [];
  let detached = false;
  let sent;
  let latest = { cols: term.cols, rows: term.rows };
  let pending;
  const sendSize = () => {
    pending = void 0;
    if (detached) return;
    const { cols, rows } = latest;
    if (sent && sent.cols === cols && sent.rows === rows) return;
    sent = { cols, rows };
    client.resize(cols, rows);
  };
  const scheduleSize = (size) => {
    latest = { cols: size.cols, rows: size.rows };
    if (resizeDelayMs === 0) return sendSize();
    if (pending !== void 0) clearTimeout(pending);
    pending = setTimeout(sendSize, resizeDelayMs);
  };
  const data = term.onData((text) => {
    client.write(text);
  });
  const resize = term.onResize((size) => scheduleSize(size));
  cleanups.push(() => data.dispose(), () => resize.dispose(), () => {
    if (pending !== void 0) clearTimeout(pending);
  });
  if (copyOnCtrlC) {
    term.attachCustomKeyEventHandler((event) => {
      if (detached) return true;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && typeof event.key === "string" && event.key.toLowerCase() === "c" && term.hasSelection()) {
        if (event.type === "keydown") {
          event.preventDefault();
          globalThis.navigator?.clipboard?.writeText(term.getSelection()).catch(() => {
          });
          term.clearSelection?.();
        }
        return false;
      }
      return true;
    });
  }
  const refit = () => {
    if (detached || !fit) return;
    try {
      fit.fit();
    } catch {
    }
  };
  if (fit) {
    refit();
    if (typeof document !== "undefined") {
      const onVisibility = () => {
        if (document.visibilityState === "visible") refit();
      };
      document.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
    }
    if (term.element && typeof ResizeObserver !== "undefined") {
      let frame;
      const schedule = typeof requestAnimationFrame === "function" ? () => {
        if (frame !== void 0) return;
        frame = requestAnimationFrame(() => {
          frame = void 0;
          refit();
        });
      } : refit;
      const observer = new ResizeObserver(() => schedule());
      observer.observe(term.element);
      cleanups.push(() => {
        observer.disconnect();
        if (frame !== void 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      });
    }
  }
  if (pending !== void 0) clearTimeout(pending);
  latest = { cols: term.cols, rows: term.rows };
  sendSize();
  return () => {
    if (detached) return;
    detached = true;
    for (const cleanup of cleanups) cleanup();
  };
}
export {
  attachXterm,
  xtermCallbacks
};
