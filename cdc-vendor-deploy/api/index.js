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

const PORTAL_HTML = JSON.parse("\"<!DOCTYPE html>\\n<html lang=\\\"en\\\">\\n<head>\\n    <meta charset=\\\"UTF-8\\\">\\n    <meta name=\\\"viewport\\\" content=\\\"width=device-width, initial-scale=1.0\\\">\\n    <title>CDC Vendor Portal - Crep Dog Crew</title>\\n    <link href=\\\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap\\\" rel=\\\"stylesheet\\\">\\n    <script crossorigin src=\\\"https://unpkg.com/react@18/umd/react.development.js\\\"></script>\\n    <script crossorigin src=\\\"https://unpkg.com/react-dom@18/umd/react-dom.development.js\\\"></script>\\n    <script src=\\\"https://unpkg.com/@babel/standalone@7.23.9/babel.min.js\\\"></script>\\n    <script src=\\\"https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.min.js\\\"></script>\\n    <script src=\\\"https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.5.0/pdf.min.js\\\"></script>\\n    <script src=\\\"https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js\\\"></script>\\n    <style>\\n        * {\\n            margin: 0;\\n            padding: 0;\\n            box-sizing: border-box;\\n        }\\n\\n        body {\\n            font-family: 'Inter', sans-serif;\\n            background: #f8f9fa;\\n            color: #1a1a1a;\\n            line-height: 1.6;\\n        }\\n\\n        .container {\\n            max-width: 1200px;\\n            margin: 0 auto;\\n            padding: 0 20px;\\n        }\\n\\n        /* Header */\\n        .header {\\n            background: #1a1a1a;\\n            color: white;\\n            padding: 20px 0;\\n            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);\\n            position: sticky;\\n            top: 0;\\n            z-index: 100;\\n        }\\n\\n        .header-content {\\n            display: flex;\\n            justify-content: space-between;\\n            align-items: center;\\n            max-width: 1200px;\\n            margin: 0 auto;\\n            padding: 0 20px;\\n        }\\n\\n        .logo {\\n            font-size: 28px;\\n            font-weight: 800;\\n            letter-spacing: -1px;\\n            text-transform: uppercase;\\n        }\\n\\n        .header-actions {\\n            display: flex;\\n            gap: 20px;\\n            align-items: center;\\n        }\\n\\n        .vendor-info {\\n            font-size: 14px;\\n            text-align: right;\\n        }\\n\\n        .vendor-name {\\n            font-weight: 600;\\n            margin-bottom: 4px;\\n        }\\n\\n        .logout-btn {\\n            background: #ff6b6b;\\n            color: white;\\n            border: none;\\n            padding: 10px 20px;\\n            border-radius: 6px;\\n            cursor: pointer;\\n            font-size: 14px;\\n            font-weight: 500;\\n            transition: background 0.3s;\\n        }\\n\\n        .logout-btn:hover {\\n            background: #ff5252;\\n        }\\n\\n        /* Main Content */\\n        .main {\\n            min-height: 100vh;\\n            padding: 40px 0;\\n        }\\n\\n        /* Landing Page */\\n        .landing {\\n            display: flex;\\n            flex-direction: column;\\n            justify-content: center;\\n            align-items: center;\\n            min-height: 100vh;\\n            text-align: center;\\n            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);\\n            color: white;\\n        }\\n\\n        .landing-content {\\n            max-width: 600px;\\n        }\\n\\n        .landing-logo {\\n            font-size: 80px;\\n            font-weight: 800;\\n            margin-bottom: 20px;\\n            letter-spacing: -2px;\\n            background: linear-gradient(135deg, #fff 0%, #d0d0d0 100%);\\n            -webkit-background-clip: text;\\n            -webkit-text-fill-color: transparent;\\n            background-clip: text;\\n        }\\n\\n        .landing-title {\\n            font-size: 48px;\\n            font-weight: 700;\\n            margin-bottom: 10px;\\n        }\\n\\n        .landing-subtitle {\\n            font-size: 18px;\\n            color: #b0b0b0;\\n            margin-bottom: 40px;\\n        }\\n\\n        .button-group {\\n            display: flex;\\n            gap: 20px;\\n            justify-content: center;\\n            flex-wrap: wrap;\\n        }\\n\\n        .btn {\\n            padding: 14px 40px;\\n            font-size: 16px;\\n            font-weight: 600;\\n            border: none;\\n            border-radius: 8px;\\n            cursor: pointer;\\n            transition: all 0.3s;\\n            text-transform: uppercase;\\n            letter-spacing: 0.5px;\\n        }\\n\\n        .btn-primary {\\n            background: white;\\n            color: #1a1a1a;\\n        }\\n\\n        .btn-primary:hover {\\n            background: #f0f0f0;\\n            transform: translateY(-2px);\\n            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);\\n        }\\n\\n        .btn-secondary {\\n            background: transparent;\\n            color: white;\\n            border: 2px solid white;\\n        }\\n\\n        .btn-secondary:hover {\\n            background: white;\\n            color: #1a1a1a;\\n            transform: translateY(-2px);\\n        }\\n\\n        /* Forms */\\n        .form-container {\\n            background: white;\\n            border-radius: 12px;\\n            padding: 40px;\\n            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);\\n            max-width: 500px;\\n            margin: 0 auto;\\n        }\\n\\n        .form-title {\\n            font-size: 28px;\\n            font-weight: 700;\\n            margin-bottom: 30px;\\n            color: #1a1a1a;\\n        }\\n\\n        .form-group {\\n            margin-bottom: 20px;\\n        }\\n\\n        .form-label {\\n            display: block;\\n            font-size: 14px;\\n            font-weight: 600;\\n            margin-bottom: 8px;\\n            color: #1a1a1a;\\n        }\\n\\n        .form-input,\\n        .form-select {\\n            width: 100%;\\n            padding: 12px 16px;\\n            border: 1px solid #e0e0e0;\\n            border-radius: 6px;\\n            font-size: 14px;\\n            font-family: 'Inter', sans-serif;\\n            transition: border-color 0.3s;\\n        }\\n\\n        .form-input:focus,\\n        .form-select:focus {\\n            outline: none;\\n            border-color: #1a1a1a;\\n            box-shadow: 0 0 0 3px rgba(26, 26, 26, 0.1);\\n        }\\n\\n        .form-back {\\n            text-align: center;\\n            margin-top: 20px;\\n        }\\n\\n        .form-back button {\\n            background: none;\\n            border: none;\\n            color: #666;\\n            cursor: pointer;\\n            font-size: 14px;\\n            text-decoration: underline;\\n            transition: color 0.3s;\\n        }\\n\\n        .form-back button:hover {\\n            color: #1a1a1a;\\n        }\\n\\n        /* Dashboard */\\n        .dashboard {\\n            background: white;\\n            border-radius: 12px;\\n            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);\\n            overflow: hidden;\\n        }\\n\\n        .tabs {\\n            display: flex;\\n            border-bottom: 1px solid #e0e0e0;\\n            background: #f8f9fa;\\n        }\\n\\n        .tab {\\n            flex: 1;\\n            padding: 18px 24px;\\n            border: none;\\n            background: none;\\n            cursor: pointer;\\n            font-size: 14px;\\n            font-weight: 600;\\n            color: #666;\\n            transition: all 0.3s;\\n            border-bottom: 3px solid transparent;\\n            position: relative;\\n        }\\n\\n        .tab:hover {\\n            background: white;\\n            color: #1a1a1a;\\n        }\\n\\n        .tab.active {\\n            background: white;\\n            color: #1a1a1a;\\n            border-bottom-color: #1a1a1a;\\n        }\\n\\n        .tab-content {\\n            padding: 40px;\\n        }\\n\\n        /* Tables */\\n        .table-wrapper {\\n            overflow-x: auto;\\n        }\\n\\n        table {\\n            width: 100%;\\n            border-collapse: collapse;\\n            font-size: 14px;\\n        }\\n\\n        thead {\\n            background: #f8f9fa;\\n            border-bottom: 2px solid #e0e0e0;\\n        }\\n\\n        th {\\n            padding: 16px;\\n            text-align: left;\\n            font-weight: 600;\\n            color: #1a1a1a;\\n        }\\n\\n        td {\\n            padding: 16px;\\n            border-bottom: 1px solid #e0e0e0;\\n            color: #333;\\n        }\\n\\n        tbody tr:hover {\\n            background: #f8f9fa;\\n        }\\n\\n        /* Status Badges */\\n        .badge {\\n            display: inline-block;\\n            padding: 6px 12px;\\n            border-radius: 20px;\\n            font-size: 12px;\\n            font-weight: 600;\\n            text-transform: uppercase;\\n            letter-spacing: 0.5px;\\n        }\\n\\n        .badge-submitted {\\n            background: #e3f2fd;\\n            color: #1565c0;\\n        }\\n\\n        .badge-approved {\\n            background: #e8f5e9;\\n            color: #2e7d32;\\n        }\\n\\n        .badge-rejected {\\n            background: #ffebee;\\n            color: #c62828;\\n        }\\n\\n        .badge-shipped {\\n            background: #fff3e0;\\n            color: #e65100;\\n        }\\n\\n        .badge-authenticated {\\n            background: #f3e5f5;\\n            color: #6a1b9a;\\n        }\\n\\n        .badge-consigned {\\n            background: #e0f2f1;\\n            color: #00695c;\\n        }\\n\\n        .badge-sold {\\n            background: #fce4ec;\\n            color: #ad1457;\\n        }\\n\\n        /* Shoe Form */\\n        .shoe-form {\\n            background: #f8f9fa;\\n            padding: 24px;\\n            border-radius: 8px;\\n            margin-bottom: 30px;\\n        }\\n\\n        .form-grid {\\n            display: grid;\\n            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));\\n            gap: 16px;\\n            margin-bottom: 16px;\\n        }\\n\\n        .shoe-list {\\n            margin-top: 30px;\\n        }\\n\\n        .shoe-item {\\n            background: white;\\n            border: 1px solid #e0e0e0;\\n            padding: 16px;\\n            border-radius: 8px;\\n            margin-bottom: 12px;\\n            display: flex;\\n            justify-content: space-between;\\n            align-items: center;\\n        }\\n\\n        .shoe-details {\\n            flex: 1;\\n        }\\n\\n        .shoe-model {\\n            font-weight: 600;\\n            color: #1a1a1a;\\n            margin-bottom: 4px;\\n        }\\n\\n        .shoe-meta {\\n            font-size: 13px;\\n            color: #666;\\n        }\\n\\n        .shoe-value {\\n            font-weight: 600;\\n            color: #2e7d32;\\n            margin-right: 20px;\\n        }\\n\\n        .remove-btn {\\n            background: #ffebee;\\n            color: #c62828;\\n            border: none;\\n            padding: 8px 16px;\\n            border-radius: 6px;\\n            cursor: pointer;\\n            font-size: 13px;\\n            font-weight: 600;\\n            transition: background 0.3s;\\n        }\\n\\n        .remove-btn:hover {\\n            background: #ffcdd2;\\n        }\\n\\n        /* MRN Styles */\\n        .mrn-container {\\n            background: white;\\n            border: 2px solid #1a1a1a;\\n            padding: 40px;\\n            margin-bottom: 30px;\\n            font-family: 'Courier New', monospace;\\n            font-size: 13px;\\n        }\\n\\n        .mrn-header {\\n            text-align: center;\\n            font-weight: 700;\\n            margin-bottom: 20px;\\n            font-size: 14px;\\n        }\\n\\n        .mrn-grid {\\n            display: grid;\\n            grid-template-columns: 1fr 1fr;\\n            gap: 30px;\\n            margin-bottom: 30px;\\n        }\\n\\n        .mrn-section {\\n            border: 1px solid #1a1a1a;\\n            padding: 16px;\\n        }\\n\\n        .mrn-label {\\n            font-weight: 700;\\n            margin-bottom: 8px;\\n        }\\n\\n        .mrn-field {\\n            margin-bottom: 12px;\\n            padding-bottom: 8px;\\n            border-bottom: 1px solid #1a1a1a;\\n            min-height: 20px;\\n        }\\n\\n        .warehouse-option {\\n            display: flex;\\n            align-items: center;\\n            margin-bottom: 8px;\\n        }\\n\\n        .warehouse-option input {\\n            margin-right: 8px;\\n        }\\n\\n        .warehouse-name {\\n            font-weight: 600;\\n        }\\n\\n        .mrn-table {\\n            width: 100%;\\n            border-collapse: collapse;\\n            margin-bottom: 20px;\\n        }\\n\\n        .mrn-table th,\\n        .mrn-table td {\\n            border: 1px solid #1a1a1a;\\n            padding: 8px;\\n            text-align: center;\\n            font-size: 12px;\\n        }\\n\\n        .mrn-table th {\\n            background: #f0f0f0;\\n            font-weight: 700;\\n        }\\n\\n        .mrn-table td {\\n            height: 24px;\\n        }\\n\\n        .mrn-total {\\n            font-weight: 700;\\n            background: #f0f0f0;\\n        }\\n\\n        .mrn-signature {\\n            margin-top: 30px;\\n            border-top: 1px solid #1a1a1a;\\n            padding-top: 20px;\\n        }\\n\\n        .signature-canvas {\\n            border: 1px solid #1a1a1a;\\n            display: block;\\n            margin: 20px 0;\\n            background: white;\\n            cursor: crosshair;\\n        }\\n\\n        .signature-buttons {\\n            display: flex;\\n            gap: 12px;\\n            margin-top: 16px;\\n        }\\n\\n        .toc-section {\\n            margin-top: 40px;\\n            page-break-before: always;\\n        }\\n\\n        .toc-title {\\n            font-weight: 700;\\n            margin-bottom: 20px;\\n        }\\n\\n        .toc-clause {\\n            margin-bottom: 16px;\\n        }\\n\\n        .toc-clause-number {\\n            font-weight: 700;\\n        }\\n\\n        .mrn-footer {\\n            margin-top: 30px;\\n            border-top: 1px solid #1a1a1a;\\n            padding-top: 20px;\\n            display: grid;\\n            grid-template-columns: 1fr 1fr;\\n            gap: 30px;\\n        }\\n\\n        /* Notifications */\\n        .notifications-list {\\n            max-width: 600px;\\n        }\\n\\n        .notification-item {\\n            background: white;\\n            border-left: 4px solid #1a1a1a;\\n            padding: 20px;\\n            margin-bottom: 16px;\\n            border-radius: 4px;\\n            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);\\n        }\\n\\n        .notification-title {\\n            font-weight: 600;\\n            color: #1a1a1a;\\n            margin-bottom: 8px;\\n        }\\n\\n        .notification-message {\\n            color: #666;\\n            margin-bottom: 8px;\\n            font-size: 14px;\\n        }\\n\\n        .notification-time {\\n            font-size: 12px;\\n            color: #999;\\n        }\\n\\n        /* Upload Area */\\n        .upload-area {\\n            border: 2px dashed #1a1a1a;\\n            border-radius: 8px;\\n            padding: 40px;\\n            text-align: center;\\n            cursor: pointer;\\n            transition: all 0.3s;\\n            margin-bottom: 30px;\\n        }\\n\\n        .upload-area:hover {\\n            background: #f8f9fa;\\n            border-color: #333;\\n        }\\n\\n        .upload-area.active {\\n            background: #f8f9fa;\\n            border-color: #1a1a1a;\\n        }\\n\\n        .upload-icon {\\n            font-size: 32px;\\n            margin-bottom: 12px;\\n        }\\n\\n        .upload-text {\\n            font-weight: 600;\\n            margin-bottom: 4px;\\n        }\\n\\n        .upload-hint {\\n            font-size: 13px;\\n            color: #666;\\n        }\\n\\n        /* Utility Classes */\\n        .mt-20 {\\n            margin-top: 20px;\\n        }\\n\\n        .mb-20 {\\n            margin-bottom: 20px;\\n        }\\n\\n        .text-center {\\n            text-align: center;\\n        }\\n\\n        .text-muted {\\n            color: #666;\\n        }\\n\\n        .loading {\\n            text-align: center;\\n            padding: 40px;\\n            color: #666;\\n        }\\n\\n        .error {\\n            background: #ffebee;\\n            color: #c62828;\\n            padding: 16px;\\n            border-radius: 6px;\\n            margin-bottom: 20px;\\n        }\\n\\n        .success {\\n            background: #e8f5e9;\\n            color: #2e7d32;\\n            padding: 16px;\\n            border-radius: 6px;\\n            margin-bottom: 20px;\\n        }\\n\\n        /* Responsive */\\n        @media (max-width: 768px) {\\n            .header-content {\\n                flex-direction: column;\\n                gap: 16px;\\n            }\\n\\n            .landing-logo {\\n                font-size: 48px;\\n            }\\n\\n            .landing-title {\\n                font-size: 32px;\\n            }\\n\\n            .button-group {\\n                flex-direction: column;\\n            }\\n\\n            .btn {\\n                width: 100%;\\n            }\\n\\n            .form-container {\\n                padding: 24px;\\n            }\\n\\n            .tab-content {\\n                padding: 20px;\\n            }\\n\\n            .mrn-grid {\\n                grid-template-columns: 1fr;\\n            }\\n\\n            .form-grid {\\n                grid-template-columns: 1fr;\\n            }\\n\\n            table {\\n                font-size: 12px;\\n            }\\n\\n            th, td {\\n                padding: 12px 8px;\\n            }\\n\\n            .shoe-item {\\n                flex-direction: column;\\n                align-items: flex-start;\\n            }\\n\\n            .shoe-value {\\n                margin-right: 0;\\n                margin-top: 12px;\\n            }\\n\\n            .mrn-footer {\\n                grid-template-columns: 1fr;\\n            }\\n        }\\n    </style>\\n</head>\\n<body>\\n    <div id=\\\"root\\\"></div>\\n\\n    <script type=\\\"text/babel\\\">\\n        const { useState, useEffect, useRef } = React;\\n        const { jsPDF } = window.jspdf;\\n\\n        // API Utility\\n        const apiCall = async (method, endpoint, data = null) => {\\n            try {\\n                const options = {\\n                    method,\\n                    headers: { 'Content-Type': 'application/json' }\\n                };\\n                if (data) options.body = JSON.stringify(data);\\n\\n                const response = await fetch(endpoint, options);\\n                if (response.ok) return await response.json();\\n            } catch (error) {\\n                console.log('API call failed, using localStorage fallback');\\n            }\\n            return null;\\n        };\\n\\n        // Notification Manager\\n        const NotificationManager = {\\n            add: (message, type = 'info', title = 'Notification') => {\\n                const notifications = JSON.parse(localStorage.getItem('cdc_synced_notifications') || '[]');\\n                notifications.unshift({\\n                    id: Date.now(),\\n                    title,\\n                    message,\\n                    type,\\n                    timestamp: new Date().toISOString()\\n                });\\n                localStorage.setItem('cdc_synced_notifications', JSON.stringify(notifications.slice(0, 50)));\\n                window.dispatchEvent(new Event('storagechange'));\\n            },\\n\\n            getAll: () => JSON.parse(localStorage.getItem('cdc_synced_notifications') || '[]'),\\n\\n            clear: () => {\\n                localStorage.removeItem('cdc_synced_notifications');\\n                window.dispatchEvent(new Event('storagechange'));\\n            }\\n        };\\n\\n        // Signature Canvas\\n        function SignatureCanvas({ onSign, onClear }) {\\n            const canvasRef = useRef(null);\\n            const [isDrawing, setIsDrawing] = useState(false);\\n\\n            useEffect(() => {\\n                const canvas = canvasRef.current;\\n                canvas.width = canvas.offsetWidth;\\n                canvas.height = 150;\\n                const ctx = canvas.getContext('2d');\\n                ctx.fillStyle = 'white';\\n                ctx.fillRect(0, 0, canvas.width, canvas.height);\\n                ctx.strokeStyle = '#000';\\n                ctx.lineWidth = 2;\\n            }, []);\\n\\n            const startDrawing = (e) => {\\n                setIsDrawing(true);\\n                const { offsetX, offsetY } = e.nativeEvent;\\n                const ctx = canvasRef.current.getContext('2d');\\n                ctx.beginPath();\\n                ctx.moveTo(offsetX, offsetY);\\n            };\\n\\n            const draw = (e) => {\\n                if (!isDrawing) return;\\n                const { offsetX, offsetY } = e.nativeEvent;\\n                const ctx = canvasRef.current.getContext('2d');\\n                ctx.lineTo(offsetX, offsetY);\\n                ctx.stroke();\\n            };\\n\\n            const stopDrawing = () => setIsDrawing(false);\\n\\n            const clearCanvas = () => {\\n                const canvas = canvasRef.current;\\n                const ctx = canvas.getContext('2d');\\n                ctx.fillStyle = 'white';\\n                ctx.fillRect(0, 0, canvas.width, canvas.height);\\n                onClear();\\n            };\\n\\n            const submitSignature = () => {\\n                const signatureImage = canvasRef.current.toDataURL('image/png');\\n                onSign(signatureImage);\\n            };\\n\\n            return (\\n                <div className=\\\"mrn-signature\\\">\\n                    <div>Signature of Vendor:</div>\\n                    <canvas\\n                        ref={canvasRef}\\n                        className=\\\"signature-canvas\\\"\\n                        onMouseDown={startDrawing}\\n                        onMouseMove={draw}\\n                        onMouseUp={stopDrawing}\\n                        onMouseLeave={stopDrawing}\\n                    />\\n                    <div className=\\\"signature-buttons\\\">\\n                        <button className=\\\"btn btn-primary\\\" onClick={submitSignature}>\\n                            Submit Signature\\n                        </button>\\n                        <button className=\\\"btn btn-secondary\\\" onClick={clearCanvas}>\\n                            Clear\\n                        </button>\\n                    </div>\\n                </div>\\n            );\\n        }\\n\\n        // MRN Component\\n        function MRNDisplay({ mrn, onSign }) {\\n            const [signatureImage, setSignatureImage] = useState(null);\\n            const [showTOC, setShowTOC] = useState(false);\\n\\n            const handleSign = (image) => {\\n                setSignatureImage(image);\\n                NotificationManager.add('Signature captured. Click Submit to generate PDF.', 'success', 'Signature Ready');\\n            };\\n\\n            const generateAndDownloadPDF = async () => {\\n                const doc = new jsPDF({\\n                    orientation: 'portrait',\\n                    unit: 'mm',\\n                    format: 'a4'\\n                });\\n\\n                const pageWidth = doc.internal.pageSize.getWidth();\\n                const pageHeight = doc.internal.pageSize.getHeight();\\n                const margin = 10;\\n                let yPosition = margin;\\n\\n                // Header\\n                doc.setFontSize(14);\\n                doc.setFont(undefined, 'bold');\\n                doc.text('MATERIAL RECEIPT NOTE (MRN)', pageWidth / 2, yPosition, { align: 'center' });\\n                yPosition += 15;\\n\\n                // Vendor Info & Warehouses Grid\\n                doc.setFontSize(10);\\n                const colWidth = (pageWidth - 2 * margin) / 2;\\n\\n                // Vendor Section\\n                doc.rect(margin, yPosition, colWidth - 5, 50);\\n                doc.setFont(undefined, 'bold');\\n                doc.text('VENDOR INFORMATION', margin + 5, yPosition + 5);\\n                doc.setFont(undefined, 'normal');\\n                let vendorY = yPosition + 12;\\n                doc.text(`Name: ${mrn.vendorName}`, margin + 5, vendorY);\\n                vendorY += 6;\\n                doc.text(`Contact: ${mrn.vendorPhone}`, margin + 5, vendorY);\\n                vendorY += 6;\\n                doc.text(`Email: ${mrn.vendorEmail}`, margin + 5, vendorY);\\n                vendorY += 6;\\n                doc.text(`PAN: ${mrn.vendorPAN}`, margin + 5, vendorY);\\n                vendorY += 6;\\n                doc.text(`Address: ${mrn.vendorAddress || 'N/A'}`, margin + 5, vendorY);\\n\\n                // Warehouses Section\\n                doc.rect(margin + colWidth, yPosition, colWidth - 5, 50);\\n                doc.setFont(undefined, 'bold');\\n                doc.text('WAREHOUSE', margin + colWidth + 5, yPosition + 5);\\n                doc.setFont(undefined, 'normal');\\n\\n                const warehouses = [\\n                    { name: 'Delhi', address: 'C-35, Ground floor, Sector-2, Noida, UP-201301' },\\n                    { name: 'Mumbai', address: 'Shop no.3, Galleria Market, Sector-28, Kharghar, Navi Mumbai' },\\n                    { name: 'Hyderabad', address: '2nd Floor, Above Bata Showroom, Kukatpally' }\\n                ];\\n\\n                let warehouseY = yPosition + 12;\\n                warehouses.forEach(wh => {\\n                    const isSelected = mrn.selectedWarehouse === wh.name;\\n                    doc.text(`${isSelected ? '✓' : '○'} ${wh.name}`, margin + colWidth + 5, warehouseY);\\n                    warehouseY += 5;\\n                });\\n\\n                yPosition += 55;\\n\\n                // Items Table\\n                doc.setFont(undefined, 'bold');\\n                doc.text('ITEMS DETAILS', margin, yPosition);\\n                yPosition += 8;\\n\\n                const tableHeaders = ['S.NO', 'SKU', 'ITEM DETAILS', 'SIZE(UK)', 'QTY', 'PAYOUT', 'TYPE'];\\n                const tableData = [];\\n\\n                mrn.items.forEach((item, idx) => {\\n                    tableData.push([\\n                        (idx + 1).toString(),\\n                        item.sku,\\n                        `${item.brand} ${item.model}`,\\n                        item.size,\\n                        '1',\\n                        `₹${item.payout}`,\\n                        item.type === 'cashout' ? 'CASHOUT' : 'CONSIGN'\\n                    ]);\\n                });\\n\\n                // Add empty rows\\n                while (tableData.length < 10) {\\n                    tableData.push(['', '', '', '', '', '', '']);\\n                }\\n\\n                doc.autoTable({\\n                    head: [tableHeaders],\\n                    body: tableData,\\n                    startY: yPosition,\\n                    margin: margin,\\n                    theme: 'grid',\\n                    styles: { fontSize: 8, cellPadding: 3 },\\n                    headStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold' },\\n                    didDrawPage: function(data) {\\n                        yPosition = data.lastAutoTable.finalY + 5;\\n                    }\\n                });\\n\\n                yPosition = doc.lastAutoTable.finalY + 5;\\n\\n                // Total Row\\n                doc.setFont(undefined, 'bold');\\n                const totalPayout = mrn.items.reduce((sum, item) => sum + parseInt(item.payout || 0), 0);\\n                doc.text(`TOTAL PAYOUT: ₹${totalPayout}`, margin, yPosition);\\n                yPosition += 12;\\n\\n                // Signature Section\\n                if (signatureImage) {\\n                    doc.text('Vendor Signature:', margin, yPosition);\\n                    yPosition += 8;\\n                    doc.addImage(signatureImage, 'PNG', margin, yPosition, 40, 30);\\n                    yPosition += 35;\\n                }\\n\\n                // New Page for T&C\\n                doc.addPage();\\n                yPosition = margin;\\n\\n                doc.setFontSize(12);\\n                doc.setFont(undefined, 'bold');\\n                doc.text('TERMS & CONDITIONS', margin, yPosition);\\n                yPosition += 10;\\n\\n                const clauses = [\\n                    ['Authenticity & Ownership', 'Vendor warrants that all products are authentic and legally owned.'],\\n                    ['Compliance with Laws', 'All products comply with applicable laws and regulations.'],\\n                    ['Return of Unsold Products', 'CDC will return unsold products within agreed timeline.'],\\n                    ['Payout & Terms', 'Payment terms are as per mutually agreed schedule.'],\\n                    ['Liability', 'CDC is not liable for damage post-receipt at warehouse.'],\\n                    ['Indemnity', 'Vendor indemnifies CDC against third-party claims.'],\\n                    ['Confidentiality', 'Both parties maintain confidentiality of business information.'],\\n                    ['Intellectual Property', 'All IP rights remain with respective owners.'],\\n                    ['Dispute Resolution', 'Disputes resolved through arbitration.'],\\n                    ['Governing Law', 'Agreement governed by laws of India.']\\n                ];\\n\\n                doc.setFontSize(9);\\n                clauses.forEach((clause, idx) => {\\n                    if (yPosition > pageHeight - 20) {\\n                        doc.addPage();\\n                        yPosition = margin;\\n                    }\\n                    doc.setFont(undefined, 'bold');\\n                    doc.text(`${idx + 1}. ${clause[0]}`, margin, yPosition);\\n                    yPosition += 5;\\n                    doc.setFont(undefined, 'normal');\\n                    const lines = doc.splitTextToSize(clause[1], pageWidth - 2 * margin);\\n                    doc.text(lines, margin, yPosition);\\n                    yPosition += lines.length * 5 + 5;\\n                });\\n\\n                // Try upload to server, fallback to download\\n                const pdfBlob = doc.output('blob');\\n                const formData = new FormData();\\n                formData.append('file', pdfBlob, `MRN_${mrn.mrnNumber}.pdf`);\\n                formData.append('mrnNumber', mrn.mrnNumber);\\n                formData.append('vendorId', mrn.vendorId);\\n\\n                try {\\n                    const uploadResponse = await fetch('/api/drive/mrn-upload', {\\n                        method: 'POST',\\n                        body: formData\\n                    });\\n                    if (uploadResponse.ok) {\\n                        NotificationManager.add('MRN PDF uploaded successfully!', 'success', 'Upload Complete');\\n                    } else {\\n                        throw new Error('Upload failed');\\n                    }\\n                } catch (error) {\\n                    doc.save(`MRN_${mrn.mrnNumber}.pdf`);\\n                    NotificationManager.add('MRN PDF downloaded (server offline)', 'info', 'Download Complete');\\n                }\\n            };\\n\\n            return (\\n                <div className=\\\"mrn-container\\\">\\n                    <div className=\\\"mrn-header\\\">MATERIAL RECEIPT NOTE</div>\\n                    <div className=\\\"mrn-header\\\" style={{ fontSize: '12px', marginBottom: '30px' }}>\\n                        MRN #: {mrn.mrnNumber}\\n                    </div>\\n\\n                    <div className=\\\"mrn-grid\\\">\\n                        <div className=\\\"mrn-section\\\">\\n                            <div className=\\\"mrn-label\\\">VENDOR INFORMATION</div>\\n                            <div className=\\\"mrn-field\\\">\\n                                <div>Name:</div>\\n                                <div style={{ borderBottom: '1px solid #1a1a1a', paddingBottom: '4px' }}>\\n                                    {mrn.vendorName}\\n                                </div>\\n                            </div>\\n                            <div className=\\\"mrn-field\\\">\\n                                <div>Contact No.:</div>\\n                                <div style={{ borderBottom: '1px solid #1a1a1a', paddingBottom: '4px' }}>\\n                                    {mrn.vendorPhone}\\n                                </div>\\n                            </div>\\n                            <div className=\\\"mrn-field\\\">\\n                                <div>Email ID:</div>\\n                                <div style={{ borderBottom: '1px solid #1a1a1a', paddingBottom: '4px' }}>\\n                                    {mrn.vendorEmail}\\n                                </div>\\n                            </div>\\n                            <div className=\\\"mrn-field\\\">\\n                                <div>PAN NO.:</div>\\n                                <div style={{ borderBottom: '1px solid #1a1a1a', paddingBottom: '4px' }}>\\n                                    {mrn.vendorPAN}\\n                                </div>\\n                            </div>\\n                            <div className=\\\"mrn-field\\\">\\n                                <div>Address:</div>\\n                                <div style={{ borderBottom: '1px solid #1a1a1a', paddingBottom: '4px' }}>\\n                                    {mrn.vendorAddress || 'Not provided'}\\n                                </div>\\n                            </div>\\n                        </div>\\n\\n                        <div className=\\\"mrn-section\\\">\\n                            <div className=\\\"mrn-label\\\">SELECT WAREHOUSE</div>\\n                            <div className=\\\"warehouse-option\\\">\\n                                <input\\n                                    type=\\\"radio\\\"\\n                                    name=\\\"warehouse\\\"\\n                                    checked={mrn.selectedWarehouse === 'Delhi'}\\n                                    readOnly\\n                                />\\n                                <div>\\n                                    <div className=\\\"warehouse-name\\\">Delhi</div>\\n                                    <div style={{ fontSize: '11px' }}>\\n                                        C-35, Ground floor, Sector-2, Noida, UP-201301\\n                                    </div>\\n                                </div>\\n                            </div>\\n                            <div className=\\\"warehouse-option\\\">\\n                                <input\\n                                    type=\\\"radio\\\"\\n                                    name=\\\"warehouse\\\"\\n                                    checked={mrn.selectedWarehouse === 'Mumbai'}\\n                                    readOnly\\n                                />\\n                                <div>\\n                                    <div className=\\\"warehouse-name\\\">Mumbai</div>\\n                                    <div style={{ fontSize: '11px' }}>\\n                                        Shop no.3, Galleria Market, Sector-28, Kharghar, Navi Mumbai, Maharashtra-410210\\n                                    </div>\\n                                </div>\\n                            </div>\\n                            <div className=\\\"warehouse-option\\\">\\n                                <input\\n                                    type=\\\"radio\\\"\\n                                    name=\\\"warehouse\\\"\\n                                    checked={mrn.selectedWarehouse === 'Hyderabad'}\\n                                    readOnly\\n                                />\\n                                <div>\\n                                    <div className=\\\"warehouse-name\\\">Hyderabad</div>\\n                                    <div style={{ fontSize: '11px' }}>\\n                                        2nd Floor, Above Bata Showroom, Kukatpally, Hyderabad-500072\\n                                    </div>\\n                                </div>\\n                            </div>\\n                        </div>\\n                    </div>\\n\\n                    <div className=\\\"mrn-label\\\" style={{ marginTop: '20px' }}>ITEMS DETAILS</div>\\n                    <table className=\\\"mrn-table\\\">\\n                        <thead>\\n                            <tr>\\n                                <th>S.NO</th>\\n                                <th>SKU</th>\\n                                <th>ITEMS DETAILS</th>\\n                                <th>SIZE(UK)</th>\\n                                <th>QTY</th>\\n                                <th>PAYOUT</th>\\n                                <th>CONSIGN/CASHOUT</th>\\n                            </tr>\\n                        </thead>\\n                        <tbody>\\n                            {mrn.items.map((item, idx) => (\\n                                <tr key={idx}>\\n                                    <td>{idx + 1}</td>\\n                                    <td>{item.sku}</td>\\n                                    <td>{item.brand} {item.model}</td>\\n                                    <td>{item.size}</td>\\n                                    <td>1</td>\\n                                    <td>₹{item.payout}</td>\\n                                    <td>{item.type === 'cashout' ? 'CASHOUT' : 'CONSIGN'}</td>\\n                                </tr>\\n                            ))}\\n                            {Array.from({ length: Math.max(0, 15 - mrn.items.length) }).map((_, idx) => (\\n                                <tr key={`empty-${idx}`}>\\n                                    <td>&nbsp;</td>\\n                                    <td>&nbsp;</td>\\n                                    <td>&nbsp;</td>\\n                                    <td>&nbsp;</td>\\n                                    <td>&nbsp;</td>\\n                                    <td>&nbsp;</td>\\n                                    <td>&nbsp;</td>\\n                                </tr>\\n                            ))}\\n                            <tr className=\\\"mrn-total\\\">\\n                                <td colSpan=\\\"5\\\">TOTAL</td>\\n                                <td>₹{mrn.items.reduce((sum, item) => sum + parseInt(item.payout || 0), 0)}</td>\\n                                <td>&nbsp;</td>\\n                            </tr>\\n                        </tbody>\\n                    </table>\\n\\n                    <div className=\\\"mrn-footer\\\">\\n                        <div>\\n                            <div className=\\\"mrn-label\\\">DEAL CLOSED WITH (CDC EMPLOYEE)</div>\\n                            <div className=\\\"mrn-field\\\" style={{ minHeight: '30px' }}>&nbsp;</div>\\n                        </div>\\n                        <div>\\n                            <div className=\\\"mrn-label\\\">FOR CDC USE ONLY</div>\\n                            <div className=\\\"mrn-field\\\" style={{ minHeight: '30px' }}>&nbsp;</div>\\n                        </div>\\n                    </div>\\n\\n                    {!signatureImage ? (\\n                        <SignatureCanvas\\n                            onSign={handleSign}\\n                            onClear={() => setSignatureImage(null)}\\n                        />\\n                    ) : (\\n                        <div className=\\\"mrn-signature\\\">\\n                            <div>Signature of Vendor:</div>\\n                            <img\\n                                src={signatureImage}\\n                                style={{\\n                                    border: '1px solid #1a1a1a',\\n                                    maxWidth: '150px',\\n                                    marginTop: '10px',\\n                                    marginBottom: '20px'\\n                                }}\\n                                alt=\\\"Vendor Signature\\\"\\n                            />\\n                            <div className=\\\"signature-buttons\\\">\\n                                <button className=\\\"btn btn-primary\\\" onClick={generateAndDownloadPDF}>\\n                                    Generate & Download PDF\\n                                </button>\\n                                <button className=\\\"btn btn-secondary\\\" onClick={() => setSignatureImage(null)}>\\n                                    Draw Again\\n                                </button>\\n                            </div>\\n                        </div>\\n                    )}\\n\\n                    <div style={{ marginTop: '30px', borderTop: '1px solid #1a1a1a', paddingTop: '20px' }}>\\n                        <div className=\\\"mrn-label\\\">TERMS & CONDITIONS</div>\\n                        <button\\n                            className=\\\"btn btn-secondary\\\"\\n                            onClick={() => setShowTOC(!showTOC)}\\n                            style={{ marginTop: '10px' }}\\n                        >\\n                            {showTOC ? 'Hide' : 'Show'} Terms & Conditions\\n                        </button>\\n\\n                        {showTOC && (\\n                            <div className=\\\"toc-section\\\">\\n                                {[\\n                                    {\\n                                        title: 'Authenticity & Ownership',\\n                                        text: 'The vendor warrants that all products submitted are authentic and legally owned by the vendor. CDC will not be liable for any authenticity disputes post-acceptance.'\\n                                    },\\n                                    {\\n                                        title: 'Compliance with Laws',\\n                                        text: 'All products must comply with applicable federal, state, and local laws and regulations. Vendor is responsible for ensuring legal compliance.'\\n                                    },\\n                                    {\\n                                        title: 'Return of Unsold Products',\\n                                        text: 'CDC will return all unsold products to the vendor within 60 days of request. Vendor must cover return shipping costs.'\\n                                    },\\n                                    {\\n                                        title: 'Payout & Terms',\\n                                        text: 'Payment will be processed within 30 days of product sale. Consignment items will be paid upon sale; cashout items paid immediately upon receipt.'\\n                                    },\\n                                    {\\n                                        title: 'Liability Limitations',\\n                                        text: 'CDC is not liable for damage, loss, or theft of products after receipt at warehouse. Insurance recommendations available upon request.'\\n                                    },\\n                                    {\\n                                        title: 'Indemnification',\\n                                        text: 'Vendor indemnifies CDC against any third-party claims, including trademark or intellectual property claims.'\\n                                    },\\n                                    {\\n                                        title: 'Confidentiality',\\n                                        text: 'Both parties maintain strict confidentiality regarding business information, pricing, and customer data shared during partnership.'\\n                                    },\\n                                    {\\n                                        title: 'Intellectual Property Rights',\\n                                        text: 'All intellectual property rights remain with their respective owners. CDC may use product images for catalog purposes only.'\\n                                    },\\n                                    {\\n                                        title: 'Dispute Resolution',\\n                                        text: 'Disputes will be resolved through mediation and binding arbitration under Indian Arbitration and Conciliation Act, 1996.'\\n                                    },\\n                                    {\\n                                        title: 'Governing Law',\\n                                        text: 'This agreement is governed by and construed in accordance with the laws of India, without regard to conflicts of law.'\\n                                    }\\n                                ].map((clause, idx) => (\\n                                    <div key={idx} className=\\\"toc-clause\\\">\\n                                        <span className=\\\"toc-clause-number\\\">{idx + 1}. {clause.title}</span>\\n                                        <p style={{ marginTop: '8px', marginBottom: '16px', color: '#666' }}>\\n                                            {clause.text}\\n                                        </p>\\n                                    </div>\\n                                ))}\\n                            </div>\\n                        )}\\n                    </div>\\n                </div>\\n            );\\n        }\\n\\n        // Main App Component\\n        function App() {\\n            const [appState, setAppState] = useState('landing'); // landing, register, login, dashboard\\n            const [session, setSession] = useState(null);\\n            const [shoes, setShoes] = useState([]);\\n            const [mrns, setMRNs] = useState([]);\\n            const [notifications, setNotifications] = useState([]);\\n            const [activeTab, setActiveTab] = useState('submit');\\n            const [message, setMessage] = useState({ type: '', text: '' });\\n\\n            // Check session on load\\n            useEffect(() => {\\n                const savedSession = localStorage.getItem('cdc_vendor_session');\\n                if (savedSession) {\\n                    const sessionData = JSON.parse(savedSession);\\n                    setSession(sessionData);\\n                    setAppState('dashboard');\\n                    loadVendorData(sessionData.id);\\n                }\\n            }, []);\\n\\n            // Real-time sync\\n            useEffect(() => {\\n                const handleStorageChange = () => {\\n                    if (appState === 'dashboard') {\\n                        loadVendorData(session?.id);\\n                    }\\n                };\\n\\n                window.addEventListener('storage', handleStorageChange);\\n                window.addEventListener('storagechange', handleStorageChange);\\n\\n                const pollInterval = setInterval(handleStorageChange, 5000);\\n\\n                return () => {\\n                    window.removeEventListener('storage', handleStorageChange);\\n                    window.removeEventListener('storagechange', handleStorageChange);\\n                    clearInterval(pollInterval);\\n                };\\n            }, [appState, session?.id]);\\n\\n            const loadVendorData = (vendorId) => {\\n                // Load shoes\\n                const vendorShoes = JSON.parse(localStorage.getItem(`cdc_vendor_shoes_${vendorId}`) || '[]');\\n                setShoes(vendorShoes);\\n\\n                // Load MRNs\\n                const vendorMRNs = JSON.parse(localStorage.getItem(`cdc_vendor_mrns_${vendorId}`) || '[]');\\n                setMRNs(vendorMRNs);\\n\\n                // Load notifications\\n                const vendorNotifications = NotificationManager.getAll();\\n                setNotifications(vendorNotifications);\\n            };\\n\\n            const showMessage = (text, type = 'success') => {\\n                setMessage({ type, text });\\n                setTimeout(() => setMessage({ type: '', text: '' }), 4000);\\n            };\\n\\n            // Register\\n            const handleRegister = async (formData) => {\\n                const vendors = JSON.parse(localStorage.getItem('cdc_registered_vendors') || '[]');\\n\\n                if (vendors.some(v => v.email === formData.email)) {\\n                    showMessage('Email already registered', 'error');\\n                    return;\\n                }\\n\\n                const newVendor = {\\n                    id: `v-${Date.now()}`,\\n                    name: formData.businessName,\\n                    contactPerson: formData.contactPerson,\\n                    email: formData.email,\\n                    phone: formData.phone,\\n                    password: formData.password,\\n                    gst: formData.gst,\\n                    pan: formData.pan,\\n                    registeredAt: new Date().toISOString()\\n                };\\n\\n                vendors.push(newVendor);\\n                localStorage.setItem('cdc_registered_vendors', JSON.stringify(vendors));\\n\\n                setSession(newVendor);\\n                localStorage.setItem('cdc_vendor_session', JSON.stringify(newVendor));\\n                setAppState('dashboard');\\n                loadVendorData(newVendor.id);\\n                showMessage('Registration successful! Welcome to CDC.', 'success');\\n                NotificationManager.add('Welcome to Crep Dog Crew!', 'success', 'Registration Complete');\\n            };\\n\\n            // Login\\n            const handleLogin = async (email, password) => {\\n                const vendors = JSON.parse(localStorage.getItem('cdc_registered_vendors') || '[]');\\n                const demoVendor = {\\n                    id: 'v-demo-001',\\n                    name: 'Rahul Sneaker Co.',\\n                    email: 'rahul@sneakers.in',\\n                    password: 'demo1234',\\n                    gst: '27AABCU9603R1ZM',\\n                    pan: 'AABCU9603R'\\n                };\\n\\n                let vendor = vendors.find(v => v.email === email && v.password === password);\\n                if (!vendor) {\\n                    vendor = demoVendor.email === email && demoVendor.password === password ? demoVendor : null;\\n                }\\n\\n                if (!vendor) {\\n                    showMessage('Invalid email or password', 'error');\\n                    return;\\n                }\\n\\n                setSession(vendor);\\n                localStorage.setItem('cdc_vendor_session', JSON.stringify(vendor));\\n                setAppState('dashboard');\\n                loadVendorData(vendor.id);\\n                showMessage('Login successful!', 'success');\\n                NotificationManager.add(`Welcome back, ${vendor.name}!`, 'success', 'Login');\\n            };\\n\\n            // Logout\\n            const handleLogout = () => {\\n                localStorage.removeItem('cdc_vendor_session');\\n                setSession(null);\\n                setAppState('landing');\\n                setShoes([]);\\n                setMRNs([]);\\n                showMessage('Logged out successfully', 'success');\\n            };\\n\\n            // Add shoe\\n            const addShoe = (shoeData) => {\\n                const newShoes = [...shoes, { ...shoeData, id: Date.now(), status: 'submitted' }];\\n                setShoes(newShoes);\\n                localStorage.setItem(`cdc_vendor_shoes_${session.id}`, JSON.stringify(newShoes));\\n                showMessage('Shoe added to batch!', 'success');\\n            };\\n\\n            // Remove shoe\\n            const removeShoe = (shoeId) => {\\n                const newShoes = shoes.filter(s => s.id !== shoeId);\\n                setShoes(newShoes);\\n                localStorage.setItem(`cdc_vendor_shoes_${session.id}`, JSON.stringify(newShoes));\\n                showMessage('Shoe removed from batch', 'success');\\n            };\\n\\n            // Submit batch\\n            const submitBatch = () => {\\n                if (shoes.length === 0) {\\n                    showMessage('Add at least one shoe to submit', 'error');\\n                    return;\\n                }\\n\\n                const batchId = `BATCH-${Date.now()}`;\\n                const submittedShoes = shoes.map(s => ({ ...s, status: 'submitted' }));\\n                setShoes(submittedShoes);\\n                localStorage.setItem(`cdc_vendor_shoes_${session.id}`, JSON.stringify(submittedShoes));\\n                showMessage(`Batch ${batchId} submitted successfully!`, 'success');\\n                NotificationManager.add(`Your batch ${batchId} with ${shoes.length} items has been submitted for review.`, 'success', 'Batch Submitted');\\n            };\\n\\n            // Handle Excel upload\\n            const handleExcelUpload = (file) => {\\n                const reader = new FileReader();\\n                reader.onload = (e) => {\\n                    try {\\n                        const data = new Uint8Array(e.target.result);\\n                        const workbook = XLSX.read(data, { type: 'array' });\\n                        const sheet = workbook.Sheets[workbook.SheetNames[0]];\\n                        const rows = XLSX.utils.sheet_to_json(sheet);\\n\\n                        rows.forEach(row => {\\n                            if (row.brand && row.model) {\\n                                addShoe({\\n                                    brand: row.brand,\\n                                    model: row.model,\\n                                    sku: row.sku || '',\\n                                    size: row.size || 'UK 6',\\n                                    condition: row.condition || 'New',\\n                                    payout: row.payout || '0',\\n                                    type: row.type === 'consignment' ? 'consignment' : 'cashout'\\n                                });\\n                            }\\n                        });\\n\\n                        showMessage(`Uploaded ${rows.length} shoes from Excel`, 'success');\\n                    } catch (error) {\\n                        showMessage('Error processing Excel file', 'error');\\n                    }\\n                };\\n                reader.readAsArrayBuffer(file);\\n            };\\n\\n            if (appState === 'landing') {\\n                return <LandingPage onLogin={() => setAppState('login')} onRegister={() => setAppState('register')} />;\\n            }\\n\\n            if (appState === 'register') {\\n                return <RegisterForm onSubmit={handleRegister} onBack={() => setAppState('landing')} />;\\n            }\\n\\n            if (appState === 'login') {\\n                return <LoginForm onSubmit={handleLogin} onBack={() => setAppState('landing')} />;\\n            }\\n\\n            if (appState === 'dashboard' && session) {\\n                return (\\n                    <Dashboard\\n                        session={session}\\n                        onLogout={handleLogout}\\n                        shoes={shoes}\\n                        mrns={mrns}\\n                        notifications={notifications}\\n                        onAddShoe={addShoe}\\n                        onRemoveShoe={removeShoe}\\n                        onSubmitBatch={submitBatch}\\n                        onExcelUpload={handleExcelUpload}\\n                        message={message}\\n                        showMessage={showMessage}\\n                    />\\n                );\\n            }\\n\\n            return null;\\n        }\\n\\n        // Landing Page\\n        function LandingPage({ onLogin, onRegister }) {\\n            return (\\n                <div className=\\\"landing\\\">\\n                    <div className=\\\"landing-content\\\">\\n                        <div className=\\\"landing-logo\\\">CDC</div>\\n                        <h1 className=\\\"landing-title\\\">CREP DOG CREW</h1>\\n                        <p className=\\\"landing-subtitle\\\">Premium Sneaker Vendor Partnership Portal</p>\\n                        <div className=\\\"button-group\\\">\\n                            <button className=\\\"btn btn-primary\\\" onClick={onLogin}>\\n                                Vendor Login\\n                            </button>\\n                            <button className=\\\"btn btn-secondary\\\" onClick={onRegister}>\\n                                Register as Vendor\\n                            </button>\\n                        </div>\\n                    </div>\\n                </div>\\n            );\\n        }\\n\\n        // Register Form\\n        function RegisterForm({ onSubmit, onBack }) {\\n            const [formData, setFormData] = useState({\\n                businessName: '',\\n                contactPerson: '',\\n                email: '',\\n                phone: '',\\n                password: '',\\n                gst: '',\\n                pan: ''\\n            });\\n\\n            const handleChange = (e) => {\\n                setFormData({ ...formData, [e.target.name]: e.target.value });\\n            };\\n\\n            const handleSubmit = (e) => {\\n                e.preventDefault();\\n                if (!formData.businessName || !formData.email || !formData.password) {\\n                    alert('Please fill all required fields');\\n                    return;\\n                }\\n                onSubmit(formData);\\n            };\\n\\n            return (\\n                <div className=\\\"main\\\">\\n                    <div className=\\\"container\\\">\\n                        <form className=\\\"form-container\\\" onSubmit={handleSubmit}>\\n                            <h2 className=\\\"form-title\\\">Register as Vendor</h2>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">Business Name *</label>\\n                                <input\\n                                    type=\\\"text\\\"\\n                                    name=\\\"businessName\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={formData.businessName}\\n                                    onChange={handleChange}\\n                                    required\\n                                />\\n                            </div>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">Contact Person</label>\\n                                <input\\n                                    type=\\\"text\\\"\\n                                    name=\\\"contactPerson\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={formData.contactPerson}\\n                                    onChange={handleChange}\\n                                />\\n                            </div>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">Email *</label>\\n                                <input\\n                                    type=\\\"email\\\"\\n                                    name=\\\"email\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={formData.email}\\n                                    onChange={handleChange}\\n                                    required\\n                                />\\n                            </div>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">Phone</label>\\n                                <input\\n                                    type=\\\"tel\\\"\\n                                    name=\\\"phone\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={formData.phone}\\n                                    onChange={handleChange}\\n                                />\\n                            </div>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">Password *</label>\\n                                <input\\n                                    type=\\\"password\\\"\\n                                    name=\\\"password\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={formData.password}\\n                                    onChange={handleChange}\\n                                    required\\n                                />\\n                            </div>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">GST Number</label>\\n                                <input\\n                                    type=\\\"text\\\"\\n                                    name=\\\"gst\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={formData.gst}\\n                                    onChange={handleChange}\\n                                    placeholder=\\\"27AABCU9603R1ZM\\\"\\n                                />\\n                            </div>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">PAN Number</label>\\n                                <input\\n                                    type=\\\"text\\\"\\n                                    name=\\\"pan\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={formData.pan}\\n                                    onChange={handleChange}\\n                                    placeholder=\\\"AABCU9603R\\\"\\n                                />\\n                            </div>\\n\\n                            <button type=\\\"submit\\\" className=\\\"btn btn-primary\\\" style={{ width: '100%' }}>\\n                                Create Account\\n                            </button>\\n\\n                            <div className=\\\"form-back\\\">\\n                                <button type=\\\"button\\\" onClick={onBack}>\\n                                    Back to Login\\n                                </button>\\n                            </div>\\n                        </form>\\n                    </div>\\n                </div>\\n            );\\n        }\\n\\n        // Login Form\\n        function LoginForm({ onSubmit, onBack }) {\\n            const [email, setEmail] = useState('');\\n            const [password, setPassword] = useState('');\\n\\n            const handleSubmit = (e) => {\\n                e.preventDefault();\\n                onSubmit(email, password);\\n            };\\n\\n            return (\\n                <div className=\\\"main\\\">\\n                    <div className=\\\"container\\\">\\n                        <form className=\\\"form-container\\\" onSubmit={handleSubmit}>\\n                            <h2 className=\\\"form-title\\\">Vendor Login</h2>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">Email</label>\\n                                <input\\n                                    type=\\\"email\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={email}\\n                                    onChange={(e) => setEmail(e.target.value)}\\n                                    required\\n                                />\\n                            </div>\\n\\n                            <div className=\\\"form-group\\\">\\n                                <label className=\\\"form-label\\\">Password</label>\\n                                <input\\n                                    type=\\\"password\\\"\\n                                    className=\\\"form-input\\\"\\n                                    value={password}\\n                                    onChange={(e) => setPassword(e.target.value)}\\n                                    required\\n                                />\\n                            </div>\\n\\n                            <button type=\\\"submit\\\" className=\\\"btn btn-primary\\\" style={{ width: '100%' }}>\\n                                Login\\n                            </button>\\n\\n                            <div className=\\\"form-back\\\">\\n                                <button type=\\\"button\\\" onClick={onBack}>\\n                                    Back\\n                                </button>\\n                            </div>\\n\\n                            <div style={{ marginTop: '20px', padding: '16px', background: '#f0f0f0', borderRadius: '6px', fontSize: '12px' }}>\\n                                <strong>Demo Account:</strong><br />\\n                                Email: rahul@sneakers.in<br />\\n                                Password: demo1234\\n                            </div>\\n                        </form>\\n                    </div>\\n                </div>\\n            );\\n        }\\n\\n        // Dashboard\\n        function Dashboard({\\n            session,\\n            onLogout,\\n            shoes,\\n            mrns,\\n            notifications,\\n            onAddShoe,\\n            onRemoveShoe,\\n            onSubmitBatch,\\n            onExcelUpload,\\n            message,\\n            showMessage\\n        }) {\\n            const [activeTab, setActiveTab] = useState('submit');\\n            const [newShoe, setNewShoe] = useState({\\n                brand: '',\\n                model: '',\\n                sku: '',\\n                size: 'UK 6',\\n                condition: 'New',\\n                payout: '',\\n                type: 'cashout'\\n            });\\n\\n            const handleAddShoe = (e) => {\\n                e.preventDefault();\\n                if (!newShoe.brand || !newShoe.model || !newShoe.payout) {\\n                    showMessage('Please fill brand, model, and payout', 'error');\\n                    return;\\n                }\\n                onAddShoe(newShoe);\\n                setNewShoe({\\n                    brand: '',\\n                    model: '',\\n                    sku: '',\\n                    size: 'UK 6',\\n                    condition: 'New',\\n                    payout: '',\\n                    type: 'cashout'\\n                });\\n            };\\n\\n            const handleFileUpload = (e) => {\\n                const file = e.target.files[0];\\n                if (file) {\\n                    onExcelUpload(file);\\n                }\\n            };\\n\\n            const createDemoMRN = () => {\\n                const mrnData = {\\n                    mrnNumber: `MRN-${Date.now()}`,\\n                    vendorId: session.id,\\n                    vendorName: session.name,\\n                    vendorEmail: session.email,\\n                    vendorPhone: session.phone || '+91-9999-999-999',\\n                    vendorPAN: session.pan,\\n                    vendorAddress: 'To be updated',\\n                    selectedWarehouse: 'Delhi',\\n                    items: shoes.slice(0, 5),\\n                    createdAt: new Date().toISOString()\\n                };\\n\\n                const allMRNs = [mrnData, ...mrns];\\n                localStorage.setItem(`cdc_vendor_mrns_${session.id}`, JSON.stringify(allMRNs));\\n                window.dispatchEvent(new Event('storagechange'));\\n                showMessage('Demo MRN created! You can now sign and download it.', 'success');\\n            };\\n\\n            return (\\n                <div>\\n                    {/* Header */}\\n                    <div className=\\\"header\\\">\\n                        <div className=\\\"header-content\\\">\\n                            <div className=\\\"logo\\\">CDC</div>\\n                            <div className=\\\"header-actions\\\">\\n                                <div className=\\\"vendor-info\\\">\\n                                    <div className=\\\"vendor-name\\\">{session.name}</div>\\n                                    <div style={{ fontSize: '12px', color: '#999' }}>{session.email}</div>\\n                                </div>\\n                                <button className=\\\"logout-btn\\\" onClick={onLogout}>\\n                                    Logout\\n                                </button>\\n                            </div>\\n                        </div>\\n                    </div>\\n\\n                    {/* Main Content */}\\n                    <div className=\\\"main\\\">\\n                        <div className=\\\"container\\\">\\n                            {message.text && (\\n                                <div className={message.type === 'error' ? 'error' : 'success'}>\\n                                    {message.text}\\n                                </div>\\n                            )}\\n\\n                            <div className=\\\"dashboard\\\">\\n                                {/* Tabs */}\\n                                <div className=\\\"tabs\\\">\\n                                    <button\\n                                        className={`tab ${activeTab === 'submit' ? 'active' : ''}`}\\n                                        onClick={() => setActiveTab('submit')}\\n                                    >\\n                                        Submit Shoes\\n                                    </button>\\n                                    <button\\n                                        className={`tab ${activeTab === 'myshoes' ? 'active' : ''}`}\\n                                        onClick={() => setActiveTab('myshoes')}\\n                                    >\\n                                        My Shoes\\n                                    </button>\\n                                    <button\\n                                        className={`tab ${activeTab === 'mrn' ? 'active' : ''}`}\\n                                        onClick={() => setActiveTab('mrn')}\\n                                    >\\n                                        MRN\\n                                    </button>\\n                                    <button\\n                                        className={`tab ${activeTab === 'notifications' ? 'active' : ''}`}\\n                                        onClick={() => setActiveTab('notifications')}\\n                                    >\\n                                        Notifications ({notifications.length})\\n                                    </button>\\n                                </div>\\n\\n                                {/* Tab Content */}\\n                                <div className=\\\"tab-content\\\">\\n                                    {/* Submit Shoes Tab */}\\n                                    {activeTab === 'submit' && (\\n                                        <div>\\n                                            <h3 style={{ marginBottom: '20px' }}>Add Shoes to Batch</h3>\\n\\n                                            <form className=\\\"shoe-form\\\" onSubmit={handleAddShoe}>\\n                                                <div className=\\\"form-grid\\\">\\n                                                    <div className=\\\"form-group\\\">\\n                                                        <label className=\\\"form-label\\\">Brand *</label>\\n                                                        <input\\n                                                            type=\\\"text\\\"\\n                                                            className=\\\"form-input\\\"\\n                                                            value={newShoe.brand}\\n                                                            onChange={(e) => setNewShoe({ ...newShoe, brand: e.target.value })}\\n                                                            placeholder=\\\"Nike, Adidas, etc.\\\"\\n                                                        />\\n                                                    </div>\\n\\n                                                    <div className=\\\"form-group\\\">\\n                                                        <label className=\\\"form-label\\\">Model *</label>\\n                                                        <input\\n                                                            type=\\\"text\\\"\\n                                                            className=\\\"form-input\\\"\\n                                                            value={newShoe.model}\\n                                                            onChange={(e) => setNewShoe({ ...newShoe, model: e.target.value })}\\n                                                            placeholder=\\\"Air Jordan 1, Ultraboost, etc.\\\"\\n                                                        />\\n                                                    </div>\\n\\n                                                    <div className=\\\"form-group\\\">\\n                                                        <label className=\\\"form-label\\\">SKU</label>\\n                                                        <input\\n                                                            type=\\\"text\\\"\\n                                                            className=\\\"form-input\\\"\\n                                                            value={newShoe.sku}\\n                                                            onChange={(e) => setNewShoe({ ...newShoe, sku: e.target.value })}\\n                                                            placeholder=\\\"SKU\\\"\\n                                                        />\\n                                                    </div>\\n\\n                                                    <div className=\\\"form-group\\\">\\n                                                        <label className=\\\"form-label\\\">Size (UK)</label>\\n                                                        <select\\n                                                            className=\\\"form-select\\\"\\n                                                            value={newShoe.size}\\n                                                            onChange={(e) => setNewShoe({ ...newShoe, size: e.target.value })}\\n                                                        >\\n                                                            {[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(size => (\\n                                                                <option key={size} value={`UK ${size}`}>UK {size}</option>\\n                                                            ))}\\n                                                        </select>\\n                                                    </div>\\n\\n                                                    <div className=\\\"form-group\\\">\\n                                                        <label className=\\\"form-label\\\">Condition</label>\\n                                                        <select\\n                                                            className=\\\"form-select\\\"\\n                                                            value={newShoe.condition}\\n                                                            onChange={(e) => setNewShoe({ ...newShoe, condition: e.target.value })}\\n                                                        >\\n                                                            <option>New</option>\\n                                                            <option>Like New</option>\\n                                                            <option>Good</option>\\n                                                            <option>Fair</option>\\n                                                        </select>\\n                                                    </div>\\n\\n                                                    <div className=\\\"form-group\\\">\\n                                                        <label className=\\\"form-label\\\">Payout Value (₹) *</label>\\n                                                        <input\\n                                                            type=\\\"number\\\"\\n                                                            className=\\\"form-input\\\"\\n                                                            value={newShoe.payout}\\n                                                            onChange={(e) => setNewShoe({ ...newShoe, payout: e.target.value })}\\n                                                            placeholder=\\\"5000\\\"\\n                                                        />\\n                                                    </div>\\n\\n                                                    <div className=\\\"form-group\\\">\\n                                                        <label className=\\\"form-label\\\">Type</label>\\n                                                        <select\\n                                                            className=\\\"form-select\\\"\\n                                                            value={newShoe.type}\\n                                                            onChange={(e) => setNewShoe({ ...newShoe, type: e.target.value })}\\n                                                        >\\n                                                            <option value=\\\"cashout\\\">Cashout</option>\\n                                                            <option value=\\\"consignment\\\">Consignment</option>\\n                                                        </select>\\n                                                    </div>\\n                                                </div>\\n\\n                                                <button type=\\\"submit\\\" className=\\\"btn btn-primary\\\">\\n                                                    Add to Batch\\n                                                </button>\\n                                            </form>\\n\\n                                            <div style={{ marginTop: '30px' }}>\\n                                                <label className=\\\"form-label\\\" style={{ marginBottom: '12px', display: 'block' }}>\\n                                                    Or Bulk Upload via Excel/CSV:\\n                                                </label>\\n                                                <div className=\\\"upload-area\\\">\\n                                                    <input\\n                                                        type=\\\"file\\\"\\n                                                        accept=\\\".xlsx,.xls,.csv\\\"\\n                                                        onChange={handleFileUpload}\\n                                                        style={{ display: 'none' }}\\n                                                        id=\\\"file-upload\\\"\\n                                                    />\\n                                                    <label htmlFor=\\\"file-upload\\\" style={{ cursor: 'pointer', width: '100%' }}>\\n                                                        <div className=\\\"upload-icon\\\">📁</div>\\n                                                        <div className=\\\"upload-text\\\">Click to upload or drag and drop</div>\\n                                                        <div className=\\\"upload-hint\\\">Excel (XLSX) or CSV with columns: brand, model, sku, size, condition, payout, type</div>\\n                                                    </label>\\n                                                </div>\\n                                            </div>\\n\\n                                            {shoes.length > 0 && (\\n                                                <div className=\\\"shoe-list\\\">\\n                                                    <h4 style={{ marginBottom: '16px' }}>\\n                                                        Batch ({shoes.length} items)\\n                                                    </h4>\\n                                                    {shoes.map(shoe => (\\n                                                        <div key={shoe.id} className=\\\"shoe-item\\\">\\n                                                            <div className=\\\"shoe-details\\\">\\n                                                                <div className=\\\"shoe-model\\\">\\n                                                                    {shoe.brand} {shoe.model}\\n                                                                </div>\\n                                                                <div className=\\\"shoe-meta\\\">\\n                                                                    SKU: {shoe.sku} | Size: {shoe.size} | Condition: {shoe.condition}\\n                                                                </div>\\n                                                            </div>\\n                                                            <div className=\\\"shoe-value\\\">₹{shoe.payout}</div>\\n                                                            <button\\n                                                                className=\\\"remove-btn\\\"\\n                                                                onClick={() => onRemoveShoe(shoe.id)}\\n                                                            >\\n                                                                Remove\\n                                                            </button>\\n                                                        </div>\\n                                                    ))}\\n\\n                                                    <div style={{ marginTop: '20px' }}>\\n                                                        <button\\n                                                            className=\\\"btn btn-primary\\\"\\n                                                            onClick={onSubmitBatch}\\n                                                        >\\n                                                            Submit Batch for Review\\n                                                        </button>\\n                                                    </div>\\n                                                </div>\\n                                            )}\\n                                        </div>\\n                                    )}\\n\\n                                    {/* My Shoes Tab */}\\n                                    {activeTab === 'myshoes' && (\\n                                        <div>\\n                                            <h3 style={{ marginBottom: '20px' }}>My Shoes ({shoes.length})</h3>\\n\\n                                            {shoes.length === 0 ? (\\n                                                <div className=\\\"text-center text-muted\\\">\\n                                                    <p>No shoes submitted yet. Start by adding shoes in the \\\"Submit Shoes\\\" tab.</p>\\n                                                </div>\\n                                            ) : (\\n                                                <div className=\\\"table-wrapper\\\">\\n                                                    <table>\\n                                                        <thead>\\n                                                            <tr>\\n                                                                <th>Brand</th>\\n                                                                <th>Model</th>\\n                                                                <th>SKU</th>\\n                                                                <th>Size</th>\\n                                                                <th>Condition</th>\\n                                                                <th>Payout (₹)</th>\\n                                                                <th>Type</th>\\n                                                                <th>Status</th>\\n                                                            </tr>\\n                                                        </thead>\\n                                                        <tbody>\\n                                                            {shoes.map(shoe => (\\n                                                                <tr key={shoe.id}>\\n                                                                    <td>{shoe.brand}</td>\\n                                                                    <td>{shoe.model}</td>\\n                                                                    <td>{shoe.sku}</td>\\n                                                                    <td>{shoe.size}</td>\\n                                                                    <td>{shoe.condition}</td>\\n                                                                    <td>₹{shoe.payout}</td>\\n                                                                    <td style={{ textTransform: 'capitalize' }}>\\n                                                                        {shoe.type}\\n                                                                    </td>\\n                                                                    <td>\\n                                                                        <span className={`badge badge-${shoe.status}`}>\\n                                                                            {shoe.status}\\n                                                                        </span>\\n                                                                    </td>\\n                                                                </tr>\\n                                                            ))}\\n                                                        </tbody>\\n                                                    </table>\\n                                                </div>\\n                                            )}\\n                                        </div>\\n                                    )}\\n\\n                                    {/* MRN Tab */}\\n                                    {activeTab === 'mrn' && (\\n                                        <div>\\n                                            <h3 style={{ marginBottom: '20px' }}>Material Receipt Notes</h3>\\n\\n                                            {mrns.length === 0 ? (\\n                                                <div style={{ textAlign: 'center', padding: '40px' }}>\\n                                                    <p style={{ color: '#666', marginBottom: '20px' }}>\\n                                                        No MRNs yet. Create a demo MRN to test the functionality.\\n                                                    </p>\\n                                                    <button\\n                                                        className=\\\"btn btn-primary\\\"\\n                                                        onClick={createDemoMRN}\\n                                                        disabled={shoes.length === 0}\\n                                                    >\\n                                                        {shoes.length === 0 ? 'Add shoes first' : 'Create Demo MRN'}\\n                                                    </button>\\n                                                </div>\\n                                            ) : (\\n                                                mrns.map((mrn, idx) => (\\n                                                    <div key={idx} style={{ marginBottom: '40px' }}>\\n                                                        <MRNDisplay mrn={mrn} />\\n                                                    </div>\\n                                                ))\\n                                            )}\\n                                        </div>\\n                                    )}\\n\\n                                    {/* Notifications Tab */}\\n                                    {activeTab === 'notifications' && (\\n                                        <div>\\n                                            <h3 style={{ marginBottom: '20px' }}>Notifications ({notifications.length})</h3>\\n\\n                                            {notifications.length === 0 ? (\\n                                                <div className=\\\"text-center text-muted\\\">\\n                                                    <p>No notifications yet.</p>\\n                                                </div>\\n                                            ) : (\\n                                                <div className=\\\"notifications-list\\\">\\n                                                    {notifications.map(notif => (\\n                                                        <div key={notif.id} className=\\\"notification-item\\\">\\n                                                            <div className=\\\"notification-title\\\">{notif.title}</div>\\n                                                            <div className=\\\"notification-message\\\">{notif.message}</div>\\n                                                            <div className=\\\"notification-time\\\">\\n                                                                {new Date(notif.timestamp).toLocaleString()}\\n                                                            </div>\\n                                                        </div>\\n                                                    ))}\\n                                                </div>\\n                                            )}\\n                                        </div>\\n                                    )}\\n                                </div>\\n                            </div>\\n                        </div>\\n                    </div>\\n                </div>\\n            );\\n        }\\n\\n        // Render App\\n        const root = ReactDOM.createRoot(document.getElementById('root'));\\n        root.render(<App />);\\n    </script>\\n</body>\\n</html>\\n\"");
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
