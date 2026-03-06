// ═══════════════════════════════════════════════════════════════════
// Crep Dog Crew — Vendor Portal API (Vercel Serverless)
// Real-time KYC (Sandbox.co.in) + Document Drive + Vendor API
// ═══════════════════════════════════════════════════════════════════

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");

const app = express();

// ─── Sandbox API Config (from env) ───
const SANDBOX = {
  baseUrl: "https://api.sandbox.co.in",
  apiKey: process.env.SANDBOX_API_KEY || "key_live_808b0f666cb942048817151594ff2a1f",
  apiSecret: process.env.SANDBOX_API_SECRET || "secret_live_296801ab0c11431c896fd429de830b2e",
  accessToken: null,
  tokenExpiry: null,
};

// ─── Google Drive Config (from env) ───
const GDRIVE_ROOT_FOLDER = process.env.GDRIVE_ROOT_FOLDER || "1epOrTC8kyK2WiR033B8YgrZFjKy5jhhE";
let gdrive = { token: null, tokenExpiry: null, ready: false };

// Get OAuth2 access token from service account JWT
async function getDriveToken() {
  if (gdrive.token && gdrive.tokenExpiry && Date.now() < gdrive.tokenExpiry - 60000) {
    return gdrive.token;
  }

  try {
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}');
    if (!sa.client_email || !sa.private_key) {
      console.warn("⚠️  Google Drive credentials not configured");
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 },
      sa.private_key,
      { algorithm: "RS256" }
    );

    const res = await axios.post("https://oauth2.googleapis.com/token", new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: token,
    }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

    gdrive.token = res.data.access_token;
    gdrive.tokenExpiry = Date.now() + (res.data.expires_in * 1000);
    return gdrive.token;
  } catch (err) {
    console.error("⚠️  Google Drive token fetch failed:", err.message);
    return null;
  }
}

function driveHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// Initialize Google Drive — test access to root folder
async function initGoogleDrive() {
  try {
    const token = await getDriveToken();
    if (!token) return false;

    const res = await axios.get("https://www.googleapis.com/drive/v3/files", {
      headers: driveHeaders(token),
      params: { q: `'${GDRIVE_ROOT_FOLDER}' in parents and trashed = false`, pageSize: 1, fields: "files(id,name)" },
    });
    gdrive.ready = true;
    console.log("✅ Google Drive connected — root folder accessible");
    return true;
  } catch (err) {
    console.warn("⚠️  Google Drive init failed:", err.message);
    gdrive.ready = false;
    return false;
  }
}

// Create a folder in Google Drive (returns folder ID)
async function createDriveFolder(name, parentId) {
  if (!gdrive.ready) return null;
  try {
    const token = await getDriveToken();
    if (!token) return null;

    // Check if folder already exists
    const existing = await axios.get("https://www.googleapis.com/drive/v3/files", {
      headers: driveHeaders(token),
      params: {
        q: `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id,name)",
      },
    });
    if (existing.data.files && existing.data.files.length > 0) {
      return existing.data.files[0].id;
    }

    // Create new folder
    const res = await axios.post("https://www.googleapis.com/drive/v3/files", {
      name, mimeType: "application/vnd.google-apps.folder", parents: [parentId],
    }, { headers: { ...driveHeaders(token), "Content-Type": "application/json" }, params: { fields: "id" } });
    console.log(`📁 Created Drive folder: ${name} (${res.data.id})`);
    return res.data.id;
  } catch (err) {
    console.error(`⚠️  Failed to create Drive folder '${name}':`, err.message);
    return null;
  }
}

// Upload a file to Google Drive (from base64 data) using multipart upload
async function uploadToDrive(fileName, base64Data, mimeType, parentFolderId) {
  if (!gdrive.ready) return null;
  try {
    const token = await getDriveToken();
    if (!token) return null;

    let rawBase64 = base64Data;
    if (base64Data.includes(",")) rawBase64 = base64Data.split(",")[1];
    const buffer = Buffer.from(rawBase64, "base64");
    const resolvedMime = mimeType || "application/octet-stream";

    // Use multipart upload
    const boundary = "----CDCUploadBoundary" + Date.now();
    const metadata = JSON.stringify({ name: fileName, parents: [parentFolderId] });
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${resolvedMime}\r\nContent-Transfer-Encoding: base64\r\n\r\n`),
      Buffer.from(rawBase64),
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const res = await axios.post(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size",
      multipartBody,
      { headers: { ...driveHeaders(token), "Content-Type": `multipart/related; boundary=${boundary}` }, maxBodyLength: 50 * 1024 * 1024 }
    );

    console.log(`📤 Uploaded to Drive: ${fileName} (${res.data.id})`);
    return { id: res.data.id, name: res.data.name, webViewLink: res.data.webViewLink, size: res.data.size };
  } catch (err) {
    console.error(`⚠️  Drive upload failed for '${fileName}':`, err.message);
    return null;
  }
}

// Ensure vendor folder structure on Google Drive
// Returns { root, pan, aadhaar, agreements, invoices } folder IDs
async function ensureVendorDriveFolders(vendorName) {
  if (!gdrive.ready) return null;
  try {
    const vendorFolderId = await createDriveFolder(vendorName, GDRIVE_ROOT_FOLDER);
    if (!vendorFolderId) return null;
    const subFolders = {};
    for (const sub of ["PAN", "Aadhaar", "Agreements", "Invoices"]) {
      subFolders[sub.toLowerCase()] = await createDriveFolder(sub, vendorFolderId);
    }
    return { root: vendorFolderId, ...subFolders };
  } catch (err) {
    console.error("⚠️  Failed to create vendor Drive folders:", err.message);
    return null;
  }
}

// List files in a Google Drive folder
async function listDriveFiles(folderId) {
  if (!gdrive.ready || !folderId) return [];
  try {
    const token = await getDriveToken();
    if (!token) return [];

    const res = await axios.get("https://www.googleapis.com/drive/v3/files", {
      headers: driveHeaders(token),
      params: { q: `'${folderId}' in parents and trashed = false`, fields: "files(id,name,mimeType,size,createdTime,webViewLink)", orderBy: "createdTime desc" },
    });
    return res.data.files || [];
  } catch (err) {
    console.error("⚠️  Drive list error:", err.message);
    return [];
  }
}

// ─── Middleware ───
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ─── Portal HTML & Static files ───
const path = require("path");
const isVercel = !!process.env.VERCEL;

// Read portal.html from same directory (co-located so Vercel always bundles it)
let portalHtml = "";
try {
  portalHtml = fs.readFileSync(path.join(__dirname, "portal.html"), "utf8");
} catch (e) {
  console.warn("Could not read portal.html:", e.message);
}

if (!isVercel) {
  app.use(express.static(path.join(__dirname, "..")));
}

// ─── Server-Sent Events (SSE) for real-time push (local dev only) ───
// SSE does NOT work on Vercel serverless — portals fallback to polling on Vercel
const sseClients = new Map();
const adminSseClients = new Set();

if (!isVercel) {
  app.get("/api/sse/vendor/:vendorId", (req, res) => {
    const { vendorId } = req.params;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("data: connected\n\n");
    if (!sseClients.has(vendorId)) sseClients.set(vendorId, new Set());
    sseClients.get(vendorId).add(res);
    req.on("close", () => { sseClients.get(vendorId)?.delete(res); });
  });

  app.get("/api/sse/admin", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("data: connected\n\n");
    adminSseClients.add(res);
    req.on("close", () => { adminSseClients.delete(res); });
  });
}

function pushToVendor(vendorId, event, data) {
  if (isVercel) return; // SSE not available on Vercel
  const clients = sseClients.get(vendorId);
  if (clients) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach((res) => { try { res.write(msg); } catch(e) {} });
  }
}

