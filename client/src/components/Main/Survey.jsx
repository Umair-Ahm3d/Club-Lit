import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { usersAPI } from "../../services/api";
import "../Main/Survey.css";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { notifyAuthChange } from "../../utils/authStorage";

const DEFAULT_GENRES = [
  "Fantasy",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Non-Fiction",
  "Thriller",
];

const Survey = () => {
  const [formData, setFormData] = useState({
    gender: "",
    genres: [],
    age: "",
    favoriteAuthor: "",
  });
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const userId = localStorage.getItem("userId");

  useEffect(() => {
    if (!userId) {
      navigate("/login", { replace: true });
      return;
    }

    const fetchGenres = async () => {
      try {
        const { data: books } = await api.get("/books");
        const uniqueGenres = new Set();

        books.forEach((book) => {
          if (Array.isArray(book.genres)) {
            book.genres.forEach((genre) => uniqueGenres.add(genre));
          } else if (book.genres) {
            uniqueGenres.add(book.genres);
          }
        });

        const genreList = Array.from(uniqueGenres).sort();
        setGenres(genreList.length ? genreList : DEFAULT_GENRES);
        setError(null);
      } catch (fetchError) {
        console.error("Failed to load genres:", fetchError);
        setGenres(DEFAULT_GENRES);
        setError("Failed to load genres from the server. Showing defaults.");
      } finally {
        setLoading(false);
      }
    };

    fetchGenres();
  }, [navigate, userId]);

  const updateSurveyStatus = async (preferencesOverride) => {
    if (!userId) {
      navigate("/login", { replace: true });
      return;
    }

    await usersAPI.update(userId, {
      surveyCompleted: true,
      ...(preferencesOverride
        ? { preferences: preferencesOverride }
        : { preferences: formData }),
    });

    localStorage.setItem("surveyCompleted", "true");
    notifyAuthChange();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      await updateSurveyStatus();
      toast.success("Survey completed. Tailoring your feed!");
      setTimeout(() => navigate("/main", { replace: true }), 500);
    } catch (submitError) {
      console.error("Survey submission failed:", submitError);
      toast.error("Unable to save your survey. Please try again.");
    }
  };

  const handleCheckboxChange = (genre) => {
    setFormData((prev) => {
      const hasGenre = prev.genres.includes(genre);
      return {
        ...prev,
        genres: hasGenre
          ? prev.genres.filter((item) => item !== genre)
          : [...prev.genres, genre],
      };
    });
  };

  const handleSkip = async () => {
    try {
      await updateSurveyStatus({ genres: [], gender: "", age: "", favoriteAuthor: "" });
      setTimeout(() => navigate("/main", { replace: true }), 100);
    } catch (skipError) {
      console.error("Survey skip failed:", skipError);
      toast.error("Unable to skip right now. Please try again.");
    }
  };

  return (
    <div className="survey-container">
      <div className="survey-header">
        <h1 style={{ color: "black" }}>Welcome to Your Reading Journey!</h1>
        <p style={{ color: "black" }}>
          Help us curate the perfect collection tailored to you.
        </p>
        {error && <div className="error-message">{error}</div>}
      </div>

      {loading ? (
        <div className="loading-spinner">Loading genres...</div>
      ) : (
        <form onSubmit={handleSubmit} className="survey-steps">
          <h2 style={{ color: "black" }}>Basic Information</h2>
          <div className="form-group">
            <label>Gender:</label>
            <div className="gender-select">
              {["male", "female", "other"].map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name="gender"
                    value={option}
                    checked={formData.gender === option}
                    onChange={(event) =>
                      setFormData({
                        ...formData,
                        gender: event.target.value,
                      })
                    }
                  />
                  <span className="gender-option">
                    {option.charAt(0).toUpperCase() + option.slice(1)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Age Group:</label>
            <div className="age-buttons">
              {["18-25", "26-35", "36-45", "45+"].map((age) => (
                <button
                  type="button"
                  key={age}
                  className={`age-option ${
                    formData.age === age ? "selected" : ""
                  }`}
                  onClick={() => setFormData({ ...formData, age })}
                >
                  {age}
                </button>
              ))}
            </div>
          </div>

          <h2 style={{ color: "black" }}>Genre Preferences</h2>
          <div className="genre-grid">
            {genres.map((genre) => (
              <label key={genre} className="genre-card" style={{ color: "black" }}>
                <input
                  type="checkbox"
                  checked={formData.genres.includes(genre)}
                  onChange={() => handleCheckboxChange(genre)}
                  hidden
                />
                <div className="genre-content">
                  <span>{genre}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="form-group">
            <label>Favorite Author:</label>
            <input
              type="text"
              value={formData.favoriteAuthor}
              onChange={(event) =>
                setFormData({
                  ...formData,
                  favoriteAuthor: event.target.value,
                })
              }
              placeholder="Enter your favorite author"
              className="text-input"
              style={{ color: "black" }}
            />
          </div>

          <div className="navigation-buttons">
            <button type="submit">Complete Setup</button>
            <button type="button" className="skip-button" onClick={handleSkip}>
              Skip for Now
            </button>
          </div>
        </form>
      )}
      <ToastContainer position="top-right" autoClose={3000} />
    </div>
  );
};

export default Survey;
