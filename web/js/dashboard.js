// Dashboard - Live Data Polling Only
// All write operations (logout, clear matches) are handled by HTML forms
class Dashboard {
    constructor() {
        this.matches = [];
        this.filteredMatches = [];
        this.currentPage = 0;
        this.pageSize = 20;
        this.refreshInterval = null;

        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.setupThemeToggle();

        // Initial load
        await this.loadMetrics();
        await this.loadMatches();
        await this.loadPerformanceMetrics();

        // Start auto-refresh for live data
        this.startAutoRefresh();
    }

    setupEventListeners() {
        // Search and filter (client-side)
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadMatches());
        document.getElementById('searchInput').addEventListener('input', () => this.filterMatches());
        document.getElementById('timeRange').addEventListener('change', () => this.loadMatches());
        document.getElementById('priorityFilter').addEventListener('change', () => this.filterMatches());

        // Pagination
        document.getElementById('prevPage').addEventListener('click', () => this.prevPage());
        document.getElementById('nextPage').addEventListener('click', () => this.nextPage());

        // Clear matches button (shows confirmation)
        const clearBtn = document.getElementById('clearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to clear all matches from memory?')) {
                    document.getElementById('clearForm').submit();
                }
            });
        }
    }

    setupThemeToggle() {
        const themeToggle = document.getElementById('themeToggle');
        const html = document.documentElement;

        const savedTheme = localStorage.getItem('theme') || 'light';
        html.setAttribute('data-bs-theme', savedTheme);
        this.updateThemeIcon(savedTheme);

        themeToggle.addEventListener('click', () => {
            const currentTheme = html.getAttribute('data-bs-theme');
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            html.setAttribute('data-bs-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            this.updateThemeIcon(newTheme);
        });
    }

    updateThemeIcon(theme) {
        const icon = document.querySelector('#themeToggle i');
        icon.className = theme === 'light' ? 'bi bi-moon-fill' : 'bi bi-sun-fill';
    }

    async loadMetrics() {
        try {
            const response = await fetch('/api/metrics');
            if (!response.ok) throw new Error('Failed to load metrics');

            const data = await response.json();
            document.getElementById('totalMatches').textContent = data.total_matches.toLocaleString();
            document.getElementById('totalCerts').textContent = data.total_certs.toLocaleString();
            document.getElementById('activeRules').textContent = data.rules_count.toLocaleString();

            // Format uptime
            const uptime = data.uptime_seconds;
            let uptimeStr = '';
            if (uptime < 60) {
                uptimeStr = uptime + 's';
            } else if (uptime < 3600) {
                uptimeStr = Math.floor(uptime / 60) + 'm';
            } else if (uptime < 86400) {
                uptimeStr = Math.floor(uptime / 3600) + 'h';
            } else {
                uptimeStr = Math.floor(uptime / 86400) + 'd';
            }
            document.getElementById('uptime').textContent = uptimeStr;

            // Show clear button if there are matches
            const clearBtn = document.getElementById('clearBtn');
            if (clearBtn && data.recent_matches > 0) {
                clearBtn.style.display = '';
            }

            this.updateStatusBadge(true);
        } catch (error) {
            console.error('Error loading metrics:', error);
            this.updateStatusBadge(false);
        }
    }

    async loadPerformanceMetrics() {
        try {
            const response = await fetch('/api/metrics/performance?minutes=60');
            if (!response.ok) throw new Error('Failed to load performance metrics');

            const data = await response.json();
            const current = data.current;

            if (current) {
                document.getElementById('certsPerMin').textContent = current.certs_per_minute.toLocaleString();
                document.getElementById('matchesPerMin').textContent = current.matches_per_minute.toLocaleString();
                document.getElementById('avgMatchTime').textContent = current.avg_match_time_us + ' μs';
                document.getElementById('cpuUsage').textContent = current.cpu_percent.toFixed(1) + '%';
                document.getElementById('memoryUsage').textContent = current.memory_used_mb.toFixed(1) + ' MB';
                document.getElementById('goroutines').textContent = current.goroutine_count.toLocaleString();
            }
        } catch (error) {
            console.error('Error loading performance metrics:', error);
        }
    }

    async loadMatches() {
        const timeRange = document.getElementById('timeRange').value;

        try {
            const response = await fetch(`/api/matches/recent?minutes=${timeRange}`);
            if (!response.ok) throw new Error('Failed to load matches');

            const data = await response.json();
            this.matches = data.matches || [];
            this.matches = this.sortByNewestFirst(this.matches);

            this.filterMatches();
            this.updateStatusBadge(true);
        } catch (error) {
            console.error('Error loading matches:', error);
            this.updateStatusBadge(false);
            this.matches = [];
            this.renderMatches();
        }
    }

    sortByNewestFirst(matches) {
        return matches.sort((a, b) => {
            const dateA = new Date(a.detected_at);
            const dateB = new Date(b.detected_at);
            return dateB - dateA;
        });
    }

    filterMatches() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const priorityFilter = document.getElementById('priorityFilter').value;

        this.filteredMatches = this.matches.filter(match => {
            const domainMatch = match.dns_names.some(domain =>
                domain.toLowerCase().includes(searchTerm)
            );
            const priorityMatch = !priorityFilter || match.priority === priorityFilter;
            return domainMatch && priorityMatch;
        });

        this.currentPage = 0;
        this.renderMatches();
    }

    renderMatches() {
        const tbody = document.getElementById('matchesTableBody');
        const start = this.currentPage * this.pageSize;
        const end = start + this.pageSize;
        const pageMatches = this.filteredMatches.slice(start, end);

        // Update counts
        document.getElementById('matchCount').textContent = `${this.filteredMatches.length} matches`;
        document.getElementById('matchCountFooter').textContent = `${this.filteredMatches.length} matches`;

        // Update pagination buttons
        document.getElementById('prevPage').disabled = this.currentPage === 0;
        document.getElementById('nextPage').disabled = end >= this.filteredMatches.length;

        if (pageMatches.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-5">
                        <i class="bi bi-inbox fs-1 d-block mb-2"></i>
                        No matches found. Adjust filters or wait for new certificates...
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = pageMatches.map(match => this.renderMatchRow(match)).join('');
    }

    renderMatchRow(match) {
        const timestamp = new Date(match.detected_at).toLocaleString();
        const domains = match.dns_names.slice(0, 3).join(', ') +
                       (match.dns_names.length > 3 ? ` (+${match.dns_names.length - 3} more)` : '');

        const priorityBadge = {
            critical: 'danger',
            high: 'warning',
            medium: 'info',
            low: 'secondary'
        }[match.priority] || 'secondary';

        const keywords = Array.isArray(match.matched_domains)
            ? match.matched_domains.join(', ')
            : match.matched_domains;

        return `
            <tr>
                <td><small>${this.escapeHtml(timestamp)}</small></td>
                <td>
                    <div class="text-truncate" style="max-width: 300px;" title="${this.escapeHtml(match.dns_names.join(', '))}">
                        ${this.escapeHtml(domains)}
                    </div>
                </td>
                <td><span class="badge bg-secondary">${this.escapeHtml(match.matched_rule)}</span></td>
                <td><span class="badge bg-${priorityBadge}">${this.escapeHtml(match.priority)}</span></td>
                <td><small><code>${this.escapeHtml(keywords)}</code></small></td>
                <td>
                    <a href="https://crt.sh/?q=${encodeURIComponent(match.tbs_sha256)}"
                       target="_blank"
                       rel="noopener noreferrer"
                       class="btn btn-sm btn-outline-primary"
                       title="View on crt.sh">
                        <i class="bi bi-box-arrow-up-right"></i>
                    </a>
                </td>
            </tr>
        `;
    }

    prevPage() {
        if (this.currentPage > 0) {
            this.currentPage--;
            this.renderMatches();
        }
    }

    nextPage() {
        const maxPage = Math.ceil(this.filteredMatches.length / this.pageSize) - 1;
        if (this.currentPage < maxPage) {
            this.currentPage++;
            this.renderMatches();
        }
    }

    startAutoRefresh() {
        // Refresh metrics and matches every 5 seconds
        this.refreshInterval = setInterval(() => {
            this.loadMetrics();
            this.loadMatches();
            this.loadPerformanceMetrics();
        }, 5000);
    }

    updateStatusBadge(online) {
        const badge = document.getElementById('statusBadge');
        if (online) {
            badge.className = 'badge bg-success';
            badge.innerHTML = '<i class="bi bi-check-circle me-1"></i>Online';
        } else {
            badge.className = 'badge bg-danger';
            badge.innerHTML = '<i class="bi bi-x-circle me-1"></i>Offline';
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize dashboard
const dashboard = new Dashboard();