function pushToAdmin(event, data) {
  if (isVercel) return; // SSE not available on Vercel
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  adminSseClients.forEach((res) => { try { res.write(msg); } catch(e) {} });
}

// ─── Health check endpoint ───
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: isVercel ? "vercel" : "local", timestamp: new Date().toISOString() });
});

// ─── In-Memory Store (per invocation) ───
// Note: Vercel is stateless. This persists only during single request.
// For production, use a database (Supabase, MongoDB, etc.)
const DB = {
  vendors: [],
  shoes: [],
  batches: [],
  mrns: [],
  notifications: [],
  qrCounter: 0,
  admins: [
    {
      id: "admin-001",
      email: "admin@crepdogcrew.com",
      password: "admin123",
      name: "CDC Admin",
    },
  ],
};

// Seed demo data
const DEMO_VENDOR = {
  id: "v-demo-001",
  name: "Rahul Sneaker Co.",
  email: "rahul@sneakers.in",
  password: "demo1234",
  gst: "27AABCU9603R1ZM",
  pan: "AABCU9603R",
  aadhaar: "987654321012",
  address: "42, MG Road, Andheri East, Mumbai, Maharashtra – 400069",
  taxInvoices: ["INV-2025-0041.pdf", "INV-2025-0042.pdf"],
  panVerified: true,
  aadhaarVerified: true,
  tcAccepted: true,
  createdAt: "2025-11-15",
};

const DEMO_SHOES = [
  {
    id: "s-001",
    vendorId: "v-demo-001",
    batchId: "b-001",
    brand: "Nike",
    model: "Air Jordan 1 Retro High OG 'Chicago'",
    size: "US 10",
    sku: "555088-101",
    condition: "Deadstock",
    purchaseValue: 18500,
    originalPV: 18500,
    status: "sold",
    qrCode: "CDC-2026-00001",
    qrNumber: 1,
    warehouse: "Delhi",
    authStatus: "passed",
    authNotes: null,
    authAt: "2025-12-15",
    mrnId: "m-001",
    pvChangeRequested: null,
    pvChangeNote: null,
    pvChangeStatus: null,
    pvChangeAt: null,
    submittedAt: "2025-11-20",
    approvedAt: "2025-11-25",
    shippedAt: "2025-12-05",
    consignedAt: "2025-12-15",
    soldAt: "2026-01-05",
  },
  {
    id: "s-002",
    vendorId: "v-demo-001",
    batchId: "b-001",
    brand: "Adidas",
    model: "Yeezy Boost 350 V2 'Zebra'",
    size: "US 9",
    sku: "CP9654",
    condition: "Deadstock",
    purchaseValue: 21000,
    originalPV: 21000,
    status: "sold",
    qrCode: "CDC-2026-00002",
    qrNumber: 2,
    warehouse: "Delhi",
    authStatus: "passed",
    authNotes: null,
    authAt: "2025-12-15",
    mrnId: "m-001",
    pvChangeRequested: null,
    pvChangeNote: null,
    pvChangeStatus: null,
    pvChangeAt: null,
    submittedAt: "2025-11-20",
    approvedAt: "2025-11-25",
    shippedAt: "2025-12-05",
    consignedAt: "2025-12-15",
    soldAt: "2026-01-18",
  },
  {
    id: "s-003",
    vendorId: "v-demo-001",
    batchId: "b-001",
    brand: "Nike",
    model: "Dunk Low 'Panda'",
    size: "US 11",
    sku: "DD1391-100",
    condition: "VNDS",
    purchaseValue: 9500,
    originalPV: 9500,
    status: "available",
    qrCode: "CDC-2026-00003",
    qrNumber: 3,
    warehouse: "Mumbai",
    authStatus: "passed",
    authNotes: null,
    authAt: "2025-12-20",
    mrnId: "m-002",
    pvChangeRequested: null,
    pvChangeNote: null,
    pvChangeStatus: null,
    pvChangeAt: null,
    submittedAt: "2025-11-20",
    approvedAt: "2025-11-25",
    shippedAt: "2025-12-05",
    consignedAt: "2025-12-20",
    soldAt: null,
  },
  {
    id: "s-004",
    vendorId: "v-demo-001",
    batchId: "b-002",
    brand: "New Balance",
    model: "550 'White Green'",
    size: "US 10.5",
    sku: "BB550WT1",
    condition: "Deadstock",
    purchaseValue: 12000,
    originalPV: 12000,
    status: "pv_change_pending",
    qrCode: "CDC-2026-00004",
    qrNumber: 4,
    warehouse: "Mumbai",
    authStatus: "passed",
    authNotes: null,
    authAt: "2026-01-10",
    mrnId: "m-003",
    pvChangeRequested: 11500,
    pvChangeNote: "Market adjustment due to recent release",
    pvChangeStatus: "pending",
    pvChangeAt: "2026-02-28",
    submittedAt: "2025-12-15",
    approvedAt: "2025-12-20",
    shippedAt: "2025-12-28",
    consignedAt: "2026-01-10",
    soldAt: null,
  },
  {
    id: "s-005",
    vendorId: "v-demo-001",
    batchId: "b-002",
    brand: "Nike",
    model: "Air Force 1 '07 Low White",
    size: "US 9.5",
    sku: "CW2288-111",
    condition: "Deadstock",
    purchaseValue: 7500,
    originalPV: 7500,
    status: "sold",
    qrCode: "CDC-2026-00005",
    qrNumber: 5,
    warehouse: "Mumbai",
    authStatus: "passed",
    authNotes: null,
    authAt: "2026-01-12",
    mrnId: "m-003",
    pvChangeRequested: null,
    pvChangeNote: null,
    pvChangeStatus: null,
    pvChangeAt: null,
    submittedAt: "2025-12-15",
    approvedAt: "2025-12-20",
    shippedAt: "2025-12-28",
    consignedAt: "2026-01-12",
    soldAt: "2026-02-01",
  },
  {
    id: "s-006",
    vendorId: "v-demo-001",
    batchId: "b-002",
    brand: "Jordan",
    model: "Air Jordan 4 Retro 'Military Black'",
    size: "US 10",
    sku: "DH6927-111",
    condition: "Deadstock",
    purchaseValue: 19000,
    originalPV: 19000,
    status: "approved",
    qrCode: null,
    qrNumber: null,
    warehouse: null,
    authStatus: null,
    authNotes: null,
    authAt: null,
    mrnId: null,
    pvChangeRequested: null,
    pvChangeNote: null,
    pvChangeStatus: null,
    pvChangeAt: null,
    submittedAt: "2025-12-15",
    approvedAt: "2026-02-20",
    shippedAt: null,
    consignedAt: null,
    soldAt: null,
  },
  {
    id: "s-007",
    vendorId: "v-demo-001",
    batchId: "b-002",
    brand: "Adidas",
    model: "Campus 00s 'Dark Green'",
    size: "US 8",
    sku: "H03472",
    condition: "VNDS",
    purchaseValue: 8000,
    originalPV: 8000,
    status: "rejected_intake",
    qrCode: null,
    qrNumber: null,
    warehouse: null,
    authStatus: null,
    authNotes: null,
    authAt: null,
    mrnId: null,
    pvChangeRequested: null,
    pvChangeNote: null,
    pvChangeStatus: null,
    pvChangeAt: null,
    submittedAt: "2025-12-15",
    approvedAt: null,
    shippedAt: null,
    consignedAt: null,
    soldAt: null,
  },
  {
    id: "s-008",
    vendorId: "v-demo-001",
    batchId: "b-003",
    brand: "Nike",
    model: "SB Dunk Low 'Court Purple'",
    size: "US 10",
    sku: "BQ6817-500",
    condition: "Deadstock",
    purchaseValue: 14000,
    originalPV: 14000,
    status: "submitted",
    qrCode: null,
    qrNumber: null,
    warehouse: null,
    authStatus: null,
    authNotes: null,
    authAt: null,
    mrnId: null,
    pvChangeRequested: null,
    pvChangeNote: null,
    pvChangeStatus: null,
    pvChangeAt: null,
    submittedAt: "2026-02-25",
    approvedAt: null,
    shippedAt: null,
    consignedAt: null,
    soldAt: null,
  },
];

