require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { fail } = require('./util/respond');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const dashboardRoutes = require('./routes/dashboard');
const notificationRoutes = require('./routes/notifications');

const app = express();
app.set('trust proxy', 1); // correct req.ip behind Render's proxy (login throttle)
app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
app.use(express.json({ limit: '256kb' }));

const frontendDir = path.join(__dirname, '..', 'frontend');
// Static files only from frontend/ (index:false keeps / mapped to login.html below).
app.use(express.static(frontendDir, { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));

app.get('/health', (req, res) => res.json({ success: true, data: { ok: true }, message: '' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.use('/api', (req, res) => fail(res, 404, 'Route not found.'));
app.get(/.*/, (req, res) => res.sendFile(path.join(frontendDir, 'login.html')));
app.use((err, req, res, next) => fail(res, 500, 'Something went wrong.'));

const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, () => {
  console.log('GameZone admin backend listening on port ' + PORT);
});
