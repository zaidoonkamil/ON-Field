const path = require("path");
const fs = require("fs");
const qrcode = require("qrcode");

const SESSION_PATH = process.env.WHATSAPP_SESSION_PATH
  ? path.resolve(process.env.WHATSAPP_SESSION_PATH)
  : path.join(__dirname, "..", ".wwebjs_auth");
const CLIENT_ID = process.env.WHATSAPP_CLIENT_ID || "on-field";
const AUTO_INIT = process.env.WHATSAPP_AUTO_INIT !== "false";
const RECONNECT_DELAY_MS = Number(process.env.WHATSAPP_RECONNECT_DELAY_MS || 15000);
const MAX_RECONNECT_DELAY_MS = Number(process.env.WHATSAPP_MAX_RECONNECT_DELAY_MS || 120000);
const OPERATION_TIMEOUT_MS = Number(process.env.WHATSAPP_OPERATION_TIMEOUT_MS || 20000);

let sock = null;
let initializingPromise = null;
let latestQrText = null;
let latestQrImage = null;
let latestError = null;
let connectionStatus = "idle";
let authenticated = false;
let connectedNumber = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let manualLogout = false;
let isShuttingDown = false;

// Explicit queue — can be drained instantly on disconnect
let operationQueueList = [];
let operationQueueRunning = false;

// Silences Baileys internal logs
const silentLogger = {
  level: "silent",
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

function getAuthDir() {
  return path.join(SESSION_PATH, `session-${CLIENT_ID}`);
}

// Chrome cache dirs left over from the old whatsapp-web.js — safe to delete
const CHROME_CACHE_DIRS = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "blob_storage",
  "logs",
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/Service Worker/CacheStorage",
];

function cleanupSessionCache() {
  const sessionDir = getAuthDir();
  if (!fs.existsSync(sessionDir)) return { cleaned: 0, errors: 0 };

  let cleaned = 0;
  let errors = 0;
  for (const rel of CHROME_CACHE_DIRS) {
    const target = path.join(sessionDir, rel);
    try {
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true, recursive: true });
        cleaned++;
      }
    } catch (_) {
      errors++;
    }
  }
  return { cleaned, errors };
}

function deleteWhatsAppSession() {
  const sessionDir = getAuthDir();
  if (!fs.existsSync(sessionDir)) return false;
  try {
    fs.rmSync(sessionDir, { force: true, recursive: true });
    return true;
  } catch (_) {
    return false;
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function getReconnectDelay() {
  return Math.min(RECONNECT_DELAY_MS * Math.max(1, reconnectAttempts), MAX_RECONNECT_DELAY_MS);
}

function scheduleReconnect(reason = "unknown") {
  if (!AUTO_INIT || manualLogout || isShuttingDown || reconnectTimer || initializingPromise) return;

  reconnectAttempts += 1;
  const delay = getReconnectDelay();
  connectionStatus = "reconnecting";
  latestError = `Reconnecting after disconnect: ${reason}`;

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (isShuttingDown || manualLogout) return;
    try {
      await initWhatsAppClient();
    } catch (error) {
      latestError = error.message || String(error);
      scheduleReconnect(latestError);
    }
  }, delay);
}

function normalizeWhatsAppPhone(phone = "") {
  let value = String(phone).trim().replace(/[^\d+]/g, "");

  if (!value) throw new Error("Phone number is required");
  if (value.startsWith("+")) value = value.slice(1);
  if (value.startsWith("00")) value = value.slice(2);
  if (value.startsWith("0")) value = `964${value.slice(1)}`;
  if (!/^\d{8,15}$/.test(value)) throw new Error("Phone number format is invalid");

  return value;
}

function getStatus() {
  return {
    status: connectionStatus,
    authenticated,
    hasQr: Boolean(latestQrImage),
    connectedNumber,
    lastError: latestError,
  };
}

function drainQueueWithError(message) {
  const pending = operationQueueList.splice(0);
  for (const item of pending) {
    item.reject(new Error(message));
  }
}

async function processOperationQueue() {
  operationQueueRunning = true;
  while (operationQueueList.length > 0) {
    const item = operationQueueList.shift();
    try {
      item.resolve(await item.operation());
    } catch (err) {
      item.reject(err);
    }
  }
  operationQueueRunning = false;
}

const UNUSABLE_STATES = new Set([
  "disconnected",
  "reconnecting",
  "failed",
  "idle",
  "qr_ready",
]);

function throwIfUnusable() {
  if (UNUSABLE_STATES.has(connectionStatus) && !initializingPromise) {
    const msg =
      connectionStatus === "qr_ready"
        ? "WhatsApp بحاجة لمسح QR قبل إرسال الرسائل"
        : "خدمة WhatsApp غير متصلة حالياً، يرجى المحاولة لاحقاً";
    throw new Error(msg);
  }
}

function enqueueClientOperation(operation) {
  throwIfUnusable();
  return new Promise((resolve, reject) => {
    operationQueueList.push({ operation, resolve, reject });
    if (!operationQueueRunning) processOperationQueue();
  });
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs)
    ),
  ]);
}

async function getQrCode() {
  return {
    status: connectionStatus,
    qrText: latestQrText,
    qrImage: latestQrImage,
  };
}