const DEMO_BATCH = {
  id: "b-002",
  vendorId: "v-demo-001",
  vendorName: "Rahul Sneaker Co.",
  totalShoes: 3,
  approvedCount: 2,
  rejectedCount: 1,
  status: "reviewed",
  createdAt: "2025-12-15",
};

const DEMO_NOTIFICATION_1 = {
  id: "notif-001",
  vendorId: "v-demo-001",
  type: "batch_approved",
  title: "Batch Approved",
  message: "CDC approved 2 of 3 shoes in your batch. 1 rejected.",
  data: { batchId: "b-002", approvedCount: 2, rejectedCount: 1 },
  read: false,
  createdAt: "2025-12-20",
};

const DEMO_NOTIFICATION_2 = {
  id: "notif-002",
  vendorId: "v-demo-001",
  type: "pv_change_requested",
  title: "PV Change Requested",
  message: "CDC requests PV change for Nike Air Jordan 4 from ₹19000 to ₹18000",
  data: { shoeId: "s-006", currentPV: 19000, newPV: 18000 },
  read: false,
  createdAt: "2026-02-25",
};

DB.vendors.push(DEMO_VENDOR);
DB.shoes.push(...DEMO_SHOES);
DB.batches.push(DEMO_BATCH);
DB.notifications.push(DEMO_NOTIFICATION_1, DEMO_NOTIFICATION_2);
DB.qrCounter = 5;

// ════════════════════════════════════════════════════════════════════
// SANDBOX API HELPERS
// ════════════════════════════════════════════════════════════════════

async function getSandboxToken() {
  // Return cached token if still valid (with 5-min buffer)
  if (SANDBOX.accessToken && SANDBOX.tokenExpiry && Date.now() < SANDBOX.tokenExpiry - 300000) {
    return SANDBOX.accessToken;
  }

  try {
    const res = await axios.post(
      `${SANDBOX.baseUrl}/authenticate`,
      {},
      {
        headers: {
          "x-api-key": SANDBOX.apiKey,
          "x-api-secret": SANDBOX.apiSecret,
          "x-api-version": "1.0",
        },
      }
    );

    if (res.data && res.data.access_token) {
      SANDBOX.accessToken = res.data.access_token;
      SANDBOX.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23 hours
      console.log("✅ Sandbox access token obtained");
      return SANDBOX.accessToken;
    }

    // Handle nested data structure
    if (res.data && res.data.data && res.data.data.access_token) {
      SANDBOX.accessToken = res.data.data.access_token;
      SANDBOX.tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
      console.log("✅ Sandbox access token obtained");
      return SANDBOX.accessToken;
    }

    throw new Error("No access token in response");
  } catch (err) {
    console.error("⚠️  Sandbox auth failed:", err.message);
    throw new Error("Failed to authenticate with Sandbox API");
  }
}

function sandboxHeaders(token) {
  return {
    Authorization: token,
    "Content-Type": "application/json",
    "x-api-key": SANDBOX.apiKey,
    "x-api-version": "1.0",
  };
}

