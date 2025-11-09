const express = require("express");
const { ChatGroq } = require("@langchain/groq");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");
const Book = require("../models/Book");
const Club = require("../models/Club");

const DEFAULT_MODEL = process.env.GROQ_MODEL || "mixtral-8x7b-32768";

let cachedModel = null;
const getModel = () => {
  if (!process.env.GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY is not configured. Set the environment variable to enable AI chat."
    );
  }
  if (!cachedModel) {
    cachedModel = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: DEFAULT_MODEL,
      temperature: 0.6,
    });
  }
  return cachedModel;
};

const intentConfig = {
  greetings: {
    patterns: ["hi", "hello", "hey", "howdy"],
    defaultActions: ["Browse Books", "View Clubs"],
  },
  recommendations: {
    patterns: ["recommend", "suggest", "what should i read", "reading list"],
    defaultActions: ["Top Rated", "New Releases"],
  },
  clubs: {
    patterns: ["club", "group", "discussion", "community"],
    defaultActions: ["View Clubs", "Create Club"],
  },
  summary: {
    patterns: ["summary", "synopsis", "tell me about", "what is", "plot"],
    defaultActions: ["Recommendations", "Similar Books"],
  },
};

const escapeRegExp = (value = "") =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractGenreTerms = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean);
        }
      } catch (_) {
        // ignore and fall back
      }
    }
    return trimmed
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
};

const detectIntent = (message, availableGenres) => {
  const lower = message.toLowerCase();
  for (const rawGenre of availableGenres) {
    const candidates = extractGenreTerms(rawGenre);
    for (const candidate of candidates) {
      const escaped = escapeRegExp(candidate);
      if (!escaped) continue;
      const pattern = new RegExp(`\\b${escaped}\\b`, "i");
      if (pattern.test(lower)) {
        return { category: "genre", genre: candidate };
      }
    }
  }
  for (const [category, config] of Object.entries(intentConfig)) {
    if (config.patterns.some((pattern) => lower.includes(pattern))) {
      return { category, genre: null };
    }
  }
  return { category: "default", genre: null };
};

const getTopBooks = async (genre) => {
  const matchStage = { averageRating: { $gte: 4 } };
  if (genre) {
    matchStage.genres = {
      $elemMatch: { $regex: escapeRegExp(genre), $options: "i" },
    };
  }
  return Book.aggregate([
    { $match: matchStage },
    { $sort: { averageRating: -1, ratingCount: -1, createdAt: -1 } },
    { $limit: 3 },
    {
      $project: {
        title: 1,
        author: 1,
        genres: 1,
        description: 1,
        averageRating: 1,
      },
    },
  ]);
};

const getTopClubs = async () =>
  Club.aggregate([
    {
      $addFields: {
        memberCount: { $size: { $ifNull: ["$members", []] } },
      },
    },
    { $sort: { memberCount: -1, createdAt: -1 } },
    { $limit: 3 },
    {
      $project: {
        name: 1,
        description: 1,
        memberCount: 1,
        book: 1,
      },
    },
  ]);

