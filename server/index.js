require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const connection = require("./db");
const seedDatabase = require("./seed-data");
const promoteUserToAdmin = require("./make-admin");
const userRoutes = require("./routes/users");
const authRoutes = require("./routes/auth");
const clubsRoutes = require("./routes/clubs");
const profileRoutes = require("./routes/profile");
const messageRoutes = require("./routes/messages");
const booksRoutes = require("./routes/books");
const adminRoutes = require("./routes/admin");
const aiRoutes = require("./routes/ai");
const bookRequestRoutes = require("./routes/bookRequest");

const onlineUsers = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
    pingInterval: 10000,
    pingTimeout: 20000,
  },
});

// Connect to MongoDB
connection();

// Make Socket.IO instance available to routers
app.set("io", io);

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// Serve static assets
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check
app.get("/", (req, res) => {
  res.send("Server is running!");
});

// API routes
app.use("/api/users", userRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/clubs", clubsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/books", booksRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/book-requests", bookRequestRoutes);
app.use("/api/ai", aiRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack);
  res.status(500).json({
    message: "Internal Server Error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Socket.IO logic
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("joinRoom", ({ clubId, userId }) => {
    if (!userId || !clubId) {
      console.warn("joinRoom missing userId or clubId", { clubId, userId });
      return;
    }

    socket.join(clubId);
    socket.userId = userId;

    if (!onlineUsers.has(clubId)) {
      onlineUsers.set(clubId, new Set());
    }

    const userSet = onlineUsers.get(clubId);
    userSet.add(userId);

    const members = Array.from(userSet);
    io.to(clubId).emit("onlineUsers", members);
    io.to(clubId).emit("updateOnlineUsers", members);
  });

  socket.on("newMessage", (data) => {
    if (!data?.clubId) {
      console.warn("newMessage missing clubId", data);
      return;
    }
    io.to(data.clubId).emit("newMessage", data);
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
    for (const [clubId, users] of onlineUsers.entries()) {
      if (users.delete(socket.userId)) {
        const members = Array.from(users);
        io.to(clubId).emit("onlineUsers", members);
        io.to(clubId).emit("updateOnlineUsers", members);
      }
    }
  });
});

const startServer = async () => {
  try {
    await connection();
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    process.exit(1);
  }

  try {
    const seedResult = await seedDatabase({ silent: true });
    if (seedResult.booksSeeded || seedResult.clubsSeeded) {
      console.log("Database seed executed:", seedResult);
    }
  } catch (error) {
    console.error("Database seed step failed:", error);
  }

  const adminEmail =
    process.env.MASTER_ADMIN_EMAIL ||
    process.env.SEED_ADMIN_EMAIL ||
    "support@clubreaders.com";

  try {
    await promoteUserToAdmin(adminEmail, { quiet: true });
  } catch (error) {
    console.warn(
      `Could not ensure admin account (${adminEmail}): ${error.message}`
    );
  }

  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Startup failure:", error);
  process.exit(1);
});
