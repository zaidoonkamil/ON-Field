const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const upload = require("../middlewares/uploads");
const { BookingAd } = require("../models");
const { authenticateToken, optionalAuthenticateToken } = require("../middlewares/auth");
const {
  isAdmin,
  isSuperAdmin,
  getGovernorateScope,
  applyGovernorateScope,
  ensureGovernorateAccess,
} = require("../services/accessScope");

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch (_) {
    return false;
  }
}

function asBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function removeUploadedImage(filename) {
  if (!filename) return;
  const filePath = path.resolve(__dirname, "..", "uploads", filename);
  fs.unlink(filePath, () => {});
}

function ensureAdmin(req, res) {
  if (isAdmin(req.user) || isSuperAdmin(req.user)) return true;
  res.status(403).json({ error: "Not allowed" });
  return false;
}

router.get("/booking-ads", optionalAuthenticateToken, async (req, res) => {
  try {
    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    if (governorateScope === undefined) {
      return res.status(400).json({ error: "governorateId is required" });
    }

    const ads = await BookingAd.findAll({
      where: applyGovernorateScope({ isActive: true }, governorateScope),
      attributes: ["id", "image", "linkUrl", "sortOrder"],
      order: [["sortOrder", "ASC"], ["createdAt", "DESC"]],
    });
    return res.json({ data: ads });
  } catch (error) {
    console.error("Unable to load booking ads:", error);
    return res.status(500).json({ error: "Unable to load booking ads" });
  }
});

router.get("/admin/booking-ads", authenticateToken, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const governorateScope = getGovernorateScope(req, { allowQuery: true });
    const ads = await BookingAd.findAll({
      where: applyGovernorateScope({}, governorateScope),
      order: [["sortOrder", "ASC"], ["createdAt", "DESC"]],
    });
    return res.json({ data: ads });
  } catch (error) {
    console.error("Unable to load admin booking ads:", error);
    return res.status(500).json({ error: "Unable to load booking ads" });
  }
});

router.post("/admin/booking-ads", authenticateToken, upload.single("image"), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    if (!req.file || !req.file.mimetype?.startsWith("image/")) {
      removeUploadedImage(req.file?.filename);
      return res.status(400).json({ error: "An image is required" });
    }
    if (!isValidHttpUrl(req.body.linkUrl)) {
      removeUploadedImage(req.file.filename);
      return res.status(400).json({ error: "A valid http or https link is required" });
    }

    const requestedGovernorateId = Number(req.body.governorateId);
    const governorateId = isSuperAdmin(req.user)
      ? (Number.isInteger(requestedGovernorateId) && requestedGovernorateId > 0
          ? requestedGovernorateId
          : null)
      : Number(req.user.governorateId);
    if (!governorateId && !isSuperAdmin(req.user)) {
      removeUploadedImage(req.file.filename);
      return res.status(403).json({ error: "Governorate access is not configured" });
    }

    const ad = await BookingAd.create({
      image: req.file.filename,
      linkUrl: req.body.linkUrl.trim(),
      isActive: asBoolean(req.body.isActive, true),
      sortOrder: Number.parseInt(req.body.sortOrder, 10) || 0,
      governorateId,
    });
    return res.status(201).json(ad);
  } catch (error) {
    removeUploadedImage(req.file?.filename);
    console.error("Unable to create booking ad:", error);
    return res.status(500).json({ error: "Unable to create booking ad" });
  }
});

router.patch("/admin/booking-ads/:id", authenticateToken, upload.single("image"), async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const ad = await BookingAd.findByPk(req.params.id);
    if (!ad) return res.status(404).json({ error: "Ad not found" });
    if (!ensureGovernorateAccess(req, res, ad.governorateId)) return;
    if (req.file && !req.file.mimetype?.startsWith("image/")) {
      removeUploadedImage(req.file.filename);
      return res.status(400).json({ error: "Image files only" });
    }
    if (req.body.linkUrl !== undefined && !isValidHttpUrl(req.body.linkUrl)) {
      removeUploadedImage(req.file?.filename);
      return res.status(400).json({ error: "A valid http or https link is required" });
    }

    const previousImage = ad.image;
    if (req.file) ad.image = req.file.filename;
    if (req.body.linkUrl !== undefined) ad.linkUrl = req.body.linkUrl.trim();
    ad.isActive = asBoolean(req.body.isActive, ad.isActive);
    if (req.body.sortOrder !== undefined) {
      ad.sortOrder = Number.parseInt(req.body.sortOrder, 10) || 0;
    }
    await ad.save();
    if (req.file) removeUploadedImage(previousImage);
    return res.json(ad);
  } catch (error) {
    removeUploadedImage(req.file?.filename);
    console.error("Unable to update booking ad:", error);
    return res.status(500).json({ error: "Unable to update booking ad" });
  }
});

router.delete("/admin/booking-ads/:id", authenticateToken, async (req, res) => {
  try {
    if (!ensureAdmin(req, res)) return;
    const ad = await BookingAd.findByPk(req.params.id);
    if (!ad) return res.status(404).json({ error: "Ad not found" });
    if (!ensureGovernorateAccess(req, res, ad.governorateId)) return;
    const image = ad.image;
    await ad.destroy();
    removeUploadedImage(image);
    return res.json({ success: true });
  } catch (error) {
    console.error("Unable to delete booking ad:", error);
    return res.status(500).json({ error: "Unable to delete booking ad" });
  }
});

module.exports = router;
