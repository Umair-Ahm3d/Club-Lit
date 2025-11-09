import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FaUserCircle, FaBookMedical, FaRegEdit, FaBell } from "react-icons/fa";
import { FaRankingStar } from "react-icons/fa6";
import logocat from "../assets/clublit logo.jpg";
import "./Header.css";
import "../components/Profile/Profile.css";
import api from "../services/api";
import { clearAuthState, notifyAuthChange } from "../utils/authStorage";
const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = localStorage.getItem("isAdmin") === "true";
  const token = localStorage.getItem("token");

  const shouldShowLink = (path) => location.pathname !== path;
  const [notificationCount, setNotificationCount] = useState(0);
  const [adminNotificationCount, setAdminNotificationCount] = useState(0);

  
  useEffect(() => {
    if (!token) return;

    const fetchNotifications = async () => {
      try {
        const endpoint = isAdmin
          ? "/book-requests/admin/notifications"
          : "/book-requests/notifications";
        const { data } = await api.get(endpoint);

        if (isAdmin) {
          setAdminNotificationCount(data?.newRequestsCount ?? 0);
        } else {
          const count = Array.isArray(data)
            ? data.length
            : data?.length ?? 0;
          setNotificationCount(count);
        }
      } catch (error) {
        console.error("Error fetching notifications:", error);
      }
    };

    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000);
    return () => clearInterval(interval);
  }, [token, isAdmin]);

  const handleNotificationClick = async (event) => {
    event.preventDefault();
    if (!token) {
      navigate("/login");
      return;
    }

    navigate(isAdmin ? "/admin/requests" : "/user/requests");
  };

  const handleLogout = () => {
    clearAuthState();
    localStorage.removeItem("surveyStep");
    notifyAuthChange();
    navigate("/login", { replace: true });
  };

  const isLanding = location.pathname === "/";
  const dashboardPath = isAdmin ? "/admin" : "/main";
  const clubPath = isAdmin ? "/admin/clubs" : "/club";

    return (
      <nav className="navbar">
        <div className="leftNav">
          <div className="logoContainer">
            <img src={logocat} alt="logo" className="logoImage" />
            <span className="logoText">Club Lit</span>
          </div>
        </div>

        <div className="rightNav">
          {/* Primary Navigation */}
          {!isLanding && <Link to="/" className="navButton">Home</Link>}
          
          {location.pathname !== "/genre" && (
            <Link to="/genre" className="navButton">Genre</Link>
          )}
          
          {location.pathname !== clubPath && (
            <Link to={clubPath} className="navButton">Club</Link>
          )}
          
          {!isAdmin && location.pathname !== "/about" && (
            <Link to="/about" className="navButton">About</Link>
          )}

          {/* Auth Navigation */}
          {!token ? (
            <>
              <Link to="/login" className="navButton auth-button">Sign In</Link>
              <Link to="/signup" className="navButton auth-button">Sign Up</Link>
            </>
          ) : (
            <>
              {/* Authenticated Navigation */}
              {location.pathname !== dashboardPath && (
                <Link to={dashboardPath} className="navButton">
                  {isAdmin ? "Dashboard" : "My Hub"}
                </Link>
              )}
              
              {!isAdmin && shouldShowLink("/ranking") && (
                <Link to="/ranking" className="navButton">
                  <FaRankingStar size={18} title="Rankings" />
                </Link>
              )}

              {/* Icon Navigation */}
              {!isAdmin && (
                <Link to="/requests" className="nav-icon">
                  <FaRegEdit size={28} title="Requests" />
                  {notificationCount > 0 && (
                    <span className="notification-badge">{notificationCount}</span>
                  )}
                </Link>
              )}

              {isAdmin && (
                <Link to="/admin" className="nav-icon">
                  <FaBookMedical size={28} title="Admin Dashboard" />
                </Link>
              )}

              <button
                onClick={handleNotificationClick}
                className="nav-icon"
              >
                <FaBell size={28} title="Notifications" />
                {(isAdmin ? adminNotificationCount : notificationCount) > 0 && (
                  <span className="notification-badge">
                    {isAdmin ? adminNotificationCount : notificationCount}
                  </span>
                )}
              </button>

              <Link to="/profile" className="nav-icon">
                <FaUserCircle size={32} title="Profile" />
              </Link>

              <button 
                type="button" 
                onClick={handleLogout}
                className="logout-button"
              >
                Logout
              </button>
            </>
          )}
        </div>
      </nav>
    );
};

export default Header;