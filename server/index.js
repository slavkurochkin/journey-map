import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import analyzeRouter from './routes/analyze.js';
import sessionsRouter from './routes/sessions.js';
import settingsRouter from './routes/settings.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Allow the web client and the recorder extension (chrome-extension:// origin).
app.use(cors({
  origin(origin, cb) {
    const allowed = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
    // No origin (curl, same-origin), the web client, or any extension origin
    if (!origin || origin === allowed || origin.startsWith('chrome-extension://')) {
      return cb(null, true);
    }
    cb(null, true); // local dev tool — permissive; tighten for production
  },
}));
app.use(express.json({ limit: '25mb' })); // recordings with screenshots can be large
app.use('/api', analyzeRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/settings', settingsRouter);

app.listen(PORT, () => console.log(`Server → http://localhost:${PORT}`));
