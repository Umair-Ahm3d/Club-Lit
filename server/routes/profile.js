const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const authenticateToken = require("../middleware/authenticateToken");
const { User } = require("../models/User");

// Fetch user profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("bookHistory")
      .populate("favorites")
      .select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      userId: user._id,
      name: user.UserName,
      email: user.email,
      bio: user.bio,
      avatar: user.avatar,
      bookHistory: user.bookHistory || [],
      favorites: user.favorites || [],
      comments: user.comments || [],
    });
  } catch (error) {
    console.error("Profile Fetch Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Update user profile
router.put("/profile", authenticateToken, async (req, res) => {
  try {
    const { name, email, bio, avatar } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (typeof name === "string" && name.trim() && name.trim() !== user.UserName) {
      const existingUserName = await User.findOne({
        _id: { $ne: user._id },
        UserName: name.trim(),
      });
      if (existingUserName) {
        return res.status(409).json({ message: "Username already in use" });
      }
      user.UserName = name.trim();
    }

    if (typeof email === "string" && email.trim()) {
      const normalizedEmail = email.trim().toLowerCase();
      if (normalizedEmail !== user.email) {
        const existingEmail = await User.findOne({
          _id: { $ne: user._id },
          email: normalizedEmail,
        });
        if (existingEmail) {
          return res.status(409).json({ message: "Email already in use" });
        }
        user.email = normalizedEmail;
      }
    }

    if (typeof bio === "string") {
      user.bio = bio.trim();
    }

    if (typeof avatar === "string") {
      user.avatar = avatar.trim();
    }

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        name: user.UserName,
        email: user.email,
        bio: user.bio,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error("Profile Update Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Fetch book history
router.get("/book-history", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("bookHistory");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user.bookHistory || []);
  } catch (error) {
    console.error("Book History Fetch Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Add book to history
router.post("/book-history", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.body;
    if (!bookId || !mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Valid bookId is required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!Array.isArray(user.bookHistory)) {
      user.bookHistory = [];
    }

    const alreadyStored = user.bookHistory.some((id) => id.equals(bookId));
    if (!alreadyStored) {
      user.bookHistory.push(bookId);
      await user.save();
    }

    res.status(200).json({ message: "Book added to history" });
  } catch (error) {
    console.error("Book History Update Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Fetch favorite books
router.get("/favorite", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate("favorites");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user.favorites || []);
  } catch (error) {
    console.error("Favorite Books Fetch Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Toggle favorite book
router.post("/favorite", authenticateToken, async (req, res) => {
  try {
    const { bookId } = req.body;
    if (!bookId || !mongoose.Types.ObjectId.isValid(bookId)) {
      return res.status(400).json({ message: "Valid bookId is required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!Array.isArray(user.favorites)) {
      user.favorites = [];
    }

    const index = user.favorites.findIndex((id) => id.equals(bookId));
    if (index > -1) {
      user.favorites.splice(index, 1);
    } else {
      user.favorites.push(bookId);
    }

    await user.save();
    res.json({ isFavorite: index === -1 });
  } catch (error) {
    console.error("Favorite Toggle Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Save user comment and rating
router.post("/comment", authenticateToken, async (req, res) => {
  try {
    const { bookTitle, comment, rating } = req.body;
    if (!bookTitle || !comment) {
      return res
        .status(400)
        .json({ message: "bookTitle and comment are required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!Array.isArray(user.comments)) {
      user.comments = [];
    }

    const numericRating =
      typeof rating === "number" ? Math.max(0, Math.min(5, rating)) : undefined;

    const existingComment = user.comments.find(
      (c) => c.bookTitle === bookTitle
    );
    if (existingComment) {
      existingComment.text = comment;
      existingComment.rating = numericRating;
      existingComment.updatedAt = new Date();
    } else {
      user.comments.push({
        bookTitle,
        text: comment,
        rating: numericRating,
        updatedAt: new Date(),
      });
    }
    await user.save();
    res.json({ message: "Comment saved successfully" });
  } catch (error) {
    console.error("Comment Save Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = router;
