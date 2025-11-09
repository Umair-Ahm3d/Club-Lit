import React from 'react';
import { Link } from 'react-router-dom';
import './Footer.css';

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-row">
        <h3>About ClubLit</h3>
        <p>Discover your next favorite book with our passionate reading community.</p>
        <ul className="footer-links">
          <li><Link to="/about">About Us</Link></li>
          <li><Link to="/contact">Contact</Link></li>
          <li><Link to="/terms">Terms of Service</Link></li>
          <li><Link to="/privacy">Privacy Policy</Link></li>
        </ul>
      </div>

      <div className="footer-row">
        <h3>For Readers</h3>
        <ul className="footer-links">
          <li><Link to="/genre">Explore Genres</Link></li>
          <li><Link to="/ranking">Top Books</Link></li>
          <li><Link to="/clubs">Book Clubs</Link></li>
          <li><Link to="/recommendations">Get Recommendations</Link></li>
        </ul>
      </div>

      <div className="footer-row">
        <h3>For Authors</h3>
        <ul className="footer-links">
          <li><Link to="/submit">Submit Your Book</Link></li>
          <li><Link to="/author-guidelines">Author Guidelines</Link></li>
          <li><Link to="/author-resources">Resources</Link></li>
          <li><Link to="/author-support">Support</Link></li>
        </ul>
      </div>

      <div className="footer-row">
        <h3>Connect</h3>
        <ul className="footer-links">
          <li><a href="mailto:support@clublit.com">Email Us</a></li>
          <li><a href="https://twitter.com/clublit" target="_blank" rel="noopener noreferrer">Twitter</a></li>
          <li><a href="https://instagram.com/clublit" target="_blank" rel="noopener noreferrer">Instagram</a></li>
          <li><a href="https://facebook.com/clublit" target="_blank" rel="noopener noreferrer">Facebook</a></li>
        </ul>
      </div>

      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} ClubLit. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
