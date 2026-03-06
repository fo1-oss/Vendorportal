// ═══════════════════════════════════════════════════════════════════
// Crep Dog Crew — Vendor Portal Server
// Real-time KYC (Sandbox.co.in) + Document Drive + Vendor API
// ═══════════════════════════════════════════════════════════════════

const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const app = express();
const PORT = 3000;

// ─── Sandbox API Config ───
const SANDBOX = {
  baseUrl: "https://api.sandbox.co.in",
  apiKey: "key_live_808b0f666cb942048817151594ff2a1f",
  apiSecret: "secret_live_296801ab0c11431c896fd429de830b2e",
  accessToken: null,
  tokenExpiry: null,
};

// ─── Google Drive Config (lightweight: axios + JWT) ───
const GDRIVE_ROOT_FOLDER = "1epOrTC8kyK2WiR033B8YgrZFjKy5jhhE";
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "service-account.json");
let gdrive = { token: null, tokenExpiry: null, ready: false };

// Get OAuth2 access token from service account JWT
async function getDriveToken() {
  if (gdrive.token && gdrive.tokenExpiry && Date.now() < gdrive.tokenExpiry - 60000) {
    return gdrive.token;
  }
  const sa = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));
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
}

function driveHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

// Initialize Google Drive — test access to root folder
async function initGoogleDrive() {
  try {
    const token = await getDriveToken();
    const res = await axios.get("https://www.googleapis.com/drive/v3/files", {
      headers: driveHeaders(token),
      params: { q: `'${GDRIVE_ROOT_FOLDER}' in parents and trashed = false`, pageSize: 1, fields: "files(id,name)" },
    });
    gdrive.ready = true;
    console.log("✅ Google Drive connected — root folder accessible");
    return true;
  } catch (err) {
    console.error("⚠️  Google Drive init failed:", err.response?.data?.error?.message || err.message);
    console.log("   Documents will be saved to local drive/ folder as fallback.");
    gdrive.ready = false;
    return false;
  }
}

// Create a folder in Google Drive (returns folder ID)
async function createDriveFolder(name, parentId) {
  if (!gdrive.ready) return null;
  try {
    const token = await getDriveToken();
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
    console.error(`❌ Failed to create Drive folder '${name}':`, err.response?.data?.error?.message || err.message);
    return null;
  }
}

// Upload a file to Google Drive (from base64 data) using multipart upload
async function uploadToDrive(fileName, base64Data, mimeType, parentFolderId) {
  if (!gdrive.ready) return null;
  try {
    const token = await getDriveToken();
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
    console.error(`❌ Drive upload failed for '${fileName}':`, err.response?.data?.error?.message || err.message);
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
    console.error("❌ Failed to create vendor Drive folders:", err.message);
    return null;
  }
}

// List files in a Google Drive folder
async function listDriveFiles(folderId) {
  if (!gdrive.ready || !folderId) return [];
  try {
    const token = await getDriveToken();
    const res = await axios.get("https://www.googleapis.com/drive/v3/files", {
      headers: driveHeaders(token),
      params: { q: `'${folderId}' in parents and trashed = false`, fields: "files(id,name,mimeType,size,createdTime,webViewLink)", orderBy: "createdTime desc" },
    });
    return res.data.files || [];
  } catch (err) {
    console.error("❌ Drive list error:", err.message);
    return [];
  }
}

// ─── Local Document Drive (Fallback) ───
const DRIVE_ROOT = path.join(__dirname, "drive");
if (!fs.existsSync(DRIVE_ROOT)) fs.mkdirSync(DRIVE_ROOT, { recursive: true });

