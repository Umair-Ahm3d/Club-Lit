const adminAuth = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Missing authenticated user context." });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({ error: "Access denied: Admins only." });
  }

  next();
};

module.exports = adminAuth;
