const express = require("express");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const mongoose = require("mongoose");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf");

const Book = require("../models/Book");
const { User } = require("../models/User");
const authenticateToken = require("../middleware/authenticateToken");
const adminAuth = require("../middleware/adminAuth");

const router = express.Router();

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");
const IMAGE_DIR = path.join(UPLOADS_ROOT, "images");
const PDF_DIR = path.join(UPLOADS_ROOT, "pdfs");
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50 MB
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(IMAGE_DIR);
ensureDir(PDF_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = file.mimetype.startsWith("image/") ? IMAGE_DIR : PDF_DIR;
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const isImage = file.mimetype.startsWith("image/");
  const isPdf = file.mimetype === "application/pdf";
  if (isImage || isPdf) {
    cb(null, true);
  } else {
    cb(new Error("Only image and PDF uploads are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_SIZE },
});

const isValidObjectId = mongoose.Types.ObjectId.isValid;
const toStringId = (value) => value?.toString();

const getAbsoluteUploadPath = (relative) => {
  if (!relative) return null;
  const normalized = relative.startsWith("/")
    ? relative.slice(1)
    : relative;
  return path.join(__dirname, "..", normalized);
};

const deleteFileSafe = async (filePath) => {
  try {
    if (!filePath) return;
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : getAbsoluteUploadPath(filePath);
    if (fullPath && fs.existsSync(fullPath)) {
      await fsp.unlink(fullPath);
    }
  } catch (error) {
    console.warn("Failed to delete file:", filePath, error.message);
  }
};

const parseArray = (input) => {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed;
    } catch (err) {
      return input
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const parseToc = (input) => {
  const tocArray = parseArray(input);
  return tocArray
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      title: entry.title ?? "",
      page: Number.isInteger(entry.page) ? entry.page : null,
      level:
        typeof entry.level === "number" && entry.level > 0
          ? entry.level
          : 1,
    }))
    .filter((entry) => entry.title && entry.page !== null);
};

const sanitizeBook = (book, currentUserId) => {
  if (!book) return book;
  const plain = book.toObject ? book.toObject() : { ...book };
  plain._id = toStringId(plain._id);
  plain.coverImage = plain.coverImage;
  plain.pdfUrl = plain.pdfUrl;
  plain.genres = Array.isArray(plain.genres)
    ? plain.genres.map((g) => g)
    : [];

  const userId = toStringId(currentUserId);
  const ratings = Array.isArray(plain.ratings) ? plain.ratings : [];
  const bookmarks = Array.isArray(plain.bookmarks) ? plain.bookmarks : [];

  const userRatingEntry = ratings.find(
    (entry) => toStringId(entry.userId) === userId
  );
  plain.userRating = userRatingEntry ? userRatingEntry.rating : null;
  plain.ratingCount = ratings.length;

  if (!plain.averageRating && ratings.length) {
    const sum = ratings.reduce((total, entry) => total + entry.rating, 0);
    plain.averageRating = Number((sum / ratings.length).toFixed(1));
  }

  plain.isBookmarked = userId
    ? bookmarks.some((entry) => toStringId(entry.userId) === userId)
    : false;

  delete plain.ratings;
  delete plain.bookmarks;
  delete plain.highlights;

  return plain;
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
    const uploadedFiles = [];

    try {
      const { title, author, description } = req.body;
      const genres = parseArray(req.body.genres);
      const toc = parseToc(req.body.toc);

      const coverFile = req.files?.coverImage?.[0];
      const pdfFile = req.files?.bookPdf?.[0];

      if (!title || !author || !description || !genres.length) {
        return res.status(400).json({
          message: "Title, author, description, and at least one genre are required.",
        });
      }

      if (!coverFile || !pdfFile) {
        return res
          .status(400)
          .json({ message: "Cover image and PDF file are required." });
      }

      uploadedFiles.push(coverFile.path, pdfFile.path);

      const pdfBuffer = await fsp.readFile(pdfFile.path);
      const pdfDocument = await pdfjsLib
        .getDocument({ data: pdfBuffer })
        .promise;
      const pageCount = pdfDocument.numPages;
      pdfDocument.destroy();

      if (pageCount < 1) {
        throw new Error("Unable to determine PDF structure.");
      }

      const book = await Book.create({
        title: title.trim(),
        author: author.trim(),
        description: description.trim(),
        genres,
        coverImage: `/uploads/images/${path.basename(coverFile.path)}`,
        pdfUrl: `/uploads/pdfs/${path.basename(pdfFile.path)}`,
        pageCount,
        toc,
      });

      res.status(201).json({
        message: "Book uploaded successfully",
        book: sanitizeBook(book),
      });
    } catch (error) {
      console.error("Book upload error:", error);
      await Promise.all(uploadedFiles.map((filePath) => deleteFileSafe(filePath)));
      const status = error.name === "ValidationError" ? 400 : 500;
      res.status(status).json({
        message: error.message || "Server error during upload",
      });
    }
  }
);