function ensureLocalVendorDrive(vendorId) {
  const vendorDir = path.join(DRIVE_ROOT, vendorId);
  const dirs = ["pan", "aadhaar", "agreements", "invoices"];
  dirs.forEach((d) => {
    const p = path.join(vendorDir, d);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
  return vendorDir;
}

// ─── Middleware ───
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(
  session({
    secret: "cdc-vendor-portal-secret-2026",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, "public")));

// ─── In-Memory Store ───
const DB = {
  vendors: [],
  shoes: [],
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
  { id: "s-001", vendorId: "v-demo-001", brand: "Nike", model: "Air Jordan 1 Retro High OG 'Chicago'", size: "US 10", sku: "555088-101", condition: "Deadstock", bidPrice: 18500, bidStatus: "accepted", consignPrice: 18500, counterPrice: null, counterNote: null, status: "sold", consignedAt: "2025-12-01", soldAt: "2026-01-05" },
  { id: "s-002", vendorId: "v-demo-001", brand: "Adidas", model: "Yeezy Boost 350 V2 'Zebra'", size: "US 9", sku: "CP9654", condition: "Deadstock", bidPrice: 21000, bidStatus: "accepted", consignPrice: 21000, counterPrice: null, counterNote: null, status: "sold", consignedAt: "2025-12-03", soldAt: "2026-01-18" },
  { id: "s-003", vendorId: "v-demo-001", brand: "Nike", model: "Dunk Low 'Panda'", size: "US 11", sku: "DD1391-100", condition: "VNDS", bidPrice: 9500, bidStatus: "pending", consignPrice: null, counterPrice: null, counterNote: null, status: "pending_review", consignedAt: "2026-01-10", soldAt: null },
  { id: "s-004", vendorId: "v-demo-001", brand: "New Balance", model: "550 'White Green'", size: "US 10.5", sku: "BB550WT1", condition: "Deadstock", bidPrice: 12000, bidStatus: "countered", consignPrice: null, counterPrice: 11000, counterNote: "Market pricing adjustment", status: "available", consignedAt: "2026-01-15", soldAt: null },
  { id: "s-005", vendorId: "v-demo-001", brand: "Nike", model: "Air Force 1 '07 Low White", size: "US 9.5", sku: "CW2288-111", condition: "Deadstock", bidPrice: 7500, bidStatus: "accepted", consignPrice: 7500, counterPrice: null, counterNote: null, status: "sold", consignedAt: "2025-12-20", soldAt: "2026-02-01" },
  { id: "s-006", vendorId: "v-demo-001", brand: "Jordan", model: "Air Jordan 4 Retro 'Military Black'", size: "US 10", sku: "DH6927-111", condition: "Deadstock", bidPrice: 19000, bidStatus: "pending", consignPrice: null, counterPrice: null, counterNote: null, status: "pending_review", consignedAt: "2026-02-01", soldAt: null },
  { id: "s-007", vendorId: "v-demo-001", brand: "Adidas", model: "Campus 00s 'Dark Green'", size: "US 8", sku: "H03472", condition: "VNDS", bidPrice: 8000, bidStatus: "rejected", consignPrice: null, counterPrice: null, counterNote: null, status: "rejected", consignedAt: "2026-02-05", soldAt: null },
  { id: "s-008", vendorId: "v-demo-001", brand: "Nike", model: "SB Dunk Low 'Court Purple'", size: "US 10", sku: "BQ6817-500", condition: "Deadstock", bidPrice: 14000, bidStatus: "accepted", consignPrice: 14000, counterPrice: null, counterNote: null, status: "sold", consignedAt: "2025-12-15", soldAt: "2026-01-22" },
];

DB.vendors.push(DEMO_VENDOR);
DB.shoes.push(...DEMO_SHOES);
ensureLocalVendorDrive(DEMO_VENDOR.id);

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
    console.error("❌ Sandbox auth failed:", err.response?.data || err.message);
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
    console.error("❌ PAN verify error:", err.response?.data || err.message);
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
    console.error("❌ Aadhaar OTP error:", err.response?.data || err.message);
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
    console.error("❌ Aadhaar verify error:", err.response?.data || err.message);
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
      console.log("⚠️  Google Drive upload failed, falling back to local storage");
    }

    // ── Local fallback ──
    const vId = vendorId || vendorName.replace(/[^a-zA-Z0-9]/g, "_");
    const vendorDir = ensureLocalVendorDrive(vId);
    const catDir = path.join(vendorDir, category);

    let base64Data = fileData;
    if (fileData.includes(",")) base64Data = fileData.split(",")[1];

    const buffer = Buffer.from(base64Data, "base64");
    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const finalName = `${Date.now()}_${safeFileName}`;
    fs.writeFileSync(path.join(catDir, finalName), buffer);
    console.log(`📁 Saved locally: ${category}/${finalName} for ${vendorName}`);

    return res.json({
      success: true,
      storage: "local",
      file: {
        name: finalName,
        originalName: fileName,
        category,
        path: `/drive/${vId}/${category}/${finalName}`,
        size: buffer.length,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("❌ Upload error:", err.message);
    return res.status(500).json({ error: `Upload failed: ${err.message}` });
  }
});

// Save signed agreement to Google Drive
app.post("/api/drive/agreement", async (req, res) => {
  const { vendorId, vendorName, vendorEmail, agreementText, acceptedAt } = req.body;

  if (!vendorName) {
    return res.status(400).json({ error: "vendorName required" });
  }

  try {
    const agreement = {
      title: "CDC Vendor Consignment Agreement",
      vendorName,
      vendorEmail,
      acceptedAt: acceptedAt || new Date().toISOString(),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      agreementVersion: "2026-02",
      content: agreementText || "Standard CDC Vendor Consignment Agreement v2026-02",
      digitalSignature: crypto
        .createHash("sha256")
        .update(`${vendorId || vendorName}|${vendorName}|${acceptedAt || Date.now()}`)
        .digest("hex"),
    };

    const agreementFileName = `Agreement_${vendorName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`;
    const agreementBase64 = Buffer.from(JSON.stringify(agreement, null, 2)).toString("base64");

    // ── Google Drive upload ──
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

    // ── Local fallback ──
    const vId = vendorId || vendorName.replace(/[^a-zA-Z0-9]/g, "_");
    const vendorDir = ensureLocalVendorDrive(vId);
    fs.writeFileSync(
      path.join(vendorDir, "agreements", agreementFileName),
      JSON.stringify(agreement, null, 2)
    );
    console.log(`📝 Agreement saved locally for ${vendorName}`);
    return res.json({ success: true, storage: "local", agreement: { ...agreement, fileName: agreementFileName } });
  } catch (err) {
    console.error("❌ Agreement save error:", err.message);
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

    // ── Local fallback ──
    const vendorDir = path.join(DRIVE_ROOT, vendorName);
    if (!fs.existsSync(vendorDir)) return res.json({ files: [], storage: "local" });

    const categories = category ? [category] : ["pan", "aadhaar", "agreements", "invoices"];
    const files = [];
    categories.forEach((cat) => {
      const catDir = path.join(vendorDir, cat);
      if (fs.existsSync(catDir)) {
        fs.readdirSync(catDir).forEach((item) => {
          const stat = fs.statSync(path.join(catDir, item));
          files.push({ name: item, category: cat, path: `/drive/${vendorName}/${cat}/${item}`, size: stat.size, uploadedAt: stat.mtime.toISOString() });
        });
      }
    });
    files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    return res.json({ files, totalCount: files.length, storage: "local" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Serve local drive files as fallback
app.use("/drive", express.static(DRIVE_ROOT));

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
  ensureLocalVendorDrive(vendor.id);
  // Also create Google Drive folder structure for this vendor
  ensureVendorDriveFolders(vendor.name).then((folders) => {
    if (folders) vendorDriveFolderCache[vendor.name] = folders;
  }).catch(() => {});
  req.session.vendorId = vendor.id;
  console.log(`🆕 Vendor registered: ${vendor.name} (${vendor.id})`);

  return res.json(vendor);
});

// Login
app.post("/api/vendors/login", (req, res) => {
  const { email, password } = req.body;
  const vendor = DB.vendors.find((v) => v.email === email && v.password === password);
  if (!vendor) return res.status(401).json({ error: "Invalid credentials" });
  req.session.vendorId = vendor.id;
  return res.json(vendor);
});

// Session check
app.get("/api/vendors/me", (req, res) => {
  const vendor = DB.vendors.find((v) => v.id === req.session.vendorId);
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
  req.session.destroy();
  return res.json({ ok: true });
});

// ─── Shoe / Consignment Routes ───
app.get("/api/shoes", (req, res) => {
  const vendorId = req.session.vendorId || req.query.vendorId;
  if (!vendorId) return res.status(401).json({ error: "Not authenticated" });
  return res.json(DB.shoes.filter((s) => s.vendorId === vendorId));
});

app.post("/api/shoes", (req, res) => {
  const vendorId = req.session.vendorId;
  if (!vendorId) return res.status(401).json({ error: "Not authenticated" });
  const shoe = {
    id: "s-" + crypto.randomBytes(3).toString("hex"),
    vendorId,
    ...req.body,
    status: req.body.status || "pending_review",
    consignedAt: new Date().toISOString().slice(0, 10),
    soldAt: null,
  };
  DB.shoes.push(shoe);
  return res.json(shoe);
});

// ─── Admin Routes ───
app.post("/api/admin/login", (req, res) => {
  const { email, password } = req.body;
  const admin = DB.admins.find((a) => a.email === email && a.password === password);
  if (!admin) return res.status(401).json({ error: "Invalid admin credentials" });
  req.session.adminId = admin.id;
  return res.json(admin);
});

app.get("/api/admin/me", (req, res) => {
  const admin = DB.admins.find((a) => a.id === req.session.adminId);
  if (!admin) return res.status(401).json({ error: "Not logged in as admin" });
  return res.json(admin);
});

app.get("/api/admin/vendors", (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: "Admin required" });
  return res.json(DB.vendors);
});

app.get("/api/admin/shoes", (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: "Admin required" });
  return res.json(DB.shoes);
});

app.patch("/api/admin/shoes/:id", (req, res) => {
  if (!req.session.adminId) return res.status(401).json({ error: "Admin required" });
  const shoe = DB.shoes.find((s) => s.id === req.params.id);
  if (!shoe) return res.status(404).json({ error: "Shoe not found" });
  Object.assign(shoe, req.body);
  return res.json(shoe);
});

// ─── Serve frontend ───
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// ─── Start ───
app.listen(PORT, async () => {
  console.log(`\n🚀 CDC Vendor Portal Server running at http://localhost:${PORT}`);
  console.log(`   📂 Local Drive Fallback: ${DRIVE_ROOT}`);
  console.log(`   🔑 Sandbox API: ${SANDBOX.apiKey.slice(0, 20)}...`);
  console.log(`   👤 Demo login: rahul@sneakers.in / demo1234`);
  console.log(`   🛡  Admin login: admin@crepdogcrew.com / admin123`);

  // Initialize Google Drive
  console.log(`\n   🔗 Connecting to Google Drive...`);
  const driveOk = await initGoogleDrive();
  if (driveOk) {
    console.log(`   📁 Drive folder: https://drive.google.com/drive/folders/${GDRIVE_ROOT_FOLDER}`);
  }
  console.log("");
});
