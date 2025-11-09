import React from "react";
import bookgrid from "./bookgrid.png";
import { Link } from 'react-router-dom';
import logocat from "./clublit logo.jpg";
import "./index.css";

const Home = () => {
  return (
    <div className="page-container">
      {/* Menubar */}
      <nav className="navbar">
      <div className="leftNav">
        <div className="logoContainer">
          <img src={logocat} alt="logo" className="logoImage" />
          <div className="logoText">ClubLit</div>
        </div>
      </div>
      <div className="rightNav">
      <Link to="/login" className="navButton">Sign In</Link>

      <Link to="/signup" className="navButton">Sign Up</Link>

      <Link to="/about" className="navButton">About</Link>
          
      </div>
    </nav>

  {/* Container */}
  <main className="main-content">
  <div className="grid-container">
        <div className="leftSection">
          <div className="hero-card">
            <div className="textContent">
              <div className="aiBadge">🤖 AI-powered Library</div>
              <h1 className="logoText hero-title">Club Lit</h1>
              <p className="hero-tag">Discover your next literary obsession with AI-curated recommendations, join passionate reading communities, and embark on immersive literary adventures that transform the way you experience books.</p>
              <div className="buttons">
                <Link to="/register" className="signUpButton">Start Reading</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="rightSection">
          <div className="bookFrame">
            <img src={bookgrid} className="bookgridImage" alt="Book Grid" />
            <div className="aiOverlay">AI · Personalized covers</div>
          </div>
        </div>
      </div>

      {/* Benefits Section */}
      <section className="benefits">
        <h2>Why Join ClubLit?</h2>
        <p className="lead">AI-curated reading, lively clubs, and bite-sized challenges — all built to make reading social, smart and simple.</p>
        <div className="benefitList">
          <div className="benefitItem">
            <h3>Intelligent Recommendations</h3>
            <p>Our recommendation engine surfaces books you'll actually enjoy — not just what's popular.</p>
          </div>
          <div className="benefitItem">
            <h3>Active, Friendly Community</h3>
            <p>Join discussion circles, share notes, and take part in weekly reading sprints.</p>
          </div>
          <div className="benefitItem">
            <h3>Personalized Booklists</h3>
            <p>Create smart lists — mood-based, theme-based or length-based — that update as your tastes evolve.</p>
          </div>
          <div className="benefitItem">
            <h3>Reading Challenges & Rewards</h3>
            <p>Complete micro-challenges, earn badges, and discover curated reading paths.</p>
          </div>
        </div>
      </section>

      {/* AI Showcase */}
      <section className="aiShowcase">
        <div className="aiCard">
          <h3>AI Reading Assistant</h3>
          <p>Discover titles you’ll actually love with smart clustering and trends from our community.</p>
        </div>
        <div className="aiCard">
          <h3>Smart Clubs</h3>
          <p>Join or form clubs where topics adapt to member interests and reading pace.</p>
        </div>
      </section>

      <section className="about-cta">
        <div className="about-inner">
          <h2>About ClubLit — Smarter Reading</h2>
          <p>ClubLit combines human curation with AI insights to help readers find meaningful books faster. We focus on community, lightweight discussion formats, and tools that help you build a better reading habit. From personalized reading lists to friendly clubs and short, rewarding challenges, ClubLit helps make reading social, consistent, and delightful.</p>
        </div>
      </section>

      {/* CTA */}
      <section className="ctaSection">
        <div className="ctaInner">
          <h3 className="ctaTitle">Ready to read smarter?</h3>
          <p className="ctaText">Create your account and explore clubs, genres, and AI picks tailored just for you.</p>
          <Link className="ctaButton" to="/signup">Get Started</Link>
        </div>
      </section>

      {/* Book Quotes Section */}
      <section className="bookQuotes">
        <h2>Inspiring Book Quotes</h2>
        <div className="quoteList">
          <blockquote>"We read to know we are not alone." — C.S. Lewis</blockquote>
          <blockquote>"Books give a soul to the universe, wings to the mind, flight to the imagination." — Plato</blockquote>
          <blockquote>"There is no friend as loyal as a book." — Ernest Hemingway</blockquote>
          <blockquote>"A book is a dream that you hold in your hands." — Neil Gaiman</blockquote>
          <blockquote>"Reading is a conversation. All books talk. But a good book listens as well." — Mark Haddon</blockquote>
        </div>
      </section>

      </main>

      {/* Footer Section */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-col">
            <h4>About</h4>
            <p>ClubLit brings readers together with AI-backed suggestions and friendly book clubs.</p>
          </div>
          <div className="footer-col">
            <h4>Readers</h4>
            <p>Discover lists, join clubs, save highlights and more.</p>
          </div>
          <div className="footer-col">
            <h4>Authors</h4>
            <p>Connect with readers and showcase your work.</p>
          </div>
          <div className="footer-col">
            <h4>Contact</h4>
            <p>support@clubreader.com</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
export default Home;
