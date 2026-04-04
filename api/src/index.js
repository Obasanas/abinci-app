// src/index.js — abinci API entry point
// NOTE: Run with: node --env-file=.env src/index.js
// Or set env vars directly. dotenv is not used (ESM import hoisting issue).

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './lib/logger.js';

import authRouter          from './routes/auth.js';
import ordersRouter        from './routes/orders.js';
import vendorsRouter       from './routes/vendors.js';
import driversRouter       from './routes/drivers.js';
import locationRouter      from './routes/location.js';
import notificationsRouter from './routes/notifications.js';
import reviewsRouter       from './routes/reviews.js';
import adminRouter         from './routes/admin.js';

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max:      parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
}));

app.use((req, _res, next) => { logger.debug(`${req.method} ${req.path}`); next(); });

app.use('/auth',          authRouter);
app.use('/orders',        ordersRouter);
app.use('/vendors',       vendorsRouter);
app.use('/drivers',       driversRouter);
app.use('/location',      locationRouter);
app.use('/notifications', notificationsRouter);
app.use('/reviews',       reviewsRouter);
app.use('/admin',         adminRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'abinci-api', ts: new Date().toISOString() }));
app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found` }));
app.use((err, req, res, _next) => { logger.error('Unhandled error', { error: err.message }); res.status(500).json({ error: 'Internal server error' }); });

app.listen(PORT, () => {
  logger.info(`abinci API on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

export default app;
