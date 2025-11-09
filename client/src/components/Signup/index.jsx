import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authAPI } from "../../services/api";
import {
  buildPostLoginDestination,
  notifyAuthChange,
  persistAuthState,
} from "../../utils/authStorage";
import styles from "./styles.module.css";

const Signup = () => {
  const [formData, setFormData] = useState({
    UserName: "",
    email: "",
    password: "",
  });
  const [popupMessage, setPopupMessage] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleChange = ({ currentTarget: input }) => {
    setFormData({ ...formData, [input.name]: input.value });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const { data } = await authAPI.register(formData);

      if (!data?.token || !data?.user) {
        throw new Error("Invalid registration response");
      }

      persistAuthState(data);
      notifyAuthChange();

      setPopupMessage("Registration successful!");
      setIsSuccess(true);
      setShowPopup(true);

      setTimeout(() => {
        navigate(buildPostLoginDestination(data.user), { replace: true });
      }, 1200);
    } catch (submitError) {
      console.error("Registration error:", submitError);
      const message =
        submitError.response?.data?.message ||
        submitError.response?.data?.error ||
        submitError.message ||
        "Registration failed. Please try again.";
      setPopupMessage(message);
      setIsSuccess(false);
      setShowPopup(true);
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!showPopup) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setShowPopup(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [showPopup]);

  return (
    <div className={styles.signup_container}>
      {showPopup && (
        <div
          className={`${styles.popup} ${
            isSuccess ? styles.success : styles.error
          }`}
        >
          {popupMessage}
        </div>
      )}
      <div className={styles.signup_form_container}>
        <div className={styles.left}>
          <h1>Welcome Back</h1>
          <br />
          <Link to="/login" className={styles.white_btn} style={{ textAlign: 'center', display: 'inline-block', textDecoration: 'none' }}>
            Sign in
          </Link>
        </div>
        <div className={styles.right}>
          <form className={styles.form_container} onSubmit={handleSubmit}>
            <h1>Create Account</h1>
            <br />
            <input
              type="text"
              placeholder="User Name"
              name="UserName"
              onChange={handleChange}
              value={formData.UserName}
              required
              className={styles.input}
              
            />
            <input
              type="email"
              placeholder="Email"
              name="email"
              onChange={handleChange}
              value={formData.email}
              required
              className={styles.input}
              autoComplete="email"
              
            />
            <input
              type="password"
              placeholder="Password"
              name="password"
              onChange={handleChange}
              value={formData.password}
              required
              className={styles.input}
              autoComplete="new-password"
              
            />
            {error && <div className={styles.error_msg}>{error}</div>}
            <button
              type="submit"
              className={styles.green_btn}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating Account..." : "Sign Up"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Signup;
