const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const axios = require("axios");

const app = express();

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// Constants
const JWT_SECRET = process.env.JWT_SECRET || "cdc-secret-key";
const ADMIN_EMAIL = "admin@crepdogcrew.com";
const ADMIN_PASSWORD = "admin123";

// In-memory database
const db = {
  vendors: [
    {
      id: "v-demo-001",
      name: "Rahul Sneaker Co.",
      email: "rahul@sneakers.in",
      password: "0ead2060b65992dca4769af601a1b3a35ef38cfad2c2c465bb160ea764157c5d",
      phone: "9876543210",
      gst: "18AABCT1234H1Z0",
      pan: "AABCT1234H",
      status: "approved",
      kycStatus: "verified",
      createdAt: new Date(),
    },
  ],
  shoes: [],
  batches: [],
  mrns: [],
  notifications: [],
  admin: {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  },
};

// Utility Functions
const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const hashPassword = (password) => {
  return crypto.createHash("sha256").update(password).digest("hex");
};

const verifyPassword = (password, hash) => {
  return hashPassword(password) === hash;
};

const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const getVendorFromQuery = (req) => {
  const vendorId = req.query.vendorId;
  if (!vendorId) return null;
  return db.vendors.find((v) => v.id === vendorId);
};

const sendNotification = (vendorId, title, message, type = "info") => {
  db.notifications.push({
    id: generateId("notif"),
    vendorId,
    title,
    message,
    type,
    read: false,
    createdAt: new Date(),
  });
};

const generateMRNNumber = () => {
  const today = new Date();
  const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
  const randomNum = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `MRN-${dateStr}-${randomNum}`;
};

// ============================================
// VENDOR AUTH ROUTES
// ============================================

