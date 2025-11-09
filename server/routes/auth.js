const express = require("express");
const router = express.Router();
const { User } = require("../models/User");
const bcrypt = require("bcrypt");
const Joi = require("joi");
const jwt = require("jsonwebtoken");
const authenticateToken = require("../middleware/authenticateToken");
const multer = require("multer");
const mongoose = require("mongoose");
// REGISTRATION ROUTE - ADD THIS
router.post("/register", async (req, res) => {
  try {
    const { error, value } = validateRegister(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const userName = value.UserName.trim();
    const email = value.email.trim().toLowerCase();
    const password = value.password;

    const existingUser = await User.findOne({
      $or: [{ email }, { UserName: userName }],
    });

    if (existingUser) {
      const conflictField =
        existingUser.email === email ? "Email" : "Username";
      return res
        .status(409)
        .json({ message: `${conflictField} already exists` });
    }

    const saltRounds = Number(process.env.SALT) || 10;
    const salt = await bcrypt.genSalt(saltRounds);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      UserName: userName,
      email,
      password: hashedPassword,
      isAdmin: false,
      surveyCompleted: false,
    });

    const token = jwt.sign(
      { _id: newUser._id, isAdmin: newUser.isAdmin },
      process.env.JWTPRIVATEKEY,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "User created successfully",
      token,
      user: {
        id: newUser._id,
        name: newUser.UserName,
        email: newUser.email,
        isAdmin: newUser.isAdmin,
        surveyCompleted: newUser.surveyCompleted,
      },
    });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
});

// Validation function for registration - ADD THIS TOO
const validateRegister = (data) => {
    const schema = Joi.object({
        UserName: Joi.string().required().label("Username"),
        email: Joi.string().email().required().label("Email"),
        password: Joi.string().min(6).required().label("Password"),
    });
    return schema.validate(data);
};

const loginSchema = Joi.object({
  email: Joi.string().email().required().label("Email"),
  password: Joi.string().min(6).required().label("Password"),
});

router.post("/login", async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: error.details[0].message });
    }

    const email = value.email.trim().toLowerCase();
    const password = value.password;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { _id: user._id, isAdmin: user.isAdmin },
      process.env.JWTPRIVATEKEY,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login Successful",
      token,
      user: {
        id: user._id,
        name: user.UserName,
        email: user.email,
        isAdmin: user.isAdmin,
        favorites: user.favorites,
        surveyCompleted: user.surveyCompleted,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/logout", authenticateToken, (req, res) => {
	res.json({ message: "Logout successful" });
});

router.post("/reset-password", async (req, res) => {
	try {
		const schema = Joi.object({
			email: Joi.string().email().required().label("Email"),
			newPassword: Joi.string().min(6).required().label("New Password"),
			confirmPassword: Joi.valid(Joi.ref("newPassword"))
				.required()
				.label("Confirm Password")
				.messages({ "any.only": "Passwords do not match" }),
		});

		const { error, value } = schema.validate(req.body);
		if (error) {
			return res.status(400).json({ message: error.details[0].message });
		}

		const user = await User.findOne({ email: value.email.toLowerCase() });
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		const saltRounds = Number(process.env.SALT) || 10;
		const salt = await bcrypt.genSalt(saltRounds);
		user.password = await bcrypt.hash(value.newPassword, salt);
		await user.save();

		res.json({ message: "Password reset successful" });
	} catch (error) {
		console.error("Reset password error:", error);
		res.status(500).json({ message: "Internal Server Error" });
	}
});

// Get user profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("favorites")
      .populate("bookHistory")
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
      favorites: user.favorites || [],
      bookHistory: user.bookHistory || [],
      isAdmin: user.isAdmin,
      surveyCompleted: user.surveyCompleted,
    });
  } catch (error) {
    console.error("Profile Fetch Error:", error);
    res.status(500).json({
      message: "Internal Server Error",
      error: error.message,
    });
  }
});
  
  // Set up storage engine for Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Profile Update with Avatar Upload
router.put(
  "/profile",
  authenticateToken,
  upload.single("avatar"),
  async (req, res) => {
    try {
      const { name, email, bio } = req.body;
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

      if (req.file) {
        user.avatar = `/uploads/${req.file.filename}`;
      }

      await user.save();

      res.json({
        message: "Profile updated successfully",
        user: {
          id: user._id,
          name: user.UserName,
          email: user.email,
          bio: user.bio,
          avatar: user.avatar,
        },
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);
  
// POST route for book history (unchanged)
router.post("/book-history", authenticateToken, async (req, res) => {
	try {
	  const userId = req.user._id; // Get the logged-in user ID
	  const { bookId } = req.body; // Book ID passed from the client
	  if (!bookId || !mongoose.Types.ObjectId.isValid(bookId)) {
		return res.status(400).send("Valid bookId is required");
	  }
	  // Find the user and add the book to their history
	  const user = await User.findById(userId);
	  if (!user) {
		return res.status(404).send("User not found");
	  }

	  if (!Array.isArray(user.bookHistory)) {
		user.bookHistory = [];
	  }

	  const alreadyStored = user.bookHistory.some((id) =>
		id.equals(bookId)
	  );
	  if (!alreadyStored) {
		user.bookHistory.push(bookId);
		await user.save();
	  }
  
	  res.status(200).send("Book added to history");
	} catch (error) {
	  console.error("Error updating book history:", error);
	  res.status(500).send("Error updating book history");
	}
  });  

  router.get("/me", authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select("-password"); // Exclude password
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json({
			_id: user._id,
			username: user.UserName,  // ✅ Explicitly use `UserName`
			email: user.email,
			avatar: user.avatar,
		  });
    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "Server error" });
    }
});
  
module.exports = router;
