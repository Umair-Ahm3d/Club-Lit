require("dotenv").config();
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Book = require("./models/Book");
const Club = require("./models/Club");
const { User } = require("./models/User");

const defaultUri = "mongodb://127.0.0.1:27017/clubreader";
const mongoUri = process.env.DB || defaultUri;

const placeholderImagePath = path.join(__dirname, "uploads", "images", "placeholder-cover.png");
const placeholderPdfPath = path.join(__dirname, "uploads", "pdfs", "placeholder.pdf");

const ensureDirectory = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const ensurePlaceholderAssets = async () => {
  ensureDirectory(path.dirname(placeholderImagePath));
  ensureDirectory(path.dirname(placeholderPdfPath));

  if (!fs.existsSync(placeholderImagePath)) {
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5AELCyIlFyFOSAAAAB10RVh0U29mdHdhcmUAUGFpbnQuTkVUIHYzLjM2qefiJQAAAB1pVFh0Q3JlYXRpb24gVGltZQA1LzE4LzIwMjQtTSBi4gAAACB0RVh0TW9kaWZpZWQgRGF0ZQA1LzE4LzIwMjQgMDI6MDU6MzIrMDA6MDBxWJrqAAAAEklEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAA4DEAALY2f3gAAAAASUVORK5CYII=";
    fs.writeFileSync(placeholderImagePath, Buffer.from(pngBase64, "base64"));
  }

  if (!fs.existsSync(placeholderPdfPath)) {
    const pdfBase64 =
      "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlIC9QYWdlcwoL0tpZHNbMyAwIFJdCi9Db3VudCAxCj4+CmVuZG9iagozIDAgb2JqCjw8L1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3hbMCAwIDU5NSA4NDJdCi9Db250ZW50cyA0IDAgUgo+PgplbmRvYmoKNCAwIG9iago8PC9MZW5ndGggMjk+PgpzdHJlYW0KSGVsbG8gQ2x1YiBSZWFkZXIhCkVuam95IHlvdXIgbmV3IGJvb2sgY29sbGVjdGlvbi4KZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAxMTIgMDAwMDAgbiAKMDAwMDAwMDE3NCAwMDAwMCBuIAowMDAwMDAwMzI0IDAwMDAwIG4gCjAwMDAwMDA0MjUgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDUKL1Jvb3QgMSAwIFIKPj4Kc3RhcnR4cmVmCjU1MQolJUVPRgo=";
    fs.writeFileSync(placeholderPdfPath, Buffer.from(pdfBase64, "base64"));
  }
};

const sampleBooks = [
  {
    title: "The Midnight Library",
    author: "Matt Haig",
    description:
      "A poignant novel about second chances and the infinite lives we might have lived.",
    genres: ["fiction", "fantasy"],
    coverImage: "/uploads/images/placeholder-cover.png",
    pdfUrl: "/uploads/pdfs/placeholder.pdf",
    pageCount: 320,
  },
  {
    title: "Project Hail Mary",
    author: "Andy Weir",
    description:
      "A lone astronaut must save Earth, encountering unexpected allies along the way.",
    genres: ["science fiction", "adventure"],
    coverImage: "/uploads/images/placeholder-cover.png",
    pdfUrl: "/uploads/pdfs/placeholder.pdf",
    pageCount: 496,
  },
  {
    title: "Atomic Habits",
    author: "James Clear",
    description:
      "Practical strategies for forming good habits, breaking bad ones, and mastering tiny behaviors.",
    genres: ["non-fiction", "self-help"],
    coverImage: "/uploads/images/placeholder-cover.png",
    pdfUrl: "/uploads/pdfs/placeholder.pdf",
    pageCount: 320,
  },
];

const buildSampleClubs = (creatorId) => [
  {
    name: "Midnight Readers",
    description: "A club exploring thought-provoking contemporary fiction.",
    book: "The Midnight Library",
    members: [creatorId],
    createdBy: creatorId,
    active: true,
  },
  {
    name: "Sci-Fi Explorers",
    description: "Discussing mind-bending science fiction adventures weekly.",
    book: "Project Hail Mary",
    members: [creatorId],
    createdBy: creatorId,
    active: true,
  },
];

const connectIfNeeded = async () => {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  await mongoose.connect(mongoUri);
};

const createSeedAdminIfMissing = async () => {
  const email =
    (process.env.SEED_ADMIN_EMAIL || process.env.MASTER_ADMIN_EMAIL || "support@clubreaders.com").toLowerCase();

  let user = await User.findOne({ email });
  if (user) {
    if (!user.isAdmin) {
      user.isAdmin = true;
      await user.save();
    }
    return user;
  }

  const baseUserName =
    (process.env.SEED_ADMIN_USERNAME ||
      email.split("@")[0] ||
      "seed_admin")
      .replace(/\s+/g, "_")
      .slice(0, 24);

  let candidateUserName = baseUserName;
  let suffix = 1;
  while (await User.exists({ UserName: candidateUserName })) {
    candidateUserName = `${baseUserName}_${suffix}`;
    suffix += 1;
  }

  const existingByUserName = await User.findOne({ UserName: baseUserName });
  if (existingByUserName) {
    if (!existingByUserName.isAdmin) {
      existingByUserName.isAdmin = true;
      await existingByUserName.save();
    }
    if (existingByUserName.email !== email) {
      existingByUserName.email = email;
      await existingByUserName.save();
    }
    return existingByUserName;
  }

  const saltRounds = Number(process.env.SALT) || 10;
  const salt = await bcrypt.genSalt(saltRounds);
  const passwordHash = await bcrypt.hash(
    process.env.SEED_ADMIN_PASSWORD || "Password123!",
    salt
  );

  user = await User.create({
    UserName: candidateUserName,
    email,
    password: passwordHash,
    isAdmin: true,
  });

  return user;
};

const seedDatabase = async ({ silent = false } = {}) => {
  await connectIfNeeded();
  await ensurePlaceholderAssets();

  const seedAdmin = await createSeedAdminIfMissing();

  const bookCount = await Book.countDocuments();
  if (bookCount === 0) {
    await Book.insertMany(sampleBooks);
    if (!silent) {
      console.log(`Seeded ${sampleBooks.length} books.`);
    }
  }

  const clubCount = await Club.countDocuments();
  if (clubCount === 0 && seedAdmin) {
    const sampleClubs = buildSampleClubs(seedAdmin._id);
    await Club.insertMany(sampleClubs);
    if (!silent) {
      console.log(`Seeded ${sampleClubs.length} clubs.`);
    }
  }

  return { booksSeeded: bookCount === 0, clubsSeeded: clubCount === 0 };
};

if (require.main === module) {
  seedDatabase()
    .then((result) => {
      console.log("Database seed completed:", result);
      return mongoose.connection.close();
    })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Seeding failed:", error);
      mongoose.connection.close().finally(() => process.exit(1));
    });
}

module.exports = seedDatabase;
