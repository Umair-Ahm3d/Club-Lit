require("dotenv").config();
const mongoose = require("mongoose");
const { User } = require("./models/User");

const defaultUri = "mongodb://127.0.0.1:27017/clubreader";
const mongoUri = process.env.DB || defaultUri;

const connectIfNeeded = async () => {
  if (mongoose.connection.readyState === 1) {
    return false;
  }
  await mongoose.connect(mongoUri);
  return true;
};

const promoteUserToAdmin = async (email, { quiet = false } = {}) => {
  if (!email) {
    throw new Error("An email address is required to promote a user to admin.");
  }

  const closeWhenDone = await connectIfNeeded();

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw new Error(`User not found with email: ${email}`);
    }

    if (user.isAdmin) {
      if (!quiet) {
        console.log(`User ${email} is already an admin.`);
      }
      return user;
    }

    user.isAdmin = true;
    await user.save();

    if (!quiet) {
      console.log(`User ${email} has been promoted to admin.`);
    }

    return user;
  } finally {
    if (closeWhenDone) {
      await mongoose.connection.close();
    }
  }
};

if (require.main === module) {
  const emailArg = process.argv[2] || process.env.MASTER_ADMIN_EMAIL;
  if (!emailArg) {
    console.error(
      "Usage: node make-admin.js <email>\nSet MASTER_ADMIN_EMAIL or pass an email argument."
    );
    process.exit(1);
  }

  promoteUserToAdmin(emailArg)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Failed to promote admin:", error.message);
      process.exit(1);
    });
}

module.exports = promoteUserToAdmin;