const extractBookTitle = (message) => {
  if (!message) return null;
  const patterns = [
    /summary of ([^?!.]+)/i,
    /tell me about ([^?!.]+)/i,
    /what is ([^?!.]+) about/i,
    /synopsis of ([^?!.]+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
};

const findBookSummary = async (message) => {
  const potentialTitle = extractBookTitle(message);
  if (!potentialTitle) {
    return null;
  }

  const book = await Book.findOne({
    title: { $regex: escapeRegExp(potentialTitle), $options: "i" },
  }).select("title author description genres averageRating");

  if (!book) {
    return null;
  }

  return {
    _id: book._id,
    title: book.title,
    author: book.author,
    description: book.description,
    genres: book.genres,
    averageRating: book.averageRating,
  };
};

const promptTemplate = ChatPromptTemplate.fromMessages([
  [
    "system",
    `You are BookBuddy, a helpful assistant for an online reading community.
Use the provided data about genres, clubs, and books to craft concise (<=4 sentences) responses.
Highlight relevant books or clubs when available and be enthusiastic but grounded.
If no data is supplied, guide the user to other choices.
Always conclude with a question or suggestion that keeps the conversation going.`,
  ],
  [
    "human",
    `User message: {user_input}
Detected category: {detected_category}
Detected genre: {detected_genre}
Available genres: {genres_list}
Suggested genres: {suggested_genres}
Top books: {books_context}
Featured clubs: {clubs_context}
Book summary context: {book_summary_context}
Please craft your reply.`,
  ],
]);

router.post("/chat", authenticateToken, async (req, res) => {
  try {
    const message = (req.body.message || "").trim();
    if (!message) {
      return res.status(400).json({ text: "Please provide a message." });
    }

    const genres = await Book.distinct("genres");
    const cleanedGenres = Array.from(
      genres.reduce((set, entry) => {
        extractGenreTerms(entry).forEach((term) => set.add(term));
        return set;
      }, new Set())
    );

    const { category, genre } = detectIntent(message, cleanedGenres);
    const wantsGenre = category === "genre";
    const wantsClubs = category === "clubs";

    const [topBooks, topClubs, summaryMatch] = await Promise.all([
      getTopBooks(wantsGenre ? genre : null),
      wantsClubs ? getTopClubs() : Promise.resolve([]),
      category === "summary" ? findBookSummary(message) : Promise.resolve(null),
    ]);

    const suggestedGenres =
      wantsGenre && genre
        ? cleanedGenres
            .filter(
              (item) => item && item.toLowerCase() !== genre.toLowerCase()
            )
            .slice(0, 5)
        : [];

    let actions = [];
    if (wantsGenre) {
      actions = suggestedGenres.length ? suggestedGenres : ["Browse Genres"];
    } else if (intentConfig[category]?.defaultActions) {
      actions = intentConfig[category].defaultActions;
    } else {
      actions = ["Recommendations", "Clubs", "Help"];
    }

    const model = getModel();
    const chain = promptTemplate.pipe(model);
    const response = await chain.invoke({
      user_input: message,
      detected_category: category,
      detected_genre: genre ?? "None",
      genres_list: cleanedGenres.join(", ") || "None",
      suggested_genres: suggestedGenres.join(", ") || "None",
      books_context:
        topBooks
          .map(
            (book, index) =>
              `${index + 1}. ${book.title} by ${book.author} (Rating: ${
                book.averageRating ?? "N/A"
              })${book.description ? ` — ${book.description}` : ""}`
          )
          .join("\n") || "None",
      clubs_context:
        wantsClubs && topClubs.length
          ? topClubs
              .map(
                (club, index) =>
                  `${index + 1}. ${club.name} (${club.memberCount} members)${
                    club.description ? ` — ${club.description}` : ""
                  }`
              )
              .join("\n")
          : "None",
      book_summary_context: summaryMatch
        ? `${summaryMatch.title} by ${
            summaryMatch.author || "Unknown"
          }${summaryMatch.description ? ` — ${summaryMatch.description}` : ""}`
        : "None",
    });

    const text =
      typeof response?.content === "string"
        ? response.content
        : Array.isArray(response?.content)
        ? response.content.map((part) => part.text ?? "").join("")
        : response?.text || "Let's talk books! What would you like to discuss?";

    res.json({
      text: text.trim(),
      actions,
      books: topBooks,
      clubs: topClubs,
      genre: wantsGenre ? genre : null,
      suggestedGenres: wantsGenre && !topBooks.length ? suggestedGenres : [],
      bookSummary: summaryMatch,
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      text:
        "Our reading assistant is unavailable right now, but I'm happy to chat about books! Ask away.",
      actions: ["Recommendations", "Clubs", "Help"],
      books: [],
      clubs: [],
      suggestedGenres: [],
    });
  }
});

module.exports = router;
