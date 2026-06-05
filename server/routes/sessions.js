import { Router } from 'express';
import docsRouter from './docs.js';
import requestsRouter from './requests.js';
import tracesRouter from './traces.js';
import screenshotsRouter from './screenshots.js';
import annotationsRouter from './annotations.js';
import impactRouter from './impact.js';
import coreRouter from './core.js';

const router = Router();

// Literal-path routers first; coreRouter (which has the bare /:id param routes)
// MUST be mounted last so it doesn't shadow literal paths like /journey-docs,
// /aggregate/map, /impact, /requests/by-endpoints, /scrape.
router.use(docsRouter);
router.use(requestsRouter);
router.use(tracesRouter);
router.use(impactRouter);
router.use(screenshotsRouter);
router.use(annotationsRouter);
router.use(coreRouter);

export default router;
