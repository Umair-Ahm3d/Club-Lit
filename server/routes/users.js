const express = require("express");
const router = express.Router();
const { User, validate } = require("../models/User");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const authenticateToken = require("../middleware/authenticateToken");

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : undefined;

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : undefined;

const validateUserId = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
    return res.status(400).json({ message: "Invalid user ID format" });
  }
  next();
};

const toStringId = (value) => value?.toString();

const ensureFavoritesArray = (user) => {
  if (!Array.isArray(user.favorites)) {
    user.favorites = [];
  }
};

const ensureNotificationsArray = (user) => {
  if (!Array.isArray(user.notifications)) {
    user.notifications = [];
  }
};

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");
const AVATAR_DIR = path.join(UPLOADS_ROOT, "avatars");
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

const sanitizeBookRef = (book) => {
  if (!book) return null;
  const doc = book.toObject ? book.toObject() : { ...book };
  return {
    _id: toStringId(doc._id),
    title: doc.title,
    author: doc.author,
    coverImage: doc.coverImage,
    pdfUrl: doc.pdfUrl,
    genres: doc.genres,
  };
};

const computeFavoriteState = (user, bookId, desiredState) => {
  ensureFavoritesArray(user);
  const currentIndex = user.favorites.findIndex(
    (id) => id.toString() === bookId
  );
  let isFavorite = currentIndex !== -1;

  if (typeof desiredState === "boolean") {
    if (desiredState && !isFavorite) {
      user.favorites.push(bookId);
      isFavorite = true;
    } else if (!desiredState && isFavorite) {
      user.favorites.splice(currentIndex, 1);
      isFavorite = false;
    }
  } else {
    if (isFavorite) {
      user.favorites.splice(currentIndex, 1);
      isFavorite = false;
    } else {
      user.favorites.push(bookId);
      isFavorite = true;
    }
  }

  return isFavorite;
};

