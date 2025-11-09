const jwt = require("jsonwebtoken");
const { User } = require("../models/User");

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res
      .status(401)
      .json({ error: "Access denied. Provide a valid Bearer token." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWTPRIVATEKEY);

    const user = await User.findById(decoded._id).select("_id isAdmin");
    if (!user) {
      return res
        .status(401)
        .json({ error: "User associated with this token no longer exists." });
    }

    req.user = {
      _id: user._id.toString(),
      isAdmin: Boolean(user.isAdmin),
    };

    next();
  } catch (error) {
    const status = error.name === "TokenExpiredError" ? 401 : 403;
    res.status(status).json({
      error: "Token verification failed",
      details: error.message,
    });
  }
};

module.exports = authenticateToken;