// POST /api/vendors/register
app.post("/api/vendors/register", (req, res) => {
  try {
    const { name, email, password, phone, gst, pan } = req.body;

    if (!name || !email || !password || !phone || !gst || !pan) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (db.vendors.some((v) => v.email === email)) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const vendor = {
      id: generateId("v"),
      name,
      email,
      password: hashPassword(password),
      phone,
      gst,
      pan,
      status: "pending",
      kycStatus: "pending",
      createdAt: new Date(),
    };

    db.vendors.push(vendor);

    sendNotification(
      vendor.id,
      "Registration Successful",
      "Your vendor account has been created. Waiting for admin approval.",
      "info"
    );

    res.status(201).json({
      message: "Vendor registered successfully",
      vendorId: vendor.id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/vendors/login
app.post("/api/vendors/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const vendor = db.vendors.find((v) => v.email === email);

    if (!vendor || !verifyPassword(password, vendor.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = generateToken({ vendorId: vendor.id, type: "vendor" });

    res.json({
      message: "Login successful",
      token,
      vendor: {
        id: vendor.id,
        name: vendor.name,
        email: vendor.email,
        status: vendor.status,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/vendors/me
app.get("/api/vendors/me", (req, res) => {
  try {
    const vendor = getVendorFromQuery(req);

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.json({
      id: vendor.id,
      name: vendor.name,
      email: vendor.email,
      phone: vendor.phone,
      gst: vendor.gst,
      pan: vendor.pan,
      status: vendor.status,
      kycStatus: vendor.kycStatus,
      createdAt: vendor.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/vendors/logout
app.post("/api/vendors/logout", (req, res) => {
  try {
    res.json({ message: "Logout successful" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN AUTH ROUTES
// ============================================

// POST /api/admin/login
app.post("/api/admin/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const token = generateToken({ email, type: "admin" });

    res.json({
      message: "Admin login successful",
      token,
      admin: {
        email: ADMIN_EMAIL,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/me
app.get("/api/admin/me", (req, res) => {
  try {
    res.json({
      email: ADMIN_EMAIL,
      role: "admin",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SHOES ROUTES
// ============================================

// GET /api/shoes
app.get("/api/shoes", (req, res) => {
  try {
    let shoes = db.shoes;

    const vendorId = req.query.vendorId;
    if (vendorId) {
      shoes = shoes.filter((s) => s.vendorId === vendorId);
    }

    res.json(shoes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/shoes
app.post("/api/shoes", (req, res) => {
  try {
    const { vendorId, name, sku, size, color, category, cost } = req.body;

    if (!vendorId || !name || !sku || !size || !color || !category) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const shoe = {
      id: generateId("shoe"),
      vendorId,
      name,
      sku,
      size,
      color,
      category,
      cost: cost || 0,
      status: "submitted",
      batchId: null,
      createdAt: new Date(),
    };

    db.shoes.push(shoe);

    res.status(201).json({
      message: "Shoe added successfully",
      shoe,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/shoes/batch
app.post("/api/shoes/batch", (req, res) => {
  try {
    const { vendorId, shoes: shoeList } = req.body;

    if (!vendorId || !shoeList || !Array.isArray(shoeList)) {
      return res.status(400).json({ error: "Invalid batch data" });
    }

    const vendor = db.vendors.find((v) => v.id === vendorId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const batchId = generateId("batch");
    const addedShoes = [];

    shoeList.forEach((shoeData) => {
      if (shoeData.name && shoeData.sku && shoeData.size) {
        const shoe = {
          id: generateId("shoe"),
          vendorId,
          name: shoeData.name,
          sku: shoeData.sku,
          size: shoeData.size,
          color: shoeData.color || "",
          category: shoeData.category || "",
          cost: shoeData.cost || 0,
          status: "submitted",
          batchId,
          createdAt: new Date(),
        };
        db.shoes.push(shoe);
        addedShoes.push(shoe);
      }
    });

    const batch = {
      id: batchId,
      vendorId,
      vendorName: vendor.name,
      shoeIds: addedShoes.map((s) => s.id),
      shoeCount: addedShoes.length,
      status: "submitted",
      createdAt: new Date(),
    };

    db.batches.push(batch);

    sendNotification(vendorId, "Batch Submitted", `Your batch ${batchId} with ${addedShoes.length} shoes has been submitted.`, "info");

    res.status(201).json({
      message: "Batch submitted successfully",
      batch,
      shoes: addedShoes,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ADMIN OPERATIONS ROUTES
// ============================================

// GET /api/admin/vendors
app.get("/api/admin/vendors", (req, res) => {
  try {
    const vendors = db.vendors.map((v) => ({
      id: v.id,
      name: v.name,
      email: v.email,
      phone: v.phone,
      gst: v.gst,
      pan: v.pan,
      status: v.status,
      kycStatus: v.kycStatus,
      createdAt: v.createdAt,
    }));

    res.json(vendors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/shoes
app.get("/api/admin/shoes", (req, res) => {
  try {
    const shoes = db.shoes.map((s) => ({
      ...s,
      vendor: db.vendors.find((v) => v.id === s.vendorId),
    }));

    res.json(shoes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/batches/:batchId/review
app.post("/api/admin/batches/:batchId/review", (req, res) => {
  try {
    const { batchId } = req.params;
    const { decisions } = req.body;

    if (!decisions || !Array.isArray(decisions)) {
      return res.status(400).json({ error: "Invalid decisions format" });
    }

    const batch = db.batches.find((b) => b.id === batchId);
    if (!batch) {
      return res.status(404).json({ error: "Batch not found" });
    }

    decisions.forEach((decision) => {
      const shoe = db.shoes.find((s) => s.id === decision.shoeId);
      if (shoe) {
        shoe.status = decision.status === "approved" ? "approved" : "rejected";
        if (decision.status === "rejected") {
          shoe.rejectionReason = decision.reason || "";
        }
      }
    });

    batch.status = "reviewed";
    const approvedCount = decisions.filter((d) => d.status === "approved").length;

    sendNotification(batch.vendorId, "Batch Reviewed", `${approvedCount} out of ${decisions.length} shoes approved.`, "info");

    res.json({
      message: "Batch review submitted",
      batch,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/shoes/authenticate
app.post("/api/admin/shoes/authenticate", (req, res) => {
  try {
    const { results } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: "Invalid results format" });
    }

    results.forEach((result) => {
      const shoe = db.shoes.find((s) => s.id === result.shoeId);
      if (shoe) {
        shoe.status = result.authenticated ? "authenticated" : "rejected";
        shoe.authenticationDate = new Date();
        if (result.notes) {
          shoe.authenticationNotes = result.notes;
        }
      }
    });

    res.json({
      message: "Shoes authenticated",
      authenticatedCount: results.filter((r) => r.authenticated).length,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/shoes/:id/pv-change
app.post("/api/admin/shoes/:id/pv-change", (req, res) => {
  try {
    const { id } = req.params;
    const { payoutValue, reason } = req.body;

    const shoe = db.shoes.find((s) => s.id === id);
    if (!shoe) {
      return res.status(404).json({ error: "Shoe not found" });
    }

    shoe.originalPayoutValue = shoe.payoutValue || shoe.cost;
    shoe.payoutValue = payoutValue;
    shoe.pvChangeReason = reason || "";
    shoe.pvChangeStatus = "pending";

    sendNotification(
      shoe.vendorId,
      "Payout Value Change",
      `Payout value for shoe ${shoe.name} has been proposed to change to ${payoutValue}.`,
      "warning"
    );

    res.json({
      message: "Payout value change initiated",
      shoe,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// MRN ROUTES
// ============================================

// POST /api/admin/mrn/create
app.post("/api/admin/mrn/create", (req, res) => {
  try {
    const { vendorId, vendorName, shoeIds, warehouse } = req.body;

    if (!vendorId || !shoeIds || !Array.isArray(shoeIds)) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const mrnNumber = generateMRNNumber();
    const mrn = {
      id: generateId("mrn"),
      mrnNumber,
      vendorId,
      vendorName: vendorName || db.vendors.find((v) => v.id === vendorId)?.name,
      shoeIds,
      warehouse: warehouse || "Main Warehouse",
      status: "pending_signature",
      signature: null,
      createdAt: new Date(),
    };

    db.mrns.push(mrn);

    sendNotification(vendorId, "MRN Generated", `MRN ${mrnNumber} has been created. Please sign and submit it.`, "info");

    res.json({
      message: "MRN created successfully",
      mrn,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/mrn/:id
app.get("/api/mrn/:id", (req, res) => {
  try {
    const { id } = req.params;
    const mrn = db.mrns.find((m) => m.id === id);

    if (!mrn) {
      return res.status(404).json({ error: "MRN not found" });
    }

    const shoes = mrn.shoeIds.map((shoeId) => db.shoes.find((s) => s.id === shoeId));

    res.json({
      ...mrn,
      shoes,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/mrns
app.get("/api/mrns", (req, res) => {
  try {
    let mrns = db.mrns;

    const vendorId = req.query.vendorId;
    if (vendorId) {
      mrns = mrns.filter((m) => m.vendorId === vendorId);
    }

    res.json(mrns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/mrn/:id/sign
app.post("/api/mrn/:id/sign", (req, res) => {
  try {
    const { id } = req.params;
    const { signature } = req.body;

    if (!signature) {
      return res.status(400).json({ error: "Signature image required" });
    }

    const mrn = db.mrns.find((m) => m.id === id);
    if (!mrn) {
      return res.status(404).json({ error: "MRN not found" });
    }

    mrn.signature = signature;
    mrn.status = "signed";
    mrn.signedAt = new Date();

    sendNotification(mrn.vendorId, "MRN Signed", `MRN ${mrn.mrnNumber} has been signed and submitted.`, "success");

    res.json({
      message: "MRN signed successfully",
      mrn,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// NOTIFICATIONS ROUTES
// ============================================

// GET /api/notifications
app.get("/api/notifications", (req, res) => {
  try {
    const vendorId = req.query.vendorId;

    if (!vendorId) {
      return res.status(400).json({ error: "vendorId query parameter required" });
    }

    const notifications = db.notifications
      .filter((n) => n.vendorId === vendorId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/:id/read
app.post("/api/notifications/:id/read", (req, res) => {
  try {
    const { id } = req.params;
    const notification = db.notifications.find((n) => n.id === id);

    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    notification.read = true;
    notification.readAt = new Date();

    res.json({
      message: "Notification marked as read",
      notification,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// KYC ROUTES (Sandbox.co.in)
// ============================================

// POST /api/kyc/pan/verify
app.post("/api/kyc/pan/verify", (req, res) => {
  try {
    const { pan, vendorId } = req.body;

    if (!pan || !vendorId) {
      return res.status(400).json({ error: "PAN and vendorId required" });
    }

    const vendor = db.vendors.find((v) => v.id === vendorId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    // Sandbox API call (mock - in production, call actual API)
    const sandboxApiKey = process.env.SANDBOX_API_KEY || "sandbox-key";
    const sandboxApiSecret = process.env.SANDBOX_API_SECRET || "sandbox-secret";

    // Mock PAN verification - in production: getAccessToken -> verify against Sandbox API
    const isValid = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(pan);

    if (!isValid) {
      return res.status(400).json({ error: "Invalid PAN format" });
    }

    vendor.panVerified = true;
    vendor.panVerificationDate = new Date();

    res.json({
      message: "PAN verified successfully",
      verified: true,
      pan: pan.substring(0, 2) + "****" + pan.substring(6),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kyc/aadhaar/otp/generate
app.post("/api/kyc/aadhaar/otp/generate", (req, res) => {
  try {
    const { aadhaar, vendorId } = req.body;

    if (!aadhaar || !vendorId) {
      return res.status(400).json({ error: "Aadhaar and vendorId required" });
    }

    const vendor = db.vendors.find((v) => v.id === vendorId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    // Mock OTP generation
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    vendor.aadhaarOtp = otp;
    vendor.aadhaarOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    res.json({
      message: "OTP generated successfully",
      requestId: generateId("req"),
      expiresIn: 600,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/kyc/aadhaar/otp/verify
app.post("/api/kyc/aadhaar/otp/verify", (req, res) => {
  try {
    const { aadhaar, otp, vendorId, requestId } = req.body;

    if (!aadhaar || !otp || !vendorId) {
      return res.status(400).json({ error: "Aadhaar, OTP, and vendorId required" });
    }

    const vendor = db.vendors.find((v) => v.id === vendorId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    if (vendor.aadhaarOtp !== otp || new Date() > vendor.aadhaarOtpExpiresAt) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    vendor.aadhaarVerified = true;
    vendor.aadhaarVerificationDate = new Date();
    vendor.aadhaarOtp = null;
    vendor.aadhaarOtpExpiresAt = null;
    vendor.kycStatus = "verified";

    sendNotification(vendorId, "KYC Verification Complete", "Your Aadhaar and PAN have been verified successfully.", "success");

    res.json({
      message: "Aadhaar verified successfully",
      verified: true,
      kycStatus: "verified",
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// GOOGLE DRIVE ROUTES
// ============================================

// POST /api/drive/upload
app.post("/api/drive/upload", (req, res) => {
  try {
    const { vendorId, documentType, fileData, fileName } = req.body;

    if (!vendorId || !documentType || !fileData) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const vendor = db.vendors.find((v) => v.id === vendorId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    // Mock Google Drive upload - in production: use Google Drive API
    const driveFileId = generateId("drive");

    res.json({
      message: "Document uploaded successfully",
      driveFileId,
      documentType,
      fileName: fileName || `${documentType}_${vendor.pan}`,
      uploadedAt: new Date(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/drive/agreement
app.post("/api/drive/agreement", (req, res) => {
  try {
    const { vendorId, signedAgreement } = req.body;

    if (!vendorId || !signedAgreement) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const vendor = db.vendors.find((v) => v.id === vendorId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const driveFileId = generateId("drive");
    vendor.agreementFileId = driveFileId;
    vendor.agreementSignedAt = new Date();
    vendor.status = "approved";

    sendNotification(vendorId, "Agreement Signed", "Your vendor agreement has been signed and stored.", "success");

    res.json({
      message: "Agreement uploaded successfully",
      driveFileId,
      uploadedAt: new Date(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drive/:vendorName
app.get("/api/drive/:vendorName", (req, res) => {
  try {
    const { vendorName } = req.params;

    const vendor = db.vendors.find((v) => v.name.toLowerCase() === vendorName.toLowerCase());
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    // Mock Google Drive file listing
    const files = [
      {
        id: vendor.agreementFileId || generateId("drive"),
        name: "Vendor Agreement",
        type: "agreement",
        createdAt: vendor.agreementSignedAt || new Date(),
      },
    ];

    if (vendor.panVerified) {
      files.push({
        id: generateId("drive"),
        name: `PAN Verification - ${vendor.pan}`,
        type: "pan",
        createdAt: vendor.panVerificationDate,
      });
    }

    if (vendor.aadhaarVerified) {
      files.push({
        id: generateId("drive"),
        name: "Aadhaar Verification",
        type: "aadhaar",
        createdAt: vendor.aadhaarVerificationDate,
      });
    }

    res.json({
      vendorName: vendor.name,
      files,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/drive/mrn-upload
app.post("/api/drive/mrn-upload", (req, res) => {
  try {
    const { mrnId, mrnPdf } = req.body;

    if (!mrnId || !mrnPdf) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const mrn = db.mrns.find((m) => m.id === mrnId);
    if (!mrn) {
      return res.status(404).json({ error: "MRN not found" });
    }

    const driveFileId = generateId("drive");
    mrn.pdfFileId = driveFileId;
    mrn.pdfUploadedAt = new Date();

    res.json({
      message: "MRN PDF uploaded successfully",
      driveFileId,
      uploadedAt: new Date(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// VENDOR PV RESPONSE ROUTE
// ============================================

// POST /api/shoes/:id/pv-response
app.post("/api/shoes/:id/pv-response", (req, res) => {
  try {
    const { id } = req.params;
    const { response, notes } = req.body;

    if (!response || !["accept", "reject"].includes(response)) {
      return res.status(400).json({ error: "Invalid response. Must be 'accept' or 'reject'" });
    }

    const shoe = db.shoes.find((s) => s.id === id);
    if (!shoe) {
      return res.status(404).json({ error: "Shoe not found" });
    }

    if (shoe.pvChangeStatus !== "pending") {
      return res.status(400).json({ error: "No pending PV change for this shoe" });
    }

    shoe.pvChangeStatus = response === "accept" ? "accepted" : "rejected";
    shoe.vendorPvResponse = response;
    shoe.vendorPvResponseDate = new Date();
    if (notes) {
      shoe.vendorPvResponseNotes = notes;
    }

    if (response === "reject") {
      shoe.payoutValue = shoe.originalPayoutValue;
      sendNotification(shoe.vendorId, "PV Change Rejected", `You rejected the proposed payout change for ${shoe.name}.`, "info");
    } else {
      sendNotification(shoe.vendorId, "PV Change Accepted", `You accepted the new payout value of ${shoe.payoutValue} for ${shoe.name}.`, "success");
    }

    res.json({
      message: `PV change ${response}ed`,
      shoe,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BATCHES ROUTE
// ============================================

// GET /api/batches
app.get("/api/batches", (req, res) => {
  try {
    let batches = db.batches;

    const vendorId = req.query.vendorId;
    if (vendorId) {
      batches = batches.filter((b) => b.vendorId === vendorId);
    }

    res.json(batches);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HEALTH CHECK ROUTE
// ============================================

// GET /api/health
app.get("/api/health", (req, res) => {
  try {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CATCH-ALL ROUTE (MUST BE LAST)
// ============================================

const PORTAL_HTML = require("./_html");
app.get("*", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(PORTAL_HTML);
});

// ============================================
// ERROR HANDLER (AFTER CATCH-ALL)
// ============================================

app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