router.get("/", authenticateToken, async (req, res) => {
  try {
    const books = await Book.find().sort({ createdAt: -1 }).lean();
    res.json(books.map((book) => sanitizeBook(book, req.user._id)));
  } catch (error) {
    console.error("Fetch books error:", error);
    res.status(500).json({ message: "Failed to fetch books" });
  }
});

router.get("/genres", authenticateToken, async (req, res) => {
  try {
    const genres = await Book.distinct("genres");
    res.json(genres.filter(Boolean));
  } catch (error) {
    console.error("Genres error:", error);
    res.status(500).json({ error: "Failed to fetch genres" });
  }
});

router.get("/rankings/reads", authenticateToken, async (req, res) => {
  try {
    const books = await Book.find().sort({ reads: -1 }).limit(10).lean();
    res.json(books.map((book) => sanitizeBook(book, req.user._id)));
  } catch (error) {
    console.error("Reads ranking error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/rankings/most-visited", authenticateToken, async (req, res) => {
  try {
    const books = await Book.find().sort({ reads: -1 }).limit(10).lean();
    res.json(books.map((book) => sanitizeBook(book, req.user._id)));
  } catch (error) {
    console.error("Most visited ranking error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/rankings/highest-rated", authenticateToken, async (req, res) => {
  try {
    const books = await Book.find()
      .sort({ averageRating: -1, ratingCount: -1 })
      .limit(10)
      .lean();
    res.json(books.map((book) => sanitizeBook(book, req.user._id)));
  } catch (error) {
    console.error("Highest rated ranking error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/rankings/most-discussed", authenticateToken, async (req, res) => {
  try {
    const books = await Book.aggregate([
      { $project: { title: 1, author: 1, commentCount: { $size: "$comments" } } },
      { $sort: { commentCount: -1 } },
      { $limit: 10 },
    ]);
    res.json(books);
  } catch (error) {
    console.error("Most discussed ranking error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/:bookId/rate", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    const rating = Number(req.body.rating);

    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 0 and 5" });
    }

    const userId = new mongoose.Types.ObjectId(req.user._id);
    const book = await Book.findById(bookId);

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    book.ratings = Array.isArray(book.ratings) ? book.ratings : [];
    const existingRating = book.ratings.find((entry) =>
      entry.userId.equals(userId)
    );

    if (existingRating) {
      existingRating.rating = rating;
      existingRating.updatedAt = new Date();
    } else {
      book.ratings.push({ userId, rating });
    }

    const total = book.ratings.reduce((sum, entry) => sum + entry.rating, 0);
    book.ratingCount = book.ratings.length;
    book.averageRating = Number((total / book.ratingCount).toFixed(1));

    await book.save();

    res.json({
      averageRating: book.averageRating,
      ratingCount: book.ratingCount,
      userRating: rating,
    });
  } catch (error) {
    console.error("Rating error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:filename", (req, res, next) => {
  const { filename } = req.params;
  if (!filename.includes(".")) {
    return next();
  }

  const pdfPath = path.join(PDF_DIR, filename);
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: "PDF not found" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${path.basename(pdfPath)}"`
  );
  res.sendFile(pdfPath);
});

router.get("/:bookId", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    const book = await Book.findById(bookId)
      .populate("comments.userId", "UserName avatar")
      .lean();

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const sanitized = sanitizeBook(book, req.user._id);
    sanitized.comments = (book.comments || []).map((comment) => ({
      _id: toStringId(comment._id),
      text: comment.text,
      createdAt: comment.createdAt,
      user: comment.userId
        ? {
            _id: toStringId(comment.userId._id ?? comment.userId),
            UserName: comment.userId.UserName ?? "Unknown",
            avatar: comment.userId.avatar ?? null,
          }
        : {
            _id: null,
            UserName: "Unknown",
            avatar: null,
          },
    }));

    res.json(sanitized);
  } catch (error) {
    console.error("Get book error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:bookId/comments", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    const text = (req.body.text || "").trim();

    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    if (!text) {
      return res.status(400).json({ message: "Comment text is required" });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const comment = {
      userId: req.user._id,
      text,
      createdAt: new Date(),
    };

    book.comments = Array.isArray(book.comments) ? book.comments : [];
    book.comments.push(comment);
    await book.save();

    const populated = await Book.findById(bookId)
      .select({ comments: { $slice: -1 } })
      .populate("comments.userId", "UserName avatar");

    const savedComment = populated?.comments?.[0];
    res.status(201).json({
      _id: toStringId(savedComment?._id),
      text: savedComment?.text,
      createdAt: savedComment?.createdAt,
      user: savedComment?.userId
        ? {
            _id: toStringId(savedComment.userId._id ?? savedComment.userId),
            UserName: savedComment.userId.UserName ?? "Unknown",
            avatar: savedComment.userId.avatar ?? null,
          }
        : {
            _id: req.user._id,
            UserName: "Unknown",
            avatar: null,
          },
    });
  } catch (error) {
    console.error("Comment error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.get("/:bookId/comments", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ message: "Invalid book ID" });
    }

    const book = await Book.findById(bookId).populate(
      "comments.userId",
      "UserName avatar"
    );
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    const comments = (book.comments || []).map((comment) => ({
      _id: toStringId(comment._id),
      text: comment.text,
      createdAt: comment.createdAt,
      user: comment.userId
        ? {
            _id: toStringId(comment.userId._id ?? comment.userId),
            UserName: comment.userId.UserName ?? "Unknown",
            avatar: comment.userId.avatar ?? null,
          }
        : { _id: null, UserName: "Unknown", avatar: null },
    }));

    res.json(comments);
  } catch (error) {
    console.error("Get comments error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/pdf/:filename", authenticateToken, (req, res) => {
  const pdfPath = path.join(PDF_DIR, req.params.filename);
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: "PDF not found" });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${path.basename(pdfPath)}"`
  );
  res.sendFile(pdfPath);
});

router.get("/image/:filename", (req, res) => {
  const imagePath = path.join(IMAGE_DIR, req.params.filename);
  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: "Image not found" });
  }
  res.sendFile(imagePath);
});

router.get("/:bookId/pdf", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ error: "Invalid book ID" });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }

    const pdfPath = getAbsoluteUploadPath(book.pdfUrl);
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: "PDF not found" });
    }

    const stats = await fsp.stat(pdfPath);
    if (stats.size < 256) {
      console.warn("PDF file appears unusually small:", pdfPath);
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": stats.size,
      "Content-Disposition": `inline; filename="${book.title}.pdf"`,
    });

    const stream = fs.createReadStream(pdfPath);
    stream.on("error", (err) => {
      console.error("Stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming PDF" });
      }
    });
    stream.on("end", async () => {
      try {
        book.reads = (book.reads || 0) + 1;
        await book.save();
      } catch (dbError) {
        console.error("Failed to update read count:", dbError);
      }
    });
    stream.pipe(res);
  } catch (error) {
    console.error("PDF delivery error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:bookId/bookmarks", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    const page = Number(req.body.page);

    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ error: "Invalid book ID" });
    }

    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: "Valid page number is required" });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }

    book.bookmarks = Array.isArray(book.bookmarks) ? book.bookmarks : [];
    book.bookmarks = book.bookmarks.filter(
      (entry) =>
        !(
          toStringId(entry.userId) === req.user._id &&
          entry.page === page
        )
    );

    book.bookmarks.push({
      userId: req.user._id,
      page,
      createdAt: new Date(),
    });

    await book.save();

    const userBookmarks = book.bookmarks.filter(
      (entry) => toStringId(entry.userId) === req.user._id
    );
    res.status(201).json(
      userBookmarks.map((entry) => ({
        page: entry.page,
        createdAt: entry.createdAt,
      }))
    );
  } catch (error) {
    console.error("Bookmark error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:bookId/bookmarks", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ error: "Invalid book ID" });
    }

    const book = await Book.findById(bookId).lean();
    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }

    const bookmarks = (book.bookmarks || [])
      .filter((entry) => toStringId(entry.userId) === req.user._id)
      .map((entry) => ({
        page: entry.page,
        createdAt: entry.createdAt,
      }));

    res.json(bookmarks);
  } catch (error) {
    console.error("Get bookmarks error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:bookId/highlights", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ error: "Invalid book ID" });
    }

    const book = await Book.findById(bookId).lean();
    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }

    const highlights = (book.highlights || [])
      .filter((entry) => toStringId(entry.userId) === req.user._id)
      .map((entry) => ({
        text: entry.text,
        page: entry.page,
        coordinates: entry.coordinates,
        createdAt: entry.createdAt,
      }));

    res.json(highlights);
  } catch (error) {
    console.error("Highlights fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:bookId/highlights", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    const { text, page, coordinates } = req.body;

    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ error: "Invalid book ID" });
    }

    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: "Valid page number is required" });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }

    const highlight = {
      userId: req.user._id,
      text: text || "",
      page,
      coordinates: coordinates || null,
      createdAt: new Date(),
    };

    book.highlights = Array.isArray(book.highlights) ? book.highlights : [];
    book.highlights.push(highlight);
    await book.save();

    res.status(201).json({
      text: highlight.text,
      page: highlight.page,
      coordinates: highlight.coordinates,
      createdAt: highlight.createdAt,
    });
  } catch (error) {
    console.error("Highlight error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

router.put(
  "/:bookId/admin",
  authenticateToken,
  adminAuth,
  async (req, res) => {
    try {
      const { bookId } = req.params;
      if (!isValidObjectId(bookId)) {
        return res.status(400).json({ error: "Invalid book ID" });
      }

      const updates = {};
      if (typeof req.body.title === "string") {
        updates.title = req.body.title.trim();
      }
      if (typeof req.body.author === "string") {
        updates.author = req.body.author.trim();
      }
      if (typeof req.body.description === "string") {
        updates.description = req.body.description.trim();
      }
      if (req.body.genres) {
        const genres = parseArray(req.body.genres);
        if (!genres.length) {
          return res
            .status(400)
            .json({ error: "At least one genre is required" });
        }
        updates.genres = genres;
      }

      const book = await Book.findByIdAndUpdate(bookId, updates, {
        new: true,
        runValidators: true,
      });

      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      res.json(sanitizeBook(book));
    } catch (error) {
      console.error("Book update error:", error);
      res.status(500).json({ error: "Server error during update" });
    }
  }
);

router.delete(
  "/:bookId/admin",
  authenticateToken,
  adminAuth,
  async (req, res) => {
    try {
      const { bookId } = req.params;
      if (!isValidObjectId(bookId)) {
        return res.status(400).json({ error: "Invalid book ID" });
      }

      const book = await Book.findByIdAndDelete(bookId);
      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      await Promise.all([
        deleteFileSafe(book.coverImage),
        deleteFileSafe(book.pdfUrl),
      ]);

      res.json({
        message: "Book deleted successfully",
        book: sanitizeBook(book),
      });
    } catch (error) {
      console.error("Book delete error:", error);
      res.status(500).json({ error: "Server error during deletion" });
    }
  }
);

router.get("/:bookId/toc", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.params;
    if (!isValidObjectId(bookId)) {
      return res.status(400).json({ error: "Invalid book ID" });
    }

    const book = await Book.findById(bookId, "toc");
    if (!book) {
      return res.status(404).json({ error: "Book not found" });
    }

    res.json(book.toc || []);
  } catch (error) {
    console.error("Get TOC error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put(
  "/:bookId/toc",
  authenticateToken,
  adminAuth,
  async (req, res) => {
    try {
      const { bookId } = req.params;
      if (!isValidObjectId(bookId)) {
        return res.status(400).json({ error: "Invalid book ID" });
      }

      const toc = parseToc(req.body.toc);
      const book = await Book.findByIdAndUpdate(
        bookId,
        { toc },
        { new: true, runValidators: true }
      );

      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      res.json(book.toc || []);
    } catch (error) {
      console.error("Update TOC error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;