async function initWhatsAppClient() {
  if (sock) return getStatus();
  if (initializingPromise) {
    await initializingPromise;
    return getStatus();
  }

  connectionStatus = "initializing";
  latestError = null;
  manualLogout = false;
  clearReconnectTimer();

  fs.mkdirSync(getAuthDir(), { recursive: true });
  cleanupSessionCache();

  initializingPromise = (async () => {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      DisconnectReason,
      fetchLatestBaileysVersion,
    } = await import("@whiskeysockets/baileys");

    const { Boom } = await import("@hapi/boom");

    const { state, saveCreds } = await useMultiFileAuthState(getAuthDir());

    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = [2, 3000, 1017531287];
    }

    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: silentLogger,
      browser: ["ON-Field", "Chrome", "1.0.0"],
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 20000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 2000,
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionStatus = "qr_ready";
        latestError = null;
        connectedNumber = null;
        authenticated = false;
        try {
          latestQrText = qr;
          latestQrImage = await qrcode.toDataURL(qr);
        } catch (err) {
          latestError = `QR generation failed: ${err.message}`;
        }
      }

      if (connection === "open") {
        clearReconnectTimer();
        reconnectAttempts = 0;
        connectionStatus = "ready";
        authenticated = true;
        latestQrText = null;
        latestQrImage = null;
        latestError = null;
        try {
          connectedNumber = socket.user?.id?.split(":")?.[0] || null;
        } catch {
          connectedNumber = null;
        }
      }

      if (connection === "close") {
        const boom = lastDisconnect?.error ? new Boom(lastDisconnect.error) : null;
        const statusCode = boom?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const reason = boom?.message || "connection closed";

        authenticated = false;
        latestQrText = null;
        latestQrImage = null;
        connectedNumber = null;
        connectionStatus = "disconnected";
        latestError = reason;

        drainQueueWithError("خدمة WhatsApp انقطعت، يرجى المحاولة لاحقاً");

        sock = null;
        initializingPromise = null;

        if (loggedOut) {
          // WhatsApp revoked the session — delete auth files so next init shows QR
          deleteWhatsAppSession();
          connectionStatus = "idle";
          if (AUTO_INIT && !manualLogout && !isShuttingDown) {
            scheduleReconnect("logged out");
          }
        } else if (!manualLogout && !isShuttingDown) {
          scheduleReconnect(reason);
        }
      }
    });

    sock = socket;
  })()
    .catch((error) => {
      latestError = error.message;
      connectionStatus = "failed";
      sock = null;
      if (!manualLogout && !isShuttingDown) scheduleReconnect(error.message);
      throw error;
    })
    .finally(() => {
      initializingPromise = null;
    });

  await initializingPromise;
  return getStatus();
}

async function logoutWhatsApp() {
  manualLogout = true;
  clearReconnectTimer();
  drainQueueWithError("تم تسجيل الخروج من WhatsApp");

  const activeSock = sock;
  sock = null;
  initializingPromise = null;

  if (activeSock) {
    try { await activeSock.logout(); } catch (_) {}
  }

  deleteWhatsAppSession();

  latestQrText = null;
  latestQrImage = null;
  latestError = null;
  connectionStatus = "idle";
  authenticated = false;
  connectedNumber = null;

  return { success: true, status: connectionStatus };
}

async function sendWhatsAppText(phone, message) {
  if (!message || !String(message).trim()) throw new Error("Message is required");

  return enqueueClientOperation(async () => {
    if (!sock || connectionStatus !== "ready") {
      throw new Error("خدمة WhatsApp غير متصلة حالياً، يرجى المحاولة لاحقاً");
    }

    const normalizedPhone = normalizeWhatsAppPhone(phone);

    const results = await withTimeout(
      sock.onWhatsApp(normalizedPhone),
      OPERATION_TIMEOUT_MS,
      "WhatsApp number lookup timed out"
    );

    const result = Array.isArray(results) ? results[0] : results;

    if (!result?.exists) throw new Error("This number does not appear to have WhatsApp");

    const sent = await withTimeout(
      sock.sendMessage(result.jid, { text: String(message).trim() }),
      OPERATION_TIMEOUT_MS,
      "WhatsApp message send timed out"
    );

    return {
      to: normalizedPhone,
      messageId: sent?.key?.id || null,
      timestamp: sent?.messageTimestamp || null,
      status: "sent",
    };
  });
}

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearReconnectTimer();
  drainQueueWithError("Server shutting down");
  const activeSock = sock;
  sock = null;
  if (activeSock) { try { activeSock.end(); } catch (_) {} }
}

process.once("SIGTERM", async () => { await gracefulShutdown(); process.exit(0); });
process.once("SIGINT", async () => { await gracefulShutdown(); process.exit(0); });

function startWhatsAppAutoInit() {
  if (!AUTO_INIT) return;
  cleanupSessionCache();
  scheduleReconnect("server_boot");
}

module.exports = {
  getQrCode,
  getStatus,
  initWhatsAppClient,
  logoutWhatsApp,
  normalizeWhatsAppPhone,
  sendWhatsAppText,
  startWhatsAppAutoInit,
  cleanupSessionCache,
  deleteWhatsAppSession,
};
