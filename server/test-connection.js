require("dotenv").config();
const mongoose = require("mongoose");

const defaultUri = "mongodb://127.0.0.1:27017/clubreader";
const mongoUri = process.env.DB || process.env.MONGODB_URI || defaultUri;

const testConnection = async () => {
  try {
    await mongoose.connect(mongoUri);
    const { host, port, name } = mongoose.connection;
    console.log("MongoDB connection successful!");
    console.log(`Connected to ${host}:${port}/${name}`);
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

testConnection();
