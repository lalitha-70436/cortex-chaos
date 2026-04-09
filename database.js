/**
 * CodeDynamos — Database Layer
 * Uses JSON files as persistent storage (swap for MongoDB/PostgreSQL in production)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../database/data');

class Database {
  constructor() {
    this._ensureDataDir();
    this._initIfEmpty();
  }

  // ─── INTERNAL HELPERS ───────────────────────────────────────────────────────
  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _read(file) {
    const fp = path.join(DATA_DIR, file + '.json');
    if (!fs.existsSync(fp)) return null;
    try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return null; }
  }

  _write(file, data) {
    const fp = path.join(DATA_DIR, file + '.json');
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  }

  _initIfEmpty() {
    const seedPath = path.join(__dirname, '../database/seed.json');
    if (!fs.existsSync(seedPath)) return;
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

    const tables = ['users','events','challenges','projects','team','leaderboard',
                    'suggestions','certificates','badges','coreBadges',
                    'feedbackSubmissions','gallery','announcements','submissions',
                    'registrations','votes','likes'];

    tables.forEach(t => {
      if (!this._read(t)) {
        this._write(t, seed[t] !== undefined ? seed[t] : (t === 'registrations' || t === 'votes' || t === 'likes' ? {} : []));
      }
    });
  }

  // ─── USERS ──────────────────────────────────────────────────────────────────
  getAllUsers() { return this._read('users') || []; }
  getUserByHandle(handle) { return this.getAllUsers().find(u => u.handle === handle) || null; }
  getUserByEmail(email) { return this.getAllUsers().find(u => u.email === email || u.handle + '@college.edu' === email) || null; }
  getUserByRole(role) { return this.getAllUsers().find(u => u.role === role) || null; }
  addUser(user) { const users = this.getAllUsers(); users.push(user); this._write('users', users); return user; }
  saveUsers() { /* no-op: updates mutate in-place via getAllUsers reference; call after mutations */ }

  // ─── EVENTS ─────────────────────────────────────────────────────────────────
  getAllEvents() { return this._read('events') || []; }
  getEventById(id) { return this.getAllEvents().find(e => e.id === id) || null; }
  addEvent(ev) {
    const events = this.getAllEvents();
    ev.id = Date.now();
    events.push(ev);
    this._write('events', events);
    return ev;
  }
  deleteEvent(id) {
    const events = this.getAllEvents().filter(e => e.id !== id);
    this._write('events', events);
  }
  saveEvents() { /* mutations handled per-method */ }

  registerEvent(eid, uid) {
    const regs = this._read('registrations') || {};
    if (!regs[eid]) regs[eid] = [];
    if (!regs[eid].includes(uid)) regs[eid].push(uid);
    this._write('registrations', regs);

    const events = this.getAllEvents();
    const ev = events.find(e => e.id === eid);
    if (ev) { ev.registrations = (ev.registrations || 0) + 1; this._write('events', events); }

    const users = this.getAllUsers();
    const u = users.find(u => u.handle === uid);
    if (u) { u.events = (u.events || 0) + 1; u.score = (u.score || 0) + 5; this._write('users', users); }
  }

  isRegistered(eid, uid) {
    const regs = this._read('registrations') || {};
    return !!((regs[eid] || []).includes(uid));
  }

  // ─── CHALLENGES ─────────────────────────────────────────────────────────────
  getAllChallenges() { return this._read('challenges') || []; }
  addChallenge(c) {
    const challenges = this.getAllChallenges();
    c.id = Date.now(); c.submissions = 0;
    challenges.push(c);
    this._write('challenges', challenges);
    return c;
  }
  deleteChallenge(id) { this._write('challenges', this.getAllChallenges().filter(c => c.id !== id)); }

  submitSolution(cid, uid, githubUrl, liveUrl, desc) {
    const subs = this.getSubmissions();
    const sub = { id: Date.now(), challengeId: cid, userId: uid, githubUrl, liveUrl, desc, date: new Date().toLocaleDateString(), status: 'pending', score: null };
    subs.push(sub);
    this._write('submissions', subs);

    const challenges = this.getAllChallenges();
    const ch = challenges.find(c => c.id === cid);
    if (ch) { ch.submissions = (ch.submissions || 0) + 1; this._write('challenges', challenges); }

    const users = this.getAllUsers();
    const u = users.find(u => u.handle === uid);
    if (u) { u.submissions = (u.submissions || 0) + 1; this._write('users', users); }

    return sub;
  }

  getSubmissions() { return this._read('submissions') || []; }

  scoreSubmission(subId, score) {
    const subs = this.getSubmissions();
    const sub = subs.find(s => s.id === subId);
    if (!sub) return;
    sub.score = score; sub.status = 'reviewed';
    this._write('submissions', subs);

    const users = this.getAllUsers();
    const u = users.find(u => u.handle === sub.userId);
    if (u) {
      u.score = (u.score || 0) + parseInt(score);
      this._write('users', users);
      const lb = this.getLeaderboard();
      const entry = lb.find(l => l.handle === sub.userId);
      if (entry) { entry.score = u.score; entry.submissions = u.submissions; }
      lb.sort((a, b) => b.score - a.score);
      lb.forEach((l, i) => l.rank = i + 1);
      this._write('leaderboard', lb);
    }
  }

  // ─── PROJECTS ───────────────────────────────────────────────────────────────
  getAllProjects() { return this._read('projects') || []; }
  getProjectById(id) { return this.getAllProjects().find(p => p.id === id) || null; }
  addProject(p) {
    const projects = this.getAllProjects();
    p.id = Date.now(); p.likes = p.likes || 0;
    projects.push(p);
    this._write('projects', projects);
    return p;
  }
  deleteProject(id) { this._write('projects', this.getAllProjects().filter(p => p.id !== id)); }
  saveProjects() {}

  toggleLike(pid, uid) {
    const likes = this._read('likes') || {};
    const key = pid + '_' + uid;
    const projects = this.getAllProjects();
    const p = projects.find(p => p.id === pid);
    if (!p) return false;
    if (likes[key]) { likes[key] = false; p.likes = Math.max(0, p.likes - 1); }
    else { likes[key] = true; p.likes++; }
    this._write('likes', likes);
    this._write('projects', projects);
    return likes[key];
  }
  isLiked(pid, uid) { return !!((this._read('likes') || {})[pid + '_' + uid]); }

  // ─── TEAM ────────────────────────────────────────────────────────────────────
  getAllTeam() { return this._read('team') || []; }
  addTeamMember(m) { const team = this.getAllTeam(); team.push(m); this._write('team', team); return m; }
  removeTeamMember(name) { this._write('team', this.getAllTeam().filter(m => m.name !== name)); }

  // ─── LEADERBOARD ─────────────────────────────────────────────────────────────
  getLeaderboard() { return this._read('leaderboard') || []; }

  // ─── SUGGESTIONS ─────────────────────────────────────────────────────────────
  getAllSuggestions() { return this._read('suggestions') || []; }
  addSuggestion(s) {
    const suggestions = this.getAllSuggestions();
    s.id = Date.now();
    suggestions.push(s);
    this._write('suggestions', suggestions);
    return s;
  }
  voteSuggestion(id, uid) {
    const votes = this._read('votes') || {};
    const key = id + '_' + uid;
    if (votes[key]) return false;
    votes[key] = true;
    this._write('votes', votes);
    const suggestions = this.getAllSuggestions();
    const s = suggestions.find(s => s.id === id);
    if (s) { s.votes++; this._write('suggestions', suggestions); }
    return true;
  }
  hasVoted(id, uid) { return !!((this._read('votes') || {})[id + '_' + uid]); }
  updateSuggestionStatus(id, status) {
    const suggestions = this.getAllSuggestions();
    const s = suggestions.find(s => s.id === id);
    if (s) { s.status = status; this._write('suggestions', suggestions); }
  }

  // ─── FEEDBACK ─────────────────────────────────────────────────────────────────
  getAllFeedback() { return this._read('feedbackSubmissions') || []; }
  submitFeedback(fb) {
    const feedbacks = this.getAllFeedback();
    fb.id = Date.now();
    feedbacks.push(fb);
    this._write('feedbackSubmissions', feedbacks);
    return fb;
  }
  hasFeedback(eid, uid) {
    return this.getAllFeedback().some(f => f.eventId === eid && f.userId === uid);
  }

  // ─── ANNOUNCEMENTS ───────────────────────────────────────────────────────────
  getAnnouncements() { return this._read('announcements') || []; }
  addAnnouncement(ann) {
    const anns = this.getAnnouncements();
    ann.id = Date.now(); ann.date = new Date().toLocaleDateString();
    anns.unshift(ann);
    this._write('announcements', anns);
    return ann;
  }

  // ─── GALLERY ─────────────────────────────────────────────────────────────────
  getGallery() { return this._read('gallery') || { albums: [], photos: [] }; }
  deleteAlbum(album) {
    const gallery = this.getGallery();
    gallery.photos = gallery.photos.filter(p => p.album !== album);
    gallery.albums = gallery.albums.filter(a => a !== album);
    this._write('gallery', gallery);
  }

  // ─── CERTIFICATES ─────────────────────────────────────────────────────────────
  getCertificates() { return this._read('certificates') || []; }

  // ─── BADGES ───────────────────────────────────────────────────────────────────
  getBadges() { return this._read('badges') || []; }
  getCoreBadges() { return this._read('coreBadges') || []; }
}

module.exports = Database;
