const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const { User } = require("../models/User");
const Club = require("../models/Club");
const authenticateToken = require("../middleware/authenticateToken");
const adminAuth = require("../middleware/adminAuth");

const isValidId = (value) => mongoose.Types.ObjectId.isValid(value);
const toStringId = (value) => value?.toString();

const sanitizeUserRef = (user) => {
  if (!user) return null;
  if (user.toObject) {
    user = user.toObject();
  }
  if (user._id) {
    return {
      _id: toStringId(user._id),
      UserName: user.UserName ?? null,
      email: user.email ?? null,
      avatar: user.avatar ?? null,
    };
  }
  return {
    _id: toStringId(user),
    UserName: null,
    email: null,
    avatar: null,
  };
};

const serializeClub = (club) => {
  if (!club) return club;
  const doc = club.toObject ? club.toObject() : { ...club };
  doc._id = toStringId(doc._id);
  doc.createdBy = sanitizeUserRef(doc.createdBy);
  doc.members = Array.isArray(doc.members)
    ? doc.members
        .map(sanitizeUserRef)
        .filter(Boolean)
    : [];
  return doc;
};

router.get("/", authenticateToken, async (req, res) => {
  try {
    const clubs = await Club.find()
      .populate("createdBy", "UserName avatar")
      .populate("members", "UserName avatar")
      .populate("book", "genres title author");

    res.json(clubs.map(serializeClub));
  } catch (error) {
    console.error("Error fetching clubs:", error);
    res
      .status(500)
      .json({ message: "Error fetching clubs", error: error.message });
  }
});

