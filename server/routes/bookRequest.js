const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const adminAuth = require("../middleware/adminAuth");
const BookRequest = require("../models/BookRequest");
const { User } = require("../models/User");
const Book = require("../models/Book");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const toStringId = (value) => value?.toString();

const ensureNotificationsArray = (user) => {
  if (!Array.isArray(user.notifications)) {
    user.notifications = [];
  }
};

const sanitizeRequest = (request) => {
  if (!request) return request;
  const doc = request.toObject ? request.toObject() : { ...request };
  doc._id = toStringId(doc._id);
  doc.user = doc.user
    ? {
        _id: toStringId(doc.user._id ?? doc.user),
        UserName: doc.user.UserName,
        email: doc.user.email,
        avatar: doc.user.avatar,
      }
    : undefined;
  return doc;
};

router.post("/", authenticateToken, async (req, res) => {
  try {
    const title = (req.body.bookTitle || "").trim();
    if (!title) {
      return res.status(400).json({ message: "Book title is required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const existingPending = await BookRequest.findOne({
      user: req.user._id,
      bookTitle: title,
      status: "Pending",
    });
    if (existingPending) {
      return res
        .status(409)
        .json({ message: "You already have a pending request for this book." });
    }

    const request = await BookRequest.create({
      user: req.user._id,
      bookTitle: title,
      status: "Pending",
    });

    ensureNotificationsArray(user);
    user.notifications.push({
      message: `Your request for "${title}" has been submitted for review.`,
      status: "Pending",
      reason: "Awaiting review",
      createdAt: new Date(),
      viewed: false,
    });
    await user.save();

    res.status(201).json(sanitizeRequest(request));
  } catch (error) {
    console.error("Book request creation error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/", authenticateToken, async (req, res) => {
  try {
    const requests = await BookRequest.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json(requests.map(sanitizeRequest));
  } catch (error) {
    console.error("Fetch book requests error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/admin/all", authenticateToken, adminAuth, async (req, res) => {
  try {
    const [pending, approved, rejected] = await Promise.all(
      ["Pending", "Approved", "Rejected"].map((status) =>
        BookRequest.find({ status })
          .populate("user", "UserName avatar email")
          .sort({ createdAt: -1 })
      )
    );

    res.json({
      pending: pending.map(sanitizeRequest),
      approved: approved.map(sanitizeRequest),
      rejected: rejected.map(sanitizeRequest),
    });
  } catch (error) {
    console.error("Admin fetch requests error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/admin/:id", authenticateToken, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid request id" });
    }

    const status = req.body.status;
    const reason = (req.body.reason || "").trim();
    if (!status || !["Pending", "Approved", "Rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    if (status === "Rejected" && !reason) {
      return res
        .status(400)
        .json({ message: "Rejection reason is required" });
    }

    const request = await BookRequest.findById(id).populate(
      "user",
      "UserName email avatar notifications"
    );
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    request.status = status;
    request.reason = status === "Rejected" ? reason : "";
    await request.save();

    if (request.user) {
      ensureNotificationsArray(request.user);
      const message =
        status === "Approved"
          ? `Your request for "${request.bookTitle}" has been approved. Check the library for new arrivals.`
          : status === "Rejected"
          ? `Your request for "${request.bookTitle}" was rejected. Reason: ${reason}`
          : `Your request for "${request.bookTitle}" is now marked as ${status}.`;

      request.user.notifications.push({
        message,
        status,
        reason: status === "Rejected" ? reason : undefined,
        createdAt: new Date(),
        viewed: false,
      });
      await request.user.save();
    }

    res.json(sanitizeRequest(request));
  } catch (error) {
    console.error("Update request error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/notify-users/:bookId",
  authenticateToken,
  adminAuth,
  async (req, res) => {
    try {
      const { bookId } = req.params;
      if (!isValidObjectId(bookId)) {
        return res.status(400).json({ error: "Invalid book ID" });
      }

      const book = await Book.findById(bookId);
      if (!book) {
        return res.status(404).json({ error: "Book not found" });
      }

      const requestingUsers = await BookRequest.find({
        bookTitle: book.title,
        status: "Approved",
      }).populate("user");
      const usersToNotify = new Map();
      requestingUsers.forEach((request) => {
        if (request.user) {
          usersToNotify.set(request.user._id.toString(), request.user);
        }
      });

      for (const userDoc of usersToNotify.values()) {
        ensureNotificationsArray(userDoc);
        userDoc.notifications.push({
          message: `The book "${book.title}" is now available in the library!`,
          status: "Approved",
          reason: "Book now available",
          createdAt: new Date(),
          viewed: false,
        });
        await userDoc.save();
      }

      res.json({ message: "Users notified successfully" });
    } catch (error) {
      console.error("Notify users error:", error);
      try {
        const logDir = path.join(__dirname, "..", "logs");
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        fs.appendFileSync(
          path.join(logDir, "notify-errors.log"),
          `${new Date().toISOString()} ${error.stack}\n`
        );
      } catch (loggingError) {
        console.error("Failed to write notify error log:", loggingError);
      }
      res.status(500).json({
        error: "Failed to notify users",
        details:
          process.env.NODE_ENV === "production" ? undefined : error.message,
      });
    }
  }
);

router.post("/clear-notifications", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.notifications = [];
    await user.save();
    res.json({ message: "Notifications cleared successfully" });
  } catch (error) {
    console.error("Clear notifications error:", error);
    res.status(500).json({ error: "Failed to clear notifications" });
  }
});

router.get("/notifications", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("notifications");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    ensureNotificationsArray(user);
    res.json(user.notifications);
  } catch (error) {
    console.error("Fetch notifications error:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

router.get(
  "/admin/notifications",
  authenticateToken,
  adminAuth,
  async (req, res) => {
    try {
      const pendingCount = await BookRequest.countDocuments({ status: "Pending" });
      res.json({ pendingCount });
    } catch (error) {
      console.error("Admin notifications error:", error);
      res.status(500).json({ error: "Failed to fetch admin notifications" });
    }
  }
);

router.put("/notifications/mark-read", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    ensureNotificationsArray(user);
    user.notifications = user.notifications.map((notification) => ({
      ...notification,
      viewed: true,
    }));
    await user.save();
    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark-read error:", error);
    res.status(500).json({ error: "Failed to update notifications" });
  }
});

router.patch(
  "/notifications/:id/mark-read",
  authenticateToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid notification id" });
      }

      const user = await User.findById(req.user._id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      ensureNotificationsArray(user);
      const notification = user.notifications.find(
        (entry) => toStringId(entry._id) === id
      );
      if (!notification) {
        return res.status(404).json({ message: "Notification not found" });
      }

      notification.viewed = true;
      await user.save();

      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Single mark-read error:", error);
      res.status(500).json({ error: "Failed to update notification" });
    }
  }
);

module.exports = router;
