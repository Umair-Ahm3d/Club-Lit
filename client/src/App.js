import React, { useEffect, useState } from "react";
import { Route, Routes, Navigate, useNavigate } from "react-router-dom";
import Modal from "react-modal";
import Main from "./components/Main/Homepage";
import Survey from "./components/Main/Survey";
import Signup from "./components/Signup";
import Login from "./components/Login";
import Home from "./Home/Home";
import GenrePage from "./components/Genre/GenrePage";
import Club from "./components/Club/Club";
import Profile from "./components/Profile/Profile";
import Chat from "./components/Chat/Chat";
import About from "./components/About";
import RankingPage from "./components/Ranking/RankingPage";
import Admin from "./pages/Admin";
import BookRequestPage from "./components/Profile/BookRequestPage";
import UserRequestsPage from "./pages/UserRequestsPage";
import AdminRequestsPage from "./pages/AdminRequestsPage";
import AdminClubsPage from "./components/Club/AdminClubsPage";
import { usersAPI } from "./services/api";
import {
  AUTH_CHANGED_EVENT,
  buildPostLoginDestination,
  clearAuthState,
  notifyAuthChange,
  readAuthSnapshot,
} from "./utils/authStorage";

const ProtectedRoute = ({ isAllowed, redirectPath, children }) => {
  if (!isAllowed) {
    return <Navigate to={redirectPath} replace />;
  }
  return children;
};

const RequireSurvey = ({ children, authState }) => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const verifySurveyStatus = async () => {
      if (!authState.token || !authState.userId) {
        navigate("/login", { replace: true });
        return;
      }

      try {
        const { data } = await usersAPI.getById(authState.userId);
        if (data?.surveyCompleted) {
          localStorage.setItem("surveyCompleted", "true");
          notifyAuthChange();
          navigate("/main", { replace: true });
          return;
        }

        setChecking(false);
      } catch (error) {
        console.error("Survey check error:", error);
        clearAuthState();
        notifyAuthChange();
        navigate("/login", { replace: true });
      }
    };

    verifySurveyStatus();
  }, [authState.token, authState.userId, navigate]);

  if (checking) {
    return null;
  }

  return children;
};

const useAuthSnapshot = () => {
  const [auth, setAuth] = useState(() => readAuthSnapshot());

  useEffect(() => {
    const handleChange = () => setAuth(readAuthSnapshot());
    window.addEventListener(AUTH_CHANGED_EVENT, handleChange);
    window.addEventListener("storage", handleChange);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, []);

  return auth;
};

const App = () => {
  const auth = useAuthSnapshot();
  const isAuthenticated = Boolean(auth.token);
  const isAdmin = auth.isAdmin;

  useEffect(() => {
    Modal.setAppElement("#root");
  }, []);

  const postAuthRedirect = isAuthenticated
    ? buildPostLoginDestination({
        isAdmin,
        surveyCompleted: auth.surveyCompleted,
      })
    : "/login";

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <div id="main-content" role="main">
        <Routes>
          <Route path="/" element={<Home />} />

          <Route
            path="/login"
            element={
              isAuthenticated ? (
                <Navigate to={postAuthRedirect} replace />
              ) : (
                <Login />
              )
            }
          />

          <Route
            path="/signup"
            element={
              isAuthenticated ? (
                <Navigate to={postAuthRedirect} replace />
              ) : (
                <Signup />
              )
            }
          />

          <Route
            path="/main"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated && !isAdmin}
                redirectPath={isAdmin ? "/profile" : "/login"}
              >
                <Main />
              </ProtectedRoute>
            }
          />

          <Route
            path="/survey"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated && !isAdmin}
                redirectPath={isAdmin ? "/profile" : "/login"}
              >
                <RequireSurvey authState={auth}>
                  <Survey />
                </RequireSurvey>
              </ProtectedRoute>
            }
          />

          <Route path="/genre" element={<GenrePage />} />

          <Route
            path="/club"
            element={
              isAdmin ? (
                <Navigate to="/admin/clubs" replace />
              ) : (
                <ProtectedRoute
                  isAllowed={isAuthenticated}
                  redirectPath="/login"
                >
                  <Club />
                </ProtectedRoute>
              )
            }
          />

          <Route
            path="/profile"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated}
                redirectPath="/login"
              >
                <Profile />
              </ProtectedRoute>
            }
          />

          <Route
            path="/chat/:clubId"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated}
                redirectPath="/login"
              >
                <Chat />
              </ProtectedRoute>
            }
          />

          <Route
            path="/about"
            element={
              isAdmin ? (
                <Navigate to="/profile" replace />
              ) : (
                <About />
              )
            }
          />

          <Route path="/ranking" element={<RankingPage />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated && isAdmin}
                redirectPath="/login"
              >
                <Admin />
              </ProtectedRoute>
            }
          />

          <Route
            path="/requests"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated && !isAdmin}
                redirectPath="/login"
              >
                <BookRequestPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/user/requests"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated && !isAdmin}
                redirectPath="/login"
              >
                <UserRequestsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/requests"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated && isAdmin}
                redirectPath="/login"
              >
                <AdminRequestsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/clubs"
            element={
              <ProtectedRoute
                isAllowed={isAuthenticated && isAdmin}
                redirectPath="/login"
              >
                <AdminClubsPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to={postAuthRedirect} replace />} />
        </Routes>
      </div>
    </>
  );
};

export default App;