// ════════════════════════════════════════════════════════════════════
// KYC API ROUTES
// ════════════════════════════════════════════════════════════════════

// --- PAN Verification ---
app.post("/api/kyc/pan/verify", async (req, res) => {
  const { pan, name, dob } = req.body;

  if (!pan || !name) {
    return res.status(400).json({ error: "PAN number and name are required" });
  }

  try {
    const token = await getSandboxToken();

    const payload = {
      "@entity": "in.co.sandbox.kyc.pan.request",
      pan: pan.toUpperCase(),
      name_as_per_pan: name,
      date_of_birth: dob || "",
      consent: "Y",
      reason: "For vendor KYC verification at Crep Dog Crew",
    };

    const response = await axios.post(
      `${SANDBOX.baseUrl}/kyc/pan/verify`,
      payload,
      { headers: sandboxHeaders(token) }
    );

    const data = response.data.data || response.data;
    console.log("✅ PAN verification result:", data.status);

    return res.json({
      success: true,
      verified: data.status === "valid",
      data: {
        pan: data.pan,
        status: data.status,
        category: data.category,
        nameMatch: data.name_as_per_pan_match,
        remarks: data.remarks,
        aadhaarSeeding: data.aadhaar_seeding_status,
      },
      transactionId: response.data.transaction_id,
    });
  } catch (err) {
    console.error("⚠️  PAN verify error:", err.message);
    const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
    return res.status(500).json({ error: `PAN verification failed: ${errMsg}` });
  }
});

// --- Aadhaar: Generate OTP ---
app.post("/api/kyc/aadhaar/otp/generate", async (req, res) => {
  const { aadhaar } = req.body;

  if (!aadhaar || aadhaar.replace(/\s/g, "").length !== 12) {
    return res.status(400).json({ error: "Valid 12-digit Aadhaar number required" });
  }

  try {
    const token = await getSandboxToken();

    const payload = {
      "@entity": "in.co.sandbox.kyc.aadhaar.okyc.otp.request",
      aadhaar_number: aadhaar.replace(/\s/g, ""),
      consent: "Y",
      reason: "For vendor KYC verification at Crep Dog Crew",
    };

    const response = await axios.post(
      `${SANDBOX.baseUrl}/kyc/aadhaar/okyc/otp`,
      payload,
      { headers: sandboxHeaders(token) }
    );

    const data = response.data.data || response.data;
    console.log("✅ Aadhaar OTP sent, ref:", data.reference_id);

    return res.json({
      success: true,
      referenceId: data.reference_id,
      message: data.message || "OTP sent to registered mobile number",
      transactionId: response.data.transaction_id,
    });
  } catch (err) {
    console.error("⚠️  Aadhaar OTP error:", err.message);
    const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
    return res.status(500).json({ error: `Aadhaar OTP failed: ${errMsg}` });
  }
});

// --- Aadhaar: Verify OTP ---
app.post("/api/kyc/aadhaar/otp/verify", async (req, res) => {
  const { referenceId, otp } = req.body;

  if (!referenceId || !otp) {
    return res.status(400).json({ error: "Reference ID and OTP are required" });
  }

  try {
    const token = await getSandboxToken();

    const payload = {
      "@entity": "in.co.sandbox.kyc.aadhaar.okyc.otp.verify.request",
      reference_id: referenceId,
      otp: otp,
    };

    const response = await axios.post(
      `${SANDBOX.baseUrl}/kyc/aadhaar/okyc/otp/verify`,
      payload,
      { headers: sandboxHeaders(token) }
    );

    const data = response.data.data || response.data;
    console.log("✅ Aadhaar OTP verified for:", data.name);

    return res.json({
      success: true,
      verified: true,
      data: {
        name: data.name,
        dob: data.date_of_birth,
        gender: data.gender,
        address: data.full_address || data.address,
        photo: data.photo,
        mobileHash: data.mobile_hash,
        emailHash: data.email_hash,
      },
      transactionId: response.data.transaction_id,
    });
  } catch (err) {
    console.error("⚠️  Aadhaar verify error:", err.message);
    const errMsg = err.response?.data?.message || err.response?.data?.error || err.message;
    return res.status(500).json({ error: `Aadhaar verification failed: ${errMsg}` });
  }
});

// ════════════════════════════════════════════════════════════════════
// DOCUMENT DRIVE ROUTES
// ════════════════════════════════════════════════════════════════════

// In-memory cache: vendorName -> { root, pan, aadhaar, agreements, invoices } folder IDs
const vendorDriveFolderCache = {};

