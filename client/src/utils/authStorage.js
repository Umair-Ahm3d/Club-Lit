export const AUTH_CHANGED_EVENT = "auth:changed";

const STORAGE_KEYS = {
  token: "token",
  userId: "userId",
  userName: "userName",
  isAdmin: "isAdmin",
  surveyCompleted: "surveyCompleted",
};

const booleanToString = (value) => String(Boolean(value));

const extractUserId = (user) => user.id || user._id || "";

const extractUserName = (user) =>
  user.name ?? user.username ?? user.UserName ?? "";

export const persistAuthState = ({ token, user }) => {
  if (!token || !user) {
    throw new Error("persistAuthState requires both token and user objects");
  }

  localStorage.setItem(STORAGE_KEYS.token, token);
  localStorage.setItem(STORAGE_KEYS.userId, extractUserId(user));
  localStorage.setItem(STORAGE_KEYS.userName, extractUserName(user));
  localStorage.setItem(STORAGE_KEYS.isAdmin, booleanToString(user.isAdmin));
  localStorage.setItem(
    STORAGE_KEYS.surveyCompleted,
    booleanToString(user.surveyCompleted)
  );
};

export const clearAuthState = () => {
  Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
};

export const buildPostLoginDestination = (user = {}) => {
  if (user.isAdmin) {
    return "/profile";
  }
  return user.surveyCompleted ? "/main" : "/survey";
};

export const readAuthSnapshot = () => {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  const userId = localStorage.getItem(STORAGE_KEYS.userId);
  const isAdmin =
    localStorage.getItem(STORAGE_KEYS.isAdmin)?.toLowerCase() === "true";
  const surveyCompleted =
    localStorage.getItem(STORAGE_KEYS.surveyCompleted)?.toLowerCase() ===
    "true";

  return {
    token,
    userId,
    isAdmin,
    surveyCompleted,
  };
};

export const notifyAuthChange = () => {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
};
