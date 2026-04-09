/**
 * CodeDynamos — Backend API Server
 * Express.js REST API
 * Run: npm install && npm start
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Database = require('./database');

const app = express();
const PORT = process.env.PORT || 3001;
const db = new Database();

app.use(cors());
app.use(bodyParser.json());

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const handle = req.headers['x-user-handle'];
  if (!handle) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const user = db.getUserByHandle(handle);
  if (!user) return res.status(401).json({ ok: false, error: 'User not found' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin only' });
    next();
  });
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.getUserByEmail(email);
  if (!user) return res.json({ ok: false, error: 'No account found with this email' });
  if (user.password && user.password !== password) return res.json({ ok: false, error: 'Incorrect password' });
  if (user.banned) return res.json({ ok: false, error: 'Account suspended. Contact admin.' });
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.post('/api/auth/oauth', (req, res) => {
  const { provider, handle, name } = req.body;
  // In production: verify OAuth token with Google/GitHub API
  // For demo: log in as member
  const user = db.getUserByRole('member');
  if (!user) return res.json({ ok: false, error: 'Demo user not found' });
  res.json({ ok: true, user: sanitizeUser(user), provider });
});

app.post('/api/auth/signup', (req, res) => {
  const { firstName, lastName, email, password, domain, role } = req.body;
  if (db.getUserByEmail(email)) return res.json({ ok: false, error: 'Email already registered' });
  const handle = firstName.toLowerCase().replace(/\s/g, '').slice(0, 6) + Math.floor(Math.random() * 99);
  const newUser = {
    name: firstName + (lastName ? ' ' + lastName : ''),
    handle, email, password,
    role: role || 'member',
    score: 0, submissions: 0, events: 0,
    rank: db.getAllUsers().length + 1,
    badges: ['🥇'], avatar: '🚀',
    color: 'rgba(0,245,212,0.2)', points: 0, domain,
    joinDate: new Date().toLocaleDateString()
  };
  db.addUser(newUser);
  res.json({ ok: true, user: sanitizeUser(newUser) });
});

// ─── USER ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/users', requireAdmin, (req, res) => {
  res.json({ ok: true, data: db.getAllUsers().map(sanitizeUser) });
});

app.get('/api/users/:handle', requireAuth, (req, res) => {
  const user = db.getUserByHandle(req.params.handle);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  res.json({ ok: true, data: sanitizeUser(user) });
});

app.patch('/api/users/:handle/promote', requireAdmin, (req, res) => {
  const user = db.getUserByHandle(req.params.handle);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  user.role = 'admin';
  db.saveUsers();
  res.json({ ok: true, data: sanitizeUser(user) });
});

app.patch('/api/users/:handle/ban', requireAdmin, (req, res) => {
  const user = db.getUserByHandle(req.params.handle);
  if (!user) return res.status(404).json({ ok: false, error: 'User not found' });
  user.banned = true;
  db.saveUsers();
  res.json({ ok: true, data: sanitizeUser(user) });
});

// ─── EVENTS ROUTES ───────────────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  const { status } = req.query;
  let events = db.getAllEvents();
  if (status) events = events.filter(e => e.status === status);
  res.json({ ok: true, data: events });
});

app.get('/api/events/:id', (req, res) => {
  const ev = db.getEventById(+req.params.id);
  if (!ev) return res.status(404).json({ ok: false, error: 'Event not found' });
  res.json({ ok: true, data: ev });
});

app.post('/api/events', requireAdmin, (req, res) => {
  const ev = db.addEvent(req.body);
  res.json({ ok: true, data: ev });
});

app.delete('/api/events/:id', requireAdmin, (req, res) => {
  db.deleteEvent(+req.params.id);
  res.json({ ok: true });
});

app.post('/api/events/:id/register', requireAuth, (req, res) => {
  const eid = +req.params.id;
  const uid = req.user.handle;
  const ev = db.getEventById(eid);
  if (!ev) return res.status(404).json({ ok: false, error: 'Event not found' });
  if (db.isRegistered(eid, uid)) return res.json({ ok: false, error: 'Already registered' });
  db.registerEvent(eid, uid);
  res.json({ ok: true, message: `Registered for ${ev.title}!` });
});

app.patch('/api/events/:id/feedback-toggle', requireAdmin, (req, res) => {
  const ev = db.getEventById(+req.params.id);
  if (!ev) return res.status(404).json({ ok: false, error: 'Event not found' });
  ev.feedbackEnabled = req.body.enabled;
  db.saveEvents();
  res.json({ ok: true, data: ev });
});

// ─── CHALLENGES ROUTES ────────────────────────────────────────────────────────
app.get('/api/challenges', (req, res) => {
  const { status, category } = req.query;
  let challenges = db.getAllChallenges();
  if (status) challenges = challenges.filter(c => c.status === status);
  if (category) challenges = challenges.filter(c => c.category === category);
  res.json({ ok: true, data: challenges });
});

app.post('/api/challenges', requireAdmin, (req, res) => {
  const c = db.addChallenge(req.body);
  res.json({ ok: true, data: c });
});

app.delete('/api/challenges/:id', requireAdmin, (req, res) => {
  db.deleteChallenge(+req.params.id);
  res.json({ ok: true });
});

app.post('/api/challenges/:id/submit', requireAuth, (req, res) => {
  const { githubUrl, liveUrl, desc } = req.body;
  const sub = db.submitSolution(+req.params.id, req.user.handle, githubUrl, liveUrl, desc);
  res.json({ ok: true, data: sub });
});

// ─── SUBMISSIONS ROUTES ────────────────────────────────────────────────────────
app.get('/api/submissions', requireAdmin, (req, res) => {
  res.json({ ok: true, data: db.getSubmissions() });
});

app.patch('/api/submissions/:id/score', requireAdmin, (req, res) => {
  db.scoreSubmission(+req.params.id, req.body.score);
  res.json({ ok: true });
});

// ─── PROJECTS ROUTES ─────────────────────────────────────────────────────────
app.get('/api/projects', (req, res) => {
  const { domain, featured } = req.query;
  let projects = db.getAllProjects();
  if (domain) projects = projects.filter(p => p.domain === domain);
  if (featured === 'true') projects = projects.filter(p => p.featured);
  res.json({ ok: true, data: projects });
});

app.post('/api/projects', requireAdmin, (req, res) => {
  const p = db.addProject(req.body);
  res.json({ ok: true, data: p });
});

app.delete('/api/projects/:id', requireAdmin, (req, res) => {
  db.deleteProject(+req.params.id);
  res.json({ ok: true });
});

app.patch('/api/projects/:id/feature', requireAdmin, (req, res) => {
  const p = db.getProjectById(+req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: 'Project not found' });
  p.featured = req.body.featured;
  db.saveProjects();
  res.json({ ok: true, data: p });
});

app.post('/api/projects/:id/like', requireAuth, (req, res) => {
  const liked = db.toggleLike(+req.params.id, req.user.handle);
  res.json({ ok: true, liked });
});

// ─── TEAM ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/team', (req, res) => {
  const { alumni } = req.query;
  let team = db.getAllTeam();
  if (alumni === 'false') team = team.filter(m => !m.alumni);
  if (alumni === 'true') team = team.filter(m => m.alumni);
  res.json({ ok: true, data: team });
});

app.post('/api/team', requireAdmin, (req, res) => {
  const m = db.addTeamMember(req.body);
  res.json({ ok: true, data: m });
});

app.delete('/api/team/:name', requireAdmin, (req, res) => {
  db.removeTeamMember(req.params.name);
  res.json({ ok: true });
});

// ─── LEADERBOARD ROUTES ───────────────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const { limit } = req.query;
  let lb = db.getLeaderboard();
  if (limit) lb = lb.slice(0, +limit);
  res.json({ ok: true, data: lb });
});

// ─── SUGGESTIONS ROUTES ───────────────────────────────────────────────────────
app.get('/api/suggestions', (req, res) => {
  const { status } = req.query;
  let suggestions = db.getAllSuggestions();
  if (status) suggestions = suggestions.filter(s => s.status === status);
  res.json({ ok: true, data: suggestions });
});

app.post('/api/suggestions', requireAuth, (req, res) => {
  const s = db.addSuggestion({ ...req.body, by: '@' + req.user.handle, votes: 0, status: 'pending' });
  res.json({ ok: true, data: s });
});

app.post('/api/suggestions/:id/vote', requireAuth, (req, res) => {
  const voted = db.voteSuggestion(+req.params.id, req.user.handle);
  if (!voted) return res.json({ ok: false, error: 'Already voted' });
  res.json({ ok: true });
});

app.patch('/api/suggestions/:id/status', requireAdmin, (req, res) => {
  db.updateSuggestionStatus(+req.params.id, req.body.status);
  res.json({ ok: true });
});

// ─── FEEDBACK ROUTES ──────────────────────────────────────────────────────────
app.get('/api/feedback', requireAdmin, (req, res) => {
  res.json({ ok: true, data: db.getAllFeedback() });
});

app.post('/api/feedback', requireAuth, (req, res) => {
  const { eventId, rating, comment } = req.body;
  if (db.hasFeedback(eventId, req.user.handle)) return res.json({ ok: false, error: 'Already submitted feedback' });
  const fb = db.submitFeedback({
    eventId, rating, comment,
    by: '@' + req.user.handle,
    userId: req.user.handle,
    event: db.getEventById(eventId)?.title || '',
    date: new Date().toLocaleDateString()
  });
  res.json({ ok: true, data: fb });
});

// ─── ANNOUNCEMENTS ROUTES ─────────────────────────────────────────────────────
app.get('/api/announcements', (req, res) => {
  res.json({ ok: true, data: db.getAnnouncements() });
});

app.post('/api/announcements', requireAdmin, (req, res) => {
  const ann = db.addAnnouncement(req.body);
  res.json({ ok: true, data: ann });
});

// ─── GALLERY ROUTES ───────────────────────────────────────────────────────────
app.get('/api/gallery', (req, res) => {
  res.json({ ok: true, data: db.getGallery() });
});

app.delete('/api/gallery/albums/:album', requireAdmin, (req, res) => {
  db.deleteAlbum(req.params.album);
  res.json({ ok: true });
});

// ─── CERTIFICATES ROUTES ──────────────────────────────────────────────────────
app.get('/api/certificates', requireAuth, (req, res) => {
  res.json({ ok: true, data: db.getCertificates() });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'CodeDynamos API running', version: '1.0.0' });
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ CodeDynamos API running on http://localhost:${PORT}`);
});

module.exports = app;