// Upload document to vendor's Google Drive folder
app.post("/api/drive/upload", async (req, res) => {
  const { vendorId, vendorName, category, fileName, fileData, mimeType } = req.body;

  if (!vendorName || !category || !fileName || !fileData) {
    return res.status(400).json({ error: "vendorName, category, fileName, and fileData are required" });
  }

  const validCategories = ["pan", "aadhaar", "agreements", "invoices"];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(", ")}` });
  }

  try {
    // ── Google Drive upload ──
    if (gdrive.ready) {
      // Ensure vendor folder structure exists on Drive
      if (!vendorDriveFolderCache[vendorName]) {
        vendorDriveFolderCache[vendorName] = await ensureVendorDriveFolders(vendorName);
      }
      const folders = vendorDriveFolderCache[vendorName];

      if (folders && folders[category]) {
        const driveFile = await uploadToDrive(fileName, fileData, mimeType, folders[category]);
        if (driveFile) {
          return res.json({
            success: true,
            storage: "google_drive",
            file: {
              id: driveFile.id,
              name: driveFile.name,
              category,
              driveLink: driveFile.webViewLink,
              size: driveFile.size,
              uploadedAt: new Date().toISOString(),
            },
          });
        }
      }
      console.log("⚠️  Google Drive upload failed, returning success with memory storage");
    }

    // Vercel is read-only: return success with memory storage indicator
    return res.json({
      success: true,
      storage: "memory",
      file: {
        name: fileName,
        category,
        size: fileData.length,
        uploadedAt: new Date().toISOString(),
        note: "File stored in memory (temporary). Configure Google Drive for persistence.",
      },
    });
  } catch (err) {
    console.error("⚠️  Upload error:", err.message);
    return res.status(500).json({ error: `Upload failed: ${err.message}` });
  }
});

// Save signed agreement (with digital signature image) to Google Drive
app.post("/api/drive/agreement", async (req, res) => {
  const { vendorId, vendorName, vendorEmail, vendorGst, vendorAddress, signatureImage, tcAcceptedAt, agreementSignedAt } = req.body;

  if (!vendorName) {
    return res.status(400).json({ error: "vendorName required" });
  }

  try {
    const now = new Date().toISOString();
    const hashInput = `${vendorId || vendorName}|${vendorName}|${agreementSignedAt || now}`;
    const digitalHash = crypto.createHash("sha256").update(hashInput).digest("hex");

    // ── Build agreement record ──
    const agreement = {
      title: "CDC Master Seller Agreement & T&C",
      vendorName,
      vendorEmail,
      vendorGst: vendorGst || "",
      vendorAddress: vendorAddress || "",
      tcAcceptedAt: tcAcceptedAt || now,
      agreementSignedAt: agreementSignedAt || now,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      agreementVersion: "2026-03",
      digitalHash,
      hasSignatureImage: !!signatureImage,
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeName = vendorName.replace(/[^a-zA-Z0-9]/g, "_");

    // ── Upload signature image ──
    if (signatureImage && gdrive.ready) {
      const sigFileName = `Signature_${safeName}_${dateStr}.png`;
      const sigBase64 = signatureImage.replace(/^data:image\/\w+;base64,/, "");

      if (!vendorDriveFolderCache[vendorName]) {
        vendorDriveFolderCache[vendorName] = await ensureVendorDriveFolders(vendorName);
      }
      const folders = vendorDriveFolderCache[vendorName];
      if (folders && folders.agreements) {
        await uploadToDrive(sigFileName, sigBase64, "image/png", folders.agreements);
        console.log(`✍️ Signature image saved to Drive for ${vendorName}`);
      }
    }

    // ── Upload agreement JSON ──
    const agreementFileName = `Agreement_${safeName}_${dateStr}.json`;
    const agreementBase64 = Buffer.from(JSON.stringify(agreement, null, 2)).toString("base64");

    if (gdrive.ready) {
      if (!vendorDriveFolderCache[vendorName]) {
        vendorDriveFolderCache[vendorName] = await ensureVendorDriveFolders(vendorName);
      }
      const folders = vendorDriveFolderCache[vendorName];

      if (folders && folders.agreements) {
        const driveFile = await uploadToDrive(
          agreementFileName,
          agreementBase64,
          "application/json",
          folders.agreements
        );
        if (driveFile) {
          console.log(`📝 Agreement saved to Drive for ${vendorName}`);
          return res.json({
            success: true,
            storage: "google_drive",
            agreement: { ...agreement, fileName: agreementFileName, driveLink: driveFile.webViewLink },
          });
        }
      }
    }

    // Vercel fallback: return success with memory storage
    console.log(`📝 Agreement recorded for ${vendorName}`);
    return res.json({
      success: true,
      storage: "memory",
      agreement: { ...agreement, fileName: agreementFileName, note: "Stored in memory. Configure Google Drive for persistence." },
    });
  } catch (err) {
    console.error("⚠️  Agreement save error:", err.message);
    return res.status(500).json({ error: `Agreement save failed: ${err.message}` });
  }
});

// List files in vendor's Google Drive folder
app.get("/api/drive/:vendorName", async (req, res) => {
  const { vendorName } = req.params;
  const { category } = req.query;

  try {
    // ── Google Drive listing ──
    if (gdrive.ready) {
      const folders = vendorDriveFolderCache[vendorName];
      if (folders) {
        const categories = category ? [category] : ["pan", "aadhaar", "agreements", "invoices"];
        const allFiles = [];

        for (const cat of categories) {
          if (folders[cat]) {
            const files = await listDriveFiles(folders[cat]);
            files.forEach((f) => {
              allFiles.push({
                id: f.id,
                name: f.name,
                category: cat,
                driveLink: f.webViewLink,
                size: f.size,
                uploadedAt: f.createdTime,
              });
            });
          }
        }

        return res.json({ files: allFiles, totalCount: allFiles.length, storage: "google_drive" });
      }
    }

    // Fallback: return empty (no local storage on Vercel)
    return res.json({ files: [], totalCount: 0, storage: "memory" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════
// VENDOR AUTH & DATA ROUTES
// ════════════════════════════════════════════════════════════════════

// Register
app.post("/api/vendors/register", (req, res) => {
  const { name, email, password, gst, pan, aadhaar, address, taxInvoices } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  if (DB.vendors.find((v) => v.email === email)) {
    return res.status(400).json({ error: "Email already registered" });
  }

  const vendor = {
    id: "v-" + crypto.randomBytes(4).toString("hex"),
    name, email, password, gst, pan, aadhaar, address,
    taxInvoices: taxInvoices || [],
    panVerified: false,
    aadhaarVerified: false,
    tcAccepted: false,
    createdAt: new Date().toISOString().slice(0, 10),
  };

  DB.vendors.push(vendor);
  // Also create Google Drive folder structure for this vendor
  ensureVendorDriveFolders(vendor.name).then((folders) => {
    if (folders) vendorDriveFolderCache[vendor.name] = folders;
  }).catch(() => {});
  console.log(`🆕 Vendor registered: ${vendor.name} (${vendor.id})`);

  return res.json(vendor);
});

// Login
app.post("/api/vendors/login", (req, res) => {
  const { email, password } = req.body;
  const vendor = DB.vendors.find((v) => v.email === email && v.password === password);
  if (!vendor) return res.status(401).json({ error: "Invalid credentials" });
  return res.json(vendor);
});

// Session check (returns vendor if found in DB, otherwise treats as logged in via client-side storage)
app.get("/api/vendors/me", (req, res) => {
  const vendorId = req.query.vendorId || req.headers["x-vendor-id"];
  const vendor = DB.vendors.find((v) => v.id === vendorId);
  if (!vendor) return res.status(401).json({ error: "Not logged in" });
  return res.json(vendor);
});

// Update vendor (KYC status, etc.)
app.patch("/api/vendors/:id", (req, res) => {
  const vendor = DB.vendors.find((v) => v.id === req.params.id);
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  Object.assign(vendor, req.body);
  return res.json(vendor);
});

// Logout
app.post("/api/vendors/logout", (req, res) => {
  return res.json({ ok: true });
});

// ─── Shoe / Consignment Routes ───
app.get("/api/shoes", (req, res) => {
  const vendorId = req.query.vendorId || req.session?.vendorId;
  if (!vendorId) return res.status(401).json({ error: "vendorId required" });
  return res.json(DB.shoes.filter((s) => s.vendorId === vendorId));
});

app.post("/api/shoes", (req, res) => {
  const vendorId = req.body.vendorId || req.session?.vendorId;
  if (!vendorId) return res.status(401).json({ error: "vendorId required" });
  const shoe = {
    id: "s-" + crypto.randomBytes(3).toString("hex"),
    vendorId,
    ...req.body,
    status: req.body.status || "pending_review",
    consignedAt: new Date().toISOString().slice(0, 10),
    soldAt: null,
  };
  delete shoe.vendorId;
  shoe.vendorId = vendorId;
  DB.shoes.push(shoe);
  return res.json(shoe);
});

// Vendor-side shoe update (for bid accept/reject)
app.patch("/api/shoes/:id", (req, res) => {
  const shoe = DB.shoes.find((s) => s.id === req.params.id);
  if (!shoe) return res.status(404).json({ error: "Shoe not found" });
  // Only allow updating bid-related fields from vendor side
  const allowed = ["bidStatus", "consignPrice", "status"];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  Object.assign(shoe, updates);
  return res.json(shoe);
});

// ─── Admin Routes ───
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body;
  const admin = DB.admins.find((a) => a.email === email && a.password === password);
  if (!admin) return res.status(401).json({ error: "Invalid admin credentials" });
  return res.json(admin);
});

app.get("/api/admin/me", (req, res) => {
  const adminId = req.query.adminId || req.headers["x-admin-id"];
  const admin = DB.admins.find((a) => a.id === adminId);
  if (!admin) return res.status(401).json({ error: "Not logged in as admin" });
  return res.json(admin);
});

app.get("/api/admin/vendors", (req, res) => {
  return res.json(DB.vendors);
});

app.get("/api/admin/shoes", (req, res) => {
  return res.json(DB.shoes);
});

app.patch("/api/admin/shoes/:id", (req, res) => {
  const shoe = DB.shoes.find((s) => s.id === req.params.id);
  if (!shoe) return res.status(404).json({ error: "Shoe not found" });
  Object.assign(shoe, req.body);
  return res.json(shoe);
});

// ════════════════════════════════════════════════════════════════════
// QR CODE & CONSIGNMENT WORKFLOW HELPERS
// ════════════════════════════════════════════════════════════════════

function generateQRCode() {
  DB.qrCounter++;
  const year = new Date().getFullYear();
  const num = String(DB.qrCounter).padStart(5, "0");
  return {
    qrCode: `CDC-${year}-${num}`,
    qrNumber: DB.qrCounter,
  };
}

function createNotification(vendorId, type, title, message, data) {
  const notif = {
    id: "notif-" + crypto.randomBytes(4).toString("hex"),
    vendorId,
    type,
    title,
    message,
    data: data || {},
    read: false,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  DB.notifications.push(notif);
  return notif;
}

// ════════════════════════════════════════════════════════════════════
// BATCH & CONSIGNMENT ROUTES
// ════════════════════════════════════════════════════════════════════

// 1. Batch Upload - Vendor uploads many shoes at once
app.post("/api/shoes/batch", (req, res) => {
  const { vendorId, vendorName, shoes } = req.body;

  if (!vendorId || !vendorName || !Array.isArray(shoes) || shoes.length === 0) {
    return res.status(400).json({ error: "vendorId, vendorName, and shoes array required" });
  }

  const batch = {
    id: "b-" + crypto.randomBytes(4).toString("hex"),
    vendorId,
    vendorName,
    totalShoes: shoes.length,
    approvedCount: 0,
    rejectedCount: 0,
    status: "pending",
    createdAt: new Date().toISOString().slice(0, 10),
  };
  DB.batches.push(batch);

  const createdShoes = [];
  for (const shoe of shoes) {
    const newShoe = {
      id: "s-" + crypto.randomBytes(4).toString("hex"),
      vendorId,
      batchId: batch.id,
      brand: shoe.brand,
      model: shoe.model,
      size: shoe.size,
      sku: shoe.sku,
      condition: shoe.condition,
      purchaseValue: shoe.purchaseValue,
      originalPV: shoe.purchaseValue,
      status: "submitted",
      qrCode: null,
      qrNumber: null,
      warehouse: null,
      authStatus: null,
      authNotes: null,
      authAt: null,
      mrnId: null,
      pvChangeRequested: null,
      pvChangeNote: null,
      pvChangeStatus: null,
      pvChangeAt: null,
      submittedAt: new Date().toISOString().slice(0, 10),
      approvedAt: null,
      shippedAt: null,
      consignedAt: null,
      soldAt: null,
    };
    DB.shoes.push(newShoe);
    createdShoes.push(newShoe);
  }

  // Create admin notification
  createNotification("admin-001", "batch_submitted", "New Batch Submitted", `${vendorName} submitted a batch with ${shoes.length} shoes`, { batchId: batch.id });

  console.log(`📦 Batch created: ${batch.id} with ${shoes.length} shoes`);
  // Push real-time update to admin portal
  pushToAdmin("batch_submitted", { batchId: batch.id, vendorName, shoeCount: shoes.length });
  return res.json({ batch, shoes: createdShoes });
});

// 2. List batches
app.get("/api/batches", (req, res) => {
  const { vendorId } = req.query;
  let batches = DB.batches;
  if (vendorId) {
    batches = batches.filter((b) => b.vendorId === vendorId);
  }
  return res.json(batches);
});

// 3. Admin reviews batch (approve/reject individual shoes)
app.post("/api/admin/batches/:batchId/review", (req, res) => {
  const { batchId } = req.params;
  const { decisions } = req.body;

  if (!Array.isArray(decisions) || decisions.length === 0) {
    return res.status(400).json({ error: "decisions array required" });
  }

  const batch = DB.batches.find((b) => b.id === batchId);
  if (!batch) return res.status(404).json({ error: "Batch not found" });

  let approvedCount = 0,
    rejectedCount = 0;

  for (const decision of decisions) {
    const shoe = DB.shoes.find((s) => s.id === decision.shoeId);
    if (!shoe) continue;

    if (decision.decision === "approved") {
      shoe.status = "approved";
      shoe.approvedAt = new Date().toISOString().slice(0, 10);
      approvedCount++;
    } else if (decision.decision === "rejected_intake") {
      shoe.status = "rejected_intake";
      rejectedCount++;
    }
    if (decision.note) shoe.reviewNote = decision.note;
  }

  batch.approvedCount = approvedCount;
  batch.rejectedCount = rejectedCount;
  batch.status = "reviewed";

  // Create vendor notification
  createNotification(
    batch.vendorId,
    "batch_approved",
    "Batch Review Complete",
    `CDC approved ${approvedCount} of ${batch.totalShoes} shoes. ${rejectedCount} rejected.`,
    { batchId: batch.id, approvedCount, rejectedCount }
  );

  console.log(`✅ Batch ${batchId} reviewed: ${approvedCount} approved, ${rejectedCount} rejected`);
  // Push real-time update to vendor portal
  pushToVendor(batch.vendorId, "batch_reviewed", { batchId, approvedCount, rejectedCount });
  return res.json(batch);
});

// 4. Admin authenticates shoes at warehouse
app.post("/api/admin/shoes/authenticate", (req, res) => {
  const { results, warehouse } = req.body;
  // Accept shoeIds from results array if not provided separately
  const shoeIds = req.body.shoeIds || (results || []).map(r => r.shoeId);

  if (!Array.isArray(results) || !warehouse) {
    return res.status(400).json({ error: "results and warehouse required" });
  }

  const vendorRtvs = {}; // Track RTVs per vendor
  const updatedShoes = [];

  for (const result of results) {
    const shoe = DB.shoes.find((s) => s.id === result.shoeId);
    if (!shoe) continue;

    shoe.warehouse = warehouse;
    shoe.authAt = new Date().toISOString().slice(0, 10);
    shoe.authNotes = result.notes || null;

    if (result.result === "passed") {
      shoe.authStatus = "passed";
      shoe.status = "authenticated";
    } else if (result.result === "failed") {
      shoe.authStatus = "failed";
      shoe.status = "rtv";
      if (!vendorRtvs[shoe.vendorId]) vendorRtvs[shoe.vendorId] = [];
      vendorRtvs[shoe.vendorId].push(shoe);
    }
    updatedShoes.push(shoe);
  }

  // Create RTV notifications for each vendor
  for (const [vendorId, rtvShoes] of Object.entries(vendorRtvs)) {
    createNotification(
      vendorId,
      "rtv_issued",
      "Shoes Returned to Vendor",
      `${rtvShoes.length} shoe(s) failed authentication and are being returned.`,
      { count: rtvShoes.length, warehouse }
    );
  }

  console.log(`🔍 Authenticated ${shoeIds.length} shoes at ${warehouse}`);
  return res.json(updatedShoes);
});

// 5. Admin creates MRN for authenticated shoes
app.post("/api/admin/mrn/create", (req, res) => {
  const { vendorId, vendorName, shoeIds, warehouse } = req.body;

  if (!vendorId || !vendorName || !Array.isArray(shoeIds) || !warehouse) {
    return res.status(400).json({ error: "vendorId, vendorName, shoeIds, and warehouse required" });
  }

  const mrnShoes = [];
  let totalPV = 0;

  for (const shoeId of shoeIds) {
    const shoe = DB.shoes.find((s) => s.id === shoeId && s.vendorId === vendorId);
    if (!shoe || shoe.status !== "authenticated") continue;

    // Assign QR code
    const { qrCode, qrNumber } = generateQRCode();
    shoe.qrCode = qrCode;
    shoe.qrNumber = qrNumber;
    shoe.status = "consigned";
    shoe.consignedAt = new Date().toISOString().slice(0, 10);

    mrnShoes.push(shoe);
    totalPV += shoe.purchaseValue;
  }

  const vendorObj = DB.vendors.find(v => v.id === vendorId);
  const mrn = {
    id: "m-" + crypto.randomBytes(4).toString("hex"),
    vendorId,
    vendorName,
    shoes: mrnShoes.map((s) => s.id),
    shoeDetails: mrnShoes.map(s => ({sku:s.sku||"",brand:s.brand||"",model:s.model||"",size:s.size||"",purchaseValue:s.purchaseValue||0,mode:"Consign"})),
    vendor: vendorObj ? {name:vendorObj.name,phone:vendorObj.phone||"",email:vendorObj.email||"",pan:vendorObj.pan||"",address:vendorObj.address||""} : {name:vendorName},
    warehouse,
    totalPV,
    status: "pending_signature",
    signedAt: null,
    signatureImage: null,
    driveLink: null,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  DB.mrns.push(mrn);

  // Create vendor notification
  createNotification(
    vendorId,
    "mrn_ready",
    "MRN Ready for Signing",
    `MRN #${mrn.id} is ready for signature. ${mrnShoes.length} shoes consigned with total PV ₹${totalPV.toLocaleString("en-IN")}.`,
    { mrnId: mrn.id, shoeCount: mrnShoes.length, totalPV }
  );

  console.log(`📋 MRN created: ${mrn.id} with ${mrnShoes.length} shoes, Total PV: ₹${totalPV}`);
  // Push real-time MRN to vendor portal instantly
  pushToVendor(mrn.vendorId, "mrn_created", mrn);
  return res.json(mrn);
});

