import React from 'react';
import './About.css';
import Header from './Header';
import Footer from './Footer';

const About = () => {
  return (
    <div className="about-page">
      <Header />
      <div className="about-container">
        <h1>About Club Lit</h1>

        <section className="about-section intro">
          <p>
            Club Lit is an AI‑powered digital library and community for readers. We blend
            a modern reading experience with smart discovery, collaborative clubs, and
            a friendly place to talk about books you love.
          </p>
        </section>

        <section className="about-section">
          <h2>Our Mission</h2>
          <p>
            Help every reader find the right book at the right moment, build lasting
            reading habits, and connect with a community that shares their curiosity.
          </p>
        </section>

        <section className="about-section">
          <h2>What You Can Do</h2>
          <ul className="feature-list">
            <li>Explore a growing library across fiction, non‑fiction, classics, and more.</li>
            <li>Join or create themed clubs and chat in real time with fellow readers.</li>
            <li>Track favorites and history, and curate your personal bookshelf.</li>
            <li>Request new titles and get notified when they arrive.</li>
            <li>Take a quick onboarding survey to tune recommendations.</li>
          </ul>
        </section>

        <section className="about-section">
          <h2>How AI Helps</h2>
          <ul className="feature-list">
            <li>Personalized picks based on your genres, authors, and activity.</li>
            <li>Smart club suggestions and reading prompts to keep momentum.</li>
            <li>Contextual search that surfaces books relevant to your interests.</li>
          </ul>
        </section>

        <section className="about-section">
          <h2>Clubs & Community</h2>
          <p>
            Clubs make reading social. Start a club for a genre, author, or challenge;
            invite friends; and meet in the discussion chat. See who’s online, share notes,
            and keep the conversation going while you read.
          </p>
        </section>

        <section className="about-section">
          <h2>Privacy & Security</h2>
          <p>
            We keep your account data private and use your preferences only to improve
            your experience. You control your club membership and notifications.
          </p>
        </section>

        <section className="about-section">
          <h2>Get Involved</h2>
          <p>
            Ready to read smarter? Create an account, join a club, and explore genres
            tailored to you. Have feedback or a book request? We’d love to hear it.
          </p>
          <p>
            Contact us at <a href="mailto:support@clubreader.com">support@clubreader.com</a>.
          </p>
        </section>
      </div>
      <Footer />
    </div>
  );
};

export default About;