router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, book, description, active } = req.body;

    if (!name || !book || !description) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (!req.user?._id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const newClub = new Club({
      name: name.trim(),
      book,
      description: description.trim(),
      active: typeof active === "boolean" ? active : true,
      createdBy: req.user._id,
      members: [req.user._id],
    });

    await newClub.save();

    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { joinedClubs: newClub._id },
    });

    await newClub.populate([
      { path: "createdBy", select: "UserName email avatar" },
      { path: "members", select: "UserName email avatar" },
      { path: "book", select: "title author genres" },
    ]);

    res.status(201).json(serializeClub(newClub));
  } catch (error) {
    console.error("Error creating club:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/joinClub", authenticateToken, async (req, res) => {
  try {
    const { clubId } = req.body;
    const userId = req.user._id;

    if (!isValidId(userId) || !isValidId(clubId)) {
      return res.status(400).json({ message: "Invalid user or club ID" });
    }

    const [user, club] = await Promise.all([
      User.findById(userId),
      Club.findById(clubId),
    ]);

    if (!user || !club) {
      return res.status(404).json({ message: "User or club not found" });
    }

    club.members = Array.isArray(club.members) ? club.members : [];
    if (!club.members.some((member) => toStringId(member) === userId)) {
      club.members.push(userId);
      await club.save();
    }

    user.joinedClubs = Array.isArray(user.joinedClubs) ? user.joinedClubs : [];
    if (!user.joinedClubs.some((clubRef) => toStringId(clubRef) === clubId)) {
      user.joinedClubs.push(clubId);
      await user.save();
    }

    await club.populate([
      { path: "createdBy", select: "UserName email avatar" },
      { path: "members", select: "UserName email avatar" },
      { path: "book", select: "title author genres" },
    ]);

    res.status(200).json({
      message: "Joined club successfully",
      club: serializeClub(club),
    });
  } catch (error) {
    console.error("Error joining club:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/leaveClub", authenticateToken, async (req, res) => {
  try {
    const { clubId } = req.body;
    const userId = req.user._id;

    if (!isValidId(clubId) || !isValidId(userId)) {
      return res.status(400).json({ message: "Invalid user or club ID" });
    }

    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: "Club not found" });
    }

    const isCreator = toStringId(club.createdBy) === userId;
    if (isCreator) {
      return res.status(400).json({
        message: "Club creators must delete the club instead of leaving it.",
      });
    }

    club.members = (club.members || []).filter(
      (member) => toStringId(member) !== userId
    );
    await club.save();

    await User.findByIdAndUpdate(userId, { $pull: { joinedClubs: clubId } });

    res.status(200).json({ message: "Left club successfully" });
  } catch (error) {
    console.error("Error leaving club:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/userClubs", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "joinedClubs",
      populate: [
        { path: "createdBy", select: "UserName avatar" },
        { path: "members", select: "UserName avatar" },
      ],
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const clubs = Array.isArray(user.joinedClubs)
      ? user.joinedClubs.map(serializeClub)
      : [];

    res.json(clubs);
  } catch (error) {
    console.error("Error fetching user clubs:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid club ID" });
    }

    const club = await Club.findById(id)
      .populate("createdBy", "UserName avatar email")
      .populate("members", "UserName avatar email joinedClubs")
      .populate("book", "title author genres description");

    if (!club) {
      return res.status(404).json({ message: "Club not found" });
    }

    const members = Array.isArray(club.members) ? club.members : [];
    const isMember = members.some(
      (member) => toStringId(member._id ?? member) === req.user._id
    );

    if (!isMember && toStringId(club.createdBy?._id ?? club.createdBy) !== req.user._id) {
      return res.status(403).json({
        message: "You must be a member or the club creator to view details.",
      });
    }

    res.json(serializeClub(club));
  } catch (error) {
    console.error("Error fetching club:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/admin/all", authenticateToken, adminAuth, async (req, res) => {
  try {
    const clubs = await Club.find()
      .populate("createdBy", "UserName email")
      .populate("members", "UserName email");

    res.json(clubs.map(serializeClub));
  } catch (error) {
    console.error("Error fetching clubs for admin:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

router.delete(
  "/:id",
  authenticateToken,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!isValidId(id)) {
        return res.status(400).json({ message: "Invalid club ID" });
      }

      const club = await Club.findById(id);
      if (!club) {
        return res.status(404).json({ message: "Club not found" });
      }

      const isCreator = toStringId(club.createdBy) === req.user._id;
      const isAdmin = Boolean(req.user.isAdmin);
      if (!(isCreator || isAdmin)) {
        return res.status(403).json({
          message: "Only the club creator or an admin can delete a club.",
        });
      }

      req.club = club;
      req.isAdminDeleting = isAdmin && !isCreator;
      next();
    } catch (error) {
      console.error("Club delete auth error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
  async (req, res) => {
    try {
      const club = req.club;
      const isAdmin = req.isAdminDeleting;

      await Club.findByIdAndDelete(club._id);

      await User.updateMany(
        { joinedClubs: club._id },
        { $pull: { joinedClubs: club._id } }
      );

      if (isAdmin) {
        const creator = await User.findById(club.createdBy);
        if (creator) {
          creator.notifications = Array.isArray(creator.notifications)
            ? creator.notifications
            : [];
          creator.notifications.push({
            message: `Your club "${club.name}" was deleted by an administrator.`,
            status: "unread",
            createdAt: new Date(),
          });
          await creator.save();
        }
      }

      res.json({
        message: "Club deleted successfully",
        deletedBy: isAdmin ? "admin" : "creator",
      });
    } catch (error) {
      console.error("Club delete error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.delete(
  "/:clubId/removeMember/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const { clubId, userId } = req.params;

      if (!isValidId(clubId) || !isValidId(userId)) {
        return res.status(400).json({ message: "Invalid ID format" });
      }

      const club = await Club.findById(clubId);
      if (!club) {
        return res.status(404).json({ message: "Club not found" });
      }

      const isCreator = toStringId(club.createdBy) === req.user._id;
      const isAdmin = Boolean(req.user.isAdmin);
      if (!(isCreator || isAdmin)) {
        return res.status(403).json({
          message: "Only the club creator or an admin can remove members.",
        });
      }

      const wasMember = club.members.some(
        (member) => toStringId(member) === userId
      );
      if (!wasMember) {
        return res.status(404).json({ message: "Member not found in club" });
      }

      club.members = club.members.filter(
        (member) => toStringId(member) !== userId
      );
      await club.save();

      await User.findByIdAndUpdate(userId, {
        $pull: { joinedClubs: clubId },
      });

      res.json({ message: "Member removed successfully" });
    } catch (error) {
      console.error("Remove member error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.get("/rankings/members", async (req, res) => {
  try {
    const clubs = await Club.aggregate([
      {
        $project: {
          name: 1,
          memberCount: { $size: "$members" },
          createdAt: 1,
        },
      },
      { $sort: { memberCount: -1 } },
      { $limit: 10 },
    ]);
    res.json(clubs);
  } catch (error) {
    console.error("Rankings error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/rankings/most-members", async (req, res) => {
  try {
    const clubs = await Club.aggregate([
      { $project: { name: 1, memberCount: { $size: "$members" } } },
      { $sort: { memberCount: -1 } },
      { $limit: 10 },
    ]);
    res.json(clubs);
  } catch (error) {
    console.error("Most members ranking error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
