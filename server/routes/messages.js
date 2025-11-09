const express = require("express");
const mongoose = require("mongoose");
const Message = require("../models/Message");
const { User } = require("../models/User");
const Club = require("../models/Club");
const authenticateToken = require("../middleware/authenticateToken");

const router = express.Router();
const TIME_LIMIT_MS = 5 * 60 * 1000;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const toStringId = (value) => value?.toString();
const serializeMessage = (doc) => {
  const plain = doc?.toObject ? doc.toObject() : { ...doc };
  return {
    ...plain,
    _id: toStringId(plain._id),
    clubId: toStringId(plain.clubId),
    user: toStringId(plain.user),
  };
};

router.post("/", authenticateToken, async (req, res) => {
  try {
    const { message, clubId } = req.body;
    const userId = req.user._id;

    const trimmedMessage = typeof message === "string" ? message.trim() : "";
    if (!trimmedMessage) {
      return res.status(400).json({ error: "Message text is required." });
    }

    if (!isValidObjectId(clubId)) {
      return res.status(400).json({ error: "Invalid clubId format." });
    }

    const [club, user] = await Promise.all([
      Club.findById(clubId).select("members"),
      User.findById(userId).select("UserName avatar"),
    ]);

    if (!club) {
      return res.status(404).json({ error: "Club not found." });
    }

    const memberIds = Array.isArray(club.members)
      ? club.members.map(toStringId)
      : [];
    const isMember = memberIds.includes(userId);
    if (!isMember) {
      return res
        .status(403)
        .json({ error: "You must be a member of this club to chat." });
    }

    if (!user) {
      return res
        .status(401)
        .json({ error: "User context missing. Please re-authenticate." });
    }

    const newMessage = await Message.create({
      user: userId,
      username: user.UserName || "Unknown User",
      avatar: user.avatar || "",
      message: trimmedMessage,
      clubId,
      timestamp: new Date(),
    });

    const serialized = serializeMessage(newMessage);
    const io = req.app.get("io");
    if (io) {
      io.to(serialized.clubId).emit("newMessage", serialized);
    }

    res.status(201).json(serialized);
  } catch (error) {
    console.error("Create message error:", error);
    res.status(500).json({ error: "Failed to create message." });
  }
});

router.get("/:clubId", authenticateToken, async (req, res) => {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;
    const limitParam = Number.parseInt(req.query.limit, 10);
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(limitParam, 500)
        : 200;

    if (!isValidObjectId(clubId)) {
      return res.status(400).json({ error: "Invalid clubId format." });
    }

    const club = await Club.findById(clubId).select("members");
    if (!club) {
      return res.status(404).json({ error: "Club not found." });
    }

    const memberIds = Array.isArray(club.members)
      ? club.members.map(toStringId)
      : [];
    const isMember = memberIds.includes(userId);
    if (!isMember) {
      return res
        .status(403)
        .json({ error: "You must be a member of this club to view messages." });
    }

    const messages = await Message.find({ clubId })
      .sort({ timestamp: 1 })
      .limit(limit)
      .lean();

    const normalized = messages.map(serializeMessage);

    res.json(normalized);
  } catch (error) {
    console.error("Fetch messages error:", error);
    res.status(500).json({ error: "Failed to fetch messages." });
  }
});

router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const userId = req.user._id;

    const trimmedMessage = typeof message === "string" ? message.trim() : "";
    if (!trimmedMessage) {
      return res.status(400).json({ error: "Message text is required." });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid message id format." });
    }

    const messageDoc = await Message.findById(id);
    if (!messageDoc) {
      return res.status(404).json({ error: "Message not found." });
    }

    if (toStringId(messageDoc.user) !== userId) {
      return res
        .status(403)
        .json({ error: "You can only edit your own messages." });
    }

    const elapsed = Date.now() - new Date(messageDoc.timestamp).getTime();
    if (elapsed > TIME_LIMIT_MS) {
      return res.status(403).json({
        error: "Messages can only be edited within five minutes of sending.",
      });
    }

    messageDoc.message = trimmedMessage;
    await messageDoc.save();

    const serialized = serializeMessage(messageDoc);
    const io = req.app.get("io");
    if (io) {
      io.to(serialized.clubId).emit("editMessage", serialized);
    }

    res.json(serialized);
  } catch (error) {
    console.error("Update message error:", error);
    res.status(500).json({ error: "Failed to update message." });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid message id format." });
    }

    const messageDoc = await Message.findById(id);
    if (!messageDoc) {
      return res.status(404).json({ error: "Message not found." });
    }

    const club = await Club.findById(messageDoc.clubId).select("createdBy");
    if (!club) {
      return res.status(404).json({ error: "Club not found." });
    }

    const isOwner = toStringId(messageDoc.user) === userId;
    const isClubCreator = toStringId(club.createdBy) === userId;
    const isAdmin = Boolean(req.user.isAdmin);

    const elapsed = Date.now() - new Date(messageDoc.timestamp).getTime();
    const withinEditWindow = elapsed <= TIME_LIMIT_MS;

    if (!(isAdmin || isClubCreator || (isOwner && withinEditWindow))) {
      return res
        .status(403)
        .json({ error: "You do not have permission to delete this message." });
    }

    await Message.findByIdAndDelete(id);

    const io = req.app.get("io");
    if (io) {
      io.to(toStringId(messageDoc.clubId)).emit("deleteMessage", toStringId(id));
    }

    res.json({ success: true, message: "Message deleted successfully." });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({ error: "Failed to delete message." });
  }
});

router.delete(
  "/removeMember/:clubId/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const { clubId, userId } = req.params;

      if (!isValidObjectId(clubId) || !isValidObjectId(userId)) {
        return res.status(400).json({ error: "Invalid identifier format." });
      }

      const club = await Club.findById(clubId).select("createdBy members");
      if (!club) {
        return res.status(404).json({ error: "Club not found." });
      }

      const isCreator = toStringId(club.createdBy) === req.user._id;
      if (!isCreator && !req.user.isAdmin) {
        return res
          .status(403)
          .json({ error: "Only club creators or admins can remove members." });
      }

      const memberIndex = Array.isArray(club.members)
        ? club.members.findIndex(
            (memberId) => toStringId(memberId) === userId
          )
        : -1;
      if (memberIndex === -1) {
        return res.status(404).json({ error: "Member not found in club." });
      }

      club.members.splice(memberIndex, 1);
      await club.save();

      const member = await User.findById(userId);
      if (!member) {
        return res.status(404).json({ error: "User not found." });
      }

      member.joinedClubs = (member.joinedClubs || []).filter(
        (clubRef) => toStringId(clubRef) !== clubId
      );
      await member.save();

      res.json({ message: "Member removed successfully." });
    } catch (error) {
      console.error("Remove member error:", error);
      res.status(500).json({ error: "Failed to remove member from club." });
    }
  }
);

module.exports = router;
