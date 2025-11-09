import axios from "axios";

const DEFAULT_API_URL = "http://localhost:8080/api";

const normalizeBaseUrl = (value) => {
  if (!value) {
    return DEFAULT_API_URL;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_API_URL;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const API_BASE_URL = normalizeBaseUrl(process.env.REACT_APP_API_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authAPI = {
  register: (userData) => api.post("/auth/register", userData),
  login: (credentials) => api.post("/auth/login", credentials),
  profile: () => api.get("/auth/profile"),
  me: () => api.get("/auth/me"),
};

export const usersAPI = {
  getById: (userId) => api.get(`/users/${userId}`),
  update: (userId, payload) => api.patch(`/users/${userId}`, payload),
  favorites: () => api.get("/users/favorites"),
};

export default api;
