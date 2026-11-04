// src/terminal.ts
var REFUSED_BRAND = /* @__PURE__ */ Symbol.for("@cybr/labs-sdk/TerminalRefusedError");
var TerminalRefusedError = class _TerminalRefusedError extends Error {
  /** Keeps `instanceof` true when an app loads both the ESM and CommonJS builds. */
  static [Symbol.hasInstance](value) {
    if (this !== _TerminalRefusedError) return Function.prototype[Symbol.hasInstance].call(this, value);
    return typeof value === "object" && value !== null && value[REFUSED_BRAND] === true;
  }
  reason;
  /** HTTP status of the refusal, when it came from a response. */
  status;
  /** Seconds to wait before asking again, when the server said. */
  retryAfter;
  constructor(reason, status, retryAfter) {
    super(terminalRefusalMessage(reason));
    this.name = "TerminalRefusedError";
    Object.defineProperty(this, REFUSED_BRAND, { value: true });
    this.reason = reason;
    this.status = status;
    this.retryAfter = retryAfter;
  }
};
function terminalRefusalMessage(reason) {
  switch (reason) {
    case "LAB_ENDED":
      return "This lab has ended, so the terminal is closed. Launch the lab again to get a new one.";
    case "INVALID_DEPLOYMENT_STATUS":
      return "This lab is not running, so there is no terminal to open.";
    case "TERMINAL_NOT_ENABLED":
    case "TERMINAL_NOT_SUPPORTED":
      return "This lab does not come with a terminal.";
    case "TERMINAL_ENDED":
      return "This terminal has ended. Launch the lab again for a fresh terminal.";
    case "CONTAINER_STARTING":
      return "The terminal is still starting. Try again in a moment.";
    case "TERMINAL_UNAVAILABLE":
    case "TERMINAL_NOT_CONFIGURED":
    case "NO_TERMINAL_CREDENTIALS":
    case "NO_TERMINAL_ROLE":
      return "The terminal is not available right now. Try again in a moment.";
    case "ACCESS_DENIED":
    case "FORBIDDEN":
      return "You do not have access to this terminal.";
    case "DEPLOYMENT_NOT_FOUND":
      return "This lab could not be found. Launch it again to get a terminal.";
    case "RATE_LIMITED":
      return "Too many requests. Try again in a moment.";
    default:
      return "The terminal could not be opened. Reload the page, or launch the lab again.";
  }
}
async function fetchTerminalSession(input, init) {
  const response = await fetch(input, { method: "POST", cache: "no-store", ...init });
  let body;
  try {
    body = await response.json();
  } catch {
    body = void 0;
  }
  if (!response.ok) {
    const record = body && typeof body === "object" ? body : {};
    const header = Number(response.headers.get("retry-after") ?? NaN);
    const retryAfter = typeof record.retryAfter === "number" ? record.retryAfter : header;
    throw new TerminalRefusedError(
      typeof record.message === "string" && record.message ? record.message : `HTTP_${response.status}`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : void 0
    );
  }
  if (!body || typeof body !== "object") throw new Error("Invalid terminal session");
  return body;
}
function supportsWebTerminal(lab) {
  return lab.provider === "aws" && lab.webTerminal === true;
}
var FINAL_CLOSE_CODES = [4408, 4403];
var NO_AUTO_RETRY_CLOSE_CODES = [4408, 4403, 4500];
var SESSION_CLOSE_CODES = [4401, 4409];
var RETRYABLE_REFUSALS = /* @__PURE__ */ new Set(["CONTAINER_STARTING", "TERMINAL_UNAVAILABLE", "RATE_LIMITED"]);
var FINAL_REFUSALS = /* @__PURE__ */ new Set([
  "LAB_ENDED",
  "TERMINAL_ENDED",
  "TERMINAL_NOT_ENABLED",
  "TERMINAL_NOT_SUPPORTED",
  "TERMINAL_NOT_CONFIGURED",
  "NO_TERMINAL_CREDENTIALS",
  "NO_TERMINAL_ROLE",
  "INVALID_DEPLOYMENT_STATUS",
  "DEPLOYMENT_NOT_FOUND",
  "ACCESS_DENIED",
  "FORBIDDEN"
]);
var EXIT_GRACE_MS = 1500;
var STARTUP_BUDGET_MS = 12e4;
var MAX_ATTEMPTS = 10;
var AUTO_ATTEMPT_TIMEOUT_MS = 3e4;
var FIRST_RETRY_DELAY_MS = 500;
var MAX_RETRY_DELAY_MS = 8e3;
var STABLE_CONNECTION_MS = 6e4;
function retryDelayMs(attempts) {
  return Math.min(FIRST_RETRY_DELAY_MS * 2 ** (Math.max(1, attempts) - 1), MAX_RETRY_DELAY_MS);
}
function refusalRetryable(error) {
  if (!(error instanceof TerminalRefusedError)) return true;
  if (FINAL_REFUSALS.has(error.reason)) return false;
  return RETRYABLE_REFUSALS.has(error.reason) || error.status !== void 0 && (error.status === 429 || error.status >= 500);
}
function delayFor(error, attempts) {
  const wait = error instanceof TerminalRefusedError && error.retryAfter !== void 0 ? error.retryAfter * 1e3 : 0;
  return Math.min(Math.max(retryDelayMs(attempts), wait), 2147483647);
}
function createTerminalClient(options) {
  const autoOptions = typeof options.autoReconnect === "object" ? options.autoReconnect : {};
  const auto = options.autoReconnect ? {
    startupBudgetMs: autoOptions.startupBudgetMs ?? STARTUP_BUDGET_MS,
    maxAttempts: autoOptions.maxAttempts ?? MAX_ATTEMPTS
  } : void 0;
  const timeout = options.connectionTimeoutMs ?? (auto ? AUTO_ATTEMPT_TIMEOUT_MS : 12e4);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError("Invalid connection timeout");
  if (auto && (!Number.isFinite(auto.startupBudgetMs) || auto.startupBudgetMs <= 0 || !Number.isSafeInteger(auto.maxAttempts) || auto.maxAttempts <= 0)) {
    throw new TypeError("Invalid autoReconnect options");
  }
  let state = "idle";
  let generation = 0;
  let socket;
  let pending;
  let timer;
  let retryTimer;
  let exitTimer;
  let sessionTimer;
  let exiting = false;
  let sessionRequest;
  let dimensions;
  let run = { startedAt: 0, attempts: 0, everReady: false, readyAt: 0 };
  const encoder = new TextEncoder();
  const finalErrors = /* @__PURE__ */ new WeakSet();
  function setState(next) {
    state = next;
    options.onStateChange?.(next);
  }
  function teardown(reason) {
    generation++;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    clearTimeout(exitTimer);
    clearTimeout(sessionTimer);
    timer = retryTimer = exitTimer = sessionTimer = void 0;
    exiting = false;
    sessionRequest?.abort(reason);
    sessionRequest = void 0;
    const closing = socket;
    socket = void 0;
    if (closing) {
      closing.onopen = closing.onmessage = closing.onerror = closing.onclose = null;
      closing.close();
    }
  }
  function cleanup(error) {
    teardown(error);
    const settle = pending;
    pending = void 0;
    settle?.reject(error);
  }
  function finish(notify) {
    const ended = generation;
    notify();
    if (generation === ended && state !== "disposed") setState("closed");
  }
  function withinBudget(limits) {
    if (!run.everReady) return Date.now() - run.startedAt < limits.startupBudgetMs;
    return run.attempts < limits.maxAttempts;
  }
  function end(result) {
    const rejection = result.error ?? result.rejection ?? new Error("Terminal closed");
    teardown(rejection);
    if (result.info) run.lastClose = result.info;
    if (auto && result.retry && withinBudget(auto)) {
      const current = generation;
      if (state !== "reconnecting") setState("reconnecting");
      if (generation !== current || state === "disposed") return;
      const delayMs = delayFor(result.error, run.attempts);
      retryTimer = setTimeout(() => {
        retryTimer = void 0;
        attempt(true);
      }, delayMs);
      options.onReconnect?.(reconnectInfo(result, auto.maxAttempts, delayMs));
      return;
    }
    let info = result.info;
    if (!info && auto && run.lastClose) {
      const refused = result.error instanceof TerminalRefusedError ? result.error : void 0;
      info = refused?.reason === "LAB_ENDED" ? { ...run.lastClose, retryable: false, labEnded: true } : { ...run.lastClose, retryable: !(refused && !refusalRetryable(refused)) };
    }
    const settle = pending;
    pending = void 0;
    settle?.reject(rejection);
    finish(() => {
      if (result.exited) options.onExit?.(result.exitCode);
      if (result.error) options.onError?.(result.error);
      if (info) options.onClose?.(info);
    });
  }
  function reconnectInfo(result, maxAttempts, delayMs) {
    const base = { attempt: run.everReady ? run.attempts + 1 : Math.max(1, run.attempts), maxAttempts, delayMs };
    const close = result.info ? { code: result.info.code, ...result.info.reason && { reason: result.info.reason } } : {};
    const refused = result.error instanceof TerminalRefusedError ? result.error : void 0;
    if (refused) {
      const starting = refused.reason === "CONTAINER_STARTING" || !run.everReady && refused.reason === "TERMINAL_UNAVAILABLE";
      return { ...base, cause: starting ? "starting" : "refused", reason: refused.reason };
    }
    if (!run.everReady) return { ...base, ...close, cause: "starting" };
    if (result.info && SESSION_CLOSE_CODES.includes(result.info.code)) return { ...base, ...close, cause: "session_expired" };
    return { ...base, ...close, cause: "connection_lost" };
  }
  function sendDimensions() {
    if (state === "ready" && socket?.readyState === 1 && dimensions) {
      socket.send(JSON.stringify({ type: "resize", ...dimensions }));
    }
  }
  function finalError(message) {
    const error = new Error(message);
    finalErrors.add(error);
    return error;
  }
  function attempt(retrying = false) {
    const current = generation;
    const request = new AbortController();
    sessionRequest = request;
    run.attempts++;
    let reset = false;
    let errored = false;
    let ready = false;
    const resetOnce = () => {
      if (reset) return;
      reset = true;
      options.onReset?.();
    };
    const fail = (error) => {
      if (generation !== current) return;
      end({ error, retry: !finalErrors.has(error) && refusalRetryable(error) });
    };
    const requestSession = async () => {
      for (let tries = 1; ; tries++) {
        if (generation !== current) return void 0;
        try {
          return await options.getSession(request.signal);
        } catch (error) {
          if (auto || generation !== current || !(error instanceof TerminalRefusedError) || !refusalRetryable(error)) throw error;
          await new Promise((resolve) => {
            sessionTimer = setTimeout(resolve, delayFor(error, tries));
          });
        }
      }
    };
    timer = setTimeout(() => fail(new Error("Terminal connection timed out")), timeout);
    if (!retrying) setState("connecting");
    Promise.resolve().then(() => {
      if (generation !== current) return void 0;
      return requestSession();
    }).then((session) => {
      if (generation !== current) return;
      if (!session || !Array.isArray(session.protocols) || !session.protocols.every((value) => typeof value === "string") || typeof session.wsUrl !== "string" || !/^wss?:\/\//.test(session.wsUrl) || !Number.isFinite(Date.parse(session.expiresAt))) {
        throw finalError("Invalid terminal session");
      }
      let url;
      try {
        url = new URL(session.wsUrl);
      } catch {
        throw finalError("Invalid terminal session");
      }
      if (url.protocol !== "wss:" && !(url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
        throw finalError("Terminal requires a secure WebSocket URL");
      }
      if (sessionRequest === request) sessionRequest = void 0;
      let opened;
      try {
        opened = new WebSocket(session.wsUrl, session.protocols);
      } catch {
        throw finalError("Invalid terminal session");
      }
      socket = opened;
      opened.binaryType = "arraybuffer";
      let exitCode;
      const exitWith = (event) => {
        if (generation !== current) return;
        const info = event?.code === 4408 ? { code: 4408, reason: event.reason || "Lab ended", wasReady: ready, retryable: false, labEnded: true } : { code: typeof event?.code === "number" ? event.code : 1e3, reason: "exit", wasReady: ready, retryable: true };
        end({ exited: true, exitCode, info, rejection: new Error("Terminal exited before readiness"), retry: false });
      };
      opened.onmessage = (event) => {
        if (generation !== current || exiting) return;
        if (event.data instanceof ArrayBuffer) {
          resetOnce();
          options.onOutput?.(new Uint8Array(event.data));
          return;
        }
        if (typeof event.data !== "string") return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (!message || typeof message !== "object") return;
        if (message.type === "ready" && !ready) {
          clearTimeout(timer);
          timer = void 0;
          ready = true;
          if (!run.everReady) {
            run.everReady = true;
            run.attempts = 0;
          }
          run.readyAt = Date.now();
          resetOnce();
          setState("ready");
          sendDimensions();
          const settle = pending;
          pending = void 0;
          settle?.resolve();
        } else if (message.type === "exit") {
          exiting = true;
          exitCode = typeof message.code === "number" ? message.code : void 0;
          clearTimeout(timer);
          timer = void 0;
          exitTimer = setTimeout(() => exitWith(), EXIT_GRACE_MS);
        } else if (message.type === "error") {
          errored = true;
          if (!ready) fail(new Error("Terminal reported an error"));
        }
      };
      opened.onerror = () => {
        errored = true;
      };
      opened.onclose = (event) => {
        if (generation !== current) return;
        if (exiting) {
          exitWith(event);
          return;
        }
        const code = typeof event?.code === "number" ? event.code : 1006;
        const info = {
          code,
          reason: event?.reason ?? "",
          wasReady: ready,
          retryable: !FINAL_CLOSE_CODES.includes(code),
          ...code === 4408 && { labEnded: true }
        };
        if (ready && Date.now() - run.readyAt >= STABLE_CONNECTION_MS) run.attempts = 0;
        const error = new Error(errored ? "Terminal connection failed" : "Terminal closed before readiness");
        end({ info, error: ready ? void 0 : error, rejection: error, retry: !NO_AUTO_RETRY_CLOSE_CODES.includes(code) });
      };
    }).catch((error) => fail(error instanceof Error ? error : new Error("Terminal session request failed")));
  }
  function connect() {
    if (state === "disposed") return Promise.reject(new Error("Terminal client is disposed"));
    cleanup(new Error("Terminal connection replaced"));
    run = { startedAt: Date.now(), attempts: 0, everReady: false, readyAt: 0 };
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      attempt();
    });
  }
  return {
    connect,
    reconnect: connect,
    write(text) {
      if (state !== "ready" || exiting || socket?.readyState !== 1) return false;
      socket.send(encoder.encode(text));
      return true;
    },
    resize(cols, rows) {
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) throw new TypeError("Invalid terminal dimensions");
      dimensions = { cols: Math.min(500, Math.max(1, Math.trunc(cols))), rows: Math.min(300, Math.max(1, Math.trunc(rows))) };
      sendDimensions();
    },
    dispose() {
      if (state === "disposed") return;
      cleanup(new Error("Terminal client is disposed"));
      setState("disposed");
    }
  };
}
export {
  TerminalRefusedError,
  createTerminalClient,
  fetchTerminalSession,
  supportsWebTerminal,
  terminalRefusalMessage
};
