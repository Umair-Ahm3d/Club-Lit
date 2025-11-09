const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");

const { User } = require("../models/User");
const Book = require("../models/Book");
const authenticateToken = require("../middleware/authenticateToken");
const adminAuth = require("../middleware/adminAuth");

const router = express.Router();

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");
const ADMIN_IMAGE_DIR = path.join(UPLOADS_ROOT, "images");
const ADMIN_PDF_DIR = path.join(UPLOADS_ROOT, "pdfs");

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(ADMIN_IMAGE_DIR);
ensureDir(ADMIN_PDF_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = file.mimetype.startsWith("image/")
      ? ADMIN_IMAGE_DIR
      : ADMIN_PDF_DIR;
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith("image/") ||
    file.mimetype === "application/pdf"
  ) {
    cb(null, true);
  } else {
    cb(new Error("Only images and PDFs are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

const deleteFileSafe = async (filePath) => {
  try {
    if (!filePath) return;
    if (fs.existsSync(filePath)) {
      await fsp.unlink(filePath);
    }
  } catch (err) {
    console.warn("Failed to remove file:", filePath, err.message);
  }
};

router.post(
  "/books",
  authenticateToken,
  adminAuth,
  upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "bookPdf", maxCount: 1 },
  ]),
  async (req, res) => {
    const uploadedPaths = [];
    try {
      const { title, author, description } = req.body;
      const genres = req.body.genres
        ? req.body.genres.split(",").map((g) => g.trim()).filter(Boolean)
        : [];

      if (!title || !author || !description || !genres.length) {
        return res.status(400).json({
          message:
            "Title, author, description, and at least one genre are required.",
        });
      }

      const coverFile = req.files?.coverImage?.[0];
      const pdfFile = req.files?.bookPdf?.[0];

      if (!coverFile || !pdfFile) {
        return res
          .status(400)
          .json({ message: "Cover image and PDF are required." });
      }

      uploadedPaths.push(coverFile.path, pdfFile.path);

      const book = await Book.create({
        title: title.trim(),
        author: author.trim(),
        description: description.trim(),
        genres,
        coverImage: `/uploads/images/${path.basename(coverFile.path)}`,
        pdfUrl: `/uploads/pdfs/${path.basename(pdfFile.path)}`,
      });

      res.status(201).json({
        message: "Book uploaded successfully",
        book: {
          id: book._id,
          title: book.title,
          author: book.author,
          genres: book.genres,
        },
      });
    } catch (error) {
      console.error("Admin book upload error:", error);
      await Promise.all(uploadedPaths.map(deleteFileSafe));
      res.status(500).json({ error: "Failed to upload book" });
    }
  }
);

router.get("/users", authenticateToken, adminAuth, async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    console.error("Admin fetch users error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put(
  "/users/:id/make-admin",
  authenticateToken,
  adminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.isAdmin) {
        return res.status(200).json({
          message: "User is already an admin",
          user: {
            id: user._id,
            email: user.email,
            isAdmin: true,
          },
        });
      }

      user.isAdmin = true;
      await user.save();

      res.json({
        message: "User promoted to admin",
        user: {
          id: user._id,
          email: user.email,
          isAdmin: user.isAdmin,
        },
      });
    } catch (error) {
      console.error("Make admin error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/users/:id",
  authenticateToken,
  adminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      if (user.email === process.env.MASTER_ADMIN_EMAIL) {
        return res
          .status(403)
          .json({ message: "Cannot delete the primary admin account" });
      }

      await User.findByIdAndDelete(id);
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