// 6. Get MRN details
app.get("/api/mrn/:id", (req, res) => {
  const { id } = req.params;
  const mrn = DB.mrns.find((m) => m.id === id);
  if (!mrn) return res.status(404).json({ error: "MRN not found" });

  const shoes = DB.shoes.filter((s) => mrn.shoes.includes(s.id));
  return res.json({ ...mrn, shoes });
});

// 7. List MRNs for vendor
app.get("/api/mrns", (req, res) => {
  const { vendorId } = req.query;
  let mrns = DB.mrns;
  if (vendorId) {
    mrns = mrns.filter((m) => m.vendorId === vendorId);
  }
  return res.json(mrns);
});

// 8. Vendor signs MRN
app.post("/api/mrn/:id/sign", (req, res) => {
  const { id } = req.params;
  const { signatureImage, vendorId } = req.body;

  if (!signatureImage || !vendorId) {
    return res.status(400).json({ error: "signatureImage and vendorId required" });
  }

  const mrn = DB.mrns.find((m) => m.id === id && m.vendorId === vendorId);
  if (!mrn) return res.status(404).json({ error: "MRN not found or unauthorized" });

  mrn.status = "signed";
  mrn.signedAt = new Date().toISOString().slice(0, 10);
  mrn.signatureImage = signatureImage;

  // Upload to Google Drive (in Agreements folder)
  if (gdrive.ready) {
    const vendor = DB.vendors.find((v) => v.id === vendorId);
    if (vendor) {
      ensureVendorDriveFolders(vendor.name).then((folders) => {
        if (folders && folders.agreements) {
          const dateStr = new Date().toISOString().slice(0, 10);
          const fileName = `MRN_${mrn.id}_Signed_${dateStr}.pdf`;
          uploadToDrive(fileName, signatureImage, "application/pdf", folders.agreements).then((file) => {
            if (file) {
              mrn.driveLink = file.webViewLink;
              console.log(`📄 MRN signed and uploaded for ${vendor.name}`);
            }
          });
        }
      });
    }
  }

  console.log(`✍️ MRN ${id} signed by vendor`);
  // Push real-time update to admin portal
  pushToAdmin("mrn_signed", { mrnId: id, vendorId, signedAt: mrn.signedAt, driveLink: mrn.driveLink || null });
  return res.json(mrn);
});

