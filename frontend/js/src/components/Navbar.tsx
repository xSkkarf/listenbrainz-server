import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import GlobalAppContext from "../utils/GlobalAppContext";

function Navbar() {
  const { currentUser } = React.useContext(GlobalAppContext);
  const location = useLocation();
  const navigate = useNavigate();

  const [activePage, setActivePage] = React.useState("");
  const [myProfile, setMyProfile] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState("");
  React.useEffect(() => {
    const path = location.pathname.split("/")[1];
    if (path === "user") {
      setMyProfile(location.pathname.split("/")[2] === currentUser?.name);
    }
    setActivePage(path);
  }, [location.pathname, currentUser?.name]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const searchInput = searchTerm;
    if (!searchInput) {
      return;
    }
    setSearchTerm("");
    navigate(`/search/?search_term=${searchInput}`);
  };

  return (
    <nav role="navigation">
      <div className="navbar-header">
        <button
          type="button"
          className="navbar-toggle collapsed"
          data-toggle="collapse"
          data-target="#side-nav,#side-nav-overlay"
        >
          <span className="sr-only">Toggle navigation</span>
          <span className="icon-bar" />
          <span className="icon-bar" />
          <span className="icon-bar" />
        </button>
        <Link className="navbar-logo" to="/?redirect=false">
          <img
            src="/static/img/navbar_logo.svg"
            alt="ListenBrainz"
            height="31"
          />
        </Link>
      </div>

      <div id="side-nav" className="collapse">
        <Link className="navbar-logo" to="/?redirect=false">
          <img
            src="/static/img/listenbrainz_logo_icon.svg"
            alt="ListenBrainz"
          />
        </Link>
        <div className="main-nav">
          {currentUser?.name ? (
            <>
              <Link
                to="/feed/"
                className={
                  activePage === "feed" || activePage === "recent"
                    ? "active"
                    : ""
                }
              >
                Feed
              </Link>
              <Link
                to={`/user/${currentUser.name}/`}
                className={activePage === "user" && myProfile ? "active" : ""}
              >
                Dashboard
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/recent/"
                className={activePage === "recent" ? "active" : ""}
              >
                Feed
              </Link>
              <Link
                to="/statistics/"
                className={activePage === "statistics" ? "active" : ""}
              >
                Dashboard
              </Link>
            </>
          )}
          <Link
            to="/explore/"
            className={activePage === "explore" ? "active" : ""}
          >
            Explore
          </Link>
        </div>

        <div className="navbar-bottom">
          {currentUser?.name ? (
            <>
              <div className="username">{currentUser.name}</div>
              <a href="/login/logout/">Logout</a>
              <Link
                className={activePage === "settings" ? "active" : ""}
                to="/settings/"
              >
                Settings
              </Link>
            </>
          ) : (
            <Link to="/login/">Sign in</Link>
          )}
          <Link className={activePage === "about" ? "active" : ""} to="/about/">
            About
          </Link>
          <a
            href="https://community.metabrainz.org/c/listenbrainz"
            target="_blank"
            rel="noopener noreferrer"
          >
            Community
          </a>
          <form className="search-bar" role="search" onSubmit={handleSubmit}>
            <input
              type="text"
              name="search_term"
              className="form-control input-sm"
              placeholder="Search users"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              required
            />
            <button type="submit">
              <span className="glyphicon glyphicon-search" />
            </button>
          </form>
        </div>
        <div className="mobile-nav-fix" />
      </div>
      <div
        id="side-nav-overlay"
        className="collapse"
        data-toggle="collapse"
        data-target="#side-nav,#side-nav-overlay"
      />
    </nav>
  );
}

export default Navbar;
