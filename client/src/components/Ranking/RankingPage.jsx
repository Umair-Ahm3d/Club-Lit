import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, Select, List, Spin, Empty } from "antd";
import { FaMedal } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import Header from "../Header";
import Footer from "../Footer";
import BookCard from "../BookCard";
import api from "../../services/api";
import "../Ranking/RankingPage.css";

const TAB_CONFIG = [
  {
    key: "most-visited",
    label: "Most Visited Books",
    description: (book) => `Reads: ${book.reads ?? 0}`,
  },
  {
    key: "highest-rated",
    label: "Highest Rated Books",
    description: (book) =>
      `Rating: ${(book.averageRating ?? 0).toFixed(1)} ★ (${book.ratingCount ?? 0} ratings)`,
  },
  {
    key: "most-discussed",
    label: "Most Discussed Books",
    description: (book) => `Comments: ${book.commentCount ?? 0}`,
  },
  {
    key: "most-members",
    label: "Clubs with Most Members",
    description: (club) => `Members: ${club.memberCount ?? 0}`,
  },
];

const RANK_COLORS = ["#FFD700", "#C0C0C0", "#CD7F32", "#3498db", "#27ae60"];

const medalClassFor = (i) => (i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "none");

const endpointForTab = (key) => {
  switch (key) {
    case "most-visited":
      return "/books/rankings/most-visited";
    case "highest-rated":
      return "/books/rankings/highest-rated";
    case "most-discussed":
      return "/books/rankings/most-discussed";
    case "most-members":
    default:
      return "/clubs/rankings/most-members";
  }
};

const RankingPage = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("most-members");
  const [timeRange, setTimeRange] = useState("weekly");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedBook, setSelectedBook] = useState(null);

  const fetchRankings = useCallback(async () => {
    setLoading(true);
    setError("");
    const endpoint = endpointForTab(activeTab);

    try {
      const { data } = await api.get(
        `${endpoint}?range=${encodeURIComponent(timeRange)}`
      );
      if (Array.isArray(data)) {
        setItems(data.slice(0, 10));
      } else {
        setItems([]);
      }
    } catch (err) {
      console.error("Ranking fetch error:", err);
      const message =
        err.response?.data?.message ||
        err.response?.data?.error ||
        (err.response?.status === 401
          ? "Please log in to view book rankings."
          : "Unable to load rankings right now.");
      setError(message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab, timeRange]);

  useEffect(() => {
    fetchRankings();
  }, [fetchRankings]);

  useEffect(() => {
    if (activeTab === "most-members") {
      setSelectedBook(null);
    }
  }, [activeTab]);

  const handleSelectItem = (entry) => {
    if (!entry) {
      return;
    }
    if (activeTab === "most-members") {
      const token = localStorage.getItem("token");
      if (!token) {
        navigate("/login");
        return;
      }
      if (entry._id) {
        navigate(`/clubs/${entry._id}`);
      }
      return;
    }
    setSelectedBook(entry);
  };

  const listLocale = useMemo(
    () => ({
      emptyText: loading ? null : error || "No results to show.",
    }),
    [error, loading]
  );

  const tabItems = TAB_CONFIG.map((tab) => ({
    key: tab.key,
    label: tab.label,
    children: (
      <Spin spinning={loading}>
        <List
          locale={listLocale}
          dataSource={items}
          renderItem={(item, index) => (
            <List.Item
              onClick={() => handleSelectItem(item)}
              style={{ cursor: "pointer" }}
            >
              <List.Item.Meta
                avatar={
                  medalClassFor(index) !== "none" ? (
                    <span className={`rank-medal ${medalClassFor(index)}`}>
                      <FaMedal className="medal-icon" />
                    </span>
                  ) : (
                    <span className="rank-medal">{index + 1}</span>
                  )
                }
                title={item.title || item.name || "Unknown"}
                description={tab.description(item)}
              />
            </List.Item>
          )}
        />
      </Spin>
    ),
  }));

  return (
    <div className="ranking-page">
      <Header />
      <main className="ranking-main">
        <div className="ranking-container">
          <div className="ranking-header">
            <h1>Top Rankings</h1>
            <Select
              className="time-range-select"
              value={timeRange}
              onChange={setTimeRange}
              style={{ width: 140 }}
            >
              <Select.Option value="weekly">Weekly</Select.Option>
              <Select.Option value="monthly">Monthly</Select.Option>
              <Select.Option value="yearly">Yearly</Select.Option>
            </Select>
          </div>

          <div className="ranking-content">
            <div className="ranking-list">
              <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
              {!loading && !items.length && !error && (
                <Empty description="No data available" />
              )}
            </div>

            {selectedBook && (
              <div className="book-card-sidebar">
                <button
                  type="button"
                  className="close-btn"
                  onClick={() => setSelectedBook(null)}
                  aria-label="Close book details"
                >
                  ×
                </button>
                <BookCard book={selectedBook} />
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default RankingPage;
