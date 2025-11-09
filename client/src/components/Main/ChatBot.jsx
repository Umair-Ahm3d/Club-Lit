import React, { useMemo, useState } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FiSend, FiMinimize2, FiMaximize2 } from "react-icons/fi";
import "./ChatBot.css";
import botIcon from "./bot.jpeg";

const INITIAL_MESSAGE = {
  from: "bot",
  text: "Hi! I'm BookBuddy AI — ask me for book picks, club suggestions, or quick summaries.",
  animation: "fadeIn",
  books: [],
  clubs: [],
  actions: [],
  suggestedGenres: [],
};

const ChatBot = () => {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [userMessage, setUserMessage] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);

  const appendMessage = (entry) =>
    setMessages((prev) => [
      ...prev,
      {
        books: [],
        clubs: [],
        actions: [],
        suggestedGenres: [],
        ...entry,
        animation: entry.animation ?? "slideInLeft",
      },
    ]);

  const ensureResponseShape = (payload = {}) => ({
    text: payload.text?.replace(/\r\n/g, "\n") ?? "",
    books: Array.isArray(payload.books) ? payload.books : [],
    clubs: Array.isArray(payload.clubs) ? payload.clubs : [],
    actions: Array.isArray(payload.actions) ? payload.actions : [],
    genre: payload.genre ?? null,
    suggestedGenres: Array.isArray(payload.suggestedGenres)
      ? payload.suggestedGenres
      : [],
    bookSummary: payload.bookSummary ?? null,
  });

  const requestResponse = async (content) => {
    try {
      const { data } = await axios.post(
        "http://localhost:8080/api/ai/chat",
        { message: content },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );
      return ensureResponseShape(data);
    } catch {
      return ensureResponseShape({
        text:
          "Our librarians are tied up right now. Try one of the quick actions below or ask again in a moment.",
        actions: ["Browse Books", "View Clubs"],
      });
    }
  };

  const handleSendMessage = async (overrideMessage) => {
    const content = overrideMessage ?? userMessage;
    if (!content.trim()) {
      return;
    }

    appendMessage({
      from: "user",
      text: content,
      animation: "slideInRight",
    });

    if (!overrideMessage) {
      setUserMessage("");
    }

    setIsBotTyping(true);

    const response = await requestResponse(content);

    setTimeout(() => {
      appendMessage({
        from: "bot",
        ...response,
      });
      setIsBotTyping(false);
    }, 750);
  };

  const handleQuickAction = (action) => {
    handleSendMessage(action);
  };

  const hasHistory = useMemo(() => messages.length > 0, [messages]);

  return (
    <div className="chatbot-wrapper">
      {isChatOpen && (
        <button
          type="button"
          className="chatbot-close-floating"
          onClick={() => setIsChatOpen(false)}
          aria-label="Close chat"
          title="Close"
        >
          ×
        </button>
      )}
      <button
        type="button"
        className={`chatbot-launcher ${isChatOpen ? "active" : ""}`}
        onClick={() => {
          setIsChatOpen((open) => !open);
          if (isChatOpen) {
            setIsCollapsed(false);
          }
        }}
        aria-label={isChatOpen ? "Hide BookBuddy chat" : "Open BookBuddy chat"}
      >
        <img src={botIcon} alt="BookBuddy AI" className="bot-avatar" />
        {!isChatOpen && hasHistory && <span className="notification-dot" />}
      </button>

      {isChatOpen && (
        <div className={`chatbot-container ${isCollapsed ? "collapsed" : ""}`}>
          <div className="chatbot-header">
            <div className="ai-title">
              <h3>BookBuddy AI</h3>
              <span className="ai-status">Online • ready to help</span>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="collapse-btn"
                onClick={() => setIsCollapsed((v) => !v)}
                aria-label={isCollapsed ? "Expand chat window" : "Collapse chat body"}
              >
                {isCollapsed ? <FiMaximize2 /> : <FiMinimize2 />}
              </button>
              {/* <button
                type="button"
                className="close-btn"
                onClick={() => setIsChatOpen(false)}
                aria-label="Close chat window"
              >
                ×
              </button> */}
            </div>
          </div>

          {!isCollapsed && (
            <>
              <div className="chatbot-messages">
                {messages.map((msg, index) => (
                  <div
                    key={`${msg.from}-${index}`}
                    className={`message-bubble ${msg.from}`}
                    data-animation={msg.animation}
                  >
                    <div className="message-content">
                      {msg.genre && (
                        <div className="genre-header">Genre: {msg.genre}</div>
                      )}

                      {msg.bookSummary && (
                        <div className="book-summary">
                          <h4>{msg.bookSummary.title}</h4>
                          {msg.bookSummary.author && (
                            <p className="author">by {msg.bookSummary.author}</p>
                          )}
                          {msg.bookSummary.description && (
                            <p>{msg.bookSummary.description}</p>
                          )}
                        </div>
                      )}

                      <ReactMarkdown
                        className="markdown-body"
                        remarkPlugins={[remarkGfm]}
                      >
                        {msg.text}
                      </ReactMarkdown>

                      {msg.books.length > 0 && (
                        <div className="book-recommendations">
                          <h4>Book recommendations</h4>
                          {msg.books.map((book) => (
                            <div key={book._id ?? book.title} className="book-card">
                              <h5>{book.title}</h5>
                              {book.author && (
                                <p className="author">by {book.author}</p>
                              )}
                              {book.description && (
                                <p className="book-description">{book.description}</p>
                              )}
                              {book.averageRating && (
                                <div className="rating">
                                  ★ {Number(book.averageRating).toFixed(1)}
                                </div>
                              )}
                              {Array.isArray(book.genres) && book.genres.length > 0 && (
                                <div className="book-genres">
                                  {book.genres.slice(0, 3).map((tag) => (
                                    <span key={tag}>{tag}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.clubs.length > 0 && (
                        <div className="club-recommendations">
                          <h4>Clubs to explore</h4>
                          {msg.clubs.map((club) => (
                            <div key={club._id ?? club.name} className="club-card">
                              <strong>{club.name}</strong>
                              {club.description && <p>{club.description}</p>}
                              <span className="club-meta">
                                Members: {club.memberCount ?? 0}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {msg.suggestedGenres.length > 0 && (
                        <div className="genre-suggestions">
                          <p>Try these genres:</p>
                          <div className="genre-tags">
                            {msg.suggestedGenres.map((genre) => (
                              <button
                                key={genre}
                                type="button"
                                className="genre-tag"
                                onClick={() => handleQuickAction(genre)}
                              >
                                {genre}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {msg.actions.length > 0 && (
                        <div className="quick-actions">
                          {msg.actions.map((action) => (
                            <button
                              key={action}
                              type="button"
                              className="action-btn"
                              onClick={() => handleQuickAction(action)}
                            >
                              {action}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isBotTyping && (
                  <div className="typing-indicator">
                    <div className="dot"></div>
                    <div className="dot"></div>
                    <div className="dot"></div>
                  </div>
                )}
              </div>

              <div className="chatbot-input">
                <input
                  type="text"
                  placeholder="Ask about books, clubs, or summaries..."
                  value={userMessage}
                  onChange={(event) => setUserMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={isBotTyping}
                />
                <button
                  type="button"
                  className="send-btn"
                  onClick={() => handleSendMessage()}
                  disabled={isBotTyping}
                  aria-label="Send message"
                >
                  <FiSend className="send-icon" size={20} />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ChatBot;