// 8b. Upload signed MRN PDF to Google Drive (called from vendor portal)
app.post("/api/drive/mrn-upload", async (req, res) => {
  const { vendorName, mrnId, pdfData } = req.body;
  if (!vendorName || !mrnId || !pdfData) {
    return res.status(400).json({ error: "vendorName, mrnId, and pdfData required" });
  }
  if (!gdrive.ready) {
    return res.status(503).json({ error: "Google Drive not configured" });
  }
  try {
    const folders = await ensureVendorDriveFolders(vendorName);
    if (!folders || !folders.agreements) {
      return res.status(500).json({ error: "Could not create Drive folders" });
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `MRN_${mrnId}_Signed_${dateStr}.pdf`;
    const file = await uploadToDrive(fileName, pdfData, "application/pdf", folders.agreements);
    if (file) {
      // Update MRN in DB with drive link
      const mrn = DB.mrns.find(m => m.id === mrnId);
      if (mrn) mrn.driveLink = file.webViewLink;
      console.log(`📄 Signed MRN PDF uploaded to Drive: ${fileName}`);
      return res.json({ driveLink: file.webViewLink, fileName });
    }
    return res.status(500).json({ error: "Drive upload failed" });
  } catch (err) {
    console.error("MRN Drive upload error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 9. Admin requests PV change
app.post("/api/admin/shoes/:id/pv-change", (req, res) => {
  const { id } = req.params;
  const { newPV, reason } = req.body;

  if (!newPV || !reason) {
    return res.status(400).json({ error: "newPV and reason required" });
  }

  const shoe = DB.shoes.find((s) => s.id === id);
  if (!shoe) return res.status(404).json({ error: "Shoe not found" });

  shoe.pvChangeRequested = newPV;
  shoe.pvChangeNote = reason;
  shoe.pvChangeStatus = "pending";
  shoe.pvChangeAt = new Date().toISOString().slice(0, 10);
  shoe.status = "pv_change_pending";

  // Create vendor notification
  createNotification(
    shoe.vendorId,
    "pv_change_requested",
    "PV Change Requested",
    `CDC requests PV change for ${shoe.brand} ${shoe.model} from ₹${shoe.purchaseValue} to ₹${newPV}. Reason: ${reason}`,
    { shoeId: id, currentPV: shoe.purchaseValue, newPV, reason }
  );

  console.log(`💰 PV change requested for shoe ${id}: ₹${shoe.purchaseValue} → ₹${newPV}`);
  return res.json(shoe);
});

// 10. Vendor responds to PV change
app.post("/api/shoes/:id/pv-response", (req, res) => {
  const { id } = req.params;
  const { accept, vendorId } = req.body;

  if (typeof accept !== "boolean" || !vendorId) {
    return res.status(400).json({ error: "accept (boolean) and vendorId required" });
  }

  const shoe = DB.shoes.find((s) => s.id === id && s.vendorId === vendorId);
  if (!shoe) return res.status(404).json({ error: "Shoe not found or unauthorized" });

  if (accept) {
    shoe.purchaseValue = shoe.pvChangeRequested;
    shoe.pvChangeStatus = "accepted";
    shoe.status = "available";
    createNotification("admin-001", "pv_accepted", "PV Change Accepted", `Vendor accepted PV change for shoe ${id}`, { shoeId: id });
  } else {
    shoe.pvChangeStatus = "rejected";
    shoe.status = "available";
    createNotification("admin-001", "pv_rejected", "PV Change Rejected", `Vendor rejected PV change for shoe ${id}`, { shoeId: id });
  }

  shoe.pvChangeRequested = null;

  console.log(`${accept ? "✅" : "❌"} Vendor ${accept ? "accepted" : "rejected"} PV change for shoe ${id}`);
  return res.json(shoe);
});

// 11. Notifications
app.get("/api/notifications", (req, res) => {
  const { vendorId } = req.query;
  if (!vendorId) return res.status(400).json({ error: "vendorId required" });

  const notifs = DB.notifications.filter((n) => n.vendorId === vendorId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return res.json(notifs);
});

app.post("/api/notifications/:id/read", (req, res) => {
  const { id } = req.params;
  const notif = DB.notifications.find((n) => n.id === id);
  if (!notif) return res.status(404).json({ error: "Notification not found" });
  notif.read = true;
  return res.json(notif);
});

// ─── Serve portal HTML for all non-API routes ───
app.get("*", (req, res) => {
  if (portalHtml) {
    res.setHeader("Content-Type", "text/html");
    res.send(portalHtml);
  } else {
    res.status(404).send("Portal not found");
  }
});

// ─── Global error handler (prevents FUNCTION_INVOCATION_FAILED on Vercel) ───
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message, err.stack);
  res.status(500).json({ error: "Internal server error", message: err.message });
});

// Initialize Google Drive on startup (skip on Vercel — will init on first request)
if (!isVercel) {
  initGoogleDrive().catch(() => {
    console.warn("⚠️  Google Drive not available. Using memory-only storage.");
  });
}

module.exports = app;