router.post("/", async (req, res) => {
  try {
    const incoming = { ...req.body };

    if (!incoming.UserName && incoming.name) {
      incoming.UserName = incoming.name;
    }

    const registrationPayload = {
      UserName: normalizeString(incoming.UserName),
      email: normalizeEmail(incoming.email),
      password: incoming.password,
      bio: normalizeString(incoming.bio),
      isAdmin: incoming.isAdmin,
    };

    if (!registrationPayload.UserName) {
      return res.status(400).send({ message: "User Name is required" });
    }
    if (!registrationPayload.email) {
      return res.status(400).send({ message: "Email is required" });
    }

    const { error } = validate(registrationPayload);
    if (error) {
      return res.status(400).send({ message: error.details[0].message });
    }

    const existingUser = await User.findOne({
      $or: [
        { email: registrationPayload.email },
        { UserName: registrationPayload.UserName },
      ],
    });

    if (existingUser) {
      const conflictField =
        existingUser.email === registrationPayload.email ? "Email" : "Username";
      return res
        .status(409)
        .send({ message: `${conflictField} already exists!` });
    }

    const saltRounds = Number(process.env.SALT) || 10;
    const salt = await bcrypt.genSalt(saltRounds);
    const hashPassword = await bcrypt.hash(registrationPayload.password, salt);

    const isAdmin =
      typeof process.env.ADMIN_EMAIL === "string" &&
      registrationPayload.email === process.env.ADMIN_EMAIL;

    const newUser = new User({
      UserName: registrationPayload.UserName,
      email: registrationPayload.email,
      password: hashPassword,
      bio: registrationPayload.bio,
      isAdmin: isAdmin || Boolean(registrationPayload.isAdmin),
    });

    await newUser.save();
    const token = newUser.generateAuthToken();

    res.status(201).send({
      message: "User created successfully",
      token,
      user: {
        id: newUser._id,
        email: newUser.email,
        isAdmin: newUser.isAdmin,
        surveyCompleted: newUser.surveyCompleted,
      },
    });
  } catch (error) {
    console.error("Registration Error:", error);
    if (error.code === 11000 && error.keyPattern) {
      const key = Object.keys(error.keyPattern)[0];
      const field = key === "email" ? "Email" : "Username";
      return res.status(409).send({ message: `${field} already exists!` });
    }

    res.status(500).send({
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

const handleFavoriteUpdate = async (req, res, desiredState) => {
  try {
    const { bookId } = req.body;
    if (!bookId || !mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Valid bookId is required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isFavorite = computeFavoriteState(user, bookId, desiredState);
    await user.save();

    await user.populate("favorites");
    const favorites = (user.favorites || [])
      .map(sanitizeBookRef)
      .filter(Boolean);

    res.json({ isFavorite, favorites });
  } catch (error) {
    console.error("Favorite update error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

router.post("/favorites", authenticateToken, async (req, res) => {
  const action = typeof req.body.action === "string" ? req.body.action : "";
  const desiredState =
    action.toLowerCase() === "add"
      ? true
      : action.toLowerCase() === "remove"
      ? false
      : undefined;
  return handleFavoriteUpdate(req, res, desiredState);
});

router.post("/toggle-favorite", authenticateToken, async (req, res) => {
  return handleFavoriteUpdate(req, res, undefined);
});

router.get("/favorites", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("favorites")
      .select("favorites")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const favorites = (user.favorites || [])
      .map(sanitizeBookRef)
      .filter(Boolean);

    res.json(favorites);
  } catch (error) {
    console.error("Get favorites error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, AVATAR_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, req.user._id + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpeg|jpg|png/;
    const extName = fileTypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimeType = fileTypes.test(file.mimetype);
    if (extName && mimeType) {
      return cb(null, true);
    }
    cb(new Error("Only .jpeg, .jpg, or .png formats allowed!"));
  },
});

router.post(
  "/profile/avatar",
  authenticateToken,
  upload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "Avatar file is required" });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      user.avatar = `/uploads/avatars/${req.file.filename}`;
      await user.save();

      res.json({
        message: "Profile picture uploaded successfully",
        avatar: user.avatar,
      });
    } catch (error) {
      console.error("Avatar Upload Error:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);

router.get("/requests", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("notifications")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const notifications = Array.isArray(user.notifications)
      ? user.notifications.map((notification) => ({
          ...notification,
          _id: toStringId(notification._id),
        }))
      : [];

    res.json(notifications);
  } catch (error) {
    console.error("Get requests error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.patch(
  "/requests/:notificationId/viewed",
  authenticateToken,
  async (req, res) => {
    try {
      const { notificationId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(notificationId)) {
        return res.status(400).json({ message: "Invalid notification id" });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      ensureNotificationsArray(user);
      const notification = user.notifications.find(
        (n) => n._id.toString() === notificationId
      );

      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }

      notification.viewed = true;
      await user.save();

      res.json({ message: "Notification marked as viewed" });
    } catch (error) {
      console.error("Mark notification viewed error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.delete(
  "/requests/:notificationId",
  authenticateToken,
  async (req, res) => {
    try {
      const { notificationId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(notificationId)) {
        return res.status(400).json({ message: "Invalid notification id" });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      ensureNotificationsArray(user);
      const originalLength = user.notifications.length;
      user.notifications = user.notifications.filter(
        (n) => n._id.toString() !== notificationId
      );

      if (user.notifications.length === originalLength) {
        return res.status(404).json({ message: "Notification not found" });
      }

      await user.save();

      res.json({ message: "Notification deleted successfully" });
    } catch (error) {
      console.error("Delete notification error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get("/:userId", authenticateToken, validateUserId, async (req, res) => {
  try {
    const sameUser = req.user._id === req.params.userId;
    const projection =
      sameUser || req.user.isAdmin
        ? "-password"
        : { UserName: 1, avatar: 1, bio: 1, joinedClubs: 1 };

    const user = await User.findById(req.params.userId, projection)
      .populate("joinedClubs")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Fetch user error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch(
  "/:userId",
  authenticateToken,
  validateUserId,
  async (req, res) => {
    try {
      if (req.user._id !== req.params.userId && !Boolean(req.user.isAdmin)) {
        return res.status(403).json({ message: "Access denied" });
      }

      const update = {};
      if (typeof req.body.surveyCompleted === "boolean") {
        update.surveyCompleted = req.body.surveyCompleted;
      } else {
        update.surveyCompleted = true;
      }

      if (req.body.preferences && typeof req.body.preferences === "object") {
        update.preferences = req.body.preferences;
      }

      const updatedUser = await User.findByIdAndUpdate(
        req.params.userId,
        update,
        { new: true }
      ).select("-password");

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(updatedUser);
    } catch (error) {
      console.error("User Update Error:", error);
      res.status(500).json({ message: "Server error during update" });
    }
  }
);

module.exports = router;
