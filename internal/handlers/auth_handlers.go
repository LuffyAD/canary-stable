package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"canary/internal/auth"
	"canary/internal/config"
)

// ServeLogin serves the login page
func ServeLogin(w http.ResponseWriter, r *http.Request) {
	// Try dist first, fall back to web
	if _, err := os.Stat("dist/login.html"); err == nil {
		http.ServeFile(w, r, "dist/login.html")
	} else {
		http.ServeFile(w, r, "web/login.html")
	}
}

// Login handles user authentication (supports both form and JSON)
func Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var username, password string
	isFormSubmit := false

	// Check if it's a form submission or JSON
	contentType := r.Header.Get("Content-Type")
	if contentType == "application/x-www-form-urlencoded" || contentType == "" {
		// Form submission
		if err := r.ParseForm(); err == nil {
			username = r.FormValue("username")
			password = r.FormValue("password")
			isFormSubmit = true
		}
	} else {
		// JSON submission (for backwards compatibility)
		var credentials struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&credentials); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request"})
			return
		}
		username = credentials.Username
		password = credentials.Password
	}

	// Authenticate user
	user, err := auth.AuthenticateUser(config.DB, username, password)
	if err != nil {
		if isFormSubmit {
			http.Redirect(w, r, "/login?error=Invalid+credentials", http.StatusSeeOther)
		} else {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Invalid credentials"})
		}
		return
	}

	// Create session
	token, err := auth.CreateSession(config.DB, user.ID, user.Username)
	if err != nil {
		if isFormSubmit {
			http.Redirect(w, r, "/login?error=Failed+to+create+session", http.StatusSeeOther)
		} else {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create session"})
		}
		return
	}

	// Set cookie (30 days expiration)
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   30 * 24 * 60 * 60, // 30 days in seconds
		HttpOnly: true,
		Secure:   config.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	})

	if isFormSubmit {
		http.Redirect(w, r, "/", http.StatusSeeOther)
	} else {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"success": "true"})
	}
}

// Logout handles user logout (no CSRF required - simple action)
func Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get session cookie
	cookie, err := r.Cookie(auth.SessionCookieName)
	if err == nil {
		// Delete session from database
		_ = auth.DeleteSession(config.DB, cookie.Value)
	}

	// Clear cookie with both MaxAge and Expires for better browser compatibility
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   config.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	})

	// Redirect to login page
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

// CreateUser handles user creation (admin only - can be extended with proper authorization)
func CreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request"})
		return
	}

	if req.Username == "" || req.Password == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Username and password are required"})
		return
	}

	if err := auth.CreateUser(config.DB, req.Username, req.Password); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Failed to create user"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"success": "true", "username": req.Username})
}

// StartSessionCleanup starts a background goroutine to cleanup expired sessions
func StartSessionCleanup() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			_ = auth.CleanupExpiredSessions(config.DB)
		}
	}()
}
