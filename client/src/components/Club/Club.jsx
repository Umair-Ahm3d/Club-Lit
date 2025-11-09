import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaSearch } from "react-icons/fa";
import { FaArrowRightFromBracket, FaTrash } from "react-icons/fa6";
import { MdMarkUnreadChatAlt } from "react-icons/md";
import Header from "../Header";
import Footer from "../Footer";
import api from "../../services/api";
import "./Club.css";

const Club = () => {
  const navigate = useNavigate();
  const [clubs, setClubs] = useState([]);
  const [joinedClubs, setJoinedClubs] = useState([]);
  const [createdClubs, setCreatedClubs] = useState([]);
  const [clubName, setClubName] = useState("");
  const [bookName, setBookName] = useState("");
  const [description, setDescription] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("");
  const [genresList, setGenresList] = useState([]);
  const [bookList, setBookList] = useState([]);
  const [availableBooks, setAvailableBooks] = useState([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [formError, setFormError] = useState("");

  const token = localStorage.getItem("token");
  const currentUserId = localStorage.getItem("userId");

  const ensureAuthenticated = useCallback(() => {
    if (!token) {
      navigate("/login", { replace: true });
      return false;
    }
    return true;
  }, [navigate, token]);

  const normalizeGenre = (value) =>
    typeof value === "string" ? value.trim() : "";

  const getClubBookTitle = useCallback((club) => {
    if (!club) {
      return "";
    }
    if (typeof club.book === "string") {
      return club.book;
    }
    if (club.book?.title) {
      return club.book.title;
    }
    return "";
  }, []);

  const loadBooks = useCallback(async () => {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      setLoadingBooks(true);
      const { data } = await api.get("/books");
      const booksArray = Array.isArray(data) ? data : [];
      setBookList(booksArray);

      const uniqueGenres = new Set();
      booksArray.forEach((book) => {
        if (Array.isArray(book.genres)) {
          book.genres.forEach((genre) => uniqueGenres.add(normalizeGenre(genre)));
        } else if (book.genres) {
          uniqueGenres.add(normalizeGenre(book.genres));
        }
      });

      const sortedGenres = Array.from(uniqueGenres).filter(Boolean).sort();
      setGenresList(sortedGenres);
    } catch (error) {
      console.error("Error fetching books:", error);
      setFormError("Failed to load books. Please try again later.");
    } finally {
      setLoadingBooks(false);
    }
  }, [ensureAuthenticated]);

  const loadClubs = useCallback(async () => {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      const { data } = await api.get("/clubs");
      setClubs(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error fetching clubs:", error);
    }
  }, [ensureAuthenticated]);

  const loadUserClubs = useCallback(async () => {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      const { data } = await api.get("/clubs/userClubs");
      const joined = Array.isArray(data) ? data : [];
      setJoinedClubs(joined);
    } catch (error) {
      console.error("Error fetching user clubs:", error);
    }
  }, [ensureAuthenticated]);

  useEffect(() => {
    loadBooks();
    loadClubs();
    loadUserClubs();
  }, [loadBooks, loadClubs, loadUserClubs]);

  useEffect(() => {
    if (!currentUserId) {
      setCreatedClubs([]);
      return;
    }
    const derived = joinedClubs.filter((club) => {
      const creatorId = club?.createdBy?._id ?? club?.createdBy;
      return String(creatorId) === String(currentUserId);
    });
    setCreatedClubs(derived);
  }, [currentUserId, joinedClubs]);

  useEffect(() => {
    if (loadingBooks) {
      return;
    }

    const normalizedSelectedGenre = normalizeGenre(selectedGenre);
    const filteredBooks = bookList.filter((book) => {
      if (!normalizedSelectedGenre) {
        return true;
      }
      if (Array.isArray(book.genres)) {
        return book.genres
          .map(normalizeGenre)
          .includes(normalizedSelectedGenre);
      }
      return normalizeGenre(book.genres) === normalizedSelectedGenre;
    });

    setAvailableBooks(filteredBooks);
    setBookName("");
  }, [bookList, loadingBooks, selectedGenre]);

  const filteredClubs = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return clubs;
    }

    return clubs.filter((club) => {
      const clubNameText = (club?.name ?? "").toLowerCase();
      const clubBookText = getClubBookTitle(club).toLowerCase();
      return (
        clubNameText.includes(normalizedQuery) ||
        clubBookText.includes(normalizedQuery)
      );
    });
  }, [clubs, getClubBookTitle, searchQuery]);

  const resetForm = () => {
    setClubName("");
    setBookName("");
    setDescription("");
    setFormError("");
  };

  const handleCreateClub = async () => {
    if (!ensureAuthenticated()) {
      return;
    }

    if (!clubName.trim() || !bookName.trim() || !description.trim()) {
      setFormError("Please complete all fields before creating a club.");
      return;
    }

    try {
      await api.post("/clubs", {
        name: clubName.trim(),
        book: bookName.trim(),
        description: description.trim(),
      });

      await Promise.all([loadClubs(), loadUserClubs()]);
      resetForm();
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        "Unable to create club.";
      setFormError(message);
      console.error("Error creating club:", error);
    }
  };

  const handleJoinClub = async (clubId) => {
    if (!ensureAuthenticated()) {
      return;
    }
    try {
      await api.post("/clubs/joinClub", { clubId });
      await Promise.all([loadClubs(), loadUserClubs()]);
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        "Could not join club.";
      alert(message);
      console.error("Error joining club:", error);
    }
  };

  const handleLeaveClub = async (clubId) => {
    if (!ensureAuthenticated()) {
      return;
    }
    try {
      await api.post("/clubs/leaveClub", { clubId });
      await loadUserClubs();
    } catch (error) {
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        "Could not leave club.";
      alert(message);
      console.error("Error leaving club:", error);
    }
  };

  const handleDeleteClub = async (clubId) => {
    if (!ensureAuthenticated()) {
      return;
    }
    try {
      await api.delete(`/clubs/${clubId}`);
      await Promise.all([loadClubs(), loadUserClubs()]);
    } catch (error) {
      console.error("Error deleting club:", error);
    }
  };

  const isCreatedClub = (clubId) =>
    createdClubs.some((club) => club._id === clubId);
  const isJoinedClub = (clubId) =>
    joinedClubs.some((club) => club._id === clubId);

  return (
    <div className="club-page">
      <Header />
      <div className="club-container">
        <div className="club-grid">
          <div className="create-club box">
            <h3 style={{ color: "black" }}>Create a New Club</h3>
            {formError && <div className="error-message">{formError}</div>}

            <input
              type="text"
              placeholder="Club Name"
              style={{ color: "black" }}
              value={clubName}
              onChange={(event) => setClubName(event.target.value)}
            />

            <div className="form-group">
              <label>Genre:</label>
              <select
                value={selectedGenre}
                style={{ color: "black" }}
                onChange={(event) => setSelectedGenre(event.target.value)}
              >
                <option value="">All Genres</option>
                {genresList.length > 0 ? (
                  genresList.map((genre) => (
                    <option key={genre} value={genre}>
                      {genre}
                    </option>
                  ))
                ) : (
                  <option disabled>No genres available</option>
                )}
              </select>
            </div>

            <div className="form-group">
              <label>Book:</label>
              {loadingBooks ? (
                <div className="loading-books">Loading books...</div>
              ) : (
                <select
                  value={bookName}
                  onChange={(event) => setBookName(event.target.value)}
                  style={{ color: "black" }}
                >
                  <option value="">Select a Book</option>
                  {availableBooks.map((book) => (
                    <option key={book._id} value={book.title}>
                      {book.title}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <textarea
              placeholder="Description"
              value={description}
              style={{ color: "black" }}
              onChange={(event) => setDescription(event.target.value)}
            />
            <br />
            <button className="create-btn" onClick={handleCreateClub}>
              Create Club
            </button>
          </div>

          <div className="available-clubs box">
            <h3 style={{ color: "black" }}>All Clubs</h3>
            <div className="search-bar">
              <input
                type="text"
                placeholder="Search clubs or books"
                value={searchQuery}
                style={{ color: "black" }}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              <FaSearch className="react-icons" />
            </div>
            <div className="club-list">
              {filteredClubs.map((club) => {
                const membersCount = Array.isArray(club.members)
                  ? club.members.length
                  : 0;
                return (
                  <div key={club._id} className="club-card">
                    <p style={{ color: "black" }}>
                      <strong>Club:</strong> {club.name}
                    </p>
                    <p style={{ color: "black" }}>
                      <strong>Book:</strong> {getClubBookTitle(club) || "N/A"}
                    </p>
                    <p style={{ color: "black" }}>
                      <strong>Description:</strong>{" "}
                      {club.description || "No description provided."}
                    </p>
                    <p style={{ color: "black" }}>
                      <strong>Members:</strong> {membersCount}
                    </p>
                    <div className="club-actions">
                      {isCreatedClub(club._id) ? (
                        <span className="created">Created</span>
                      ) : isJoinedClub(club._id) ? (
                        <span className="joined">Joined</span>
                      ) : (
                        <button
                          className="join-btn"
                          onClick={() => handleJoinClub(club._id)}
                        >
                          Join
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="user-clubs box">
            <div className="club-box">
              <h3 style={{ color: "black" }}>Your Created Clubs</h3>
              {createdClubs.length === 0 ? (
                <p className="empty-slate">
                  You haven&apos;t created a club yet.
                </p>
              ) : (
                createdClubs.map((club) => (
                  <div
                    key={club._id}
                    style={{ color: "black" }}
                    className="club-card user-club-card"
                  >
                    <span className="club-name">{club.name}</span>
                    <div className="icons-container">
                      <Link to={`/chat/${club._id}`}>
                        <MdMarkUnreadChatAlt className="chat-icon" />
                      </Link>
                      <FaTrash
                        className="delete-icon"
                        onClick={() => handleDeleteClub(club._id)}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="user-clubs box">
            <div className="club-box">
              <h3 style={{ color: "black" }}>Your Joined Clubs</h3>
              {joinedClubs.length === 0 ? (
                <p className="empty-slate">
                  Join a club to see it appear here.
                </p>
              ) : (
                joinedClubs.map((club) => (
                  <div
                    key={club._id}
                    className="club-card user-club-card"
                    style={{ color: "black" }}
                  >
                    <span className="club-name">{club.name}</span>
                    <div className="icons-container">
                      <Link to={`/chat/${club._id}`}>
                        <MdMarkUnreadChatAlt className="chat-icon" />
                      </Link>
                      <FaArrowRightFromBracket
                        className="leave-icon"
                        onClick={() => handleLeaveClub(club._id)}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Club;
