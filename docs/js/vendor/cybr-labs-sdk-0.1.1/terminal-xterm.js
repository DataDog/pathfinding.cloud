// src/terminal-xterm.ts
function xtermCallbacks(term) {
  return {
    onOutput: (data) => term.write(data),
    onReset: () => term.reset()
  };
}
function attachXterm(term, client, options = {}) {
  const { fit, copyOnCtrlC = true } = options;
  const cleanups = [];
  let detached = false;
  const data = term.onData((text) => {
    client.write(text);
  });
  const resize = term.onResize((size) => client.resize(size.cols, size.rows));
  cleanups.push(() => data.dispose(), () => resize.dispose());
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
  client.resize(term.cols, term.rows);
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
